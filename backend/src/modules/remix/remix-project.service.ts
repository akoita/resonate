import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PromptModerationService } from "../moderation/prompt-moderation.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomInt, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import {
  RemixEligibilityService,
  type RemixEligibilityResult,
} from "./remix-eligibility.service";
import {
  buildRemixGenerationInput,
  normalizeAiTargetInput,
  readStoredAiTarget,
  REMIX_GENERATION_DEFAULT_DURATION_SECONDS,
  REMIX_GENERATION_PROVIDER,
  RemixGenerationProviderError,
  type RemixGenerationConstraints,
  type RemixGenerationProvider,
  type StemRenderAuthorization,
  stemTransformFromAiTarget,
  validateStemTransform,
  type RemixAiTarget,
  type RemixStemTransform,
} from "./remix-generation.provider";
import { StorageProvider } from "../storage/storage_provider";
import {
  estimateGenerationCostUsd,
  inferColdStart,
} from "../generation/generation-cost-model";
import {
  GenerationCreditsService,
  InsufficientCreditsException,
} from "../credits/generation-credits.service";
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
import {
  normalizeRemixFxInput,
  readStoredRemixFx,
  REMIX_FX_DSP_VERSION,
  remixFxProFieldsSet,
  type RemixFxRecipe,
  type RemixRenderFx,
} from "./remix-fx";
import {
  RemixEntitlementsService,
  type RemixProjectEntitlements,
} from "./remix-entitlements";
import {
  gateIntervalsForBlocks,
  exceedsTimelineCap,
  normalizeRemixStructureInput,
  readStoredRemixStructure,
  resolveStoredRemixStructure,
  timelineCapError,
  REMIX_STRUCTURE_DSP_VERSION,
  structureBlockCount,
  structureTimeline,
  type RemixRenderStructure,
  type RemixStructure,
} from "./remix-structure";
import {
  normalizeRemixBeatInput,
  readStoredRemixBeat,
  REMIX_BEAT_DSP_VERSION,
  type RemixBeat,
  type RemixRenderBeat,
} from "./remix-beat";
import { readStoredRemixStretch } from "./remix-stretch";
import {
  buildPartPrompt,
  deriveSongKey,
  isPitchedPartRole,
  normalizePartGenerateRequest,
  normalizeRemixPartsInput,
  PART_CLIP_SECONDS,
  PART_MAX_LENGTH_SECONDS,
  PART_TAKE_GROUNDING,
  PART_TAKES_PER_PROJECT_MAX,
  partLengthSeconds,
  PARTS_NEED_TEMPO_ERROR,
  quotePartTakesCents,
  readRenderedParts,
  readStoredRemixParts,
  referencedTakeIds,
  REMIX_PART_PROMPT_VERSION,
  REMIX_PART_TAKE_JOB,
  REMIX_PARTS_DSP_VERSION,
  toPartTakeResponse,
  type PartRole,
  type PartTakeErrorCode,
  type RemixParts,
  type RemixRenderPart,
  type RemixRenderParts,
} from "./remix-parts";
import {
  conformPartClip,
  PartConformError,
  type PartConformTarget,
} from "./remix-part-conform";
import {
  AI_DISCLOSURE_VERSION,
  deriveRemixAiDisclosure,
} from "../catalog/ai-disclosure.policy";

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

export type RemixDraftExport = RemixDraftAudio & {
  /** Sanitized, extension-suffixed download filename (#1323). */
  filename: string;
};

/**
 * Sell-eligibility for the remix master stem (#1413) — surfaced on
 * `GET /remix/projects/:id` under `commerce` so the studio can show/hide a
 * "List this remix for sale" CTA without duplicating the eligibility rule.
 * Mirrors the mint-authorization sell-rights gate exactly: `sellable` is true
 * only when the project is published AND every source stem is
 * commercially-licensed (or the caller owns the source artist).
 */
export type RemixSellEligibility = {
  sellable: boolean;
  reasonCode: string | null;
  reason: string | null;
  publishedReleaseId: string | null;
  masterStemId: string | null;
};

export type RemixGenerationJobData = {
  jobId: string;
  userId: string;
  projectId: string;
  generationInput: ReturnType<typeof buildRemixGenerationInput>;
};

/** One AI part take job (#1901), job name {@link REMIX_PART_TAKE_JOB}. */
export type RemixPartTakeJobData = {
  kind: "part_take";
  takeId: string;
  userId: string;
  projectId: string;
};

/** Read shape of a part take audio stream (#1901). */
export type RemixPartTakeAudio = RemixDraftAudio;

/**
 * A take failure with a safe, stored code (#1901). The message is internal
 * (logged server-side only); the take records the code alone.
 */
class PartTakeFailure extends Error {
  constructor(
    readonly code: PartTakeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PartTakeFailure";
  }
}

function partTakeErrorCode(error: unknown): PartTakeErrorCode {
  if (error instanceof PartTakeFailure) return error.code;
  if (error instanceof RemixGenerationProviderError) return error.code;
  if (error instanceof PartConformError) return "conform_failed";
  return "internal_error";
}

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

/**
 * Whether a completed render mixed at least one AI part (#1901): in the
 * final render or in the audio a provider conditioned on.
 */
export function renderIncludesAiParts(input: {
  renderMetadata?: unknown;
  conditioningParts?: unknown;
}): boolean {
  const render = input.renderMetadata as { parts?: unknown } | null | undefined;
  const conditioning = input.conditioningParts as
    | { parts?: unknown }
    | null
    | undefined;
  return (
    readRenderedParts(render?.parts).length > 0 ||
    readRenderedParts(conditioning?.parts).length > 0
  );
}

/**
 * Grounding of a draft whose render includes AI parts (#1901): the stems
 * are preserved and generated instrument parts are layered on top, so a
 * stem_audio render becomes stem_plus_ai (AI-assisted) even in stem_mix
 * mode. Every other grounding is already AI and more specific: unchanged.
 */
