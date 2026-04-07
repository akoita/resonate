import { BadRequestException } from "@nestjs/common";
import { prisma } from "../../db/prisma";

type CuratorStakeTier = {
  key: "high-risk" | "standard" | "trusted" | "elite";
  label: string;
  description: string;
  multiplierBps: number;
};

type CuratorHumanVerification = {
  verified: boolean;
  provider: string | null;
  status: string;
  score: number | null;
  threshold: number | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  requiredAfterReports: number;
};

type CuratorBadge = {
  key: string;
  label: string;
  tone: "neutral" | "success" | "warning";
  description: string;
};

export type CuratorProfile = {
  walletAddress: string;
  score: number;
  effectiveScore: number;
  decayPenalty: number;
  successfulFlags: number;
  rejectedFlags: number;
  totalBounties: number;
  reportsFiled: number;
  activeReports: number;
  resolutionRate: number | null;
  lastActiveAt: string | null;
  stakeTier: CuratorStakeTier;
  humanVerification: CuratorHumanVerification;
  requiresHumanVerification: boolean;
  badges: CuratorBadge[];
};

export type CuratorReportingPolicy = {
  walletAddress: string;
  reportsFiled: number;
  requiresHumanVerification: boolean;
  message: string;
  stakeTier: CuratorStakeTier;
  humanVerification: CuratorHumanVerification;
};

const DEFAULT_DECAY_DAYS = 30;
const DEFAULT_DECAY_POINTS = 2;
const DEFAULT_HUMAN_THRESHOLD = 3;

export class CuratorReputationService {
  private getDecayDays() {
    return Math.max(1, Number(process.env.CURATOR_REPUTATION_DECAY_DAYS || DEFAULT_DECAY_DAYS));
  }

  private getDecayPoints() {
    return Math.max(0, Number(process.env.CURATOR_REPUTATION_DECAY_POINTS || DEFAULT_DECAY_POINTS));
  }

  private getHumanThreshold() {
    return Math.max(1, Number(process.env.HUMAN_VERIFICATION_REQUIRED_REPORTS || DEFAULT_HUMAN_THRESHOLD));
  }

  getStakeTier(score: number): CuratorStakeTier {
    if (score >= 50) {
      return {
        key: "elite",
        label: "Elite Curator",
        description: "Lowest counter-stake tier unlocked by strong reporting accuracy.",
        multiplierBps: 1000,
      };
    }

    if (score >= 20) {
      return {
        key: "trusted",
        label: "Trusted Curator",
        description: "Reduced counter-stake after building a positive reporting history.",
        multiplierBps: 1500,
      };
    }

    if (score < 0) {
      return {
        key: "high-risk",
        label: "High-Risk Curator",
        description: "Higher counter-stake applies until the curator recovers from rejected reports.",
        multiplierBps: 3000,
      };
    }

    return {
      key: "standard",
      label: "Standard Curator",
      description: "Default counter-stake tier for new and neutral reporters.",
      multiplierBps: 2000,
    };
  }

  private buildBadges(input: {
    effectiveScore: number;
    successfulFlags: number;
    rejectedFlags: number;
    humanVerification: CuratorHumanVerification;
    reportsFiled: number;
  }): CuratorBadge[] {
    const badges: CuratorBadge[] = [];

    if (input.humanVerification.verified) {
      badges.push({
        key: "verified-human",
        label: "Verified Human",
        tone: "success",
        description: "Proof-of-humanity is active for this curator wallet.",
      });
    }

    if (input.effectiveScore >= 50) {
      badges.push({
        key: "elite-curator",
        label: "Elite Curator",
        tone: "success",
        description: "Sustained high-quality reporting record with strong signal quality.",
      });
    } else if (input.effectiveScore >= 20) {
      badges.push({
        key: "trusted-curator",
        label: "Trusted Curator",
        tone: "success",
        description: "Positive reporting history with reduced counter-stake requirements.",
      });
    }

    if (input.successfulFlags >= 3 && input.rejectedFlags === 0) {
      badges.push({
        key: "clean-streak",
        label: "Clean Streak",
        tone: "success",
        description: "Multiple successful reports with no rejections recorded yet.",
      });
    }

    if (input.reportsFiled >= this.getHumanThreshold() && !input.humanVerification.verified) {
      badges.push({
        key: "verification-needed",
        label: "Verification Needed",
        tone: "warning",
        description: "Additional reports are gated until proof-of-humanity is completed.",
      });
    }

    if (badges.length === 0) {
      badges.push({
        key: "new-curator",
        label: "New Curator",
        tone: "neutral",
        description: "No advanced curator badges unlocked yet.",
      });
    }

    return badges;
  }

