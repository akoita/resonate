import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
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
  type StemRenderAuthorization,
  validateStemTransform,
  type RemixStemTransform,
} from "./remix-generation.provider";
import { StorageProvider } from "../storage/storage_provider";
import {
  REMIX_STEM_MIX_RENDERER,
  type StemMixRenderer,
} from "./remix-stem-mix.renderer";
import {
  REMIX_LAYERED_RENDERER,
  type LayeredRemixRenderer,
} from "./remix-layered-renderer";
import { UPLOAD_RIGHTS_POLICY_VERSION } from "../rights/upload-rights-policy";
import {
  activeIntervalsForArrangement,
  deriveSectionGrid,
  parseStemArrangement,
  validateStemArrangementInput,
} from "./remix-arrangement";
import {
  isValidRemixStemGainDb,
  REMIX_STEM_GAIN_DB_MAX,
  REMIX_STEM_GAIN_DB_MIN,
} from "./remix-gain";

export const REMIX_PROJECT_MODES = ["stem_mix", "variation", "extension"] as const;
export type RemixProjectMode = (typeof REMIX_PROJECT_MODES)[number];

/** Statuses a PATCH may set. "published" is reachable only through publish. */
export const REMIX_PROJECT_STATUSES = ["draft", "archived"] as const;
export type RemixProjectStatus = (typeof REMIX_PROJECT_STATUSES)[number];

// Published remix releases carry catalog rights provenance like AI-generated
// releases do: the route is platform policy, not creator proof-of-control
// evidence. The reason copy is honest about where the audio came from.
const REMIX_PUBLISH_RIGHTS_SOURCE = "remix_publish";
const REMIX_PUBLISH_RIGHTS_REASON =
  "This release was published from a Resonate Remix Studio draft of licensed source material. Rights routing uses the platform remix-publication policy; source lineage is recorded on the track.";
export const REMIX_GENERATION_QUEUE = "remix-generation";

export type RemixGenerationLifecycleStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

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

export type RemixDraftAudio = {
  data: Buffer;
  mimeType: string;
};

export type RemixGenerationJobData = {
  jobId: string;
  userId: string;
  projectId: string;
  generationInput: ReturnType<typeof buildRemixGenerationInput>;
};

/**
 * Review fix (#1165): the D2 Lyria provider stores .wav files, so a
 * hardcoded audio/mpeg lied to players about the codec. Matches the
 * extension anywhere in the URI because the local provider's URIs end in
 * a /blob segment rather than the filename.
 */
export function draftMimeTypeFromUri(uri: string): string {
  const normalized = uri.toLowerCase();
  if (normalized.includes(".wav")) return "audio/wav";
  if (normalized.includes(".mp3") || normalized.includes(".mpeg")) {
    return "audio/mpeg";
  }
  if (normalized.includes(".ogg")) return "audio/ogg";
  return "application/octet-stream";
}

/** Stored mime recorded by the provider at write time (#1166 review port). */
export function draftMimeTypeFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const output = (metadata as { output?: unknown }).output;
  if (!output || typeof output !== "object") return null;
  const mimeType = (output as { mimeType?: unknown }).mimeType;
  return typeof mimeType === "string" && mimeType.trim() ? mimeType : null;
}

export function draftOutputUriFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const output = (metadata as { output?: unknown }).output;
  if (!output || typeof output !== "object") {
    return null;
  }
  const outputUri = (output as { outputUri?: unknown }).outputUri;
  return typeof outputUri === "string" && outputUri.trim()
    ? outputUri
    : null;
}

export type RemixDraftGrounding =
  | "stem_audio"
  | "stem_plus_ai"
  | "audio_conditioned"
  | "feature_conditioned"
  | "prompt_only";

/** Honest provenance recorded at generation time (#1181/#1192). */
export function draftGroundingFromMetadata(
  metadata: unknown,
): RemixDraftGrounding | null {
  if (!metadata || typeof metadata !== "object") return null;
  const grounding = (metadata as { grounding?: unknown }).grounding;
  return grounding === "stem_audio" ||
    grounding === "stem_plus_ai" ||
    grounding === "audio_conditioned" ||
    grounding === "feature_conditioned" ||
    grounding === "prompt_only"
    ? grounding
    : null;
}

function groundingAiGenerated(grounding: RemixDraftGrounding): boolean {
  return grounding !== "stem_audio";
}

/** Archived draft versions kept when a project regenerates (#1320). */
export const REMIX_PREVIOUS_DRAFTS_MAX = 3;

export type RemixPreviousDraft = {
  /** The archived generation's queue job id — the draft-audio version key. */
  jobId: string;
  provider: string | null;
  mode: string | null;
  grounding: string | null;
  stemTransform: unknown;
  estimatedCostUsd: number | null;
  completedAt: string | null;
  output: { outputUri: string; mimeType: string | null };
};

/** Read the archived versions list from generation metadata (#1320). */
export function previousDraftsFromMetadata(
  metadata: unknown,
): RemixPreviousDraft[] {
  if (!metadata || typeof metadata !== "object") return [];
  const list = (metadata as { previousDrafts?: unknown }).previousDrafts;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is RemixPreviousDraft =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as RemixPreviousDraft).jobId === "string" &&
      typeof (entry as RemixPreviousDraft).output?.outputUri === "string",
  );
}

/**
 * Build the archive entry for the project's CURRENT completed draft before a
 * regeneration overwrites its metadata (#1320). Returns null when there is
 * nothing playable to archive (no completed output).
 */
export function archiveEntryFromProject(project: {
  generationJobId: string | null;
  generationProvider: string | null;
  generationMetadata: unknown;
}): RemixPreviousDraft | null {
  if (!project.generationJobId) return null;
  const metadata = normalizeMetadataObject(project.generationMetadata);
  if (metadata.status !== "completed") return null;
  const outputUri = draftOutputUriFromMetadata(metadata);
  if (!outputUri) return null;
  return {
    jobId: project.generationJobId,
    provider: project.generationProvider,
    mode: typeof metadata.mode === "string" ? metadata.mode : null,
    grounding: draftGroundingFromMetadata(metadata),
    stemTransform:
      metadata.stemTransform && typeof metadata.stemTransform === "object"
        ? metadata.stemTransform
        : null,
    estimatedCostUsd:
      typeof metadata.estimatedCostUsd === "number"
        ? metadata.estimatedCostUsd
        : null,
    completedAt:
      typeof metadata.completedAt === "string" ? metadata.completedAt : null,
    output: {
      outputUri,
      mimeType: draftMimeTypeFromMetadata(metadata),
    },
  };
}

