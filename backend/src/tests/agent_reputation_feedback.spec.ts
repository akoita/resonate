import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

const findUniqueAgentConfig = jest.fn();
const countFeedback = jest.fn();
const findUniqueFeedback = jest.fn();
const createFeedback = jest.fn();
const findManyFeedback = jest.fn();

jest.mock("../db/prisma", () => ({
  prisma: {
    agentConfig: {
      findUnique: (...args: unknown[]) => findUniqueAgentConfig(...args),
    },
    agentReputationFeedback: {
      count: (...args: unknown[]) => countFeedback(...args),
      findUnique: (...args: unknown[]) => findUniqueFeedback(...args),
      create: (...args: unknown[]) => createFeedback(...args),
      findMany: (...args: unknown[]) => findManyFeedback(...args),
    },
  },
}));

import {
  AgentReputationFeedbackService,
  applyIndependentValidationToScore,
  computeFeedbackWeight,
  FEEDBACK_DAILY_SUBMISSION_CAP,
  FEEDBACK_MAX_ROLE_SHARE,
  FEEDBACK_MAX_SCORE_BOOST,
  summarizeFeedback,
} from "../modules/agents/agent_reputation_feedback.service";
import {
  buildAgentReputationAttestationPayload,
  computeAgentReputationSnapshot,
  AGENT_REPUTATION_ATTESTATION_SCHEMA_VERSION,
} from "../modules/agents/agent_identity.service";

function makeFeedbackRow(overrides: Partial<{
  submitterRole: string;
  score: number;
  weight: number;
  createdAt: Date;
}> = {}) {
  return {
    id: "fb_1",
    subjectAgentConfigId: "agent_1",
    submitterUserId: null,
    submitterRole: "CuratorAgent",
    submitterIdentifier: null,
    feedbackKind: "QualityValidation",
    score: 80,
    weight: computeFeedbackWeight("CuratorAgent", 80),
    evidenceUri: null,
    notes: null,
    referenceType: null,
    referenceId: null,
    replayHash: "h",
    onchainStatus: "Pending",
    onchainTxHash: null,
    createdAt: new Date("2026-04-26T10:00:00.000Z"),
    ...overrides,
  } as any;
}

beforeEach(() => {
  findUniqueAgentConfig.mockReset();
  countFeedback.mockReset();
  findUniqueFeedback.mockReset();
  createFeedback.mockReset();
  findManyFeedback.mockReset();
});

