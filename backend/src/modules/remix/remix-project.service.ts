import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import {
  RemixEligibilityService,
  type RemixEligibilityResult,
} from "./remix-eligibility.service";
import {
  buildRemixGenerationInput,
  REMIX_GENERATION_PROVIDER,
  RemixGenerationProviderError,
  type RemixGenerationConstraints,
  type RemixGenerationProvider,
} from "./remix-generation.provider";

export const REMIX_PROJECT_MODES = ["stem_mix", "variation", "extension"] as const;
export type RemixProjectMode = (typeof REMIX_PROJECT_MODES)[number];

export const REMIX_PROJECT_STATUSES = ["draft", "archived"] as const;
export type RemixProjectStatus = (typeof REMIX_PROJECT_STATUSES)[number];

export type RemixProjectStemUpdate = {
  stemId: string;
  role?: string | null;
  gainDb?: number | null;
  muted?: boolean;
  arrangement?: unknown;
};

type RemixProjectWithStems = NonNullable<
  Awaited<ReturnType<typeof loadProject>>
>;

/**
 * Shared read shape: stem catalog labels and the public source-track summary
 * (titles, artist credit, rights route, content status) that studio surfaces
 * render without extra round-trips.
 */
const PROJECT_INCLUDE = {
  stems: {
    orderBy: { stemId: "asc" },
    include: { stem: { select: { type: true, title: true } } },
  },
  sourceTrack: {
    select: {
      title: true,
      artist: true,
      rightsRoute: true,
      contentStatus: true,
      release: {
        select: {
          id: true,
          // Analytics attribution (#1121): remix.project_created facts
          // aggregate under the source artist in the warehouse.
          artistId: true,
          title: true,
          primaryArtist: true,
          rightsRoute: true,
        },
      },
    },
  },
} as const;

function loadProject(projectId: string) {
  return prisma.remixProject.findUnique({
    where: { id: projectId },
    include: PROJECT_INCLUDE,
  });
}

