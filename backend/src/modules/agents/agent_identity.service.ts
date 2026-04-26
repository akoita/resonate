import { Injectable } from "@nestjs/common";
import { Prisma, type AgentConfig } from "@prisma/client";
import { prisma } from "../../db/prisma";

export type AgentIdentityStatus = "local" | "pending" | "minted" | "attested";

export type AgentReputationInput = {
  sessions: number;
  tracksCurated: number;
  totalSpendUsd: number;
  monthlyCapUsd: number;
  genresExplored: string[];
};

export type AgentReputationSnapshot = AgentReputationInput & {
  score: number;
  tier: "New" | "Emerging" | "Trusted" | "Proven";
  acceptanceRate: number;
  budgetUtilization: number;
  tasteDepth: number;
  updatedAt: string;
};

export type AgentIdentityCredential = Prisma.InputJsonObject;
export type EnrichedAgentConfig = Omit<AgentConfig, "identityCredential" | "reputationSnapshot"> & {
  reputationSnapshot: AgentReputationSnapshot;
  identityCredential: AgentIdentityCredential;
};

type AgentConfigWithIdentity = AgentConfig & {
  identityStatus: AgentIdentityStatus;
};

export function computeAgentReputationSnapshot(
  input: AgentReputationInput,
  now = new Date(),
): AgentReputationSnapshot {
  const sessions = Math.max(0, input.sessions);
  const tracksCurated = Math.max(0, input.tracksCurated);
  const monthlyCapUsd = Math.max(0, input.monthlyCapUsd);
  const totalSpendUsd = Math.max(0, input.totalSpendUsd);
  const genresExplored = Array.from(new Set(input.genresExplored.filter(Boolean)));
  const acceptanceRate = sessions === 0 ? 0 : Math.min(1, tracksCurated / sessions);
  const budgetUtilization = monthlyCapUsd === 0 ? 0 : Math.min(1, totalSpendUsd / monthlyCapUsd);
  const tasteDepth = Math.min(1, (tracksCurated / 12) + (genresExplored.length / 10));
  const score = Math.min(
    100,
    Math.round(
      sessions * 6 +
      tracksCurated * 4 +
      genresExplored.length * 5 +
      acceptanceRate * 20 +
      budgetUtilization * 10
    ),
  );
  const tier =
    score >= 80 ? "Proven" :
      score >= 50 ? "Trusted" :
        score >= 20 ? "Emerging" :
          "New";

  return {
    ...input,
    sessions,
    tracksCurated,
    totalSpendUsd,
    monthlyCapUsd,
    genresExplored,
    score,
    tier,
    acceptanceRate,
    budgetUtilization,
    tasteDepth,
    updatedAt: now.toISOString(),
  };
}

@Injectable()
export class AgentIdentityService {
  async enrichConfig(config: AgentConfig): Promise<EnrichedAgentConfig> {
    const reputationSnapshot = await this.computeReputation(config);
    const identityCredential = this.buildCredential(config as AgentConfigWithIdentity, reputationSnapshot);

    if (this.shouldPersistSnapshot(config, reputationSnapshot)) {
      await prisma.agentConfig.update({
        where: { id: config.id },
        data: {
          reputationScore: reputationSnapshot.score,
          reputationSnapshot,
          identityCredential,
        },
      });
    }

    return {
      ...config,
      reputationScore: reputationSnapshot.score,
      reputationSnapshot,
      identityCredential,
    };
  }

  private shouldPersistSnapshot(
    config: AgentConfig,
    next: AgentReputationSnapshot,
  ): boolean {
    const stored = config.reputationSnapshot;
    if (config.reputationScore !== next.score || !config.identityCredential) {
      return true;
    }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return true;
    }

    const snapshot = stored as Record<string, unknown>;
    return (
      snapshot.score !== next.score ||
      snapshot.sessions !== next.sessions ||
      snapshot.tracksCurated !== next.tracksCurated ||
      snapshot.totalSpendUsd !== next.totalSpendUsd ||
      snapshot.monthlyCapUsd !== next.monthlyCapUsd ||
      snapshot.updatedAt !== next.updatedAt ||
      JSON.stringify(snapshot.genresExplored ?? []) !== JSON.stringify(next.genresExplored)
    );
  }

  private async computeReputation(config: AgentConfig): Promise<AgentReputationSnapshot> {
    const sessions = await prisma.session.findMany({
      where: { userId: config.userId },
      include: {
        licenses: {
          include: {
            track: {
              select: {
                release: {
                  select: { genre: true },
                },
              },
            },
          },
        },
      },
      orderBy: { startedAt: "desc" },
      take: 100,
    });

    const licenseGenres = sessions.flatMap((session) =>
      session.licenses
        .map((license) => license.track.release.genre)
        .filter((genre): genre is string => Boolean(genre)),
    );
    const totalSpendUsd = sessions.reduce((sum, session) => sum + session.spentUsd, 0);
    const tracksCurated = sessions.reduce((sum, session) => sum + session.licenses.length, 0);

    const lastSignalAt = sessions[0]?.startedAt ?? config.updatedAt;
    return computeAgentReputationSnapshot({
      sessions: sessions.length,
      tracksCurated,
      totalSpendUsd,
      monthlyCapUsd: config.monthlyCapUsd,
      genresExplored: licenseGenres.length > 0 ? licenseGenres : config.vibes,
    }, lastSignalAt);
  }

  private buildCredential(
    config: AgentConfigWithIdentity,
    reputationSnapshot: AgentReputationSnapshot,
  ): AgentIdentityCredential {
    return {
      "@context": [
        "urn:w3c:credentials:v1",
        "urn:resonate:agent-identity:v1",
      ],
      id: `urn:resonate:agent-credential:${config.id}`,
      type: ["VerifiableCredential", "ResonateAgentIdentityCredential"],
      issuer: "did:resonate:protocol",
      issuanceDate: reputationSnapshot.updatedAt,
      credentialSubject: {
        id: `urn:resonate:agent:${config.id}`,
        owner: config.userId,
        agentId: config.id,
        name: config.name,
        vibes: config.vibes,
        stemTypes: config.stemTypes,
        monthlyCapUsd: config.monthlyCapUsd,
        erc8004: {
          status: config.identityStatus,
          chainId: config.identityChainId,
          registry: config.identityRegistry,
          tokenId: config.identityTokenId,
          txHash: config.identityTxHash,
        },
        reputation: reputationSnapshot,
      },
    };
  }
}
