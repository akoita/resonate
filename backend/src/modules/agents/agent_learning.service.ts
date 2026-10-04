import { Injectable, Optional } from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  AGENT_BEHAVIORAL_HALF_LIFE_DAYS,
  AGENT_COMMITMENT_HALF_LIFE_DAYS,
  AGENT_REPLAY_LOOKBACK_MS,
  AGENT_SIGNAL_WEIGHTS,
  AGENT_TASTE_HISTORY_LIMIT,
  AGENT_TASTE_HISTORY_WINDOW_DAYS,
} from "../../config/agent_learning";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../analytics/analytics_consent.service";
import {
  readTasteMemoryPolicy,
  scoreMultiplierForSignal,
  TasteMemoryPolicy,
  TasteMemoryService,
} from "../recommendations/taste_memory.service";
import { DISCOVERY_REASON_CODES } from "../recommendations/discovery-explanations";
import { measuredTrackFeatures } from "./measured_track_features";
import { sanitizeSignalMetadataString } from "../shared/signal_metadata_sanitizer";
import { mergeSessionGenres } from "./agent_session_genres";

export { AGENT_SIGNAL_WEIGHTS } from "../../config/agent_learning";

export type AgentSignalAction = keyof typeof AGENT_SIGNAL_WEIGHTS;
export type AgentSignalMetadata = Prisma.InputJsonObject;

export const AGENT_SIGNAL_METADATA_SCHEMA_VERSION = "agent-signal-metadata/v1";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AgentTasteProfile = {
  schemaVersion: "agent-taste-profile/v1" | "agent-taste-profile/v2";
  score: number;
  tier: "New" | "Emerging" | "Focused" | "Deep";
  signals: number;
  positiveSignals: number;
  negativeSignals: number;
  acceptanceRate: number;
  genresExplored: string[];
  favoredGenres: string[];
  genreWeights: Record<string, number>;
  moodWeights?: Record<string, number>;
  artistWeights?: Record<string, number>;
  energyBandWeights?: Record<string, number>;
  tempoBandWeights?: Record<string, number>;
  contextWeights?: Record<string, {
    genreWeights: Record<string, number>;
    moodWeights: Record<string, number>;
  }>;
  diversity: number;
  depth: number;
  consistency: number;
  updatedAt: string;
};

export type AgentTasteSignalInput = {
  /** Unknown persisted actions are valid when they carry a finite stored weight. */
  action: string;
  trackId: string;
  /** Internal user-scoped session grouping; never returned in taste summaries. */
  sessionKey?: string;
  createdAt?: Date;
  weight?: number;
  genre?: string | null;
  moods?: string[];
  artists?: string[];
  /** Catalog aliases used only for policy matching, never as extra artist weights. */
  artistAliases?: Record<string, string[]>;
  localHourBucket?: string | null;
  weekdayKind?: string | null;
  /** Values must carry measured provenance; inferred audio features never train these bands. */
  audioFeatures?: {
    energy?: number | null;
    tempoBpm?: number | null;
    energySource?: "measured" | "inferred" | "unavailable";
    tempoSource?: "measured" | "inferred" | "unavailable";
  };
};

