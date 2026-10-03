import { Injectable, Optional } from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AGENT_REPLAY_LOOKBACK_MS, AGENT_SIGNAL_WEIGHTS } from "../../config/agent_learning";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../analytics/analytics_consent.service";
import {
  readTasteMemoryPolicy,
  scoreMultiplierForSignal,
  TasteMemoryPolicy,
  TasteMemoryService,
} from "../recommendations/taste_memory.service";
import { DISCOVERY_REASON_CODES } from "../recommendations/discovery-explanations";
import { sanitizeSignalMetadataString } from "../shared/signal_metadata_sanitizer";
import { mergeSessionGenres } from "./agent_session_genres";

export { AGENT_SIGNAL_WEIGHTS } from "../../config/agent_learning";

export type AgentSignalAction = keyof typeof AGENT_SIGNAL_WEIGHTS;
export type AgentSignalMetadata = Prisma.InputJsonObject;

export const AGENT_SIGNAL_METADATA_SCHEMA_VERSION = "agent-signal-metadata/v1";

export type AgentTasteProfile = {
  schemaVersion: "agent-taste-profile/v1";
  score: number;
  tier: "New" | "Emerging" | "Focused" | "Deep";
  signals: number;
  positiveSignals: number;
  negativeSignals: number;
  acceptanceRate: number;
  genresExplored: string[];
  favoredGenres: string[];
  genreWeights: Record<string, number>;
  diversity: number;
  depth: number;
  consistency: number;
  updatedAt: string;
};

export type AgentTasteSignalInput = {
  action: AgentSignalAction;
  trackId: string;
  createdAt?: Date;
  weight?: number;
  genre?: string | null;
};

export function isAgentSignalAction(action: string): action is AgentSignalAction {
  return Object.prototype.hasOwnProperty.call(AGENT_SIGNAL_WEIGHTS, action);
}

export function buildAgentSignalMetadata(input: {
  source?: unknown;
  sessionIntent?: unknown;
  sessionIntentName?: unknown;
  mood?: unknown;
  vibe?: unknown;
  energy?: unknown;
  genres?: unknown;
  licenseType?: unknown;
  queueStyle?: unknown;
  startSource?: unknown;
  filterKind?: unknown;
  autoQueuedTracks?: unknown;
  runtime?: unknown;
  initiator?: unknown;
  agentOriginated?: unknown;
  agentSessionId?: unknown;
  playbackCommandId?: unknown;
  localHourBucket?: unknown;
  weekdayKind?: unknown;
  playbackInstanceId?: unknown;
  playlistId?: unknown;
  repeatMode?: unknown;
  recommendation?: unknown;
  reason?: unknown;
  reasoning?: unknown;
  outcome?: Record<string, unknown>;
}): AgentSignalMetadata {
  const metadata: Record<string, unknown> = {
    schemaVersion: AGENT_SIGNAL_METADATA_SCHEMA_VERSION,
  };
  copyString(metadata, "source", input.source, 80);
  copyString(metadata, "sessionIntent", input.sessionIntent, 64);
  copyString(metadata, "sessionIntentName", input.sessionIntentName, 80);
  copyString(metadata, "mood", input.mood, 64);
  copyString(metadata, "vibe", input.vibe, 64);
  copyString(metadata, "energy", input.energy, 16);
  copyStringArray(metadata, "genres", input.genres, 8, 64);
  copyString(metadata, "licenseType", input.licenseType, 24);
  copyString(metadata, "queueStyle", input.queueStyle, 48);
  copyString(metadata, "startSource", input.startSource, 80);
  copyString(metadata, "filterKind", input.filterKind, 32);
  copyNumber(metadata, "autoQueuedTracks", input.autoQueuedTracks);
  copyString(metadata, "runtime", input.runtime, 32);
  copyString(metadata, "initiator", input.initiator, 32);
  copyBoolean(metadata, "agentOriginated", input.agentOriginated);
  copyString(metadata, "agentSessionId", input.agentSessionId, 80);
  copyString(metadata, "playbackCommandId", input.playbackCommandId, 80);
  copyEnum(metadata, "localHourBucket", input.localHourBucket, ["night", "morning", "afternoon", "evening"]);
  copyEnum(metadata, "weekdayKind", input.weekdayKind, ["weekday", "weekend"]);
  copyString(metadata, "playbackInstanceId", input.playbackInstanceId, 100);
  copyString(metadata, "playlistId", input.playlistId, 100);
  copyEnum(metadata, "repeatMode", input.repeatMode, ["none", "one", "all"]);
  copySafeRecommendation(metadata, input.recommendation);
  copyString(metadata, "reason", input.reason, 160);
  copyString(metadata, "reasoning", input.reasoning, 240);

  const outcome = sanitizeSignalOutcome(input.outcome);
  if (outcome) {
    metadata.outcome = outcome;
  }

  return metadata as AgentSignalMetadata;
}