function selectRemixDraftGrounding(input: {
  mode: RemixProjectMode;
  sourceFeatureHints?: unknown;
  providerKind?: string | null;
}): RemixDraftGrounding {
  if (input.mode === "stem_mix") return "stem_audio";
  if (input.providerKind === "audio-conditioned") return "audio_conditioned";
  if (input.providerKind === "lyria") return "stem_plus_ai";
  return input.sourceFeatureHints ? "feature_conditioned" : "prompt_only";
}

export function remixGenerationStatusFromMetadata(
  metadata: unknown,
): RemixGenerationLifecycleStatus | null {
  if (!metadata || typeof metadata !== "object") return null;
  const status = (metadata as { status?: unknown }).status;
  return status === "pending" ||
    status === "processing" ||
    status === "completed" ||
    status === "failed"
    ? status
    : null;
}

/**
 * Full-mix stem types are the complete mixdown, not a layer: auto-adding one
 * next to separated stems would double the audio (the stems already sum to
 * it). Mirrors the player's isMixerStem() exclusion. Tracks whose ONLY stem
 * is a full mix keep it via the explicit selection; hydration just never
 * volunteers one.
 */
const FULL_MIX_STEM_TYPES = new Set(["original", "master"]);

function isFullMixStemType(type: string | null | undefined): boolean {
  const normalized = type?.trim().toLowerCase();
  return !!normalized && FULL_MIX_STEM_TYPES.has(normalized);
}

/**
 * Shared read shape: stem catalog labels and the public source-track summary
 * (titles, artist credit, rights route, content status) that studio surfaces
 * render without extra round-trips.
 */