  async noteReportFiled(walletAddress: string) {
    const normalized = walletAddress.toLowerCase();
    return prisma.curatorReputation.upsert({
      where: { walletAddress: normalized },
      create: {
        walletAddress: normalized,
        reportsFiled: 1,
        lastActiveAt: new Date(),
      },
      update: {
        reportsFiled: { increment: 1 },
        lastActiveAt: new Date(),
      },
    });
  }

  async noteBountyClaimed(walletAddress: string) {
    const normalized = walletAddress.toLowerCase();
    return prisma.curatorReputation.upsert({
      where: { walletAddress: normalized },
      create: {
        walletAddress: normalized,
        totalBounties: 1,
        lastActiveAt: new Date(),
      },
      update: {
        totalBounties: { increment: 1 },
        lastActiveAt: new Date(),
      },
    });
  }

  async recordDisputeOutcome(walletAddress: string, outcome: string) {
    const normalized = walletAddress.toLowerCase();
    const normalizedOutcome = outcome.toLowerCase();
    const delta = normalizedOutcome === "upheld" ? 10 : normalizedOutcome === "rejected" ? -15 : 0;

    if (delta === 0) {
      return prisma.curatorReputation.upsert({
        where: { walletAddress: normalized },
        create: {
          walletAddress: normalized,
          lastActiveAt: new Date(),
        },
        update: {
          lastActiveAt: new Date(),
        },
      });
    }

    return prisma.curatorReputation.upsert({
      where: { walletAddress: normalized },
      create: {
        walletAddress: normalized,
        score: delta,
        successfulFlags: normalizedOutcome === "upheld" ? 1 : 0,
        rejectedFlags: normalizedOutcome === "rejected" ? 1 : 0,
        lastActiveAt: new Date(),
      },
      update: {
        score: { increment: delta },
        ...(normalizedOutcome === "upheld" ? { successfulFlags: { increment: 1 } } : {}),
        ...(normalizedOutcome === "rejected" ? { rejectedFlags: { increment: 1 } } : {}),
        lastActiveAt: new Date(),
      },
    });
  }

  async saveHumanVerificationStatus(
    walletAddress: string,
    input: {
      provider: string;
      status: string;
      verified: boolean;
      score?: number | null;
      threshold?: number | null;
      verifiedAt?: Date | null;
      expiresAt?: Date | null;
    },
  ) {
    const normalized = walletAddress.toLowerCase();

    return prisma.curatorReputation.upsert({
      where: { walletAddress: normalized },
      create: {
        walletAddress: normalized,
        verifiedHuman: input.verified,
        humanVerificationProvider: input.provider,
        humanVerificationStatus: input.status,
        humanVerificationScore: input.score ?? null,
        humanVerificationThreshold: input.threshold ?? null,
        humanVerifiedAt: input.verified ? input.verifiedAt ?? new Date() : null,
        humanVerificationExpiresAt: input.expiresAt ?? null,
        lastActiveAt: new Date(),
      },
      update: {
        verifiedHuman: input.verified,
        humanVerificationProvider: input.provider,
        humanVerificationStatus: input.status,
        humanVerificationScore: input.score ?? null,
        humanVerificationThreshold: input.threshold ?? null,
        humanVerifiedAt: input.verified ? input.verifiedAt ?? new Date() : null,
        humanVerificationExpiresAt: input.expiresAt ?? null,
        lastActiveAt: new Date(),
      },
    });
  }