export type AgentTasteComputationOptions = {
  policy?: TasteMemoryPolicy;
  /** Disable time decay for compatibility checks over equal-history fixtures. */
  decay?: boolean;
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
  options: AgentTasteComputationOptions = {},
): AgentTasteProfile {
  const genreWeights = new Map<string, number>();
  const moodWeights = new Map<string, number>();
  const artistWeights = new Map<string, number>();
  const energyBandWeights = new Map<string, number>();
  const tempoBandWeights = new Map<string, number>();
  const contextWeights = new Map<string, { genreWeights: Map<string, number>; moodWeights: Map<string, number> }>();
  let positiveSignals = 0;
  let negativeSignals = 0;
  let signalCount = 0;
  let positiveWeight = 0;
  const cutoff = now.getTime() - AGENT_TASTE_HISTORY_WINDOW_DAYS * DAY_MS;
  const boundedSignals = signals
    .map((signal) => ({
      signal,
      createdAt: validDate(signal.createdAt) ?? now,
      weight: signal.weight ?? AGENT_SIGNAL_WEIGHTS[signal.action as AgentSignalAction],
    }))
    .filter(({ createdAt, weight }) =>
      createdAt.getTime() >= cutoff &&
      (!options.policy?.resetAt || createdAt > options.policy.resetAt) &&
      typeof weight === "number" &&
      Number.isFinite(weight),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, AGENT_TASTE_HISTORY_LIMIT);

  let latestSignalAt: Date | undefined;
  for (const { signal, createdAt, weight: storedWeight } of boundedSignals) {
    const baseWeight = storedWeight as number;
    const genre = safeTasteLabel(signal.genre);
    const moods = safeTasteLabels(signal.moods);
    const artists = safeTasteLabels(signal.artists);
    const genreMultiplier = scoreMultiplierForSignal(options.policy, "genre", genre);
    const artistMultipliers = artists.map((artist) =>
      artistControlMultiplier(options.policy, artist, signal.artistAliases?.[artist]),
    );

    // Hidden genre or artist controls exclude the whole signal. Hidden moods
    // remove only mood contributions below, leaving other dimensions intact.
    if (genreMultiplier <= 0 || artistMultipliers.some((multiplier) => multiplier <= 0)) {
      continue;
    }

    const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
    const halfLifeDays = isCommitmentAction(signal.action)
      ? AGENT_COMMITMENT_HALF_LIFE_DAYS
      : AGENT_BEHAVIORAL_HALF_LIFE_DAYS;
    const decay = options.decay === false
      ? 1
      : Math.pow(0.5, ageMs / (halfLifeDays * DAY_MS));
    const weight = baseWeight * decay;
    if (!Number.isFinite(weight)) continue;
    signalCount += 1;
    latestSignalAt = latestSignalAt && latestSignalAt > createdAt ? latestSignalAt : createdAt;

    if (weight > 0) {
      positiveSignals += 1;
      positiveWeight += weight;
    } else if (weight < 0) {
      negativeSignals += 1;
    }

    addWeightedValue(genreWeights, genre, weight * genreMultiplier);
    artists.forEach((artist, index) =>
      addWeightedValue(artistWeights, artist, weight * artistMultipliers[index]),
    );

    const contextKey = safePlaybackContextKey(signal.localHourBucket, signal.weekdayKind);
    const moodsWithWeights = moods
      .map((mood) => ({ mood, multiplier: scoreMultiplierForSignal(options.policy, "mood", mood) }))
      .filter(({ multiplier }) => multiplier > 0);
    moodsWithWeights.forEach(({ mood, multiplier }) => addWeightedValue(moodWeights, mood, weight * multiplier));

    const measuredEnergy = signal.audioFeatures?.energySource === "measured"
      ? finiteUnit(signal.audioFeatures.energy)
      : undefined;
    const measuredTempo = signal.audioFeatures?.tempoSource === "measured"
      ? finiteTempo(signal.audioFeatures.tempoBpm)
      : undefined;
    if (measuredEnergy !== undefined) {
      const band = energyBandFor(measuredEnergy);
      const multiplier = scoreMultiplierForSignal(options.policy, "energy", band);
      if (multiplier > 0) addWeightedValue(energyBandWeights, band, weight * multiplier);
    }
    if (measuredTempo !== undefined) {
      addWeightedValue(tempoBandWeights, tempoBandFor(measuredTempo), weight);
    }

    if (contextKey) {
      const context = contextWeights.get(contextKey) ?? { genreWeights: new Map(), moodWeights: new Map() };
      addWeightedValue(context.genreWeights, genre, weight * genreMultiplier);
      moodsWithWeights.forEach(({ mood, multiplier }) =>
        addWeightedValue(context.moodWeights, mood, weight * multiplier),
      );
      contextWeights.set(contextKey, context);
    }
  }

  const rankedGenres = Array.from(genreWeights.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const positiveGenres = rankedGenres
    .filter(([, weight]) => weight > 0)
    .map(([genre]) => genre);
  const fallback = options.policy?.resetAt
    ? []
    : safeTasteLabels(fallbackGenres).filter((genre) => scoreMultiplierForSignal(options.policy, "genre", genre) > 0);
  const genresExplored = positiveGenres.length > 0
    ? positiveGenres
    : Array.from(new Set(fallback));
  const favoredGenres = positiveGenres.slice(0, 5);
  // Signals with zero weight still count as observed signals; invalid and
  // hidden signals do not. Keep the counters compatible with v1 semantics.
  const signalsCount = signalCount;
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
    schemaVersion: "agent-taste-profile/v2",
    score: Math.max(0, Math.min(100, score)),
    tier,
    signals: signalsCount,
    positiveSignals,
    negativeSignals,
    acceptanceRate,
    genresExplored,
    favoredGenres,
    genreWeights: Object.fromEntries(rankedGenres),
    moodWeights: rankedWeightRecord(moodWeights),
    artistWeights: rankedWeightRecord(artistWeights),
    energyBandWeights: rankedWeightRecord(energyBandWeights),
    tempoBandWeights: rankedWeightRecord(tempoBandWeights),
    contextWeights: Object.fromEntries(
      Array.from(contextWeights.entries())
        .map(([key, context]) => [key, {
          genreWeights: rankedWeightRecord(context.genreWeights),
          moodWeights: rankedWeightRecord(context.moodWeights),
        }] as const)
        .filter(([, context]) => Object.keys(context.genreWeights).length > 0 || Object.keys(context.moodWeights).length > 0),
    ),
    diversity,
    depth,
    consistency,
    updatedAt: (latestSignalAt ?? now).toISOString(),
  };
}