describe("submitFeedback", () => {
  it("rejects self-feedback by submitterUserId matching subject owner", async () => {
    findUniqueAgentConfig.mockResolvedValue({ id: "agent_1", userId: "user_owner" });
    const service = new AgentReputationFeedbackService();

    await expect(service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: "user_owner",
      submitterRole: "CuratorAgent",
      feedbackKind: "QualityValidation",
      score: 80,
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(createFeedback).not.toHaveBeenCalled();
  });

  it("rejects self-feedback by submitterIdentifier matching owner address", async () => {
    findUniqueAgentConfig.mockResolvedValue({ id: "agent_1", userId: "0xOwnerAddr" });
    const service = new AgentReputationFeedbackService();

    await expect(service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: null,
      submitterIdentifier: "0xOWNERADDR",
      submitterRole: "ExternalClient",
      feedbackKind: "TasteEndorsement",
      score: 50,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when subject agent does not exist", async () => {
    findUniqueAgentConfig.mockResolvedValue(null);
    const service = new AgentReputationFeedbackService();

    await expect(service.submitFeedback({
      subjectAgentConfigId: "missing",
      submitterUserId: "user_a",
      submitterRole: "BuyerAgent",
      feedbackKind: "QualityValidation",
      score: 60,
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects scores outside 0..100", async () => {
    findUniqueAgentConfig.mockResolvedValue({ id: "agent_1", userId: "owner" });
    const service = new AgentReputationFeedbackService();

    await expect(service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: "user_a",
      submitterRole: "CuratorAgent",
      feedbackKind: "QualityValidation",
      score: 150,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unknown submitterRole and feedbackKind", async () => {
    const service = new AgentReputationFeedbackService();

    await expect(service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: "user_a",
      submitterRole: "Bogus" as any,
      feedbackKind: "QualityValidation",
      score: 50,
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: "user_a",
      submitterRole: "CuratorAgent",
      feedbackKind: "Garbage" as any,
      score: 50,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("persists non-owner feedback with computed weight", async () => {
    findUniqueAgentConfig.mockResolvedValue({ id: "agent_1", userId: "owner" });
    countFeedback.mockResolvedValue(0);
    findUniqueFeedback.mockResolvedValue(null);
    createFeedback.mockImplementation((args: any) => ({ id: "fb_new", ...args.data }));

    const service = new AgentReputationFeedbackService();
    const created = await service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: "curator_a",
      submitterRole: "CuratorAgent",
      feedbackKind: "QualityValidation",
      score: 80,
      referenceType: "StemQualityRating",
      referenceId: "rating_1",
    });

    expect(created.weight).toBeCloseTo(0.7 * 0.8, 4);
    expect(created.subjectAgentConfigId).toBe("agent_1");
    expect(created.submitterRole).toBe("CuratorAgent");
    expect(created.replayHash).toEqual(expect.any(String));
  });

  it("rejects duplicate (submitter, reference) feedback via replayHash", async () => {
    findUniqueAgentConfig.mockResolvedValue({ id: "agent_1", userId: "owner" });
    countFeedback.mockResolvedValue(0);
    findUniqueFeedback.mockResolvedValue({ id: "existing" });

    const service = new AgentReputationFeedbackService();
    await expect(service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: "curator_a",
      submitterRole: "CuratorAgent",
      feedbackKind: "QualityValidation",
      score: 80,
      referenceType: "StemQualityRating",
      referenceId: "rating_1",
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it("blocks submitter once daily cap is reached", async () => {
    findUniqueAgentConfig.mockResolvedValue({ id: "agent_1", userId: "owner" });
    countFeedback.mockResolvedValue(FEEDBACK_DAILY_SUBMISSION_CAP);

    const service = new AgentReputationFeedbackService();
    await expect(service.submitFeedback({
      subjectAgentConfigId: "agent_1",
      submitterUserId: "curator_a",
      submitterRole: "CuratorAgent",
      feedbackKind: "QualityValidation",
      score: 80,
    })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("computeFeedbackWeight", () => {
  it("scales by submitter role base weight and score", () => {
    expect(computeFeedbackWeight("PlatformReviewer", 100)).toBe(1);
    expect(computeFeedbackWeight("CuratorAgent", 100)).toBe(0.7);
    expect(computeFeedbackWeight("BuyerAgent", 100)).toBe(0.5);
    expect(computeFeedbackWeight("ExternalClient", 100)).toBe(0.3);
    expect(computeFeedbackWeight("CuratorAgent", 50)).toBeCloseTo(0.35, 4);
  });
});

describe("summarizeFeedback", () => {
  it("returns zeroed summary for no events", () => {
    expect(summarizeFeedback([])).toEqual({
      count: 0,
      averageScore: 0,
      weightedScore: 0,
      byRole: {
        BuyerAgent: { count: 0, weightedScore: 0 },
        CuratorAgent: { count: 0, weightedScore: 0 },
        ExternalClient: { count: 0, weightedScore: 0 },
        PlatformReviewer: { count: 0, weightedScore: 0 },
      },
      lastFeedbackAt: null,
    });
  });

  it("aggregates count, average, byRole, and lastFeedbackAt", () => {
    const summary = summarizeFeedback([
      makeFeedbackRow({
        submitterRole: "PlatformReviewer",
        score: 90,
        weight: computeFeedbackWeight("PlatformReviewer", 90),
        createdAt: new Date("2026-04-25T08:00:00.000Z"),
      }),
      makeFeedbackRow({
        submitterRole: "CuratorAgent",
        score: 80,
        weight: computeFeedbackWeight("CuratorAgent", 80),
        createdAt: new Date("2026-04-26T10:00:00.000Z"),
      }),
    ]);

    expect(summary.count).toBe(2);
    expect(summary.averageScore).toBe(85);
    expect(summary.byRole.PlatformReviewer.count).toBe(1);
    expect(summary.byRole.CuratorAgent.count).toBe(1);
    expect(summary.lastFeedbackAt).toBe("2026-04-26T10:00:00.000Z");
    expect(summary.weightedScore).toBeGreaterThan(0);
  });

  it("caps any single role's contribution share at FEEDBACK_MAX_ROLE_SHARE", () => {
    const flood = Array.from({ length: 10 }, (_, idx) =>
      makeFeedbackRow({
        submitterRole: "CuratorAgent",
        score: 100,
        weight: computeFeedbackWeight("CuratorAgent", 100),
        createdAt: new Date(`2026-04-2${(idx % 5) + 1}T10:00:00.000Z`),
      }),
    );
    const reviewer = makeFeedbackRow({
      submitterRole: "PlatformReviewer",
      score: 100,
      weight: computeFeedbackWeight("PlatformReviewer", 100),
      createdAt: new Date("2026-04-26T10:00:00.000Z"),
    });

    const events = [...flood, reviewer];
    const preCapTotal = events.reduce((sum, e) => sum + e.weight * e.score, 0);
    const summary = summarizeFeedback(events);

    expect(summary.byRole.CuratorAgent.weightedScore).toBeLessThanOrEqual(
      preCapTotal * FEEDBACK_MAX_ROLE_SHARE + 0.01,
    );
    // Without the cap, curators alone would dominate at 7x the reviewer's contribution.
    expect(summary.byRole.CuratorAgent.weightedScore).toBeLessThan(
      flood.length * computeFeedbackWeight("CuratorAgent", 100) * 100,
    );
  });
});

describe("applyIndependentValidationToScore", () => {
  it("returns base score when no feedback exists", () => {
    expect(applyIndependentValidationToScore(40, summarizeFeedback([]))).toBe(40);
  });

  it("boosts up to FEEDBACK_MAX_SCORE_BOOST and clamps at 100", () => {
    const summary = summarizeFeedback([
      makeFeedbackRow({
        submitterRole: "PlatformReviewer",
        score: 100,
        weight: computeFeedbackWeight("PlatformReviewer", 100),
      }),
    ]);
    expect(applyIndependentValidationToScore(50, summary)).toBeGreaterThan(50);
    expect(applyIndependentValidationToScore(50, summary) - 50).toBeLessThanOrEqual(FEEDBACK_MAX_SCORE_BOOST);
    expect(applyIndependentValidationToScore(98, summary)).toBeLessThanOrEqual(100);
  });
});

describe("snapshot folding", () => {
  it("preserves platformComputedScore alongside blended score", () => {
    const baseSnapshot = computeAgentReputationSnapshot({
      sessions: 4,
      tracksCurated: 4,
      totalSpendUsd: 4,
      monthlyCapUsd: 10,
      genresExplored: ["Soul"],
    }, new Date("2026-04-26T12:00:00.000Z"));

    const summary = summarizeFeedback([
      makeFeedbackRow({
        submitterRole: "PlatformReviewer",
        score: 100,
        weight: computeFeedbackWeight("PlatformReviewer", 100),
      }),
    ]);
    const blended = computeAgentReputationSnapshot({
      sessions: 4,
      tracksCurated: 4,
      totalSpendUsd: 4,
      monthlyCapUsd: 10,
      genresExplored: ["Soul"],
      independentValidation: summary,
    }, new Date("2026-04-26T12:00:00.000Z"));

    expect(blended.platformComputedScore).toBe(baseSnapshot.score);
    expect(blended.score).toBeGreaterThanOrEqual(blended.platformComputedScore);
    expect(blended.independentValidation).toBe(summary);
  });
});

describe("attestation payload v2", () => {
  it("includes a trust block separating platform-computed from independent validation", () => {
    const summary = summarizeFeedback([
      makeFeedbackRow({
        submitterRole: "PlatformReviewer",
        score: 90,
        weight: computeFeedbackWeight("PlatformReviewer", 90),
      }),
    ]);
    const reputation = computeAgentReputationSnapshot({
      sessions: 6,
      tracksCurated: 6,
      totalSpendUsd: 5,
      monthlyCapUsd: 10,
      genresExplored: ["Soul"],
      independentValidation: summary,
    }, new Date("2026-04-26T12:00:00.000Z"));

    const payload = buildAgentReputationAttestationPayload({
      config: {
        id: "agent_1",
        userId: "0xowner",
        name: "DJ",
        vibes: ["Soul"],
        stemTypes: [],
        monthlyCapUsd: 10,
        identityStatus: "minted",
        identityChainId: 84532,
        identityRegistry: "0x1234567890123456789012345678901234567890",
        identityTokenId: "42",
        identityTxHash: "0xmint",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
      reputationSnapshot: reputation,
      identityCredential: { id: "urn:credential:agent_1" },
      chainId: 84532,
      registry: "0x1234567890123456789012345678901234567890",
      tokenId: "42",
    });

    expect(payload.schemaVersion).toBe(AGENT_REPUTATION_ATTESTATION_SCHEMA_VERSION);
    expect(payload.trust.platformComputedScore).toBe(reputation.platformComputedScore);
    expect(payload.trust.blendedScore).toBe(reputation.score);
    expect(payload.trust.independentValidation.count).toBe(1);
    expect(payload.trust.independentValidation.byRole.PlatformReviewer.count).toBe(1);
  });

  it("emits empty independentValidation when no feedback was submitted", () => {
    const reputation = computeAgentReputationSnapshot({
      sessions: 1,
      tracksCurated: 1,
      totalSpendUsd: 1,
      monthlyCapUsd: 10,
      genresExplored: ["Focus"],
    }, new Date("2026-04-26T12:00:00.000Z"));

    const payload = buildAgentReputationAttestationPayload({
      config: {
        id: "agent_local",
        userId: "0xowner",
        name: "Local DJ",
        vibes: ["Focus"],
        stemTypes: [],
        monthlyCapUsd: 10,
        identityStatus: "local",
        identityChainId: null,
        identityRegistry: null,
        identityTokenId: null,
        identityTxHash: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
      reputationSnapshot: reputation,
      identityCredential: { id: "urn:credential:local" },
      chainId: null,
      registry: null,
      tokenId: null,
    });

    expect(payload.trust.independentValidation.count).toBe(0);
    expect(payload.trust.platformComputedScore).toBe(reputation.score);
    expect(payload.trust.blendedScore).toBe(reputation.score);
  });
});