export function computeAgentTasteProfileFromSignals(
  signals: AgentTasteSignalInput[],
  fallbackGenres: string[] = [],
  now = new Date(),
): AgentTasteProfile {
  const genreWeights = new Map<string, number>();
  let positiveSignals = 0;
  let negativeSignals = 0;
  let positiveWeight = 0;
  let absoluteWeight = 0;

  for (const signal of signals) {
    const weight = signal.weight ?? AGENT_SIGNAL_WEIGHTS[signal.action];
    absoluteWeight += Math.abs(weight);
    if (weight > 0) {
      positiveSignals += 1;
      positiveWeight += weight;
    } else if (weight < 0) {
      negativeSignals += 1;
    }

    const genre = signal.genre?.trim();
    if (genre) {
      genreWeights.set(genre, (genreWeights.get(genre) ?? 0) + weight);
    }
  }

  const rankedGenres = Array.from(genreWeights.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const positiveGenres = rankedGenres
    .filter(([, weight]) => weight > 0)
    .map(([genre]) => genre);
  const fallback = fallbackGenres.filter(Boolean);
  const genresExplored = positiveGenres.length > 0
    ? positiveGenres
    : Array.from(new Set(fallback));
  const favoredGenres = positiveGenres.slice(0, 5);
  const signalsCount = signals.length;
  const acceptanceRate = signalsCount === 0
    ? 0
    : positiveSignals / Math.max(1, positiveSignals + negativeSignals);
  const diversity = Math.min(1, genresExplored.length / 8);
  const depth = Math.min(1, positiveWeight / 24);
  const topWeight = Math.max(0, rankedGenres[0]?.[1] ?? 0);
  const consistency = positiveWeight === 0 ? 0 : Math.min(1, topWeight / positiveWeight);
  const score = signalsCount === 0
    ? 0
    : Math.round((diversity * 30) + (depth * 35) + (acceptanceRate * 25) + (consistency * 10));
  const tier =
    score >= 80 ? "Deep" :
      score >= 50 ? "Focused" :
        score >= 20 ? "Emerging" :
          "New";

  return {
    schemaVersion: "agent-taste-profile/v1",
    score: Math.max(0, Math.min(100, score)),
    tier,
    signals: signalsCount,
    positiveSignals,
    negativeSignals,
    acceptanceRate,
    genresExplored,
    favoredGenres,
    genreWeights: Object.fromEntries(rankedGenres),
    diversity,
    depth,
    consistency,
    updatedAt: (signals[0]?.createdAt ?? now).toISOString(),
  };
}

function sanitizeSignalOutcome(outcome?: Record<string, unknown>) {
  if (!outcome) {
    return undefined;
  }

  const sanitized: Record<string, string | number | boolean> = {};
  copyString(sanitized, "type", outcome.type, 40);
  copyString(sanitized, "source", outcome.source, 80);
  copyBoolean(sanitized, "firstPick", outcome.firstPick);
  copyNumber(sanitized, "completionRatio", outcome.completionRatio);
  copyNumber(sanitized, "durationMs", outcome.durationMs);
  // #1449: where in the track a deliberate skip happened — a useful,
  // non-identifying learning feature for the skip signal.
  copyNumber(sanitized, "positionMs", outcome.positionMs);
  copyNumber(sanitized, "sessionDurationMs", outcome.sessionDurationMs);
  copyNumber(sanitized, "priceUsd", outcome.priceUsd);
  copyString(sanitized, "status", outcome.status, 40);
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function copySafeRecommendation(target: Record<string, unknown>, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const recommendation = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  copyNumber(safe, "score", recommendation.score);
  copyStringArray(safe, "explanation", recommendation.explanation, 5, 120);
  // Categorical only: a value outside the shared vocabulary is dropped, never
  // stored (the Sonic Radar journal validates against the same list).
  if (
    typeof recommendation.reasonCode === "string" &&
    (DISCOVERY_REASON_CODES as readonly string[]).includes(recommendation.reasonCode)
  ) {
    safe.reasonCode = recommendation.reasonCode;
  }
  if (
    safe.score !== undefined ||
    safe.explanation !== undefined ||
    safe.reasonCode !== undefined
  ) {
    target.recommendation = safe;
  }
}

function copyString(target: Record<string, unknown>, key: string, value: unknown, maxLength: number) {
  const sanitized = sanitizeSignalMetadataString(value, maxLength);
  if (sanitized) {
    target[key] = sanitized;
  }
}

function copyStringArray(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  maxItems: number,
  maxLength: number,
) {
  if (!Array.isArray(value)) {
    return;
  }
  const items = value
    .slice(0, maxItems)
    .map((entry) => sanitizeSignalMetadataString(entry, maxLength))
    .filter((entry): entry is string => Boolean(entry));
  if (items.length > 0) {
    target[key] = items;
  }
}

function copyNumber(target: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

function copyBoolean(target: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value === "boolean") {
    target[key] = value;
  }
}

function copyEnum<const Values extends readonly string[]>(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  allowed: Values,
) {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    target[key] = value;
  }
}

export interface AgentSignalTelemetryDescriptor {
  /** Stable identity for retry or browser-session deduplication. */
  dedupKey?: string;
  /** Browser analytics session, retained only as a user-scoped pseudonym in metadata. */
  playbackSessionId?: string;
}

type AgentSignalRecordInput = {
  userId: string;
  sessionId?: string | null;
  trackId: string;
  action: AgentSignalAction;
  metadata?: Prisma.InputJsonObject;
  telemetry?: AgentSignalTelemetryDescriptor;
};

@Injectable()
export class AgentLearningService {
  constructor(@Optional() private readonly tasteMemoryService?: TasteMemoryService) {}

  async recordSignal(input: AgentSignalRecordInput & { telemetry: AgentSignalTelemetryDescriptor }): Promise<AgentTasteProfile | null>;
  async recordSignal(input: AgentSignalRecordInput & { telemetry?: undefined }): Promise<AgentTasteProfile>;
  async recordSignal(input: AgentSignalRecordInput): Promise<AgentTasteProfile | null> {
    if (input.telemetry) {
      return this.recordTelemetrySignal(input as AgentSignalRecordInput & {
        telemetry: AgentSignalTelemetryDescriptor;
      });
    }

    const shouldTrain = await this.tasteMemoryService?.shouldTrainAgentPlayback(input.userId, input.metadata);
    if (shouldTrain === false) {
      const config = await prisma.agentConfig.findUnique({
        where: { userId: input.userId },
      });
      return this.computeTasteProfile(input.userId, config?.vibes ?? []);
    }

    const weight = AGENT_SIGNAL_WEIGHTS[input.action];
    await prisma.agentSignal.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId ?? null,
        trackId: input.trackId,
        action: input.action,
        weight,
        metadata: input.metadata,
      },
    });

    const config = await prisma.agentConfig.findUnique({
      where: { userId: input.userId },
    });
    const profile = await this.computeTasteProfile(input.userId, config?.vibes ?? []);

    if (config) {
      await this.persistTasteProfile(config.id, profile);
    }

    return profile;
  }

  private async recordTelemetrySignal(input: AgentSignalRecordInput & { telemetry: AgentSignalTelemetryDescriptor }) {
    const dedupId = signalIdForTelemetry(input.userId, input.telemetry.dedupKey);
    const playbackSessionId = userScopedPlaybackSessionId(input.userId, input.telemetry.playbackSessionId);
    const created = await prisma.$transaction(async (tx) => {
      // AnalyticsConsentService uses the same lock when changing consent, so
      // refusal and ingestion cannot cross in flight.
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE
      `);

      const consent = await tx.analyticsConsent.findUnique({
        where: { userId: input.userId },
        select: { productAnalytics: true, policyVersion: true },
      });
      if (
        !consent?.productAnalytics ||
        consent.policyVersion !== ANALYTICS_CONSENT_POLICY_VERSION
      ) {
        return false;
      }

      const settings = await tx.listenerTasteMemorySettings.findUnique({
        where: { userId: input.userId },
        select: { agentPlaybackTrainingEnabled: true, resetAt: true },
      });
      if (settings?.agentPlaybackTrainingEnabled === false) {
        return false;
      }

      if (dedupId && await tx.agentSignal.findUnique({ where: { id: dedupId }, select: { id: true } })) {
        return false;
      }

      const priorCompletion = input.action === "complete"
        ? await findPriorTelemetryCompletion(tx, {
          userId: input.userId,
          trackId: input.trackId,
          resetAt: settings?.resetAt,
          playbackInstanceId: jsonString(jsonObject(input.metadata).playbackInstanceId),
        })
        : false;
      const action = priorCompletion ? "replay" : input.action;
      const metadata = telemetrySignalMetadata(input.metadata, playbackSessionId);

      await tx.agentSignal.create({
        data: {
          ...(dedupId ? { id: dedupId } : {}),
          userId: input.userId,
          // Browser sessions are analytics context, never Session foreign keys.
          sessionId: null,
          trackId: input.trackId,
          action,
          weight: AGENT_SIGNAL_WEIGHTS[action],
          metadata,
        },
      });
      return true;
    });

    // Retries and refused telemetry do not recalculate or rewrite the profile.
    if (!created) {
      return null;
    }

    // Keep profile refreshes ordered with telemetry writes. The first
    // transaction has committed by this point, so this lock protects a fresh
    // read of every committed signal and prevents an older snapshot from
    // overwriting a newer profile.
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE
      `);
      const config = await tx.agentConfig.findUnique({ where: { userId: input.userId } });
      const policy = await readTasteMemoryPolicy(input.userId, tx);
      const profile = await computeTasteProfileFromHistory(
        input.userId,
        { fallbackGenres: config?.vibes ?? [], policy },
        tx,
      );
      if (config) {
        await tx.agentConfig.update({
          where: { id: config.id },
          data: {
            learnedTasteProfile: profile,
            tasteScore: profile.score,
            tasteUpdatedAt: new Date(profile.updatedAt),
          },
        });
      }
      return profile;
    });
  }

  async annotateSessionOutcome(input: {
    userId: string;
    sessionId: string;
    outcome: Record<string, unknown>;
  }) {
    const signals = await prisma.agentSignal.findMany({
      where: {
        userId: input.userId,
        sessionId: input.sessionId,
      },
      select: {
        id: true,
        metadata: true,
      },
    });
    const outcome = sanitizeSignalOutcome(input.outcome);
    if (!outcome || signals.length === 0) {
      return { updated: 0 };
    }

    await prisma.$transaction(
      signals.map((signal) => {
        const metadata = {
          ...jsonObject(signal.metadata),
          schemaVersion: AGENT_SIGNAL_METADATA_SCHEMA_VERSION,
          outcome: {
            ...jsonObject(jsonObject(signal.metadata).outcome),
            ...outcome,
          },
        };
        return prisma.agentSignal.update({
          where: { id: signal.id },
          data: { metadata: metadata as Prisma.InputJsonObject },
        });
      }),
    );

    return { updated: signals.length };
  }

  async computeTasteProfile(
    userId: string,
    fallbackGenres: string[] = [],
    options: { take?: number } = {},
  ): Promise<AgentTasteProfile> {
    const policy = await this.tasteMemoryService?.getPolicy(userId);
    return computeTasteProfileFromHistory(userId, { fallbackGenres, policy, ...options });
  }

  /**
   * The taste profile both discovery surfaces consume (#1456 WS-9): the
   * persisted `AgentConfig.learnedTasteProfile`, computed from history only
   * when none is stored. Home and the AI DJ call this same resolver, so one
   * listener has one set of learned genre weights.
   */
  async resolveTasteProfile(
    userId: string,
    fallbackGenres: string[] = [],
    policy?: TasteMemoryPolicy,
  ): Promise<AgentTasteProfile> {
    return resolveAgentTasteProfile(userId, {
      fallbackGenres,
      policy: policy ?? (await this.tasteMemoryService?.getPolicy(userId)),
    });
  }

  async persistTasteProfile(agentConfigId: string, profile: AgentTasteProfile) {
    return prisma.agentConfig.update({
      where: { id: agentConfigId },
      data: {
        learnedTasteProfile: profile,
        tasteScore: profile.score,
        tasteUpdatedAt: new Date(profile.updatedAt),
      },
    });
  }

  /**
   * Learned favorites, then saved vibes, then this session's own genres (a
   * preset's genres must survive the merge). See `mergeSessionGenres`.
   */
  mergeLearnedGenres(
    vibes: string[],
    profile: AgentTasteProfile,
    sessionGenres: string[] = [],
  ): string[] {
    return mergeSessionGenres({
      learnedGenres: profile.favoredGenres,
      vibes,
      sessionGenres,
    });
  }
}

