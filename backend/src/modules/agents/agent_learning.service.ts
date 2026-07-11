import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { scoreMultiplierForSignal, TasteMemoryService } from "../recommendations/taste_memory.service";

export const AGENT_SIGNAL_WEIGHTS = {
  accept: 1,
  skip: -1,
  complete: 1.5,
  save: 3,
  replay: 2,
  add_to_playlist: 3,
  purchase: 5,
} as const;

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
  if (safe.score !== undefined || safe.explanation !== undefined) {
    target.recommendation = safe;
  }
}

function copyString(target: Record<string, unknown>, key: string, value: unknown, maxLength: number) {
  const sanitized = sanitizeSignalString(value, maxLength);
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
    .map((entry) => sanitizeSignalString(entry, maxLength))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
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

function sanitizeSignalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /https?:\/\//i.test(cleaned) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(cleaned)) {
    return undefined;
  }
  if (/\b(?:0x[a-fA-F0-9]{16,}|user[_:-]?[A-Za-z0-9_-]{6,}|session[_:-]?[A-Za-z0-9_-]{6,})\b/.test(cleaned)) {
    return undefined;
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trimEnd()}...` : cleaned;
}

@Injectable()
export class AgentLearningService {
  constructor(@Optional() private readonly tasteMemoryService?: TasteMemoryService) {}

  async recordSignal(input: {
    userId: string;
    sessionId?: string | null;
    trackId: string;
    action: AgentSignalAction;
    metadata?: Prisma.InputJsonObject;
  }) {
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
    const signals = await prisma.agentSignal.findMany({
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
      fallbackGenres,
    );
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

  mergeLearnedGenres(vibes: string[], profile: AgentTasteProfile): string[] {
    return Array.from(new Set([
      ...profile.favoredGenres,
      ...vibes,
    ].filter(Boolean)));
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