function validDate(value?: Date) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : undefined;
}

function safeTasteLabel(value: unknown) {
  return sanitizeSignalMetadataString(value, 64);
}

function safeTasteLabels(values?: unknown[]) {
  if (!Array.isArray(values)) return [];
  const labels = new Map<string, string>();
  for (const value of values.slice(0, 12)) {
    const label = safeTasteLabel(value);
    if (label) labels.set(label.toLowerCase(), labels.get(label.toLowerCase()) ?? label);
  }
  return [...labels.values()];
}

function artistControlMultiplier(policy: TasteMemoryPolicy | undefined, label: string, aliases?: unknown[]) {
  const values = safeTasteLabels([label, ...(Array.isArray(aliases) ? aliases : [])]);
  const multipliers = values.map((value) => scoreMultiplierForSignal(policy, "artist", value));
  if (multipliers.some((multiplier) => multiplier <= 0)) return 0;
  const downranks = multipliers.filter((multiplier) => multiplier < 1);
  if (downranks.length > 0) return Math.min(...downranks);
  const boosts = multipliers.filter((multiplier) => multiplier > 1);
  return boosts.length > 0 ? Math.max(...boosts) : 1;
}

function addWeightedValue(map: Map<string, number>, label: string | undefined, weight: number) {
  if (!label || !Number.isFinite(weight)) return;
  map.set(label, (map.get(label) ?? 0) + weight);
}