@Injectable()
export class RemixProjectService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly eligibilityService: RemixEligibilityService,
    @Inject(REMIX_GENERATION_PROVIDER)
    private readonly generationProvider: RemixGenerationProvider,
  ) {}

  async createProject(input: {
    userId: string;
    sourceTrackId: string;
    stemIds: string[];
    title: string;
    mode?: string;
    prompt?: string | null;
  }) {
    const title = input.title?.trim();
    if (!title) {
      throw new BadRequestException("title is required");
    }
    if (!input.sourceTrackId) {
      throw new BadRequestException("sourceTrackId is required");
    }
    if (!Array.isArray(input.stemIds) || input.stemIds.length === 0) {
      throw new BadRequestException("stemIds must contain at least one stem");
    }
    const mode = input.mode ?? "stem_mix";
    if (!REMIX_PROJECT_MODES.includes(mode as RemixProjectMode)) {
      throw new BadRequestException(
        `mode must be one of: ${REMIX_PROJECT_MODES.join(", ")}`,
      );
    }

    // Eligibility is evaluated at creation time only; private drafts stay
    // editable if the source state later changes. Any future publish/export
    // endpoint must re-run checkEligibility before releasing work.
    const eligibility = await this.eligibilityService.checkEligibility({
      userId: input.userId,
      trackId: input.sourceTrackId,
      stemIds: input.stemIds,
    });
    if (!eligibility.allowed) {
      this.publishDenialEvents(input, eligibility);
      throw new ForbiddenException({
        message: "Remix project creation is not allowed for this source",
        eligibility,
      });
    }

    const stemIds = Array.from(new Set(input.stemIds));
    const project = await prisma.remixProject.create({
      data: {
        creatorUserId: input.userId,
        sourceTrackId: input.sourceTrackId,
        title,
        mode,
        prompt: input.prompt ?? null,
        policyVersion: eligibility.policyVersion,
        stems: { create: stemIds.map((stemId) => ({ stemId })) },
      },
      include: PROJECT_INCLUDE,
    });

    // Artist attribution (#1121): the signal belongs to the artist whose
    // track is being remixed. Without artistId in the payload the warehouse
    // aggregates the fact under "unknown" and the source artist's action
    // cockpit never sees it.
    const sourceArtistId = project.sourceTrack?.release?.artistId ?? null;

    this.eventBus.publish({
      eventName: "remix.project_created",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      remixProjectId: project.id,
      creatorId: input.userId,
      sourceTrackId: input.sourceTrackId,
      ...(sourceArtistId ? { artistId: sourceArtistId } : {}),
      stemIds,
      mode,
      policyVersion: eligibility.policyVersion,
    });

    return this.toResponse(project, eligibility);
  }

  async getProject(userId: string, projectId: string) {
    const project = await this.loadOwnedProject(userId, projectId);
    return this.toResponse(project);
  }

  async listProjects(userId: string) {
    const projects = await prisma.remixProject.findMany({
      where: { creatorUserId: userId },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return projects.map((project) => this.toResponse(project));
  }

  async updateProject(
    userId: string,
    projectId: string,
    patch: {
      title?: string;
      prompt?: string | null;
      status?: string;
      mode?: string;
      stems?: RemixProjectStemUpdate[];
    },
  ) {
    const project = await this.loadOwnedProject(userId, projectId);

    if (patch.status !== undefined) {
      if (!REMIX_PROJECT_STATUSES.includes(patch.status as RemixProjectStatus)) {
        throw new BadRequestException(
          `status must be one of: ${REMIX_PROJECT_STATUSES.join(", ")}`,
        );
      }
    }
    if (patch.mode !== undefined) {
      if (!REMIX_PROJECT_MODES.includes(patch.mode as RemixProjectMode)) {
        throw new BadRequestException(
          `mode must be one of: ${REMIX_PROJECT_MODES.join(", ")}`,
        );
      }
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new BadRequestException("title cannot be empty");
    }

    const projectStemIds = new Set(project.stems.map((stem) => stem.stemId));
    const stemUpdates = patch.stems ?? [];
    const unknownStemIds = stemUpdates
      .map((stem) => stem.stemId)
      .filter((stemId) => !projectStemIds.has(stemId));
    if (unknownStemIds.length > 0) {
      throw new BadRequestException(
        `Stems are not part of this project: ${unknownStemIds.join(", ")}`,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      for (const stem of stemUpdates) {
        await tx.remixProjectStem.updateMany({
          where: { remixProjectId: project.id, stemId: stem.stemId },
          data: {
            ...(stem.role !== undefined ? { role: stem.role } : {}),
            ...(stem.gainDb !== undefined ? { gainDb: stem.gainDb } : {}),
            ...(stem.muted !== undefined ? { muted: stem.muted } : {}),
            ...(stem.arrangement !== undefined
              ? { arrangement: stem.arrangement as object }
              : {}),
          },
        });
      }
      return tx.remixProject.update({
        where: { id: project.id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
          ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
        },
        include: PROJECT_INCLUDE,
      });
    });

    return this.toResponse(updated);
  }

  /**
   * Starts an AI remix draft through the provider boundary. Eligibility is
   * re-checked here: generation is a rights-relevant action, so the
   * creation-time decision is not trusted (source state may have changed).
   */
  async generateDraft(
    userId: string,
    projectId: string,
    options: { constraints?: RemixGenerationConstraints; force?: boolean } = {},
  ) {
    const project = await this.loadOwnedProject(userId, projectId);
    const stemIds = project.stems.map((stem) => stem.stemId);

    if (project.status !== "draft") {
      throw new BadRequestException(
        "Only draft projects can generate remix drafts",
      );
    }
    if (project.generationJobId && !options.force) {
      throw new BadRequestException(
        `A generation job (${project.generationJobId}) is already recorded for this project. Retry semantics arrive with queued generation; pass force=true to overwrite.`,
      );
    }
    if (
      (project.mode === "variation" || project.mode === "extension") &&
      !project.prompt?.trim()
    ) {
      throw new BadRequestException(
        `A prompt is required for ${project.mode} mode`,
      );
    }

    const eligibility = await this.eligibilityService.checkEligibility({
      userId,
      trackId: project.sourceTrackId,
      stemIds,
    });
    if (!eligibility.allowed) {
      this.publishDenialEvents(
        { userId, sourceTrackId: project.sourceTrackId, stemIds },
        eligibility,
      );
      throw new ForbiddenException({
        message: "Remix generation is not allowed for this source",
        eligibility,
      });
    }

    const input = buildRemixGenerationInput(
      {
        id: project.id,
        creatorUserId: project.creatorUserId,
        sourceTrackId: project.sourceTrackId,
        mode: project.mode,
        prompt: project.prompt,
        licenseType: project.licenseType,
        licenseId: project.licenseId,
        policyVersion: project.policyVersion,
        source: {
          rightsRoute:
            project.sourceTrack.rightsRoute ??
            project.sourceTrack.release.rightsRoute ??
            null,
          contentStatus: project.sourceTrack.contentStatus,
        },
        stems: project.stems,
      },
      options.constraints,
    );
    let job;
    try {
      job = await this.generationProvider.createRemixDraft(input);
    } catch (error) {
      // Keep the boundary contract total: unknown provider exceptions are
      // normalized so the failed event and the HTTP error shape always fire.
      const normalized =
        error instanceof RemixGenerationProviderError
          ? error
          : new RemixGenerationProviderError(
              "provider_unavailable",
              "The remix generation provider failed unexpectedly. Please try again later.",
              true,
            );
      this.eventBus.publish({
        eventName: "remix.generation_failed",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        remixProjectId: project.id,
        creatorId: userId,
        sourceTrackId: project.sourceTrackId,
        errorCode: normalized.code,
        policyVersion: eligibility.policyVersion,
      });
      throw normalized;
    }

    // Conditional write so a concurrent generate cannot clobber recorded
    // provenance (the pre-check above is read-then-act). Double provider
    // execution itself is prevented by queued jobs in D3.
    const claimed = await prisma.remixProject.updateMany({
      where: {
        id: project.id,
        ...(options.force ? {} : { generationJobId: null }),
      },
      data: {
        generationProvider: job.provider,
        generationJobId: job.jobId,
        generationMetadata: {
          mode: input.mode,
          stemIds: input.stemIds,
          constraints: input.constraints as object,
          estimatedCostUsd: job.estimatedCostUsd ?? null,
          policyVersion: eligibility.policyVersion,
          voiceLikenessAllowed: false,
          output: job.outputMetadata,
          requestedAt: new Date().toISOString(),
        },
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestException(
        "A generation job was recorded by a concurrent request; reload the project.",
      );
    }
    const updated = (await loadProject(project.id))!;

    this.eventBus.publish({
      eventName: "remix.generation_started",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      remixProjectId: project.id,
      creatorId: userId,
      sourceTrackId: project.sourceTrackId,
      provider: job.provider,
      generationJobId: job.jobId,
      mode: input.mode,
      policyVersion: eligibility.policyVersion,
    });

    return this.toResponse(updated);
  }

  private async loadOwnedProject(userId: string, projectId: string) {
    const project = await loadProject(projectId);
    if (!project) {
      throw new NotFoundException(`Remix project ${projectId} not found`);
    }
    if (project.creatorUserId !== userId) {
      throw new ForbiddenException(
        "You do not have access to this remix project",
      );
    }
    return project;
  }

  private publishDenialEvents(
    input: { userId: string; sourceTrackId: string; stemIds: string[] },
    eligibility: RemixEligibilityResult,
  ) {
    const occurredAt = new Date().toISOString();
    if (eligibility.requiredLicense) {
      this.eventBus.publish({
        eventName: "remix.license_required",
        eventVersion: 1,
        occurredAt,
        creatorId: input.userId,
        sourceTrackId: input.sourceTrackId,
        stemIds: input.stemIds,
        requiredLicense: eligibility.requiredLicense,
        policyVersion: eligibility.policyVersion,
      });
      return;
    }
    this.eventBus.publish({
      eventName: "remix.policy_rejected",
      eventVersion: 1,
      occurredAt,
      creatorId: input.userId,
      sourceTrackId: input.sourceTrackId,
      stemIds: input.stemIds,
      reasonCodes: eligibility.reasons.map((reason) => reason.code),
      policyVersion: eligibility.policyVersion,
    });
  }

  private toResponse(
    project: RemixProjectWithStems,
    eligibility?: RemixEligibilityResult,
  ) {
    return {
      id: project.id,
      creatorUserId: project.creatorUserId,
      sourceTrackId: project.sourceTrackId,
      title: project.title,
      status: project.status,
      mode: project.mode,
      licenseType: project.licenseType,
      licenseId: project.licenseId,
      prompt: project.prompt,
      generationProvider: project.generationProvider,
      generationJobId: project.generationJobId,
      generationMetadata: project.generationMetadata,
      attribution: project.attribution,
      exportPolicy: project.exportPolicy,
      policyVersion: project.policyVersion,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      source: {
        trackId: project.sourceTrackId,
        trackTitle: project.sourceTrack.title,
        releaseId: project.sourceTrack.release.id,
        releaseTitle: project.sourceTrack.release.title,
        artistName:
          project.sourceTrack.artist ??
          project.sourceTrack.release.primaryArtist ??
          null,
        rightsRoute:
          project.sourceTrack.rightsRoute ??
          project.sourceTrack.release.rightsRoute ??
          null,
        contentStatus: project.sourceTrack.contentStatus,
      },
      stems: project.stems.map((stem) => ({
        stemId: stem.stemId,
        type: stem.stem.type,
        title: stem.stem.title,
        role: stem.role,
        gainDb: stem.gainDb,
        muted: stem.muted,
        arrangement: stem.arrangement,
      })),
      ...(eligibility ? { eligibility } : {}),
    };
  }
}