const PROJECT_INCLUDE = {
  stems: {
    orderBy: { stemId: "asc" },
    // audioFeatures: worker-measured tempo/key/energy (#1184) for
    // grounding slices (feature-conditioned prompts, render alignment).
    include: {
      stem: { select: { type: true, title: true, audioFeatures: true } },
    },
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

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function rateLimitFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class RemixProjectService {
  // Pre-public-launch abuse limits (#1144), mirroring the catalog
  // generation pattern: per-user sliding window, env-configurable.
  // Generation is stricter than drafting since it will carry real
  // provider cost once backlog D2 ships.
  private readonly maxProjectsPerHour = rateLimitFromEnv(
    "REMIX_PROJECT_RATE_LIMIT",
    20,
  );
  private readonly maxGenerationsPerHour = rateLimitFromEnv(
    "REMIX_GENERATION_RATE_LIMIT",
    10,
  );
  // A pending/processing job whose worker died (deploy, OOM, lost Redis
  // job) has no in-band path back to a terminal state — the in-process
  // worker is the only writer. After this window an explicit retry may
  // reclaim the project instead of hitting the active-job conflict.
  private readonly generationStaleAfterMs = rateLimitFromEnv(
    "REMIX_GENERATION_STALE_AFTER_MS",
    15 * 60 * 1000,
  );
  private readonly rateLimits = new Map<string, number[]>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly eligibilityService: RemixEligibilityService,
    @Inject(REMIX_GENERATION_PROVIDER)
    private readonly generationProvider: RemixGenerationProvider,
    @Inject(REMIX_STEM_MIX_RENDERER)
    private readonly stemMixRenderer: StemMixRenderer,
    private readonly storageProvider: StorageProvider,
    @InjectQueue(REMIX_GENERATION_QUEUE)
    private readonly generationQueue: Queue<RemixGenerationJobData>,
    @Inject(REMIX_LAYERED_RENDERER)
    private readonly layeredRenderer?: LayeredRemixRenderer,
  ) {}

  /**
   * Per-user sliding-window limit. 429 (not the catalog's 400) so agent
   * and frontend callers can distinguish throttling from invalid input.
   */
  private enforceRateLimit(
    action: "create" | "generate",
    userId: string,
    maxPerHour: number,
  ): void {
    const key = `${action}:${userId}`;
    const now = Date.now();
    const timestamps = (this.rateLimits.get(key) ?? []).filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
    );
    if (timestamps.length >= maxPerHour) {
      throw new HttpException(
        `Rate limit exceeded: maximum ${maxPerHour} remix ${
          action === "create" ? "project creations" : "generation requests"
        } per hour. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    timestamps.push(now);
    this.rateLimits.set(key, timestamps);
  }

  async createProject(input: {
    userId: string;
    sourceTrackId: string;
    stemIds: string[];
    title: string;
    mode?: string;
    prompt?: string | null;
  }) {
    this.enforceRateLimit("create", input.userId, this.maxProjectsPerHour);

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
    // Full-session hydration (#1312): a stem-scoped entry (stem page, library
    // chip) used to create a one-channel session even when the source track had
    // more individually eligible stems. Auto-add every eligible sibling, muted,
    // so the studio opens as a full desk. Each hydrated stem satisfies the
    // strict per-stem rule (licensed + not minted non-remixable), so the
    // generation/publish re-checks over the full project still pass.
    const hydratedStemIds = await this.resolveEligibleSiblingStemIds(
      input.userId,
      input.sourceTrackId,
      stemIds,
    );
    const project = await prisma.remixProject.create({
      data: {
        creatorUserId: input.userId,
        sourceTrackId: input.sourceTrackId,
        title,
        mode,
        prompt: input.prompt ?? null,
        policyVersion: eligibility.policyVersion,
        stems: {
          create: [
            ...stemIds.map((stemId) => ({ stemId })),
            ...hydratedStemIds.map((stemId) => ({ stemId, muted: true })),
          ],
        },
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
      // Distinguishes artist-owner remixes from licensed-buyer remixes
      // (#1174) so demand signals don't count artists remixing themselves.
      creatorOwner: eligibility.creatorOwner,
      policyVersion: eligibility.policyVersion,
    });

    return this.toResponse(project, eligibility);
  }

  async getProject(userId: string, projectId: string) {
    const project = await this.loadOwnedProject(userId, projectId);
    const response = this.toResponse(project);
    // Sibling availability (#1312): draft studios render an "Also on this
    // track" panel from this — licensed siblings are one click from active,
    // unlicensed ones route to the remix-tier purchase. Published projects are
    // locked, so the panel (and the extra eligibility work) is skipped.
    if (project.status !== "draft") {
      return response;
    }
    return {
      ...response,
      availableStems: await this.resolveAvailableStems(userId, project),
    };
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
      /**
       * Stems to add to the session (#1312) — e.g. a sibling stem whose remix
       * license was bought after the project was created, or healing an older
       * one-channel project. Every added stem is re-checked against the strict
       * eligibility rule before it joins the project.
       */
      addStemIds?: string[];
    },
  ) {
    const project = await this.loadOwnedProject(userId, projectId);

    // Published projects stay readable but are locked (#1196): the draft is
    // now public catalog audio, so edits would silently desync the release.
    if (project.status === "published") {
      throw new ConflictException({
        code: "project_published",
        message:
          "This remix project was published and can no longer be edited.",
        ...(project.publishedReleaseId
          ? { releaseId: project.publishedReleaseId }
          : {}),
      });
    }

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
    const invalidGain = stemUpdates.find(
      (stem) =>
        stem.gainDb !== undefined &&
        stem.gainDb !== null &&
        !isValidRemixStemGainDb(stem.gainDb),
    );
    if (invalidGain) {
      throw new BadRequestException(
        `gainDb must be null or a finite number between ${REMIX_STEM_GAIN_DB_MIN} and ${REMIX_STEM_GAIN_DB_MAX}`,
      );
    }
    const unknownStemIds = stemUpdates
      .map((stem) => stem.stemId)
      .filter((stemId) => !projectStemIds.has(stemId));
    if (unknownStemIds.length > 0) {
      throw new BadRequestException(
        `Stems are not part of this project: ${unknownStemIds.join(", ")}`,
      );
    }

    // Section-grid arrangement masks (#1314) must match the grid the studio
    // derived for this source; a null payload restores the always-on default.
    if (stemUpdates.some((stem) => stem.arrangement !== undefined)) {
      const sectionGrid = deriveSectionGrid(
        project.stems.map((stem) => ({
          audioFeatures: stem.stem.audioFeatures,
        })),
      );
      for (const stem of stemUpdates) {
        if (stem.arrangement === undefined) continue;
        const problem = validateStemArrangementInput(
          stem.arrangement,
          sectionGrid,
        );
        if (problem) {
          throw new BadRequestException(`Stem ${stem.stemId}: ${problem}`);
        }
      }
    }

    const addStemIds = Array.from(new Set(patch.addStemIds ?? []));
    if (addStemIds.some((stemId) => typeof stemId !== "string" || !stemId)) {
      throw new BadRequestException("addStemIds must be non-empty stem ids");
    }
    const alreadyInProject = addStemIds.filter((stemId) =>
      projectStemIds.has(stemId),
    );
    if (alreadyInProject.length > 0) {
      throw new BadRequestException(
        `Stems are already part of this project: ${alreadyInProject.join(", ")}`,
      );
    }
    if (addStemIds.length > 0) {
      // Adding a stem is a rights-relevant action: the strict explicit-selection
      // rule applies (every added stem licensed + not minted non-remixable), so
      // the generation/publish re-checks over the grown project still pass.
      const addEligibility = await this.eligibilityService.checkEligibility({
        userId,
        trackId: project.sourceTrackId,
        stemIds: addStemIds,
      });
      if (!addEligibility.allowed) {
        throw new ForbiddenException({
          message: "Adding these stems to the remix project is not allowed",
          eligibility: addEligibility,
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (addStemIds.length > 0) {
        // Added on explicit user intent, so they arrive unmuted (unlike
        // creation hydration, which parks auto-added siblings muted).
        await tx.remixProjectStem.createMany({
          data: addStemIds.map((stemId) => ({
            remixProjectId: project.id,
            stemId,
          })),
        });
      }
      for (const stem of stemUpdates) {
        await tx.remixProjectStem.updateMany({
          where: { remixProjectId: project.id, stemId: stem.stemId },
          data: {
            ...(stem.role !== undefined ? { role: stem.role } : {}),
            ...(stem.gainDb !== undefined ? { gainDb: stem.gainDb } : {}),
            ...(stem.muted !== undefined ? { muted: stem.muted } : {}),
            ...(stem.arrangement !== undefined
              ? {
                  // null restores the always-on default (#1314); Prisma Json?
                  // columns need the DbNull sentinel, not JS null.
                  arrangement:
                    stem.arrangement === null
                      ? Prisma.DbNull
                      : (stem.arrangement as Prisma.JsonObject),
                }
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
   * Enqueues an AI remix draft through BullMQ. Eligibility is re-checked here:
   * generation is a rights-relevant action, so the creation-time decision is
   * not trusted (source state may have changed). The provider call itself runs
   * in the worker so the HTTP response is not held open by Lyria/storage.
   */
  async generateDraft(
    userId: string,
    projectId: string,
    options: {
      constraints?: RemixGenerationConstraints;
      retry?: boolean;
      force?: boolean;
      /** Targeted per-stem operation (#1316); variation mode only. */
      stemTransform?: RemixStemTransform;
    } = {},
  ) {
    this.enforceRateLimit("generate", userId, this.maxGenerationsPerHour);

    const project = await this.loadOwnedProject(userId, projectId);
    const stemIds = project.stems.map((stem) => stem.stemId);
    const retryRequested = options.retry === true || options.force === true;
    const currentStatus = remixGenerationStatusFromMetadata(
      project.generationMetadata,
    );

    if (project.status !== "draft") {
      throw new BadRequestException(
        project.status === "published"
          ? "This remix project was published and can no longer generate drafts."
          : "Only draft projects can generate remix drafts",
      );
    }
    if (
      project.generationJobId &&
      !retryRequested &&
      (currentStatus === "pending" ||
        currentStatus === "processing" ||
        currentStatus === "completed" ||
        currentStatus === "failed" ||
        currentStatus === null)
    ) {
      throw new BadRequestException(
        `A generation job (${project.generationJobId}) is already recorded for this project. Use retry=true to replace a completed or failed generation.`,
      );
    }
    if (
      retryRequested &&
      (currentStatus === "pending" || currentStatus === "processing") &&
      !this.generationJobIsStale(project.generationMetadata)
    ) {
      throw new ConflictException(
        `Generation job ${project.generationJobId} is still active for this project.`,
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

    // Per-stem transform (#1316): validated against the live project before
    // any provider work, then labelled with the catalog stem type so prompt
    // framing and metadata speak the user's language ("drums", not an id).
    const transformProblem = validateStemTransform(options.stemTransform, {
      mode: project.mode,
      stems: project.stems.map((stem) => ({
        stemId: stem.stemId,
        muted: stem.muted,
      })),
    });
    if (transformProblem) {
      throw new BadRequestException(transformProblem);
    }
    const stemTransform: RemixStemTransform | undefined = options.stemTransform
      ? {
          kind: options.stemTransform.kind,
          ...(options.stemTransform.stemId
            ? { stemId: options.stemTransform.stemId }
            : {}),
          ...(options.stemTransform.kind === "replace_stem"
            ? {
                stemLabel: stemTransformLabel(
                  project.stems.find(
                    (stem) => stem.stemId === options.stemTransform?.stemId,
                  ),
                ),
              }
            : {}),
        }
      : undefined;

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

    const generationInput = buildRemixGenerationInput(
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
        // Per-stem features (#1184) feed prompt conditioning; muted
        // stems are excluded from hint derivation like from renders.
        stems: project.stems.map((stem) => ({
          stemId: stem.stemId,
          muted: stem.muted,
          audioFeatures: stem.stem.audioFeatures ?? undefined,
        })),
      },
      options.constraints,
      stemTransform,
    );
    const jobId = `rmxgen_${project.id}_${randomUUID()}`;
    const requestedAt = new Date().toISOString();
    // Honest grounding provenance (#1181/#1182): stem_audio = rendered from
    // licensed stems; audio_conditioned = model conditions on mixed stem audio;
    // feature_conditioned = prompt generation guided by measured tempo/key;
    // prompt_only = nothing from the source audio shaped the output.
    const grounding = selectRemixDraftGrounding({
      mode: generationInput.mode,
      sourceFeatureHints: generationInput.sourceFeatureHints,
      providerKind: process.env.REMIX_GENERATION_PROVIDER_KIND,
    });
    const aiGenerated = groundingAiGenerated(grounding);
    // Draft versions (#1320): a regeneration must not orphan the previous
    // completed output. Archive it (capped) so the studio can A/B versions;
    // stored outputs are never deleted, so archived URIs stay streamable.
    const archiveEntry = retryRequested ? archiveEntryFromProject(project) : null;
    const previousDrafts = [
      ...(archiveEntry ? [archiveEntry] : []),
      ...previousDraftsFromMetadata(project.generationMetadata),
    ].slice(0, REMIX_PREVIOUS_DRAFTS_MAX);

    const pendingMetadata = {
      status: "pending",
      mode: generationInput.mode,
      grounding,
      aiGenerated,
      ...(generationInput.sourceFeatureHints
        ? { sourceFeatureHints: generationInput.sourceFeatureHints }
        : {}),
      stemIds: generationInput.stemIds,
      ...(generationInput.stemTransform
        ? { stemTransform: generationInput.stemTransform }
        : {}),
      constraints: generationInput.constraints as object,
      estimatedCostUsd: null,
      policyVersion: eligibility.policyVersion,
      voiceLikenessAllowed: false,
      output: {
        outputUri: null,
        mimeType: null,
        synthIdPresent: null,
        seed: null,
        sampleRate: null,
      },
      requestedAt,
      retryOfJobId: retryRequested ? project.generationJobId : null,
      ...(previousDrafts.length > 0 ? { previousDrafts } : {}),
    };

    await this.claimGenerationJob({
      projectId: project.id,
      jobId,
      retryRequested,
      metadata: pendingMetadata,
    });

    try {
      await this.generationQueue.add(
        "generate-remix-draft",
        { jobId, userId, projectId: project.id, generationInput },
        {
          jobId,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch {
      const normalized = new RemixGenerationProviderError(
        "provider_unavailable",
        "The remix generation job could not be queued. Please try again later.",
        true,
      );
      await this.recordGenerationFailure({
        project,
        userId,
        jobId,
        metadata: pendingMetadata,
        error: normalized,
      });
      throw normalized;
    }
    const updated = (await loadProject(project.id))!;

    this.eventBus.publish({
      eventName: "remix.generation_started",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      remixProjectId: project.id,
      creatorId: userId,
      sourceTrackId: project.sourceTrackId,
      provider: "remix-queue",
      generationJobId: jobId,
      mode: generationInput.mode,
      grounding,
      aiGenerated,
      policyVersion: eligibility.policyVersion,
    });

    return this.toResponse(updated);
  }

  async processGenerationJob(data: RemixGenerationJobData) {
    const project = await this.loadOwnedProject(data.userId, data.projectId);
    if (project.generationJobId !== data.jobId) {
      return {
        skipped: true,
        reason: "stale_job",
        generationJobId: project.generationJobId,
      };
    }

    const currentMetadata = normalizeMetadataObject(project.generationMetadata);
    if (currentMetadata.status === "completed") {
      return { skipped: true, reason: "already_completed" };
    }

    // jobId-scoped writes: after a stale reclaim, a superseded worker run
    // must never overwrite the replacement job's metadata.
    const claimed = await prisma.remixProject.updateMany({
      where: { id: project.id, generationJobId: data.jobId },
      data: {
        generationMetadata: {
          ...currentMetadata,
          status: "processing",
          processingStartedAt: new Date().toISOString(),
        } as Prisma.JsonObject,
      },
    });
    if (claimed.count === 0) {
      return { skipped: true, reason: "stale_job" };
    }

    try {
      // Section grid (#1314): derived deterministically from measured features
      // at process time, exactly like the studio derives it, so the persisted
      // per-stem masks gate the render at the same boundaries the user saw.
      const sectionGrid = deriveSectionGrid(
        project.stems.map((stem) => ({
          audioFeatures: stem.stem.audioFeatures,
        })),
      );
      const liveStemArrangement = project.stems.map((stem) => {
        const mask = sectionGrid
          ? activeIntervalsForArrangement(
              sectionGrid,
              parseStemArrangement(stem.arrangement),
            )
          : null;
        return {
          stemId: stem.stemId,
          gainDb: stem.gainDb,
          muted: stem.muted,
          ...(mask !== null ? { activeIntervals: mask } : {}),
        };
      });
      // Per-stem transform (#1316): replace_stem conditions and renders on the
      // BED — every stem except the target — so the generated layer takes the
      // target's place instead of doubling it. add_layer keeps the full bed.
      const transform = data.generationInput.stemTransform;
      const bedStemArrangement =
        transform?.kind === "replace_stem" && transform.stemId
          ? liveStemArrangement.filter(
              (stem) => stem.stemId !== transform.stemId,
            )
          : liveStemArrangement;
      const activeStemIds = bedStemArrangement
        .filter((stem) => !stem.muted)
        .map((stem) => stem.stemId);

      // #1214: re-verify ownership + current eligibility in the worker before
      // any render path can load or decrypt source audio. The request-time
      // check is not sufficient — consent, quarantine, licensing, content
      // status, and project state can change while a job is queued.
      const encryptedActiveStemCount = await prisma.stem.count({
        where: { id: { in: activeStemIds }, isEncrypted: true },
      });
      const renderEligibility = await this.eligibilityService.checkEligibility({
        userId: data.userId,
        trackId: project.sourceTrackId,
        stemIds: project.stems.map((stem) => stem.stemId),
      });
      if (!renderEligibility.allowed) {
        if (encryptedActiveStemCount > 0) {
          this.eventBus.publish({
            eventName: "remix.encrypted_render_denied",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            remixProjectId: project.id,
            creatorId: data.userId,
            sourceTrackId: project.sourceTrackId,
            generationJobId: data.jobId,
            purpose: "remix-render-authorized",
            encryptedStemCount: encryptedActiveStemCount,
            reason: "ineligible",
          });
        }
        throw new RemixGenerationProviderError(
          "invalid_input",
          "This remix can no longer be generated because the source's remix permissions changed.",
          false,
        );
      }

      // Render grant built here (never from the queue payload): only stems the
      // worker just re-confirmed as eligible may be decrypted by the mixer.
      const renderAuthorization: StemRenderAuthorization = {
        userId: data.userId,
        remixProjectId: project.id,
        authorizedStemIds: new Set(activeStemIds),
      };
      if (encryptedActiveStemCount > 0) {
        this.eventBus.publish({
          eventName: "remix.encrypted_render_authorized",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          remixProjectId: project.id,
          creatorId: data.userId,
          sourceTrackId: project.sourceTrackId,
          generationJobId: data.jobId,
          purpose: "remix-render-authorized",
          encryptedStemCount: encryptedActiveStemCount,
        });
      }

      // Mode routing: stem_mix renders arranged stems with pure DSP (#1189);
      // prompted modes ask the configured provider for generated audio. Lyria
      // output is treated as one additive layer (#1209), then mixed back over
      // the live arranged stems so the final draft keeps source fidelity.
      const providerJob =
        data.generationInput.mode === "stem_mix"
          ? await this.stemMixRenderer.render({
              remixProjectId: project.id,
              stems: bedStemArrangement,
              authorization: renderAuthorization,
            })
          : await this.maybeRenderStemPlusAiLayer({
              projectId: project.id,
              generationInput: data.generationInput,
              stems: bedStemArrangement,
              authorization: renderAuthorization,
            });
      const completedAt = new Date().toISOString();
      const completedMetadata = {
        ...currentMetadata,
        status: "completed",
        providerJobId: providerJob.jobId,
        estimatedCostUsd: providerJob.estimatedCostUsd ?? null,
        output: providerJob.outputMetadata,
        ...(providerJob.generatedLayers
          ? { generatedLayers: providerJob.generatedLayers }
          : {}),
        ...(providerJob.sourceArrangement
          ? { sourceArrangement: providerJob.sourceArrangement }
          : {}),
        ...(providerJob.renderMetadata
          ? { renderMetadata: providerJob.renderMetadata }
          : {}),
        completedAt,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
      };
      const persisted = await prisma.remixProject.updateMany({
        where: { id: project.id, generationJobId: data.jobId },
        data: {
          generationProvider: providerJob.provider,
          generationMetadata: completedMetadata as Prisma.JsonObject,
        },
      });
      if (persisted.count === 0) {
        // Superseded mid-flight by a stale-window retry; the provider call
        // succeeded but its result belongs to a job the project no longer
        // tracks. Drop it without publishing a completion event.
        return { skipped: true, reason: "stale_job" };
      }
      const completedGrounding =
        draftGroundingFromMetadata(currentMetadata) ??
        selectRemixDraftGrounding({
          mode: data.generationInput.mode,
          sourceFeatureHints: data.generationInput.sourceFeatureHints,
          providerKind: process.env.REMIX_GENERATION_PROVIDER_KIND,
        });
      this.eventBus.publish({
        eventName: "remix.generation_completed",
        eventVersion: 1,
        occurredAt: completedAt,
        remixProjectId: project.id,
        creatorId: data.userId,
        sourceTrackId: project.sourceTrackId,
        provider: providerJob.provider,
        generationJobId: data.jobId,
        mode: data.generationInput.mode,
        grounding: completedGrounding,
        aiGenerated: groundingAiGenerated(completedGrounding),
        policyVersion:
          typeof currentMetadata.policyVersion === "string"
            ? currentMetadata.policyVersion
            : project.policyVersion,
      });
      return { remixProjectId: project.id, generationJobId: data.jobId };
    } catch (error) {
      const normalized = normalizeRemixGenerationError(error);
      await this.recordGenerationFailure({
        project,
        userId: data.userId,
        jobId: data.jobId,
        metadata: currentMetadata,
        error: normalized,
      });
      throw normalized;
    }
  }

  private async claimGenerationJob(input: {
    projectId: string;
    jobId: string;
    retryRequested: boolean;
    metadata: Record<string, unknown>;
  }) {
    const metadataJson = JSON.stringify(input.metadata);
    const updated = input.retryRequested
      ? await prisma.$executeRaw`
          UPDATE "RemixProject"
          SET
            "generationProvider" = 'remix-queue',
            "generationJobId" = ${input.jobId},
            "generationMetadata" = ${metadataJson}::jsonb,
            "updatedAt" = NOW()
          WHERE "id" = ${input.projectId}
            AND (
              "generationJobId" IS NULL
              OR COALESCE("generationMetadata"->>'status', 'completed') IN ('completed', 'failed')
              OR COALESCE(
                   ("generationMetadata"->>'processingStartedAt')::timestamptz,
                   ("generationMetadata"->>'requestedAt')::timestamptz,
                   '-infinity'::timestamptz
                 ) <= NOW() - make_interval(secs => ${this.generationStaleAfterMs / 1000})
            )
        `
      : await prisma.$executeRaw`
          UPDATE "RemixProject"
          SET
            "generationProvider" = 'remix-queue',
            "generationJobId" = ${input.jobId},
            "generationMetadata" = ${metadataJson}::jsonb,
            "updatedAt" = NOW()
          WHERE "id" = ${input.projectId}
            AND "generationJobId" IS NULL
        `;

    if (updated === 0) {
      throw new ConflictException(
        "A generation job is already active or recorded for this project; reload the project.",
      );
    }
  }

  private async maybeRenderStemPlusAiLayer(input: {
    projectId: string;
    generationInput: RemixGenerationJobData["generationInput"];
    stems: Array<{ stemId: string; gainDb: number | null; muted: boolean }>;
    authorization: StemRenderAuthorization;
  }) {
    const layerJob = await this.generationProvider.createRemixDraft(
      {
        ...input.generationInput,
        // Live arrangement at process time, mirroring stem_mix, so
        // audio-conditioned generation (#1182 slice 4) conditions on the
        // current mix and #1209 layered rendering keeps source stems current.
        stemArrangement: input.stems,
      },
      input.authorization,
    );

    if (process.env.REMIX_GENERATION_PROVIDER_KIND !== "lyria") {
      return layerJob;
    }
    if (!this.layeredRenderer) {
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        "Layered remix rendering is not available in this environment.",
        true,
      );
    }
    return this.layeredRenderer.render({
      remixProjectId: input.projectId,
      stems: input.stems,
      authorization: input.authorization,
      layer: {
        provider: layerJob.provider,
        jobId: layerJob.jobId,
        prompt: input.generationInput.prompt ?? null,
        constraints: input.generationInput.constraints as Record<string, unknown>,
        output: layerJob.outputMetadata,
        estimatedCostUsd: layerJob.estimatedCostUsd,
      },
    });
  }

  private generationJobIsStale(metadata: unknown): boolean {
    const meta = normalizeMetadataObject(metadata);
    const startedRaw =
      typeof meta.processingStartedAt === "string"
        ? meta.processingStartedAt
        : typeof meta.requestedAt === "string"
          ? meta.requestedAt
          : null;
    if (!startedRaw) return true;
    const startedAt = Date.parse(startedRaw);
    if (Number.isNaN(startedAt)) return true;
    return Date.now() - startedAt >= this.generationStaleAfterMs;
  }

  private async recordGenerationFailure(input: {
    project: RemixProjectWithStems;
    userId: string;
    jobId: string;
    metadata: Record<string, unknown>;
    error: RemixGenerationProviderError;
  }) {
    const failedAt = new Date().toISOString();
    const persisted = await prisma.remixProject.updateMany({
      where: { id: input.project.id, generationJobId: input.jobId },
      data: {
        generationMetadata: {
          ...input.metadata,
          status: "failed",
          failedAt,
          errorCode: input.error.code,
          errorMessage: input.error.message,
          retryable: input.error.retryable,
        } as Prisma.JsonObject,
      },
    });
    if (persisted.count === 0) {
      // Superseded by a stale-window retry — the failure belongs to a job
      // the project no longer tracks.
      return;
    }
    const grounding =
      draftGroundingFromMetadata(input.metadata) ?? "prompt_only";
    this.eventBus.publish({
      eventName: "remix.generation_failed",
      eventVersion: 1,
      occurredAt: failedAt,
      remixProjectId: input.project.id,
      creatorId: input.userId,
      sourceTrackId: input.project.sourceTrackId,
      generationJobId: input.jobId,
      errorCode: input.error.code,
      grounding,
      aiGenerated: groundingAiGenerated(grounding),
      policyVersion:
        typeof input.metadata.policyVersion === "string"
          ? input.metadata.policyVersion
          : input.project.policyVersion,
    });
  }

  /**
   * Publishes a completed draft as a catalog remix release (#1196, E2).
   * Eligibility is re-checked here — the creation-time decision is explicitly
   * not trusted (consent flips and quarantines must block publication) — and
   * publish_resonate is enforced on top of `allowed`, since the policy
   * distinguishes the two. The release is created behind a conditional
   * status claim so a double publish can never create two releases.
   */
  async publishProject(userId: string, projectId: string) {
    const project = await this.loadOwnedProject(userId, projectId);

    if (project.status !== "draft") {
      throw new ConflictException({
        code:
          project.status === "published"
            ? "already_published"
            : "project_not_draft",
        message:
          project.status === "published"
            ? "This remix project is already published."
            : `Only draft projects can be published (status: ${project.status}).`,
        ...(project.publishedReleaseId
          ? { releaseId: project.publishedReleaseId }
          : {}),
      });
    }

    const generationStatus = remixGenerationStatusFromMetadata(
      project.generationMetadata,
    );
    const outputUri = draftOutputUriFromMetadata(project.generationMetadata);
    if (generationStatus !== "completed" || !outputUri) {
      throw new ConflictException({
        code: "draft_not_completed",
        message:
          "Only a completed draft can be published. Generate a draft and wait for it to finish first.",
        generationStatus: generationStatus ?? "none",
      });
    }

    const stemIds = project.stems.map((stem) => stem.stemId);
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
        message: "Publishing this remix is not allowed for its source",
        eligibility,
      });
    }
    if (!eligibility.allowedActions.includes("publish_resonate")) {
      throw new ForbiddenException({
        message:
          "Publishing on Resonate is not part of the allowed actions for this remix",
        eligibility,
      });
    }

    const audioBytes = await this.storageProvider.download(outputUri);
    if (!audioBytes) {
      throw new ConflictException({
        code: "draft_output_missing",
        message:
          "The draft audio could not be loaded from storage. Regenerate the draft and try again.",
      });
    }

    const metadata = normalizeMetadataObject(project.generationMetadata);
    const output = normalizeMetadataObject(metadata.output);
    const mimeType =
      draftMimeTypeFromMetadata(project.generationMetadata) ??
      draftMimeTypeFromUri(outputUri);
    const grounding =
      draftGroundingFromMetadata(project.generationMetadata) ?? "prompt_only";
    // AI integrity (#1164): stem_audio renders contain the licensed source
    // audio itself; everything else is generated and must be disclosed.
    const aiGenerated = groundingAiGenerated(grounding);

    // Copy the draft audio into a catalog-owned object so the published
    // release never depends on the draft's working URI.
    const storageResult = await this.storageProvider.upload(
      audioBytes,
      `remix-published-${project.id}${audioExtensionForMimeType(mimeType)}`,
      mimeType,
    );

    const artist = await this.resolveCreatorArtist(userId);
    const sourceArtistId = project.sourceTrack.release.artistId;
    const sourceArtistName =
      project.sourceTrack.artist ??
      project.sourceTrack.release.primaryArtist ??
      null;
    const attribution = `Remix of "${project.sourceTrack.title}"${
      sourceArtistName ? ` by ${sourceArtistName}` : ""
    }`;
    const publishedAt = new Date().toISOString();

    // E3 groundwork: enough machine-readable lineage to mint license/
    // lineage records later without reprocessing, plus the AI-disclosure
    // shape (#1164) the release page renders.
    const releaseTrackMetadata = {
      kind: "remix_publish",
      remixProjectId: project.id,
      sourceTrackId: project.sourceTrackId,
      sourceReleaseId: project.sourceTrack.release.id,
      sourceTrackTitle: project.sourceTrack.title,
      sourceArtistName,
      sourceStemIds: stemIds,
      attribution,
      provider: project.generationProvider,
      mode: project.mode,
      grounding,
      aiGenerated,
      ...(Array.isArray(metadata.sourceArrangement)
        ? { sourceArrangement: metadata.sourceArrangement }
        : {}),
      ...(Array.isArray(metadata.generatedLayers)
        ? { generatedLayers: metadata.generatedLayers }
        : {}),
      ...(metadata.stemTransform && typeof metadata.stemTransform === "object"
        ? { stemTransform: metadata.stemTransform }
        : {}),
      synthIdPresent:
        typeof output.synthIdPresent === "boolean"
          ? output.synthIdPresent
          : null,
      seed: typeof output.seed === "number" ? output.seed : null,
      sampleRate:
        typeof output.sampleRate === "number" ? output.sampleRate : null,
      policyVersion: eligibility.policyVersion,
      publishedAt,
    };

    const rightsFields = {
      rightsRoute: "STANDARD_ESCROW",
      rightsFlags: [] as string[],
      rightsReason: REMIX_PUBLISH_RIGHTS_REASON,
      rightsPolicyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
      rightsEvaluatedAt: new Date(),
    };

    const release = await prisma.$transaction(async (tx) => {
      // Conditional claim (#1167 standard): only the writer that flips
      // draft → published creates the release; a concurrent publish sees
      // zero rows and conflicts instead of creating a second release.
      const claimed = await tx.remixProject.updateMany({
        where: { id: project.id, status: "draft" },
        data: { status: "published", attribution },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: "already_published",
          message: "This remix project was already published.",
        });
      }

      const createdRelease = await tx.release.create({
        data: {
          artistId: artist.id,
          title: project.title,
          status: "ready",
          type: "remix",
          primaryArtist: artist.displayName,
          ...rightsFields,
          rightsSourceType: REMIX_PUBLISH_RIGHTS_SOURCE,
          tracks: {
            create: {
              title: project.title,
              artist: artist.displayName,
              processingStatus: "complete",
              generationMetadata: releaseTrackMetadata as Prisma.JsonObject,
              ...rightsFields,
              stems: {
                create: {
                  type: "master",
                  uri: storageResult.uri,
                  storageProvider: storageResult.provider,
                  // Local storage serves stem blobs from the DB row, like
                  // the AI-generation flow.
                  data:
                    storageResult.provider === "local"
                      ? audioBytes
                      : undefined,
                  mimeType,
                },
              },
            },
          },
        },
        include: { tracks: { select: { id: true } } },
      });

      await tx.remixProject.update({
        where: { id: project.id },
        data: { publishedReleaseId: createdRelease.id },
      });

      return createdRelease;
    });

    const trackId = release.tracks[0].id;

    this.eventBus.publish({
      eventName: "remix.published",
      eventVersion: 1,
      occurredAt: publishedAt,
      remixProjectId: project.id,
      creatorId: userId,
      sourceTrackId: project.sourceTrackId,
      // Cockpit attribution (#1121): the signal belongs to the artist
      // whose track was remixed.
      ...(sourceArtistId ? { artistId: sourceArtistId } : {}),
      releaseId: release.id,
      trackId,
      mode: project.mode,
      grounding,
      aiGenerated,
      creatorOwner: eligibility.creatorOwner,
      policyVersion: eligibility.policyVersion,
    });

    const updated = (await loadProject(project.id))!;
    return {
      ...this.toResponse(updated),
      publishedRelease: { releaseId: release.id, trackId },
    };
  }

  /**
   * The catalog release needs an Artist row; remix creators without one get
   * a profile on first publish (same pattern as the AI-generation flow).
   */
  private async resolveCreatorArtist(userId: string) {
    const existing = await prisma.artist.findFirst({ where: { userId } });
    if (existing) return existing;
    return prisma.artist.create({
      data: { userId, displayName: "Remix Creator", payoutAddress: userId },
    });
  }

  async getDraftAudio(
    userId: string,
    projectId: string,
    jobId?: string,
  ): Promise<RemixDraftAudio> {
    const project = await this.loadOwnedProject(userId, projectId);

    // Archived version playback (#1320): a jobId that is not the current
    // generation resolves through the owner's archived drafts only.
    if (jobId && jobId !== project.generationJobId) {
      const archived = previousDraftsFromMetadata(
        project.generationMetadata,
      ).find((entry) => entry.jobId === jobId);
      if (!archived) {
        throw new NotFoundException("Remix draft audio not found");
      }
      const data = await this.storageProvider.download(
        archived.output.outputUri,
      );
      if (!data) {
        throw new NotFoundException("Remix draft audio not found");
      }
      return {
        data,
        mimeType:
          archived.output.mimeType ??
          draftMimeTypeFromUri(archived.output.outputUri),
      };
    }

    const outputUri = draftOutputUriFromMetadata(project.generationMetadata);
    if (!outputUri) {
      throw new NotFoundException("Remix draft audio not found");
    }

    const data = await this.storageProvider.download(outputUri);
    if (!data) {
      throw new NotFoundException("Remix draft audio not found");
    }

    return {
      data,
      // Ground truth recorded at generation time; URI-derived detection is
      // the fallback for drafts stored before mimeType was recorded.
      mimeType:
        draftMimeTypeFromMetadata(project.generationMetadata) ??
        draftMimeTypeFromUri(outputUri),
    };
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

  /**
   * Sibling stems of the source track that satisfy the strict per-stem rule
   * (licensed + not minted non-remixable) and are not full mixdowns. Used by
   * creation hydration (#1312) so a stem-scoped entry still opens a full
   * session. Best-effort: any failure returns [] rather than blocking the
   * already-validated explicit selection.
   */
  private async resolveEligibleSiblingStemIds(
    userId: string,
    trackId: string,
    excludeStemIds: string[],
  ): Promise<string[]> {
    try {
      // Track-default eligibility enumerates every stem of the track with its
      // per-stem {licensed, remixable} state in one evaluation.
      const trackEligibility = await this.eligibilityService.checkEligibility({
        userId,
        trackId,
      });
      if (!trackEligibility.allowed) return [];
      const excluded = new Set(excludeStemIds);
      const stems = await prisma.stem.findMany({
        where: { trackId },
        select: { id: true, type: true },
      });
      const typeById = new Map(stems.map((stem) => [stem.id, stem.type]));
      return trackEligibility.stems
        .filter(
          (stem) =>
            !excluded.has(stem.stemId) &&
            stem.licensed &&
            stem.remixable !== false &&
            !isFullMixStemType(typeById.get(stem.stemId)),
        )
        .map((stem) => stem.stemId);
    } catch {
      return [];
    }
  }

  /**
   * Source-track stems NOT in the project, with the state the studio needs to
   * render the "Also on this track" panel: addable (licensed + remixable),
   * license-required (routes to /stem/[tokenId] for the remix-tier purchase),
   * or honestly blocked. Advisory only — a failing lookup returns [] instead
   * of breaking the studio read.
   */
  private async resolveAvailableStems(
    userId: string,
    project: { sourceTrackId: string; stems: Array<{ stemId: string }> },
  ) {
    try {
      const trackEligibility = await this.eligibilityService.checkEligibility({
        userId,
        trackId: project.sourceTrackId,
      });
      const eligibleByStem = new Map(
        trackEligibility.stems.map((stem) => [stem.stemId, stem]),
      );
      const inProject = new Set(project.stems.map((stem) => stem.stemId));
      const stems = await prisma.stem.findMany({
        where: { trackId: project.sourceTrackId },
        select: {
          id: true,
          type: true,
          title: true,
          nftMint: { select: { tokenId: true, remixable: true } },
        },
        orderBy: { id: "asc" },
      });
      return stems
        .filter(
          (stem) => !inProject.has(stem.id) && !isFullMixStemType(stem.type),
        )
        .map((stem) => {
          const eligibility = eligibleByStem.get(stem.id);
          const remixable =
            eligibility?.remixable ?? stem.nftMint?.remixable ?? null;
          const licensed = eligibility?.licensed ?? false;
          return {
            stemId: stem.id,
            type: stem.type,
            title: stem.title,
            // BigInt → string so the studio can link to /stem/[tokenId].
            tokenId: stem.nftMint ? stem.nftMint.tokenId.toString() : null,
            remixable,
            licensed,
            addable:
              trackEligibility.allowed && licensed && remixable !== false,
          };
        });
    } catch {
      return [];
    }
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
      publishedReleaseId: project.publishedReleaseId,
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
        audioFeatures: stem.stem.audioFeatures ?? null,
        role: stem.role,
        gainDb: stem.gainDb,
        muted: stem.muted,
        arrangement: stem.arrangement,
      })),
      // Section grid (#1314): served with the project so the studio, PATCH
      // validation, and the render worker all agree on one derivation —
      // clients never re-derive boundaries themselves.
      sectionGrid: deriveSectionGrid(
        project.stems.map((stem) => ({
          audioFeatures: stem.stem.audioFeatures,
        })),
      ),
      ...(eligibility ? { eligibility } : {}),
    };
  }
}

/** Human label for prompt framing/metadata: stem title, else its type. */
function stemTransformLabel(
  stem?: { stem: { type: string; title: string | null } },
): string {
  const label = stem?.stem.title?.trim() || stem?.stem.type?.trim();
  return label || "target stem";
}

function audioExtensionForMimeType(mimeType: string): string {
  if (mimeType === "audio/wav") return ".wav";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/ogg") return ".ogg";
  return ".bin";
}

function normalizeMetadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function normalizeRemixGenerationError(
  error: unknown,
): RemixGenerationProviderError {
  if (error instanceof RemixGenerationProviderError) {
    return error;
  }
  // Worker-time eligibility re-check (#1214) can throw NotFound (source track
  // deleted) or BadRequest (a stem no longer belongs to the track). Those are
  // permanent, not transient: surface them as non-retryable invalid_input so a
  // retry does not keep re-hitting the same dead source.
  if (
    error instanceof NotFoundException ||
    error instanceof BadRequestException
  ) {
    return new RemixGenerationProviderError(
      "invalid_input",
      "This remix can no longer be generated for its source.",
      false,
    );
  }
  return new RemixGenerationProviderError(
    "provider_unavailable",
    "The remix generation provider failed unexpectedly. Please try again later.",
    true,
  );
}