function rankedWeightRecord(map: Map<string, number>) {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function safePlaybackContextKey(hour: unknown, weekday: unknown) {
  const validHour = ["night", "morning", "afternoon", "evening"].includes(String(hour))
    ? String(hour)
    : undefined;
  const validWeekday = ["weekday", "weekend"].includes(String(weekday))
    ? String(weekday)
    : undefined;
  return validHour && validWeekday ? validHour + ":" + validWeekday : undefined;
}

function finiteUnit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function finiteTempo(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 30 && value <= 300
    ? value
    : undefined;
}

function energyBandFor(energy: number): "low" | "medium" | "high" {
  if (energy >= 0.67) return "high";
  if (energy >= 0.38) return "medium";
  return "low";
}

function tempoBandFor(tempoBpm: number): "slow" | "mid" | "fast" {
  if (tempoBpm >= 124) return "fast";
  if (tempoBpm >= 96) return "mid";
  return "slow";
}

function isCommitmentAction(action: string) {
  return action === "purchase" || action === "pledge" || action === "collect";
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
    options: { take?: number; now?: Date; windowDays?: number } = {},
  ): Promise<AgentTasteProfile> {
    const policy = await this.tasteMemoryService?.getPolicy(userId) ?? await readTasteMemoryPolicy(userId);
    return computeTasteProfileFromHistory(userId, { fallbackGenres, policy, ...options });
  }

  /**
   * The Home and AI DJ share a live v2 profile over bounded recent history.
   * V1 snapshots remain a migration fallback only when no source history or
   * reset marker exists; active controls still filter their genre weights.
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

/** Computes a bounded, policy-aware profile from the listener's recent signals. */
export async function computeTasteProfileFromHistory(
  userId: string,
  options: {
    fallbackGenres?: string[];
    policy?: TasteMemoryPolicy;
    take?: number;
    windowDays?: number;
    now?: Date;
  } = {},
  db: Prisma.TransactionClient = prisma,
): Promise<AgentTasteProfile> {
  const policy = options.policy ?? await readTasteMemoryPolicy(userId, db);
  const now = options.now ?? new Date();
  const history = await readTasteHistory(userId, {
    policy,
    now,
    take: options.take,
    windowDays: options.windowDays,
  }, db);
  return computeAgentTasteProfileFromSignals(history.inputs, options.fallbackGenres ?? [], now, { policy });
}

/** Validates a stored `AgentConfig.learnedTasteProfile` JSON value. */
export function parsePersistedAgentTasteProfile(
  value: unknown,
): AgentTasteProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<AgentTasteProfile>;
  if (candidate.schemaVersion !== "agent-taste-profile/v1" && candidate.schemaVersion !== "agent-taste-profile/v2") {
    return null;
  }
  if (
    typeof candidate.score !== "number" ||
    !Number.isFinite(candidate.score) ||
    typeof candidate.signals !== "number" ||
    !Number.isFinite(candidate.signals) ||
    typeof candidate.positiveSignals !== "number" ||
    !Number.isFinite(candidate.positiveSignals) ||
    typeof candidate.negativeSignals !== "number" ||
    !Number.isFinite(candidate.negativeSignals) ||
    typeof candidate.acceptanceRate !== "number" ||
    !Number.isFinite(candidate.acceptanceRate) ||
    typeof candidate.diversity !== "number" ||
    !Number.isFinite(candidate.diversity) ||
    typeof candidate.depth !== "number" ||
    !Number.isFinite(candidate.depth) ||
    typeof candidate.consistency !== "number" ||
    !Number.isFinite(candidate.consistency) ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt)) ||
    !["New", "Emerging", "Focused", "Deep"].includes(String(candidate.tier)) ||
    !safeWeightRecord(candidate.genreWeights) ||
    !safeStringArray(candidate.genresExplored) ||
    !safeStringArray(candidate.favoredGenres)
  ) return null;
  if (candidate.schemaVersion === "agent-taste-profile/v2") {
    const optionalWeightRecords = [
      candidate.moodWeights,
      candidate.artistWeights,
      candidate.energyBandWeights,
      candidate.tempoBandWeights,
    ];
    if (optionalWeightRecords.some((weights) => weights !== undefined && !safeWeightRecord(weights))) return null;
    if (candidate.contextWeights !== undefined && !parseContextWeightRecord(candidate.contextWeights)) return null;
  }
  return candidate as AgentTasteProfile;
}

/**
 * Read-only shared resolver. It recomputes v2 dimensions to apply decay and
 * current controls, retaining only a safe v1/no-history migration fallback.
 */
export async function resolveAgentTasteProfile(
  userId: string,
  options: { fallbackGenres?: string[]; policy?: TasteMemoryPolicy; now?: Date } = {},
): Promise<AgentTasteProfile> {
  const policy = options.policy ?? await readTasteMemoryPolicy(userId);
  const now = options.now ?? new Date();
  const [config, history] = await Promise.all([
    prisma.agentConfig.findUnique({
      where: { userId },
      select: { learnedTasteProfile: true },
    }),
    readTasteHistory(userId, { policy, now }),
  ]);
  const persisted = parsePersistedAgentTasteProfile(config?.learnedTasteProfile);
  if (persisted?.schemaVersion === "agent-taste-profile/v1" && history.rows.length === 0 && !policy.resetAt) {
    const anyPriorSignal = await prisma.agentSignal.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (!anyPriorSignal) return applyLegacyProfilePolicy(persisted, policy);
  }
  return computeAgentTasteProfileFromSignals(
    history.inputs,
    options.fallbackGenres ?? [],
    now,
    { policy },
  );
}

function clampInteger(value: number | undefined, maximum: number) {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function safeWeightRecord(value: unknown): value is Record<string, number> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(([label, weight]) =>
      safeTasteLabel(label) === label && typeof weight === "number" && Number.isFinite(weight),
    ),
  );
}

function safeStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && safeTasteLabel(item) === item);
}

function parseContextWeightRecord(value: unknown): value is NonNullable<AgentTasteProfile["contextWeights"]> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(([key, context]) => {
      if (!/^(night|morning|afternoon|evening):(weekday|weekend)$/.test(key) || !context || typeof context !== "object" || Array.isArray(context)) {
        return false;
      }
      const weights = context as Record<string, unknown>;
      return safeWeightRecord(weights.genreWeights) && safeWeightRecord(weights.moodWeights);
    }),
  );
}