export function groundingWithAiParts(
  grounding: RemixDraftGrounding,
  aiParts: boolean,
): RemixDraftGrounding {
  return aiParts && grounding === "stem_audio" ? "stem_plus_ai" : grounding;
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
  // AI part takes (#1901): bounded (the per-project cap), newest first.
  partTakes: {
    orderBy: { createdAt: "desc" },
    take: PART_TAKES_PER_PROJECT_MAX,
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
  private readonly logger = new Logger(RemixProjectService.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly eligibilityService: RemixEligibilityService,
    @Inject(REMIX_GENERATION_PROVIDER)
    private readonly generationProvider: RemixGenerationProvider,
    @Inject(REMIX_STEM_MIX_RENDERER)
    private readonly stemMixRenderer: StemMixRenderer,
    private readonly storageProvider: StorageProvider,
    @InjectQueue(REMIX_GENERATION_QUEUE)
    private readonly generationQueue: Queue<
      RemixGenerationJobData | RemixPartTakeJobData
    >,
    private readonly credits: GenerationCreditsService,
    @Inject(REMIX_LAYERED_RENDERER)
    private readonly layeredRenderer?: LayeredRemixRenderer,
    @Optional()
    private readonly promptModeration?: PromptModerationService,
    // Entitlement seam (#1903): optional so positional test constructions
    // keep working; the default policy allows everyone.
    @Optional()
    private readonly entitlements: RemixEntitlementsService = new RemixEntitlementsService(),
  ) {}

  /** The project DTO's entitlements for `userId` (#1903). */
  private projectEntitlements(
    userId: string,
  ): Promise<RemixProjectEntitlements> {
    return this.entitlements.forProject(userId);
  }

  /**
   * Per-user sliding-window limit. 429 (not the catalog's 400) so agent
   * and frontend callers can distinguish throttling from invalid input.
   */
  private enforceRateLimit(
    action: "create" | "generate",
    userId: string,
    maxPerHour: number,
    /** Generations this request counts as (an AI part batch = its takes). */
    count = 1,
    /** Check without recording a hit. */
    dryRun = false,
  ): void {
    const key = `${action}:${userId}`;
    const now = Date.now();
    const timestamps = (this.rateLimits.get(key) ?? []).filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
    );
    if (timestamps.length + count > maxPerHour) {
      throw new HttpException(
        `Rate limit exceeded: maximum ${maxPerHour} remix ${
          action === "create" ? "project creations" : "generation requests"
        } per hour. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (dryRun) return;
    for (let i = 0; i < count; i += 1) timestamps.push(now);
    this.rateLimits.set(key, timestamps);
  }

  /**
   * Peek at the per-user remix *generation* rate-limit window WITHOUT recording
   * a hit (#1422). Reads the same `generate:${userId}` sliding-window state
   * `enforceRateLimit` uses, pruning expired timestamps locally only — it never
   * writes back, so it is side-effect free and safe for the Usage & Billing
   * aggregation. Mirrors the catalog getter shape (remaining/limit/windowMs +
   * `resetsAt` as a Date). Uses the generation limit (10 /
   * REMIX_GENERATION_RATE_LIMIT), not the project-create limit.
   */
  getGenerationRateLimitStatus(userId: string): {
    remaining: number;
    limit: number;
    windowMs: number;
    resetsAt: Date | null;
  } {
    const now = Date.now();
    const activeTimestamps = (this.rateLimits.get(`generate:${userId}`) ?? [])
      .filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
    const resetsAt =
      activeTimestamps.length > 0
        ? new Date(Math.min(...activeTimestamps) + RATE_LIMIT_WINDOW_MS)
        : null;

    return {
      remaining: Math.max(0, this.maxGenerationsPerHour - activeTimestamps.length),
      limit: this.maxGenerationsPerHour,
      windowMs: RATE_LIMIT_WINDOW_MS,
      resetsAt,
    };
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

    // Explicit selections from the release-page "Remix" entry point send
    // every licensed stem, which can include a full-mix stem (original/master)
    // alongside separated stems (vocals, drums, ...). The full mix already
    // sums the separated layers, so playing both doubles the audio in
    // previews and renders. When the explicit selection mixes a full-mix
    // stem with at least one separated stem, store the full-mix stem muted
    // — kept in the project as an A/B reference, same as hydration's own
    // exclusion, but not auto-played. A selection made only of full-mix
    // stems (a track whose only stem is the original) still plays unmuted.
    const explicitStemTypes = stemIds.length
      ? await prisma.stem.findMany({
          where: { id: { in: stemIds } },
          select: { id: true, type: true },
        })
      : [];
    const explicitTypeById = new Map(
      explicitStemTypes.map((stem) => [stem.id, stem.type]),
    );
    const hasSeparatedStem = stemIds.some(
      (stemId) => !isFullMixStemType(explicitTypeById.get(stemId)),
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
            ...stemIds.map((stemId) =>
              hasSeparatedStem && isFullMixStemType(explicitTypeById.get(stemId))
                ? { stemId, muted: true }
                : { stemId },
            ),
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

    return this.toResponse(
      project,
      eligibility,
      await this.projectEntitlements(input.userId),
    );
  }

  async getProject(userId: string, projectId: string) {
    let project = await this.loadOwnedProject(userId, projectId);
    // AI part takes (#1901): settle takes whose job or worker was lost, so a
    // charged take never stays "processing" (and charged) forever.
    if (this.hasStalePartTakes(project.partTakes)) {
      await this.sweepStalePartTakes(project.id);
      project = (await loadProject(project.id)) ?? project;
    }
    const response = {
      ...this.toResponse(
        project,
        undefined,
        await this.projectEntitlements(userId),
      ),
      // Sell-rights bridge (#1413): additive/backward-compatible — lets the
      // studio show/hide a "List this remix for sale" CTA without a second
      // round-trip.
      commerce: await this.computeSellEligibility(userId, project),
    };
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

  /**
   * Standalone sell-eligibility read (#1413). Ownership-enforced the same
   * way `getProject` is (via `loadOwnedProject`); the studio can poll this
   * without re-fetching the whole project payload.
   */
  async getSellEligibility(
    userId: string,
    projectId: string,
  ): Promise<RemixSellEligibility> {
    const project = await this.loadOwnedProject(userId, projectId);
    return this.computeSellEligibility(userId, project);
  }

  /**
   * Shared sell-eligibility computation (#1413) for `getProject`'s `commerce`
   * block and `getSellEligibility`. Mirrors the mint-authorization gate
   * exactly: unpublished projects are never sellable; published projects are
   * sellable only when the eligibility engine grants `export` (a commercial
   * license on every source stem, or source-artist ownership) over the
   * project's source stems.
   */
  private async computeSellEligibility(
    userId: string,
    project: RemixProjectWithStems,
  ): Promise<RemixSellEligibility> {
    if (project.status !== "published" || !project.publishedReleaseId) {
      return {
        sellable: false,
        reasonCode: "not_published",
        reason: "Publish this remix before listing it for sale.",
        publishedReleaseId: null,
        masterStemId: null,
      };
    }

    const publishedReleaseId = project.publishedReleaseId;
    const [masterStemId, eligibility] = await Promise.all([
      this.resolveMasterStemId(publishedReleaseId),
      this.eligibilityService.checkEligibility({
        userId,
        trackId: project.sourceTrackId,
        stemIds: project.stems.map((stem) => stem.stemId),
        allowHistoricalStemIds: true,
      }),
    ]);

    if (!eligibility.allowedActions.includes("export")) {
      return {
        sellable: false,
        reasonCode: "commercial_license_required",
        reason:
          "Listing this remix for sale requires a commercial license on every source stem (or owning the source artist).",
        publishedReleaseId,
        masterStemId,
      };
    }

    return {
      sellable: true,
      reasonCode: null,
      reason: null,
      publishedReleaseId,
      masterStemId,
    };
  }

  /** The `type:"master"` stem of the release a remix project published. */
  private async resolveMasterStemId(
    publishedReleaseId: string,
  ): Promise<string | null> {
    const masterStem = await prisma.stem.findFirst({
      where: { type: "master", track: { releaseId: publishedReleaseId } },
      select: { id: true },
    });
    return masterStem?.id ?? null;
  }

  async listProjects(userId: string) {
    const projects = await prisma.remixProject.findMany({
      where: { creatorUserId: userId },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    const entitlements = await this.projectEntitlements(userId);
    return projects.map((project) =>
      this.toResponse(project, undefined, entitlements),
    );
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
      /**
       * Variation AI target (#1882): undefined leaves it unchanged, null
       * clears it, `{ kind: "whole" }` normalizes to null.
       */
      aiTarget?: { kind: string; stemId?: string | null } | null;
      /**
       * Shared effects recipe remix-fx/v3 (#1897, #1898, #1903; v1/v2
       * accepted): undefined leaves it unchanged, null clears it, an
       * all-default recipe normalizes to null. Setting a Pro field (EQ, pan)
       * needs the `remix.pro` entitlement (403 `pro_required`).
       */
      effects?: unknown;
      /**
       * Structure blocks remix-structure/v1 (#1899): undefined leaves it
       * unchanged, null clears it, the identity order without fades
       * normalizes to null. Stem masks in the same PATCH are validated
       * against the resulting block count.
       */
      structure?: unknown;
      /**
       * Beat maker remix-beat/v1 (#1902): undefined leaves it unchanged, null
       * clears it. Needs a bar grid; `blocks` is measured against the block
       * count after this PATCH. Structure edits never rewrite stored blocks
       * (stale lengths fail open to on-everywhere); clients send remapped
       * blocks alongside structure edits.
       */
      beat?: unknown;
      /**
       * AI part lanes remix-parts/v1 (#1901): undefined leaves them
       * unchanged, null (or an empty list) clears them. At most 4 parts; each
       * takeId must be a COMPLETED take of this project with the same role
       * (checked under the project row lock); `blocks` follows the beat.
       */
      parts?: unknown;
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

    let aiTarget: RemixAiTarget | null | undefined;
    if (patch.aiTarget !== undefined) {
      const normalized = normalizeAiTargetInput(patch.aiTarget, projectStemIds);
      if ("error" in normalized) {
        throw new BadRequestException(normalized.error);
      }
      aiTarget = normalized.value;
    }

    let effects: RemixFxRecipe | null | undefined;
    if (patch.effects !== undefined) {
      const normalized = normalizeRemixFxInput(patch.effects, projectStemIds);
      if ("error" in normalized) {
        throw new BadRequestException(normalized.error);
      }
      effects = normalized.value;
      // Pro fields (#1903): setting a new or changed EQ/pan value needs the
      // `remix.pro` entitlement. Keeping or removing saved values never
      // does, so a saved Pro recipe keeps rendering whatever the policy.
      const proFields = remixFxProFieldsSet(
        effects,
        readStoredRemixFx(project.effects),
      );
      if (proFields.length > 0) {
        const decision = await this.entitlements.pro(userId);
        if (!decision.allowed) {
          throw new ForbiddenException({
            code: "pro_required",
            message:
              "Per-stem EQ and pan are Pro tools, which this account can't use right now.",
            fields: proFields,
            policyVersion: decision.policyVersion,
          });
        }
      }
    }

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

    const hasArrangementUpdates = stemUpdates.some(
      (stem) => stem.arrangement !== undefined,
    );
    const sectionGrid =
      hasArrangementUpdates ||
      patch.structure !== undefined ||
      patch.beat !== undefined ||
      patch.parts !== undefined
        ? deriveSectionGrid(
            project.stems.map((stem) => ({
              audioFeatures: stem.stem.audioFeatures,
            })),
          )
        : null;

    // Structure blocks (#1899) index the project's section grid.
    let structure: RemixStructure | null | undefined;
    if (patch.structure !== undefined) {
      const normalized = normalizeRemixStructureInput(
        patch.structure,
        sectionGrid?.sections.length ?? 0,
      );
      if ("error" in normalized) {
        throw new BadRequestException(normalized.error);
      }
      // Safety cap: at most min(2 × source, 900 s) of timeline.
      if (
        normalized.value &&
        sectionGrid &&
        exceedsTimelineCap(
          sectionGrid,
          structureTimeline(sectionGrid, normalized.value.blocks),
        )
      ) {
        throw new BadRequestException(timelineCapError(sectionGrid));
      }
      structure = normalized.value;
    }

    // Block count AFTER this PATCH (#1899): the new structure, else the
    // stored one, else the grid's sections. Undefined without a grid.
    const blockCountAfterPatch = (): number | undefined => {
      if (!sectionGrid) return undefined;
      const effectiveStructure =
        structure !== undefined
          ? structure
          : resolveStoredRemixStructure(project.structure, sectionGrid)
              .structure;
      return structureBlockCount(sectionGrid, effectiveStructure);
    };

    // Beat maker (#1902): needs a bar grid; its per-block on/off list is
    // measured against the block count after this PATCH.
    let beat: RemixBeat | null | undefined;
    if (patch.beat !== undefined) {
      const normalized = normalizeRemixBeatInput(
        patch.beat,
        blockCountAfterPatch() ?? 0,
        sectionGrid,
      );
      if ("error" in normalized) {
        throw new BadRequestException(normalized.error);
      }
      beat = normalized.value;
    }

    // AI parts (#1901): shape here (the beat's block rules); the takes are
    // checked inside the transaction, under the project row lock.
    let parts: RemixParts | null | undefined;
    if (patch.parts !== undefined) {
      const normalized = normalizeRemixPartsInput(
        patch.parts,
        blockCountAfterPatch() ?? 0,
        sectionGrid,
      );
      if ("error" in normalized) {
        throw new BadRequestException(normalized.error);
      }
      parts = normalized.value;
    }

    // Section-grid arrangement masks (#1314) must match the grid the studio
    // derived for this source; a null payload restores the always-on default.
    // Masks are block-indexed (#1899): submitted masks are measured against
    // the block count AFTER this PATCH (the new structure, else the stored
    // one). Stored masks left stale by a structure change are not rejected;
    // they fail open to always-on at render time.
    if (hasArrangementUpdates) {
      const blockCount = blockCountAfterPatch();
      for (const stem of stemUpdates) {
        if (stem.arrangement === undefined) continue;
        const problem = validateStemArrangementInput(
          stem.arrangement,
          sectionGrid,
          blockCount,
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
      if (parts) {
        // Serializes with take deletion and batch eviction (#1901): a take
        // referenced here cannot disappear before this write commits.
        await tx.$queryRaw`SELECT "id" FROM "RemixProject" WHERE "id" = ${project.id} FOR UPDATE`;
        const takeIds = Array.from(new Set(parts.parts.map((part) => part.takeId)));
        const takes = await tx.remixPartTake.findMany({
          where: { id: { in: takeIds }, projectId: project.id },
          select: { id: true, role: true, status: true },
        });
        const takeById = new Map(takes.map((take) => [take.id, take]));
        parts.parts.forEach((part, index) => {
          const take = takeById.get(part.takeId);
          if (!take) {
            throw new BadRequestException(
              `parts[${index}].takeId is not a take of this project`,
            );
          }
          if (take.status !== "completed") {
            throw new BadRequestException(
              `parts[${index}].takeId is not a completed take`,
            );
          }
          if (take.role !== part.role) {
            throw new BadRequestException(
              `parts[${index}].takeId is a ${take.role} take, not ${part.role}`,
            );
          }
        });
      }
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
          ...(aiTarget !== undefined
            ? {
                // Json? columns clear via the DbNull sentinel, not JS null.
                aiTarget:
                  aiTarget === null
                    ? Prisma.DbNull
                    : (aiTarget as Prisma.JsonObject),
              }
            : {}),
          ...(effects !== undefined
            ? {
                effects:
                  effects === null
                    ? Prisma.DbNull
                    : (effects as unknown as Prisma.JsonObject),
              }
            : {}),
          ...(structure !== undefined
            ? {
                structure:
                  structure === null
                    ? Prisma.DbNull
                    : (structure as unknown as Prisma.JsonObject),
              }
            : {}),
          ...(beat !== undefined
            ? {
                beat:
                  beat === null
                    ? Prisma.DbNull
                    : (beat as unknown as Prisma.JsonObject),
              }
            : {}),
          ...(parts !== undefined
            ? {
                parts:
                  parts === null
                    ? Prisma.DbNull
                    : (parts as unknown as Prisma.JsonObject),
              }
            : {}),
        },
        include: PROJECT_INCLUDE,
      });
    });

    return this.toResponse(
      updated,
      undefined,
      await this.projectEntitlements(userId),
    );
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

    // Prompt-safety moderation (#1343). The self-hosted generation path has no
    // vendor safety filter, so we screen the prompt here — before any queue or
    // credit debit — and reject unambiguous PUP violations. Runs on prompted
    // modes only (stem_mix carries no prompt → screen() is a no-op).
    const moderation = (
      this.promptModeration ?? new PromptModerationService()
    ).screen(project.prompt);
    if (!moderation.allowed) {
      this.eventBus.publish({
        eventName: "remix.policy_rejected",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        creatorId: userId,
        sourceTrackId: project.sourceTrackId,
        stemIds,
        reasonCodes: [moderation.reasonCode],
        policyVersion: project.policyVersion,
      });
      throw new UnprocessableEntityException({
        message: moderation.message,
        code: "prompt_rejected",
        category: moderation.category,
      });
    }

    // Saved AI target fallback (#1882): with no explicit request transform, a
    // variation project generates against the target the studio persisted.
    // An explicit stemTransform always wins; the derived one goes through the
    // same validation and labelling below.
    let requestedTransform = options.stemTransform;
    if (!requestedTransform) {
      const fromSaved = stemTransformFromAiTarget(
        project.aiTarget,
        project.mode,
      );
      if (fromSaved.error) {
        throw new BadRequestException(fromSaved.error);
      }
      requestedTransform = fromSaved.transform;
    }

    // Per-stem transform (#1316): validated against the live project before
    // any provider work, then labelled with the catalog stem type so prompt
    // framing and metadata speak the user's language ("drums", not an id).
    const transformProblem = validateStemTransform(requestedTransform, {
      mode: project.mode,
      stems: project.stems.map((stem) => ({
        stemId: stem.stemId,
        muted: stem.muted,
      })),
    });
    if (transformProblem) {
      throw new BadRequestException(transformProblem);
    }
    const stemTransform: RemixStemTransform | undefined = requestedTransform
      ? {
          kind: requestedTransform.kind,
          ...(requestedTransform.stemId
            ? { stemId: requestedTransform.stemId }
            : {}),
          ...(requestedTransform.kind === "replace_stem"
            ? {
                stemLabel: stemTransformLabel(
                  project.stems.find(
                    (stem) => stem.stemId === requestedTransform?.stemId,
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
      allowHistoricalStemIds: true,
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
    // completed output. claimGenerationJob archives it (capped) so the studio
    // can A/B versions, computing the list from the row re-read under its
    // lock (#1910). Archived outputs persist (and stay streamable) until the
    // owner deletes the version (deleteDraftVersion, #1910) — regeneration
    // never deletes stored audio, and an entry that falls off the cap is only
    // unlisted.
    const baseMetadata = {
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
    };

    // The persisted pending metadata (with retryOfJobId/previousDrafts from
    // the locked row) — the failure path below must write this, never a copy
    // built from the pre-eligibility read.
    const pendingMetadata = await this.claimGenerationJob({
      projectId: project.id,
      jobId,
      retryRequested,
      metadata: baseMetadata,
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

    return this.toResponse(
      updated,
      undefined,
      await this.projectEntitlements(userId),
    );
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

    // #1421 realized-cost telemetry: the processing wall-clock window starts
    // here (mirroring the processingStartedAt written below) and ends when the
    // job settles, so the record captures backend time spent on the render.
    const processingStartedAtMs = Date.now();

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

    // #1421: the AI render's requested duration, used for cost telemetry on both
    // the success and failure paths. stem_mix carries no explicit duration and
    // is not AI-generated, so the default 30s block is used only as a nominal
    // wall-clock reference (sellPriceCents stays 0 for it — nothing is debited).
    const recordDurationSeconds =
      data.generationInput.constraints?.durationSeconds ??
      REMIX_GENERATION_DEFAULT_DURATION_SECONDS;
    // #1421: only record telemetry once the provider render was actually
    // entered, so a pre-render credit block never emits a cost record.
    let providerCallStarted = false;

    // #1334: credits charged for this job's AI render, refunded on failure.
    let debitedCents = 0;
    try {
      // Section grid (#1314): derived deterministically from measured features
      // at process time, exactly like the studio derives it, so the persisted
      // per-stem masks gate the render at the same boundaries the user saw.
      const sectionGrid = deriveSectionGrid(
        project.stems.map((stem) => ({
          audioFeatures: stem.stem.audioFeatures,
        })),
      );
      // Structure blocks (#1899), read live and tolerantly: a malformed row, a
      // section outside the current grid, or a timeline over the safety cap
      // fails open to the original order — never an oversized render.
      // With a structure, masks are block-indexed and gate timeline spans.
      const resolvedStructure = resolveStoredRemixStructure(
        project.structure,
        sectionGrid,
      );
      if (resolvedStructure.overCap) {
        this.logger.warn(
          `Remix project ${project.id}: stored structure exceeds the timeline cap; rendering the original order`,
        );
      }
      const projectStructure = resolvedStructure.structure;
      const renderStructure: RemixRenderStructure | undefined =
        sectionGrid && projectStructure
          ? {
              structure: projectStructure,
              segments: structureTimeline(
                sectionGrid,
                projectStructure.blocks,
              ),
            }
          : undefined;
      const liveStemArrangement = project.stems.map((stem) => {
        const mask = sectionGrid
          ? renderStructure
            ? gateIntervalsForBlocks(
                renderStructure.segments,
                parseStemArrangement(stem.arrangement)?.sections,
              )
            : activeIntervalsForArrangement(
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
      // Shared effects recipe (#1897), read live at process time like the
      // arrangement. Echo timing uses the grid tempo only for bar grids.
      // Effects are deterministic DSP: grounding is unchanged.
      const projectEffects = readStoredRemixFx(project.effects);
      const renderFx: RemixRenderFx | undefined = projectEffects
        ? {
            effects: projectEffects,
            bpm: sectionGrid?.kind === "bars" ? sectionGrid.bpm : null,
          }
        : undefined;
      // Beat maker (#1902), read live and tolerantly against the resolved
      // timeline: a stale per-block list fails open to on-everywhere. A beat
      // needs a bar grid with a tempo; without one it is skipped (logged).
      // A synthesized beat is neither AI nor source audio: grounding is
      // unchanged.
      const projectBeat = sectionGrid
        ? readStoredRemixBeat(
            project.beat,
            structureBlockCount(sectionGrid, projectStructure),
          )
        : null;
      // A muted beat is skipped entirely: no input, no addedParts.
      const renderBeat: RemixRenderBeat | undefined =
        projectBeat &&
        !projectBeat.muted &&
        sectionGrid?.kind === "bars" &&
        sectionGrid.bpm &&
        sectionGrid.bpm > 0
          ? {
              beat: projectBeat,
              grid: sectionGrid,
              segments:
                renderStructure?.segments ??
                structureTimeline(sectionGrid, null),
            }
          : undefined;
      if (projectBeat && !projectBeat.muted && !renderBeat) {
        this.logger.warn(
          `Remix project ${project.id}: stored beat has no bar grid to play on; rendering without it`,
        );
      }
      // AI parts (#1901), read live and tolerantly like the beat: audible
      // parts with a completed take of THIS project (and role) are mixed;
      // the others are recorded with a reason, never an error. Rendering
      // them is free — the takes were already paid for.
      const renderParts = await this.resolveRenderParts(
        project,
        sectionGrid,
        projectStructure,
        renderStructure,
      );
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
        allowHistoricalStemIds: true,
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

      // #1334 generation-credit meter: AI (prompted) draft rendering is a
      // metered generation, so it debits the user's prepaid balance before the
      // provider call. stem_mix is pure DSP (no generation), so it is free and
      // never charged. An insufficient balance throws here and the job fails
      // before any generation work. The debit is refunded in the catch below if
      // the render throws, so a failed draft is never charged.
      const isAiGeneration = data.generationInput.mode !== "stem_mix";
      if (isAiGeneration) {
        const durationSeconds =
          data.generationInput.constraints?.durationSeconds ??
          REMIX_GENERATION_DEFAULT_DURATION_SECONDS;
        const costCents = this.credits.costForDurationCents(durationSeconds);
        // debit throws (and leaves debitedCents at 0) on insufficient balance,
        // so the catch below never refunds a charge that never happened.
        await this.credits.debit(
          data.userId,
          costCents,
          "remix_draft",
          data.jobId,
          "remix_draft",
        );
        debitedCents = costCents;
      }

      // Mode routing: stem_mix renders arranged stems with pure DSP (#1189);
      // prompted modes ask the configured provider for generated audio. Lyria
      // output is treated as one additive layer (#1209), then mixed back over
      // the live arranged stems so the final draft keeps source fidelity.
      providerCallStarted = true;
      const providerJob =
        data.generationInput.mode === "stem_mix"
          ? await this.stemMixRenderer.render({
              remixProjectId: project.id,
              stems: bedStemArrangement,
              authorization: renderAuthorization,
              ...(renderFx ? { fx: renderFx } : {}),
              ...(renderStructure ? { structure: renderStructure } : {}),
              ...(renderBeat ? { beat: renderBeat } : {}),
              ...(renderParts ? { parts: renderParts } : {}),
            })
          : await this.maybeRenderStemPlusAiLayer({
              projectId: project.id,
              generationInput: data.generationInput,
              stems: bedStemArrangement,
              authorization: renderAuthorization,
              ...(renderFx ? { fx: renderFx } : {}),
              ...(renderStructure ? { structure: renderStructure } : {}),
              ...(renderBeat ? { beat: renderBeat } : {}),
              ...(renderParts ? { parts: renderParts } : {}),
            });
      const completedAt = new Date().toISOString();
      // #1901: a render that mixed at least one AI part is AI-assisted — a
      // stem_audio draft becomes stem_plus_ai with aiGenerated true.
      const aiPartsRendered = renderIncludesAiParts({
        renderMetadata: providerJob.renderMetadata,
        conditioningParts: providerJob.conditioningParts,
      });
      const completedGrounding = groundingWithAiParts(
        draftGroundingFromMetadata(currentMetadata) ??
          selectRemixDraftGrounding({
            mode: data.generationInput.mode,
            sourceFeatureHints: data.generationInput.sourceFeatureHints,
            providerKind: process.env.REMIX_GENERATION_PROVIDER_KIND,
          }),
        aiPartsRendered,
      );
      const completedMetadata = {
        ...currentMetadata,
        ...(aiPartsRendered
          ? {
              grounding: completedGrounding,
              aiGenerated: groundingAiGenerated(completedGrounding),
            }
          : {}),
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
        ...(providerJob.conditioningEffects
          ? { conditioningEffects: providerJob.conditioningEffects }
          : {}),
        ...(providerJob.conditioningStructure
          ? { conditioningStructure: providerJob.conditioningStructure }
          : {}),
        ...(providerJob.conditioningBeat
          ? { conditioningBeat: providerJob.conditioningBeat }
          : {}),
        ...(providerJob.conditioningParts
          ? { conditioningParts: providerJob.conditioningParts }
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

      // #1421: realized-cost telemetry for the completed render. The estimated
      // cost is the provider's own estimate (present for AI renders, absent for
      // pure-DSP stem_mix); sellPriceCents is what was debited (0 for stem_mix).
      await this.recordGenerationCost({
        jobId: data.jobId,
        userId: data.userId,
        path: providerJob.provider,
        durationSeconds: recordDurationSeconds,
        wallClockMs: Date.now() - processingStartedAtMs,
        // 0 when the provider reports no cost estimate (pure-DSP stem_mix is
        // free) rather than fabricating a rate.
        estimatedCostUsd: providerJob.estimatedCostUsd ?? 0,
        sellPriceCents: debitedCents,
      });

      return { remixProjectId: project.id, generationJobId: data.jobId };
    } catch (error) {
      // #1334: a credit block is not a generation failure — nothing was charged
      // (debitedCents is still 0) and no render was attempted. Surface the 402
      // verbatim so the meter's intent stays legible instead of being masked as
      // a normalized provider error.
      if (error instanceof InsufficientCreditsException) {
        throw error;
      }
      const normalized = normalizeRemixGenerationError(error);
      // Refund the metered credits when a debited AI draft fails so the user is
      // not charged for a draft they never got. Idempotent per jobId, so it is
      // safe even if a retry ran the debit again. Best-effort — a refund failure
      // never masks the original error.
      if (debitedCents > 0) {
        await this.credits
          .refund(data.userId, debitedCents, "remix_draft_failed_refund", data.jobId)
          .catch(() => undefined);
      }
      await this.recordGenerationFailure({
        project,
        userId: data.userId,
        jobId: data.jobId,
        metadata: currentMetadata,
        error: normalized,
      });

      // #1421: record realized cost for a failure that happened after the
      // provider render was entered — a failed AI render (e.g. a self-hosted GPU
      // cold start) still incurs cost worth reconciling. The provider is unknown
      // on failure, so the baseline remix path key is used (defaults to the same
      // rate). stem_mix is pure DSP with no generation cost, so 0. Best-effort
      // and isolated: never masks the original error.
      if (providerCallStarted) {
        await this.recordGenerationCost({
          jobId: data.jobId,
          userId: data.userId,
          path: "remix-stub",
          durationSeconds: recordDurationSeconds,
          wallClockMs: Date.now() - processingStartedAtMs,
          estimatedCostUsd:
            data.generationInput.mode === "stem_mix"
              ? 0
              : estimateGenerationCostUsd("remix-stub", recordDurationSeconds),
          sellPriceCents: debitedCents,
        });
      }

      throw normalized;
    }
  }

  // --- AI parts (#1901) -------------------------------------------------------

  /**
   * Starts a batch of AI part takes (#1901). ADR-BM-6 line (2): each take is
   * one 30 s model generation charged at the canonical per-30 s price, so the
   * quote is takes × price. Every check that can refuse the request — input,
   * ownership, draft state, provider capability, tempo grid, clip length,
   * style moderation, eligibility, rate limit (the batch counts as `takes`
   * generations) and the balance (402) — runs BEFORE any take row exists.
   * Each take is debited once, in the worker, and refunded on any failure.
   */
  async generatePartTakes(userId: string, projectId: string, input: unknown) {
    const normalized = normalizePartGenerateRequest(input);
    if ("error" in normalized) {
      throw new BadRequestException({
        code: "invalid_input",
        message: normalized.error,
      });
    }
    const request = normalized.value;
    const project = await this.loadOwnedProject(userId, projectId);
    if (project.status !== "draft") {
      throw new ConflictException({
        code: project.status === "published" ? "project_published" : "project_not_draft",
        message: "Only draft remix projects can generate AI parts.",
      });
    }
    if (process.env.REMIX_GENERATION_ENABLED !== "true") {
      throw new RemixGenerationProviderError(
        "provider_disabled",
        "AI remix generation is not enabled on this environment yet.",
        false,
      );
    }
    if (typeof this.generationProvider.createPartClip !== "function") {
      throw new BadRequestException({
        code: "parts_unsupported",
        message: "The configured AI provider cannot generate parts.",
      });
    }
    const grid = deriveSectionGrid(
      project.stems.map((stem) => ({ audioFeatures: stem.stem.audioFeatures })),
    );
    if (!grid || grid.kind !== "bars" || !grid.bpm || grid.bpm <= 0) {
      throw new ConflictException({
        code: "no_tempo_grid",
        message: PARTS_NEED_TEMPO_ERROR,
      });
    }
    if (partLengthSeconds(grid.bpm, request.bars) > PART_MAX_LENGTH_SECONDS) {
      throw new BadRequestException({
        code: "part_too_long",
        message: `${request.bars} bars at this song's tempo do not fit in one generated clip. Pick fewer bars.`,
      });
    }
    // Style words are a prompt fragment: screened like a draft prompt (#1343)
    // before any work.
    if (request.style) {
      const moderation = (
        this.promptModeration ?? new PromptModerationService()
      ).screen(request.style);
      if (!moderation.allowed) {
        throw new UnprocessableEntityException({
          message: moderation.message,
          code: "prompt_rejected",
          category: moderation.category,
        });
      }
    }
    // Generation is rights-relevant: the creation-time decision is not trusted.
    const stemIds = project.stems.map((stem) => stem.stemId);
    const eligibility = await this.eligibilityService.checkEligibility({
      userId,
      trackId: project.sourceTrackId,
      stemIds,
      allowHistoricalStemIds: true,
    });
    if (!eligibility.allowed) {
      this.publishDenialEvents(
        { userId, sourceTrackId: project.sourceTrackId, stemIds },
        eligibility,
      );
      throw new ForbiddenException({
        message: "AI parts are not allowed for this source",
        eligibility,
      });
    }

    this.enforceRateLimit(
      "generate",
      userId,
      this.maxGenerationsPerHour,
      request.takes,
      true,
    );
    const perTakeCents = this.credits.costForDurationCents(PART_CLIP_SECONDS);
    const quoteCents = quotePartTakesCents(request.takes, perTakeCents);
    const { balanceCents } = await this.credits.getBalance(userId);
    if (balanceCents < quoteCents) {
      throw new InsufficientCreditsException(userId, quoteCents, balanceCents);
    }
    this.enforceRateLimit("generate", userId, this.maxGenerationsPerHour, request.takes);

    await this.sweepStalePartTakes(project.id);

    const batchId = randomUUID();
    const { created, evicted } = await prisma.$transaction(async (tx) => {
      // Serializes with PATCH parts, take deletion and other batches.
      await tx.$queryRaw`SELECT "id" FROM "RemixProject" WHERE "id" = ${project.id} FOR UPDATE`;
      const fresh = await tx.remixProject.findUnique({
        where: { id: project.id },
        select: { status: true, parts: true },
      });
      if (!fresh || fresh.status !== "draft") {
        throw new ConflictException({
          code: "project_not_draft",
          message: "Only draft remix projects can generate AI parts.",
        });
      }
      const existing = await tx.remixPartTake.findMany({
        where: { projectId: project.id },
        select: { id: true, status: true, storageUri: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const overflow =
        existing.length + request.takes - PART_TAKES_PER_PROJECT_MAX;
      let evictedRows: Array<{ id: string; storageUri: string | null }> = [];
      if (overflow > 0) {
        // Oldest settled takes that no part names (valid or not) go first.
        const referenced = referencedTakeIds(fresh.parts);
        const candidates = existing.filter(
          (take) =>
            (take.status === "completed" || take.status === "failed") &&
            !referenced.has(take.id),
        );
        if (candidates.length < overflow) {
          throw new ConflictException({
            code: "take_limit_reached",
            message:
              "This project already holds the maximum number of AI part takes. Delete unused takes or wait for running ones to finish.",
          });
        }
        evictedRows = candidates.slice(0, overflow);
        await tx.remixPartTake.deleteMany({
          where: {
            projectId: project.id,
            id: { in: evictedRows.map((take) => take.id) },
          },
        });
      }
      const createdAt = Date.now();
      const rows = [];
      for (let index = 0; index < request.takes; index += 1) {
        rows.push(
          await tx.remixPartTake.create({
            data: {
              projectId: project.id,
              userId,
              batchId,
              role: request.role,
              bars: request.bars,
              style: request.style,
              // Stored so a take can be reproduced (same prompt + seed).
              seed: randomInt(0, 2_147_483_647),
              status: "pending",
              promptVersion: REMIX_PART_PROMPT_VERSION,
              grounding: PART_TAKE_GROUNDING,
              costCents: perTakeCents,
              // Distinct timestamps keep the batch's order stable.
              createdAt: new Date(createdAt + index),
            },
          }),
        );
      }
      return { created: rows, evicted: evictedRows };
    });

    for (const take of evicted) {
      await this.deletePartTakeAudio(project.id, take.id, take.storageUri);
    }

    const unqueued: string[] = [];
    for (const take of created) {
      try {
        await this.generationQueue.add(
          REMIX_PART_TAKE_JOB,
          { kind: "part_take", takeId: take.id, userId, projectId: project.id },
          {
            jobId: `rmxpart_${take.id}`,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      } catch {
        unqueued.push(take.id);
      }
    }
    if (unqueued.length > 0) {
      // Nothing was debited yet (the worker debits), so nothing to refund.
      await prisma.remixPartTake.updateMany({
        where: { id: { in: unqueued }, status: "pending" },
        data: { status: "failed", errorCode: "queue_unavailable" },
      });
      if (unqueued.length === created.length) {
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "The AI part jobs could not be queued. Please try again later.",
          true,
        );
      }
    }

    const takes = await prisma.remixPartTake.findMany({
      where: { batchId, projectId: project.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return {
      batchId,
      quoteCents,
      perTakeCents,
      takes: takes.map(toPartTakeResponse),
    };
  }

  /**
   * Worker half of one take (#1901): claim (row lock; a stale `processing`
   * claim may be reclaimed), re-verify the project and eligibility, debit
   * exactly once (the ledger is checked by take id first), generate, conform,
   * store. Every failure after the debit refunds it (idempotent per take id)
   * and records a safe error code; internal detail is logged only.
   */
  async processPartTakeJob(data: RemixPartTakeJobData) {
    const claim = await this.claimPartTake(data);
    if (!claim) return { skipped: true, reason: "not_claimable" };
    const { take, startedAt } = claim;
    const claimedWhere = { id: take.id, status: "processing", startedAt };
    const markFailed = async (code: PartTakeErrorCode) => {
      await prisma.remixPartTake.updateMany({
        where: claimedWhere,
        data: { status: "failed", errorCode: code },
      });
    };
    const processingStartedAtMs = Date.now();

    const project = await loadProject(data.projectId);
    if (!project || project.creatorUserId !== data.userId) {
      await markFailed("invalid_input");
      return { failed: true, errorCode: "invalid_input" };
    }
    if (project.status !== "draft") {
      await markFailed("project_not_draft");
      return { failed: true, errorCode: "project_not_draft" };
    }
    try {
      const eligibility = await this.eligibilityService.checkEligibility({
        userId: data.userId,
        trackId: project.sourceTrackId,
        stemIds: project.stems.map((stem) => stem.stemId),
        allowHistoricalStemIds: true,
      });
      if (!eligibility.allowed) {
        await markFailed("not_eligible");
        return { failed: true, errorCode: "not_eligible" };
      }
    } catch (error) {
      this.logger.warn(
        `Part take ${take.id}: eligibility re-check failed (${
          error instanceof Error ? error.name : "unknown"
        })`,
      );
      await markFailed("not_eligible");
      return { failed: true, errorCode: "not_eligible" };
    }

    // Debit exactly once per take: a reclaimed (stale) claim finds the first
    // run's ledger row and does not charge again.
    let chargedCents = 0;
    if (take.costCents > 0) {
      const existingDebit = await prisma.generationCreditTransaction.findFirst({
        where: { userId: data.userId, jobId: take.id, type: "debit" },
        select: { amountCents: true },
      });
      if (existingDebit) {
        chargedCents = existingDebit.amountCents;
      } else {
        try {
          await this.credits.debit(
            data.userId,
            take.costCents,
            "remix_part",
            take.id,
            "remix_draft",
          );
          chargedCents = take.costCents;
        } catch (error) {
          if (error instanceof InsufficientCreditsException) {
            await markFailed("insufficient_credits");
            return { failed: true, errorCode: "insufficient_credits" };
          }
          // The debit's own transaction rolls back on error; refund anyway if
          // a ledger row exists (a lost commit acknowledgement).
          await this.refundPartTakeIfCharged(data.userId, take.id);
          await markFailed("internal_error");
          throw error;
        }
      }
    }

    let providerCalled = false;
    let clipModel: string | null = null;
    let estimatedCostUsd = 0;
    try {
      const grid = deriveSectionGrid(
        project.stems.map((stem) => ({ audioFeatures: stem.stem.audioFeatures })),
      );
      if (!grid || grid.kind !== "bars" || !grid.bpm || grid.bpm <= 0) {
        throw new PartTakeFailure("no_tempo_grid", "no bar grid at process time");
      }
      const createPartClip = this.generationProvider.createPartClip;
      if (typeof createPartClip !== "function") {
        throw new PartTakeFailure("parts_unsupported", "provider has no clip capability");
      }
      const role = take.role as PartRole;
      const songKey = deriveSongKey(
        project.stems.map((stem) => ({ audioFeatures: stem.stem.audioFeatures })),
      );
      const prompt = buildPartPrompt({
        role,
        style: take.style,
        bpm: grid.bpm,
        key: songKey,
      });
      providerCalled = true;
      const clip = await createPartClip.call(this.generationProvider, {
        prompt: prompt.prompt,
        negativePrompt: prompt.negativePrompt,
        seed: take.seed,
      });
      clipModel = clip.model;
      estimatedCostUsd = clip.estimatedCostUsd;

      const target: PartConformTarget = {
        bpm: grid.bpm,
        bars: take.bars,
        pitched: isPitchedPartRole(role),
        key: songKey,
      };
      let conformed;
      try {
        conformed = await conformPartClip(clip.audio, target, {
          logError: (message) =>
            this.logger.error(`Part take ${take.id}: ${message}`),
        });
      } catch (error) {
        this.logger.error(
          `Part take ${take.id}: conform failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new PartTakeFailure("conform_failed", "conform failed");
      }

      let storageUri: string;
      try {
        const stored = await this.storageProvider.upload(
          conformed.flac,
          // Flat, id-only name scoped to the project (no user text).
          `remix-part-${project.id}-${take.id}.flac`,
          "audio/flac",
        );
        storageUri = stored.uri;
      } catch (error) {
        this.logger.error(
          `Part take ${take.id}: storage write failed (${
            error instanceof Error ? error.name : "unknown"
          })`,
        );
        throw new PartTakeFailure("storage_failed", "storage write failed");
      }

      const completed = await prisma.remixPartTake.updateMany({
        where: claimedWhere,
        data: {
          status: "completed",
          storageUri,
          mimeType: "audio/flac",
          durationSec: conformed.durationSec,
          conform: conformed.record as unknown as Prisma.JsonObject,
          provider: clip.provider,
          model: clip.model,
          errorCode: null,
          completedAt: new Date(),
        },
      });
      if (completed.count === 0) {
        // Superseded: swept as stale or its project is gone. The take is not
        // delivered, so it is not charged; drop the stored audio.
        await this.refundPartTakeIfCharged(data.userId, take.id);
        await this.deletePartTakeAudio(project.id, take.id, storageUri);
        return { skipped: true, reason: "superseded" };
      }
      await this.recordGenerationCost({
        jobId: take.id,
        userId: data.userId,
        path: clip.model,
        durationSeconds: PART_CLIP_SECONDS,
        wallClockMs: Date.now() - processingStartedAtMs,
        estimatedCostUsd: clip.estimatedCostUsd,
        sellPriceCents: chargedCents,
      });
      return { takeId: take.id, status: "completed" };
    } catch (error) {
      const code = partTakeErrorCode(error);
      // Internal detail stays in server logs; the take stores the code only.
      this.logger.warn(
        `Part take ${take.id} failed (${code})${
          error instanceof PartTakeFailure
            ? ""
            : `: ${error instanceof Error ? error.message : String(error)}`
        }`,
      );
      await this.refundPartTakeIfCharged(data.userId, take.id);
      await markFailed(code);
      if (providerCalled) {
        await this.recordGenerationCost({
          jobId: take.id,
          userId: data.userId,
          path: clipModel ?? "remix-stub",
          durationSeconds: PART_CLIP_SECONDS,
          wallClockMs: Date.now() - processingStartedAtMs,
          estimatedCostUsd:
            estimatedCostUsd ||
            estimateGenerationCostUsd(clipModel ?? "remix-stub", PART_CLIP_SECONDS),
          sellPriceCents: chargedCents,
        });
      }
      return { failed: true, errorCode: code };
    }
  }

  private hasStalePartTakes(
    takes: Array<{ status: string; createdAt: Date; startedAt: Date | null }>,
  ): boolean {
    const cutoff = Date.now() - this.generationStaleAfterMs;
    return takes.some(
      (take) =>
        (take.status === "pending" && take.createdAt.getTime() <= cutoff) ||
        (take.status === "processing" &&
          (!take.startedAt || take.startedAt.getTime() <= cutoff)),
    );
  }

  /**
   * Row-locked claim: pending → processing, or a `processing` claim older
   * than the stale window (its worker died) is reclaimed. Anything else is
   * not claimable (already settled, deleted, or another owner's).
   */
  private async claimPartTake(data: RemixPartTakeJobData) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RemixPartTake" WHERE "id" = ${data.takeId} FOR UPDATE`;
      const take = await tx.remixPartTake.findUnique({ where: { id: data.takeId } });
      if (
        !take ||
        take.userId !== data.userId ||
        take.projectId !== data.projectId
      ) {
        return null;
      }
      const staleClaim =
        take.status === "processing" &&
        (!take.startedAt ||
          Date.now() - take.startedAt.getTime() >= this.generationStaleAfterMs);
      if (take.status !== "pending" && !staleClaim) return null;
      const startedAt = new Date();
      await tx.remixPartTake.update({
        where: { id: take.id },
        data: { status: "processing", startedAt, errorCode: null },
      });
      return { take, startedAt };
    });
  }

  /**
   * Stale reclaim for takes (#1901), the draft rule applied per take: a
   * pending take older than the stale window (its job was lost) or a
   * processing take whose claim is older (its worker died) fails as `stale`
   * and is refunded if it was charged. Conditional on the exact state read,
   * so a live worker's own settle wins any race.
   */
  private async sweepStalePartTakes(projectId: string): Promise<void> {
    const cutoff = new Date(Date.now() - this.generationStaleAfterMs);
    const stale = await prisma.remixPartTake.findMany({
      where: {
        projectId,
        OR: [
          { status: "pending", createdAt: { lte: cutoff } },
          { status: "processing", startedAt: { lte: cutoff } },
          { status: "processing", startedAt: null },
        ],
      },
      select: { id: true, userId: true, status: true, startedAt: true },
    });
    for (const take of stale) {
      const marked = await prisma.remixPartTake.updateMany({
        where: { id: take.id, status: take.status, startedAt: take.startedAt },
        data: { status: "failed", errorCode: "stale" },
      });
      if (marked.count === 1) {
        await this.refundPartTakeIfCharged(take.userId, take.id);
      }
    }
  }

  /**
   * Refunds a take's debit, if the ledger holds one: the amount is the
   * ledger's, and GenerationCreditsService.refund is idempotent per take id,
   * so every failure path may call this. A refund error is logged loudly and
   * never masks the take's own failure.
   */
  private async refundPartTakeIfCharged(userId: string, takeId: string) {
    try {
      const debit = await prisma.generationCreditTransaction.findFirst({
        where: { userId, jobId: takeId, type: "debit" },
        select: { amountCents: true },
      });
      if (!debit || debit.amountCents <= 0) return;
      await this.credits.refund(
        userId,
        debit.amountCents,
        "remix_part_failed_refund",
        takeId,
      );
    } catch (error) {
      this.logger.error(
        `Part take refund failed (take=${takeId}, error=${
          error instanceof Error ? error.name : "unknown"
        }); reconcile the credit ledger for this take.`,
      );
    }
  }

  private async deletePartTakeAudio(
    projectId: string,
    takeId: string,
    storageUri: string | null,
  ): Promise<void> {
    if (!storageUri) return;
    try {
      await this.storageProvider.delete(storageUri);
    } catch (error) {
      // Ids only: the URI and the provider error body stay out of logs.
      this.logger.warn(
        `Part take audio delete failed (project=${projectId}, take=${takeId}, error=${
          error instanceof Error ? error.name : "unknown"
        })`,
      );
    }
  }

  /** Streams a COMPLETED take's conformed FLAC (#1901). Owner-only. */
  async getPartTakeAudio(
    userId: string,
    projectId: string,
    takeId: string,
  ): Promise<RemixPartTakeAudio> {
    await this.loadOwnedProject(userId, projectId);
    const take = await prisma.remixPartTake.findFirst({
      where: { id: takeId, projectId },
      select: { status: true, storageUri: true, mimeType: true },
    });
    if (!take || take.status !== "completed" || !take.storageUri) {
      throw new NotFoundException({
        code: "take_not_found",
        message: "This AI part take has no audio.",
      });
    }
    const data = await this.storageProvider.download(take.storageUri);
    if (!data) {
      throw new NotFoundException({
        code: "take_not_found",
        message: "This AI part take has no audio.",
      });
    }
    return { data, mimeType: take.mimeType ?? "audio/flac" };
  }

  /**
   * Deletes a take and its audio (#1901). Owner-only; published projects are
   * locked (409); a take a part still names answers 409 `take_in_use`, a
   * pending/processing one 409 `take_processing` (after the stale sweep).
   * The row goes first under the project lock; the audio delete is
   * best-effort.
   */
  async deletePartTake(userId: string, projectId: string, takeId: string) {
    const project = await this.loadOwnedProject(userId, projectId);
    if (project.status === "published") {
      throw new ConflictException({
        code: "project_published",
        message: "This remix project was published and can no longer be edited.",
      });
    }
    await this.sweepStalePartTakes(projectId);
    const removed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RemixProject" WHERE "id" = ${projectId} FOR UPDATE`;
      const fresh = await tx.remixProject.findUnique({
        where: { id: projectId },
        select: { parts: true },
      });
      const take = await tx.remixPartTake.findFirst({
        where: { id: takeId, projectId },
        select: { id: true, status: true, storageUri: true },
      });
      if (!take) {
        throw new NotFoundException({
          code: "take_not_found",
          message: "This AI part take does not exist.",
        });
      }
      if (take.status === "pending" || take.status === "processing") {
        throw new ConflictException({
          code: "take_processing",
          message: "This AI part take is still being generated.",
        });
      }
      if (referencedTakeIds(fresh?.parts).has(take.id)) {
        throw new ConflictException({
          code: "take_in_use",
          message: "This AI part take is used by a part. Remove the part first.",
        });
      }
      await tx.remixPartTake.delete({ where: { id: take.id } });
      return take;
    });
    await this.deletePartTakeAudio(projectId, removed.id, removed.storageUri);
    return this.getProject(userId, projectId);
  }

  /**
   * #1421: best-effort realized-cost telemetry for a settled remix generation.
   * Writes a GenerationCostRecord and emits generation.cost_recorded. Fully
   * isolated from the generation outcome — every failure is logged and swallowed
   * so a telemetry error can never fail or refund a generation.
   */
  private async recordGenerationCost(input: {
    jobId: string;
    userId: string;
    path: string;
    durationSeconds: number;
    wallClockMs: number;
    estimatedCostUsd: number;
    sellPriceCents: number;
  }): Promise<void> {
    try {
      const wallClockMs = Math.max(0, Math.round(input.wallClockMs));
      const durationSeconds = Math.max(0, Math.round(input.durationSeconds));
      const coldStart = inferColdStart(input.path, wallClockMs);
      await prisma.generationCostRecord.create({
        data: {
          jobId: input.jobId,
          userId: input.userId,
          path: input.path,
          durationSeconds,
          wallClockMs,
          estimatedCostUsd: input.estimatedCostUsd,
          sellPriceCents: input.sellPriceCents,
          coldStart,
        },
      });
      this.eventBus.publish({
        eventName: "generation.cost_recorded",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId: input.jobId,
        userId: input.userId,
        path: input.path,
        durationSeconds,
        wallClockMs,
        estimatedCostUsd: input.estimatedCostUsd,
        sellPriceCents: input.sellPriceCents,
        coldStart,
      });
    } catch (error: any) {
      this.logger.warn(
        `Failed to record remix generation cost telemetry for job ${input.jobId}: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * Claims the project for a new generation job and persists its pending
   * metadata. Runs under a row lock and derives `retryOfJobId` and the
   * archived `previousDrafts` (#1320) from the row re-read under that lock,
   * not from the caller's earlier read: a version deleted meanwhile
   * (deleteDraftVersion, #1910) must stay deleted. Returns the metadata
   * actually written.
   */
  private async claimGenerationJob(input: {
    projectId: string;
    jobId: string;
    retryRequested: boolean;
    metadata: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RemixProject" WHERE "id" = ${input.projectId} FOR UPDATE`;
      const fresh = await tx.remixProject.findUnique({
        where: { id: input.projectId },
        select: {
          generationJobId: true,
          generationProvider: true,
          generationMetadata: true,
        },
      });
      const archiveEntry =
        input.retryRequested && fresh ? archiveEntryFromProject(fresh) : null;
      const previousDrafts = [
        ...(archiveEntry ? [archiveEntry] : []),
        ...previousDraftsFromMetadata(fresh?.generationMetadata),
      ].slice(0, REMIX_PREVIOUS_DRAFTS_MAX);
      const metadata: Record<string, unknown> = {
        ...input.metadata,
        retryOfJobId: input.retryRequested
          ? (fresh?.generationJobId ?? null)
          : null,
        ...(previousDrafts.length > 0 ? { previousDrafts } : {}),
      };
      const metadataJson = JSON.stringify(metadata);

      const updated = input.retryRequested
        ? await tx.$executeRaw`
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
        : await tx.$executeRaw`
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
      return metadata;
    });
  }

  /**
   * Render-time AI parts (#1901), read tolerantly from the owned project's
   * stored `remix-parts/v1` against the resolved timeline (a stale per-block
   * list fails open to on-everywhere, like the beat). Muted parts are left
   * out silently; a part whose take is not a take of THIS project with the
   * same role is skipped as `take_missing`, one that is not completed (or
   * has no stored audio) as `take_not_ready`. Parts need a bar grid with a
   * tempo; without one they are skipped (logged). Undefined when there is
   * nothing to render or record.
   */
  private async resolveRenderParts(
    project: RemixProjectWithStems,
    sectionGrid: ReturnType<typeof deriveSectionGrid>,
    projectStructure: RemixStructure | null,
    renderStructure: RemixRenderStructure | undefined,
  ): Promise<RemixRenderParts | undefined> {
    if (!project.parts) return undefined;
    const stored = readStoredRemixParts(
      project.parts,
      sectionGrid ? structureBlockCount(sectionGrid, projectStructure) : null,
    );
    const unmuted = stored?.parts.filter((part) => !part.muted) ?? [];
    if (unmuted.length === 0) return undefined;
    if (
      !sectionGrid ||
      sectionGrid.kind !== "bars" ||
      !sectionGrid.bpm ||
      !(sectionGrid.bpm > 0)
    ) {
      this.logger.warn(
        `Remix project ${project.id}: stored AI parts have no bar grid to play on; rendering without them`,
      );
      return undefined;
    }
    // Owner-only: takes are looked up within this (owned) project only.
    const takes = await prisma.remixPartTake.findMany({
      where: {
        projectId: project.id,
        id: { in: unmuted.map((part) => part.takeId) },
      },
      select: {
        id: true,
        role: true,
        bars: true,
        status: true,
        storageUri: true,
        provider: true,
        model: true,
        promptVersion: true,
        conform: true,
      },
    });
    const takeById = new Map(takes.map((take) => [take.id, take]));
    const parts: RemixRenderPart[] = [];
    const skipped: RemixRenderParts["skipped"] = [];
    for (const part of unmuted) {
      const take = takeById.get(part.takeId);
      if (!take || take.role !== part.role) {
        skipped.push({
          partId: part.id,
          takeId: part.takeId,
          reason: "take_missing",
        });
        continue;
      }
      if (take.status !== "completed" || !take.storageUri) {
        skipped.push({
          partId: part.id,
          takeId: part.takeId,
          reason: "take_not_ready",
        });
        continue;
      }
      const conform = normalizeMetadataObject(take.conform);
      parts.push({
        partId: part.id,
        role: part.role,
        takeId: take.id,
        gainDb: part.gainDb ?? 0,
        blocks: part.blocks ?? null,
        bars: take.bars,
        storageUri: take.storageUri,
        provider: take.provider,
        model: take.model,
        promptVersion: take.promptVersion,
        conformVersion:
          typeof conform.conformVersion === "string"
            ? conform.conformVersion
            : null,
      });
    }
    return {
      parts,
      skipped,
      grid: sectionGrid,
      segments:
        renderStructure?.segments ?? structureTimeline(sectionGrid, null),
    };
  }

  private async maybeRenderStemPlusAiLayer(input: {
    projectId: string;
    generationInput: RemixGenerationJobData["generationInput"];
    stems: Array<{ stemId: string; gainDb: number | null; muted: boolean }>;
    authorization: StemRenderAuthorization;
    /** Project effects recipe + grid tempo (#1897); absent = no effects. */
    fx?: RemixRenderFx;
    /** Structure blocks + timeline (#1899); absent = the original order. */
    structure?: RemixRenderStructure;
    /** Beat maker recipe + bar grid + timeline (#1902); absent = no beat. */
    beat?: RemixRenderBeat;
    /** AI parts + bar grid + timeline (#1901); absent = no parts. */
    parts?: RemixRenderParts;
  }) {
    const layerJob = await this.generationProvider.createRemixDraft(
      {
        ...input.generationInput,
        // Live arrangement at process time, mirroring stem_mix, so
        // audio-conditioned generation (#1182 slice 4) conditions on the
        // current mix and #1209 layered rendering keeps source stems current.
        stemArrangement: input.stems,
        ...(input.fx ? { renderFx: input.fx } : {}),
        ...(input.structure ? { renderStructure: input.structure } : {}),
        ...(input.beat ? { renderBeat: input.beat } : {}),
        ...(input.parts ? { renderParts: input.parts } : {}),
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
      ...(input.fx ? { fx: input.fx } : {}),
      ...(input.structure ? { structure: input.structure } : {}),
      ...(input.beat ? { beat: input.beat } : {}),
      ...(input.parts ? { parts: input.parts } : {}),
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
      allowHistoricalStemIds: true,
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
    const renderMetadataRecord = normalizeMetadataObject(metadata.renderMetadata);
    const renderedEffects = readStoredRemixFx(renderMetadataRecord.effects);
    // #1898: the time-stretch stage the render (or conditioning mix) ran.
    const renderedStretch = renderedEffects
      ? readStoredRemixStretch(renderMetadataRecord.stretch)
      : null;
    const conditioningRecord = normalizeMetadataObject(
      metadata.conditioningEffects,
    );
    const conditioningEffects = readStoredRemixFx(conditioningRecord.effects);
    const conditioningStretch = conditioningEffects
      ? readStoredRemixStretch(conditioningRecord.stretch)
      : null;
    // #1899: lineage records what the render recorded (no grid range check —
    // the render already resolved sections against its grid).
    const renderedStructure = readStoredRemixStructure(
      renderMetadataRecord.structure,
      null,
    );
    const conditioningStructureRecord = normalizeMetadataObject(
      metadata.conditioningStructure,
    );
    const conditioningStructure = readStoredRemixStructure(
      conditioningStructureRecord.structure,
      null,
    );
    // #1902: the beat the render mixed in / the conditioning audio carried
    // (no block-count check — the render already resolved it).
    const renderedBeat = readStoredRemixBeat(renderMetadataRecord.beat, null);
    const conditioningBeatRecord = normalizeMetadataObject(
      metadata.conditioningBeat,
    );
    const conditioningBeat = readStoredRemixBeat(
      conditioningBeatRecord.beat,
      null,
    );
    // #1901: the AI parts the render mixed in / the conditioning audio
    // carried (recorded lineage, not the possibly-edited live project).
    const renderedParts = readRenderedParts(renderMetadataRecord.parts);
    const conditioningPartsRecord = normalizeMetadataObject(
      metadata.conditioningParts,
    );
    const conditioningParts = readRenderedParts(conditioningPartsRecord.parts);
    const aiParts = renderedParts.length > 0 || conditioningParts.length > 0;
    const mimeType =
      draftMimeTypeFromMetadata(project.generationMetadata) ??
      draftMimeTypeFromUri(outputUri);
    // A draft with AI parts is AI-assisted (#1901), even if its recorded
    // grounding predates that rule.
    const grounding = groundingWithAiParts(
      draftGroundingFromMetadata(project.generationMetadata) ?? "prompt_only",
      aiParts,
    );
    // AI integrity (#1164): stem_audio renders contain the licensed source
    // audio itself; everything else is generated and must be disclosed.
    const aiGenerated = groundingAiGenerated(grounding);
    // AI parts (#1901) declare the instruments facet, at least PARTLY.
    const aiDisclosure = deriveRemixAiDisclosure(grounding, { aiParts });
    const addedParts = [
      ...(renderedBeat ? ["beat"] : []),
      ...(renderedParts.length > 0 ? ["ai_part"] : []),
    ];

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
      // #1897: the effects recipe the published draft was rendered with
      // (from its render metadata, not the possibly-edited live project).
      ...(renderedEffects
        ? {
            effects: renderedEffects,
            effectsDspVersion:
              typeof renderMetadataRecord.effectsDspVersion === "string"
                ? renderMetadataRecord.effectsDspVersion
                : REMIX_FX_DSP_VERSION,
            // #1903: the Pro EQ/pan mapping, when the render recorded one.
            ...(typeof renderMetadataRecord.effectsProDspVersion === "string"
              ? {
                  effectsProDspVersion:
                    renderMetadataRecord.effectsProDspVersion,
                }
              : {}),
            ...(renderedStretch ? { stretch: renderedStretch } : {}),
          }
        : {}),
      // Audio-conditioned drafts (#1897): the recipe that shaped the audio
      // the model conditioned on.
      ...(conditioningEffects
        ? {
            conditioningEffects: {
              effects: conditioningEffects,
              effectsDspVersion:
                typeof conditioningRecord.effectsDspVersion === "string"
                  ? conditioningRecord.effectsDspVersion
                  : REMIX_FX_DSP_VERSION,
              ...(typeof conditioningRecord.effectsProDspVersion === "string"
                ? {
                    effectsProDspVersion:
                      conditioningRecord.effectsProDspVersion,
                  }
                : {}),
              ...(conditioningStretch ? { stretch: conditioningStretch } : {}),
            },
          }
        : {}),
      // #1899: the structure blocks the published draft was rendered with.
      ...(renderedStructure
        ? {
            structure: renderedStructure,
            structureVersion:
              typeof renderMetadataRecord.structureVersion === "string"
                ? renderMetadataRecord.structureVersion
                : REMIX_STRUCTURE_DSP_VERSION,
          }
        : {}),
      ...(conditioningStructure
        ? {
            conditioningStructure: {
              structure: conditioningStructure,
              structureVersion:
                typeof conditioningStructureRecord.structureVersion ===
                "string"
                  ? conditioningStructureRecord.structureVersion
                  : REMIX_STRUCTURE_DSP_VERSION,
            },
          }
        : {}),
      // #1902: the synthesized beat the published draft was rendered with —
      // an added part that is neither AI nor source audio.
      ...(renderedBeat
        ? {
            beat: renderedBeat,
            beatDspVersion:
              typeof renderMetadataRecord.beatDspVersion === "string"
                ? renderMetadataRecord.beatDspVersion
                : REMIX_BEAT_DSP_VERSION,
          }
        : {}),
      // #1901: the AI parts (generated takes) the published draft was
      // rendered with — provider, model, prompt and conform versions.
      ...(renderedParts.length > 0
        ? {
            parts: renderedParts,
            partsDspVersion:
              typeof renderMetadataRecord.partsDspVersion === "string"
                ? renderMetadataRecord.partsDspVersion
                : REMIX_PARTS_DSP_VERSION,
          }
        : {}),
      ...(addedParts.length > 0 ? { addedParts } : {}),
      ...(conditioningBeat
        ? {
            conditioningBeat: {
              beat: conditioningBeat,
              beatDspVersion:
                typeof conditioningBeatRecord.beatDspVersion === "string"
                  ? conditioningBeatRecord.beatDspVersion
                  : REMIX_BEAT_DSP_VERSION,
            },
          }
        : {}),
      ...(conditioningParts.length > 0
        ? {
            conditioningParts: {
              parts: conditioningParts,
              partsDspVersion:
                typeof conditioningPartsRecord.partsDspVersion === "string"
                  ? conditioningPartsRecord.partsDspVersion
                  : REMIX_PARTS_DSP_VERSION,
            },
          }
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
              aiDisclosureLevel: aiDisclosure.level,
              aiContributionFacets: aiDisclosure.facets,
              aiDisclosureSource: "remix_derived",
              aiDisclosureVersion: AI_DISCLOSURE_VERSION,
              aiDeclaredAt: new Date(publishedAt),
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
                  // Pricing seed (#1413): so the master stem has a listing
                  // price the moment it becomes sellable. Deliberately omits
                  // every field so Prisma applies the StemPricing model's own
                  // defaults (schema.prisma) — the exact same numbers
                  // StemPricingService's "standard" template and its
                  // no-row-yet fallback already use for every other stem
                  // (backend/src/modules/pricing/stem-pricing.service.ts).
                  // No new price is introduced; see docs/rfc/business-model.md
                  // for canonical fee/price policy. Nested create on a
                  // brand-new stem id is inherently idempotent — no prior
                  // row can exist for it.
                  pricing: { create: {} },
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
    this.eventBus.publish({
      eventName: "catalog.ai_disclosure_recorded",
      eventVersion: 1,
      occurredAt: publishedAt,
      releaseId: release.id,
      trackId,
      level: aiDisclosure.level,
      source: "remix_derived",
      facets: aiDisclosure.facets,
    });

    const updated = (await loadProject(project.id))!;
    return {
      ...this.toResponse(
        updated,
        undefined,
        await this.projectEntitlements(userId),
      ),
      publishedRelease: { releaseId: release.id, trackId },
    };
  }

  /**
   * Exports a completed draft's final render as a downloadable file (#1323).
   * Owner-only. Eligibility is re-checked server-side — the creation-time
   * decision is explicitly not trusted (consent flips, quarantines, and
   * license expiry must block export) — and `export` is enforced on top of
   * `allowed`, exactly as publish enforces `publish_resonate`. Export requires
   * a COMMERCIAL license on the source stems (the tier that grants
   * off-platform/monetized use). Only a completed draft can be exported, and
   * the render bytes are read through the shared draft-audio path.
   */
  async exportDraft(
    userId: string,
    projectId: string,
  ): Promise<RemixDraftExport> {
    const project = await this.loadOwnedProject(userId, projectId);

    const generationStatus = remixGenerationStatusFromMetadata(
      project.generationMetadata,
    );
    const outputUri = draftOutputUriFromMetadata(project.generationMetadata);
    if (generationStatus !== "completed" || !outputUri) {
      throw new ConflictException({
        code: "draft_not_completed",
        message:
          "Only a completed draft can be exported. Generate a draft and wait for it to finish first.",
        generationStatus: generationStatus ?? "none",
      });
    }

    const stemIds = project.stems.map((stem) => stem.stemId);
    const eligibility = await this.eligibilityService.checkEligibility({
      userId,
      trackId: project.sourceTrackId,
      stemIds,
      allowHistoricalStemIds: true,
    });
    if (!eligibility.allowed) {
      this.publishDenialEvents(
        { userId, sourceTrackId: project.sourceTrackId, stemIds },
        eligibility,
      );
      throw new ForbiddenException({
        message: "Exporting this remix is not allowed for its source",
        eligibility,
      });
    }
    if (!eligibility.allowedActions.includes("export")) {
      throw new ForbiddenException({
        code: "export_not_allowed",
        message:
          "Exporting this remix requires a commercial license on the source stems.",
        eligibility,
      });
    }

    const audio = await this.readCurrentDraftAudio(project);
    const grounding =
      draftGroundingFromMetadata(project.generationMetadata) ?? "prompt_only";

    this.eventBus.publish({
      eventName: "remix.exported",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      remixProjectId: project.id,
      creatorId: userId,
      sourceTrackId: project.sourceTrackId,
      mode: project.mode,
      grounding,
      aiGenerated: groundingAiGenerated(grounding),
      policyVersion: eligibility.policyVersion,
    });

    return {
      ...audio,
      filename: `${sanitizeDownloadFilename(project.title)}${audioExtensionForMimeType(
        audio.mimeType,
      )}`,
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

    return this.readCurrentDraftAudio(project);
  }

  /**
   * Deletes an ARCHIVED draft version (#1910): removes its `previousDrafts`
   * entry, then best-effort deletes its stored audio. Owner-only (403/404 via
   * loadOwnedProject); published projects stay locked (409). The CURRENT
   * draft is not deletable here (404) — the owner regenerates instead.
   *
   * Order matters: the metadata removal commits first under a row lock, so
   * concurrent deletes serialize and exactly one caller removes the entry and
   * reaches the storage delete. A storage failure is logged and never
   * re-adds the entry. The object is only deleted when nothing else points
   * at it: no remaining archived entry, not the current draft output, and
   * never the published release audio (publish copies the draft into a
   * separate catalog-owned object; asserted defensively below).
   */
  async deleteDraftVersion(userId: string, projectId: string, jobId: string) {
    // Ownership first (403 / 404), outside the lock.
    await this.loadOwnedProject(userId, projectId);

    const removal = await prisma.$transaction(async (tx) => {
      // Row lock: serializes with concurrent deletes, PATCH autosaves,
      // generation claims and the publish status flip.
      await tx.$queryRaw`SELECT "id" FROM "RemixProject" WHERE "id" = ${projectId} FOR UPDATE`;
      const fresh = await tx.remixProject.findUnique({
        where: { id: projectId },
      });
      if (!fresh) {
        throw new NotFoundException(`Remix project ${projectId} not found`);
      }
      if (fresh.creatorUserId !== userId) {
        throw new ForbiddenException(
          "You do not have access to this remix project",
        );
      }
      if (fresh.status === "published") {
        throw new ConflictException({
          code: "project_published",
          message:
            "This remix project was published and its draft versions can no longer be deleted.",
          ...(fresh.publishedReleaseId
            ? { releaseId: fresh.publishedReleaseId }
            : {}),
        });
      }
      if (jobId === fresh.generationJobId) {
        throw new NotFoundException({
          code: "draft_version_not_found",
          message:
            "The current draft cannot be deleted; regenerate to replace it.",
        });
      }
      const archived = previousDraftsFromMetadata(fresh.generationMetadata);
      const target = archived.find((entry) => entry.jobId === jobId);
      if (!target) {
        throw new NotFoundException({
          code: "draft_version_not_found",
          message: "This draft version does not exist.",
        });
      }

      // An in-flight generation rewrites generationMetadata from a snapshot
      // taken before this delete, which would resurrect the entry after its
      // audio is gone. Deleting waits until the generation settles.
      const generationStatus = remixGenerationStatusFromMetadata(
        fresh.generationMetadata,
      );
      if (generationStatus === "pending" || generationStatus === "processing") {
        throw new ConflictException({
          code: "generation_in_progress",
          message:
            "A draft is being generated. Wait for it to finish before deleting a previous version.",
        });
      }

      const metadata = normalizeMetadataObject(fresh.generationMetadata);
      // Drop every entry with this jobId, preserving any malformed entries
      // the reader filters out (they are not ours to rewrite).
      const rawList = Array.isArray(metadata.previousDrafts)
        ? (metadata.previousDrafts as unknown[])
        : [];
      const nextList = rawList.filter(
        (entry) =>
          !(
            entry &&
            typeof entry === "object" &&
            (entry as { jobId?: unknown }).jobId === jobId
          ),
      );
      const nextMetadata: Record<string, unknown> = { ...metadata };
      if (nextList.length > 0) nextMetadata.previousDrafts = nextList;
      else delete nextMetadata.previousDrafts;

      await tx.remixProject.update({
        where: { id: projectId },
        data: { generationMetadata: nextMetadata as Prisma.JsonObject },
      });

      const targetUri = target.output.outputUri;
      const stillReferenced =
        previousDraftsFromMetadata(nextMetadata).some(
          (entry) => entry.output.outputUri === targetUri,
        ) || draftOutputUriFromMetadata(nextMetadata) === targetUri;
      // Defensive: publish writes a catalog copy, so a draft URI should never
      // be the published release audio — but never delete it if it were.
      const isPublishedAudio = fresh.publishedReleaseId
        ? (await tx.stem.count({
            where: {
              uri: targetUri,
              track: { releaseId: fresh.publishedReleaseId },
            },
          })) > 0
        : false;

      return {
        uri: targetUri,
        deleteObject: !stillReferenced && !isPublishedAudio,
      };
    });

    if (removal.deleteObject) {
      try {
        await this.storageProvider.delete(removal.uri);
      } catch (error) {
        // Ids only: the URI and provider error body stay out of logs.
        this.logger.warn(
          `Draft version audio delete failed (project=${projectId}, job=${jobId}, error=${
            error instanceof Error ? error.name : "unknown"
          }); the version was already removed.`,
        );
      }
    }

    this.eventBus.publish({
      eventName: "remix.draft_version_deleted",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      remixProjectId: projectId,
      creatorId: userId,
      generationJobId: jobId,
    });

    return this.getProject(userId, projectId);
  }

  /**
   * Reads the project's CURRENT draft render (bytes + mime) through the storage
   * provider. Shared by getDraftAudio (archived-version branch aside) and
   * exportDraft so the decrypt/read path is written once. 404s when no playable
   * draft output exists.
   */
  private async readCurrentDraftAudio(project: {
    generationMetadata: unknown;
  }): Promise<RemixDraftAudio> {
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
        where: { trackId, isCurrent: true },
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
        where: { trackId: project.sourceTrackId, isCurrent: true },
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
    entitlements?: RemixProjectEntitlements,
  ) {
    const sectionGrid = deriveSectionGrid(
      project.stems.map((stem) => ({
        audioFeatures: stem.stem.audioFeatures,
      })),
    );
    // Structure blocks (#1899), read tolerantly against the current grid
    // (over-cap rows read as null, exactly as the render fails open).
    const structure = resolveStoredRemixStructure(
      project.structure,
      sectionGrid,
    ).structure;
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
      // Variation AI target (#1882); null = whole-track default.
      aiTarget: readStoredAiTarget(project.aiTarget),
      // Shared effects recipe (#1897); null = untouched.
      effects: readStoredRemixFx(project.effects),
      // Structure blocks (#1899); null = the original section order.
      structure,
      // Beat maker (#1902); null = no beat. A stale per-block list reads as
      // null (on everywhere), exactly as the render fails open.
      beat: readStoredRemixBeat(
        project.beat,
        sectionGrid ? structureBlockCount(sectionGrid, structure) : null,
      ),
      // AI part lanes (#1901), read tolerantly: a part whose take is not a
      // completed take of this project with its role is dropped; a stale
      // per-block list reads as on-everywhere, like the beat.
      parts: readStoredRemixParts(
        project.parts,
        sectionGrid ? structureBlockCount(sectionGrid, structure) : null,
        project.partTakes,
      ),
      // Newest first, at most the per-project cap; no storage URIs (the
      // audio streams through the owner-only take audio endpoint).
      partTakes: project.partTakes.map(toPartTakeResponse),
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
      sectionGrid,
      // Derived output timeline (#1899), served like the grid so the studio
      // and the render share one derivation; the grid's sections in order
      // when there is no structure, null without a grid.
      timeline: sectionGrid
        ? structureTimeline(sectionGrid, structure?.blocks ?? null)
        : null,
      ...(eligibility ? { eligibility } : {}),
      // Entitlements (#1903): Remix Studio Pro mode, decided server-side so
      // the client never hard-codes it.
      ...(entitlements ? { entitlements } : {}),
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

/**
 * Sanitizes a project title into a safe download filename base (#1323): keeps
 * word characters, spaces, and hyphens; collapses everything else to a single
 * hyphen; trims; falls back to "remix" when nothing usable remains. Keeps the
 * value free of path separators and quotes so the Content-Disposition header
 * cannot be broken.
 */
function sanitizeDownloadFilename(title: string | null | undefined): string {
  const cleaned = (title ?? "")
    .replace(/[^\w\s-]+/g, " ")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return cleaned || "remix";
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
