import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import {
  RemixEligibilityService,
  type RemixEligibilityResult,
} from "./remix-eligibility.service";

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

function loadProject(projectId: string) {
  return prisma.remixProject.findUnique({
    where: { id: projectId },
    include: { stems: { orderBy: { stemId: "asc" } } },
  });
}

@Injectable()
export class RemixProjectService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly eligibilityService: RemixEligibilityService,
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
      include: { stems: { orderBy: { stemId: "asc" } } },
    });

    this.eventBus.publish({
      eventName: "remix.project_created",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      remixProjectId: project.id,
      creatorId: input.userId,
      sourceTrackId: input.sourceTrackId,
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
      include: { stems: { orderBy: { stemId: "asc" } } },
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
        },
        include: { stems: { orderBy: { stemId: "asc" } } },
      });
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
      stems: project.stems.map((stem) => ({
        stemId: stem.stemId,
        role: stem.role,
        gainDb: stem.gainDb,
        muted: stem.muted,
        arrangement: stem.arrangement,
      })),
      ...(eligibility ? { eligibility } : {}),
    };
  }
}