function applyLegacyProfilePolicy(profile: AgentTasteProfile, policy?: TasteMemoryPolicy): AgentTasteProfile {
  const genreWeights = Object.fromEntries(
    Object.entries(profile.genreWeights)
      .map(([genre, weight]) => ({
        genre: safeTasteLabel(genre),
        weight: weight * scoreMultiplierForSignal(policy, "genre", genre),
      }))
      .filter(({ genre, weight }) => genre && weight !== 0 && Number.isFinite(weight))
      .map(({ genre, weight }) => [genre as string, weight]),
  );
  const positiveGenres = Object.entries(genreWeights)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([genre]) => genre);
  const safeExplored = safeTasteLabels(profile.genresExplored)
    .filter((genre) => scoreMultiplierForSignal(policy, "genre", genre) > 0);
  const safeFavored = safeTasteLabels(profile.favoredGenres)
    .filter((genre) => scoreMultiplierForSignal(policy, "genre", genre) > 0);
  return {
    ...profile,
    genreWeights,
    genresExplored: positiveGenres.length > 0 ? positiveGenres : safeExplored,
    favoredGenres: positiveGenres.length > 0 ? positiveGenres.slice(0, 5) : safeFavored,
  };
}

export async function readTasteHistory(
  userId: string,
  options: {
    policy: TasteMemoryPolicy;
    now: Date;
    take?: number;
    windowDays?: number;
  },
  db: Prisma.TransactionClient = prisma,
) {
  const take = clampInteger(options.take, AGENT_TASTE_HISTORY_LIMIT);
  const windowDays = clampInteger(options.windowDays, AGENT_TASTE_HISTORY_WINDOW_DAYS);
  const historyStart = new Date(options.now.getTime() - windowDays * DAY_MS);
  const rows = await db.agentSignal.findMany({
    where: {
      userId,
      createdAt: {
        gte: historyStart,
        ...(options.policy.resetAt ? { gt: options.policy.resetAt } : {}),
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take,
    include: {
      track: {
        select: {
          artist: true,
          stems: {
            where: { isCurrent: true, type: "original" },
            orderBy: { id: "asc" },
            take: 1,
            select: { audioFeatures: true },
          },
          release: {
            select: {
              genre: true,
              moods: true,
              primaryArtist: true,
              artist: { select: { displayName: true } },
              artistCredits: {
                orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                take: 12,
                select: {
                  displayName: true,
                  artist: { select: { displayName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const inputs = rows.map((signal): AgentTasteSignalInput => {
    const { track } = signal;
    const { release } = track;
    const metadata = jsonObject(signal.metadata);
    const measured = measuredTrackFeatures(track.stems[0]?.audioFeatures);
    const creditedArtistGroups = release.artistCredits
      .map((credit) => {
        const label = safeTasteLabel(credit.displayName) ?? safeTasteLabel(credit.artist.displayName);
        if (!label) return undefined;
        return {
          label,
          aliases: safeTasteLabels([credit.displayName, credit.artist.displayName]),
        };
      })
      .filter((artist): artist is { label: string; aliases: string[] } => Boolean(artist));
    const fallbackArtist = [track.artist, release.primaryArtist, release.artist.displayName]
      .map(safeTasteLabel)
      .find((artist): artist is string => Boolean(artist));
    return {
      action: signal.action,
      trackId: signal.trackId,
      sessionKey: signal.sessionId ? `agent:${signal.sessionId}` :
        /^playback_[a-f0-9]{32}$/.test(jsonString(metadata.playbackSessionId) ?? "")
          ? jsonString(metadata.playbackSessionId) : undefined,
      weight: signal.weight,
      createdAt: signal.createdAt,
      genre: release.genre,
      moods: release.moods,
      artists: creditedArtistGroups.length > 0 ? creditedArtistGroups.map(({ label }) => label) : fallbackArtist ? [fallbackArtist] : [],
      artistAliases: Object.fromEntries(creditedArtistGroups.map(({ label, aliases }) => [label, aliases])),
      localHourBucket: jsonString(metadata.localHourBucket),
      weekdayKind: jsonString(metadata.weekdayKind),
      audioFeatures: {
        energy: measured.energy,
        energySource: measured.energy === null ? "unavailable" : "measured",
        tempoBpm: measured.tempoBpm,
        tempoSource: measured.tempoBpm === null ? "unavailable" : "measured",
      },
    };
  });
  return { rows, inputs };
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
