import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

export const AGENT_SIGNAL_WEIGHTS = {
  accept: 1,
  skip: -1,
  replay: 2,
  add_to_playlist: 3,
  purchase: 5,
} as const;

export type AgentSignalAction = keyof typeof AGENT_SIGNAL_WEIGHTS;

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

@Injectable()
export class AgentLearningService {
  async recordSignal(input: {
    userId: string;
    sessionId?: string | null;
    trackId: string;
    action: AgentSignalAction;
    metadata?: Prisma.InputJsonObject;
  }) {
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

  async computeTasteProfile(
    userId: string,
    fallbackGenres: string[] = [],
    options: { take?: number } = {},
  ): Promise<AgentTasteProfile> {
    const signals = await prisma.agentSignal.findMany({
      where: { userId },
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
      signals.map((signal) => ({
        action: signal.action as AgentSignalAction,
        trackId: signal.trackId,
        weight: signal.weight,
        createdAt: signal.createdAt,
        genre: signal.track.release.genre,
      })),
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