/**
 * Computes the taste profile from the listener's recorded signals (newest 500
 * by default), honoring the taste-memory reset and genre controls in `policy`.
 */
export async function computeTasteProfileFromHistory(
  userId: string,
  options: {
    fallbackGenres?: string[];
    policy?: TasteMemoryPolicy;
    take?: number;
  } = {},
  db: Prisma.TransactionClient = prisma,
): Promise<AgentTasteProfile> {
  const { policy } = options;
  const signals = await db.agentSignal.findMany({
    where: {
      userId,
      ...(policy?.resetAt ? { createdAt: { gt: policy.resetAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 500,
    include: {
      track: {
        select: {
          release: { select: { genre: true } },
        },
      },
    },
  });

  return computeAgentTasteProfileFromSignals(
    signals
      .map((signal): AgentTasteSignalInput | null => {
        const genre = signal.track.release.genre;
        const multiplier = scoreMultiplierForSignal(policy, "genre", genre);
        if (multiplier <= 0) return null;
        return {
          action: signal.action as AgentSignalAction,
          trackId: signal.trackId,
          weight: signal.weight * multiplier,
          createdAt: signal.createdAt,
          genre,
        };
      })
      .filter((signal): signal is AgentTasteSignalInput => signal !== null),
    options.fallbackGenres ?? [],
  );
}

/** Validates a stored `AgentConfig.learnedTasteProfile` JSON value. */
export function parsePersistedAgentTasteProfile(
  value: unknown,
): AgentTasteProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<AgentTasteProfile>;
  if (candidate.schemaVersion !== "agent-taste-profile/v1") return null;
  const weights = candidate.genreWeights;
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    return null;
  }
  if (!Object.values(weights).every((weight) => Number.isFinite(weight))) {
    return null;
  }
  if (!Array.isArray(candidate.favoredGenres)) return null;
  return candidate as AgentTasteProfile;
}

/**
 * The single taste-profile resolver shared by Home and the AI DJ (#1456
 * WS-9): the persisted `AgentConfig.learnedTasteProfile` (kept current by
 * `recordSignal`, cleared by a taste-memory reset), else a profile computed
 * from the listener's signals. Read-only: it never writes the profile back.
 */
export async function resolveAgentTasteProfile(
  userId: string,
  options: { fallbackGenres?: string[]; policy?: TasteMemoryPolicy } = {},
): Promise<AgentTasteProfile> {
  const config = await prisma.agentConfig.findUnique({
    where: { userId },
    select: { learnedTasteProfile: true },
  });
  const persisted = parsePersistedAgentTasteProfile(config?.learnedTasteProfile);
  if (persisted) return persisted;
  return computeTasteProfileFromHistory(userId, options);
}

function signalIdForTelemetry(userId: string, dedupKey?: string) {
  if (typeof dedupKey !== "string" || !dedupKey || dedupKey.length > 512) {
    return undefined;
  }
  return `telemetry_${createHash("sha256")
    .update(JSON.stringify(["agent-signal-telemetry:v1", userId, dedupKey]))
    .digest("hex")}`;
}

function userScopedPlaybackSessionId(userId: string, sessionId?: string) {
  const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    return undefined;
  }
  return `playback_${createHash("sha256")
    .update(JSON.stringify(["agent-playback-session:v1", userId, normalized]))
    .digest("hex")
    .slice(0, 32)}`;
}

function telemetrySignalMetadata(
  metadata: Prisma.InputJsonObject | undefined,
  playbackSessionId?: string,
): Prisma.InputJsonObject {
  const safe: Record<string, unknown> = { ...jsonObject(metadata), telemetryMirror: true };
  // Session identifiers are pseudonymized by userScopedPlaybackSessionId so a
  // browser value that resembles an account/session token is never persisted.
  delete safe.playbackSessionId;
  if (playbackSessionId) {
    safe.playbackSessionId = playbackSessionId;
  }
  return safe as Prisma.InputJsonObject;
}

async function findPriorTelemetryCompletion(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    trackId: string;
    resetAt?: Date | null;
    playbackInstanceId?: string;
  },
) {
  const lookbackStart = new Date(Date.now() - AGENT_REPLAY_LOOKBACK_MS);
  const resetFilter = input.resetAt
    ? Prisma.sql`AND "createdAt" > ${input.resetAt}`
    : Prisma.empty;
  const instanceFilter = input.playbackInstanceId
    ? Prisma.sql`AND "metadata"->>'playbackInstanceId' IS DISTINCT FROM ${input.playbackInstanceId}`
    : Prisma.empty;
  const matches = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AgentSignal"
    WHERE "userId" = ${input.userId}
      AND "trackId" = ${input.trackId}
      AND "action" IN ('complete', 'replay')
      AND "createdAt" >= ${lookbackStart}
      ${resetFilter}
      ${instanceFilter}
      AND COALESCE("metadata"->>'source', '') <> 'agent_session'
      AND COALESCE("metadata"->>'agentOriginated', 'false') <> 'true'
      AND (
        "metadata"->>'telemetryMirror' = 'true'
        OR "metadata"->>'source' IN ('web_player', 'web_player_local')
      )
      AND "metadata"->'outcome'->>'type' = 'playback_completed'
    LIMIT 1
  `);
  return matches.length > 0;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