  async getProfile(walletAddress: string): Promise<CuratorProfile> {
    const normalized = walletAddress.toLowerCase();
    const [record, activeReports] = await Promise.all([
      prisma.curatorReputation.findUnique({
        where: { walletAddress: normalized },
      }),
      prisma.dispute.count({
        where: {
          reporterAddr: normalized,
          status: {
            notIn: ["resolved", "RESOLVED"],
          },
        },
      }),
    ]);

    const score = record?.score ?? 0;
    const successfulFlags = record?.successfulFlags ?? 0;
    const rejectedFlags = record?.rejectedFlags ?? 0;
    const reportsFiled = record?.reportsFiled ?? successfulFlags + rejectedFlags + activeReports;
    const totalBounties = record?.totalBounties ?? 0;
    const lastActiveAt = record?.lastActiveAt ?? record?.updatedAt ?? record?.createdAt ?? null;

    const decayWindowMs = this.getDecayDays() * 24 * 60 * 60 * 1000;
    const decayPenalty =
      score > 0 && lastActiveAt
        ? Math.floor((Date.now() - lastActiveAt.getTime()) / decayWindowMs) * this.getDecayPoints()
        : 0;
    const effectiveScore = Math.max(score - decayPenalty, 0);
    const stakeTier = this.getStakeTier(score);
    const threshold = record?.humanVerificationThreshold ?? null;
    const humanVerification: CuratorHumanVerification = {
      verified: record?.verifiedHuman ?? false,
      provider: record?.humanVerificationProvider ?? null,
      status: record?.humanVerificationStatus ?? "unverified",
      score: record?.humanVerificationScore ?? null,
      threshold,
      verifiedAt: record?.humanVerifiedAt?.toISOString() ?? null,
      expiresAt: record?.humanVerificationExpiresAt?.toISOString() ?? null,
      requiredAfterReports: this.getHumanThreshold(),
    };
    const requiresHumanVerification = reportsFiled >= this.getHumanThreshold() && !humanVerification.verified;
    const resolutionBase = successfulFlags + rejectedFlags;
    const resolutionRate = resolutionBase > 0 ? successfulFlags / resolutionBase : null;

    return {
      walletAddress: normalized,
      score,
      effectiveScore,
      decayPenalty,
      successfulFlags,
      rejectedFlags,
      totalBounties,
      reportsFiled,
      activeReports,
      resolutionRate,
      lastActiveAt: lastActiveAt?.toISOString() ?? null,
      stakeTier,
      humanVerification,
      requiresHumanVerification,
      badges: this.buildBadges({
        effectiveScore,
        successfulFlags,
        rejectedFlags,
        humanVerification,
        reportsFiled,
      }),
    };
  }

  async getLeaderboard(limit: number) {
    const rows = await prisma.curatorReputation.findMany({
      orderBy: [{ score: "desc" }, { successfulFlags: "desc" }],
      take: limit,
    });

    return Promise.all(rows.map((row) => this.getProfile(row.walletAddress)));
  }

  async getReportingPolicy(walletAddress: string): Promise<CuratorReportingPolicy> {
    const profile = await this.getProfile(walletAddress);
    const message = profile.requiresHumanVerification
      ? `Proof-of-humanity is required after ${profile.humanVerification.requiredAfterReports} reports. Complete verification to keep filing disputes.`
      : `${profile.stakeTier.label} tier active. Current counter-stake multiplier is ${(profile.stakeTier.multiplierBps / 100).toFixed(0)}%.`;

    return {
      walletAddress: profile.walletAddress,
      reportsFiled: profile.reportsFiled,
      requiresHumanVerification: profile.requiresHumanVerification,
      message,
      stakeTier: profile.stakeTier,
      humanVerification: profile.humanVerification,
    };
  }

  async assertCanFileDispute(walletAddress: string) {
    const policy = await this.getReportingPolicy(walletAddress);
    if (policy.requiresHumanVerification) {
      throw new BadRequestException({
        code: "human_verification_required",
        message: policy.message,
        walletAddress: policy.walletAddress,
        reportsFiled: policy.reportsFiled,
      });
    }
    return policy;
  }
}
