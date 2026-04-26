import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { AgentConfig, AgentReputationFeedback } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma";

export const SUBMITTER_ROLES = [
  "BuyerAgent",
  "CuratorAgent",
  "ExternalClient",
  "PlatformReviewer",
] as const;
export type SubmitterRole = typeof SUBMITTER_ROLES[number];

export const FEEDBACK_KINDS = [
  "QualityValidation",
  "TasteEndorsement",
  "DisputeOutcome",
  "GeneralReview",
] as const;
export type FeedbackKind = typeof FEEDBACK_KINDS[number];

export const FEEDBACK_ONCHAIN_STATUSES = ["Pending", "Published", "NotApplicable"] as const;
export type FeedbackOnchainStatus = typeof FEEDBACK_ONCHAIN_STATUSES[number];

const ROLE_BASE_WEIGHT: Record<SubmitterRole, number> = {
  PlatformReviewer: 1.0,
  CuratorAgent: 0.7,
  BuyerAgent: 0.5,
  ExternalClient: 0.3,
};

// Anti-gaming caps applied when folding into a reputation snapshot.
export const FEEDBACK_DAILY_SUBMISSION_CAP = 5;
export const FEEDBACK_MAX_SCORE_BOOST = 10;
export const FEEDBACK_MAX_ROLE_SHARE = 0.6;

export type SubmitFeedbackInput = {
  subjectAgentConfigId: string;
  submitterUserId: string | null;
  submitterRole: SubmitterRole;
  submitterIdentifier?: string | null;
  feedbackKind: FeedbackKind;
  score: number;
  evidenceUri?: string | null;
  notes?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
};

export type IndependentValidationSummary = {
  count: number;
  averageScore: number;
  weightedScore: number;
  byRole: Record<SubmitterRole, { count: number; weightedScore: number }>;
  lastFeedbackAt: string | null;
};

function isSubmitterRole(value: unknown): value is SubmitterRole {
  return typeof value === "string" && (SUBMITTER_ROLES as readonly string[]).includes(value);
}

function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && (FEEDBACK_KINDS as readonly string[]).includes(value);
}

function computeReplayHash(input: {
  subjectAgentConfigId: string;
  submitterUserId: string | null;
  submitterIdentifier: string | null;
  feedbackKind: FeedbackKind;
  referenceType: string | null;
  referenceId: string | null;
}): string {
  const canonical = [
    input.subjectAgentConfigId,
    input.submitterUserId ?? "",
    input.submitterIdentifier ?? "",
    input.feedbackKind,
    input.referenceType ?? "",
    input.referenceId ?? "",
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export function computeFeedbackWeight(role: SubmitterRole, score: number): number {
  const base = ROLE_BASE_WEIGHT[role];
  const normalised = Math.max(0, Math.min(100, score)) / 100;
  return Number((base * normalised).toFixed(4));
}

export function emptyByRole(): Record<SubmitterRole, { count: number; weightedScore: number }> {
  return SUBMITTER_ROLES.reduce((acc, role) => {
    acc[role] = { count: 0, weightedScore: 0 };
    return acc;
  }, {} as Record<SubmitterRole, { count: number; weightedScore: number }>);
}

export function emptyIndependentValidationSummary(): IndependentValidationSummary {
  return {
    count: 0,
    averageScore: 0,
    weightedScore: 0,
    byRole: emptyByRole(),
    lastFeedbackAt: null,
  };
}

export function summarizeFeedback(events: AgentReputationFeedback[]): IndependentValidationSummary {
  if (events.length === 0) {
    return {
      count: 0,
      averageScore: 0,
      weightedScore: 0,
      byRole: emptyByRole(),
      lastFeedbackAt: null,
    };
  }

  const byRole = emptyByRole();
  let totalScore = 0;
  let totalWeight = 0;
  let totalWeightedScore = 0;
  let lastTs = 0;

  for (const event of events) {
    const role = isSubmitterRole(event.submitterRole) ? event.submitterRole : "ExternalClient";
    const weighted = event.weight * event.score;
    byRole[role].count += 1;
    byRole[role].weightedScore += weighted;
    totalScore += event.score;
    totalWeight += event.weight;
    totalWeightedScore += weighted;
    const ts = event.createdAt.getTime();
    if (ts > lastTs) lastTs = ts;
  }

  // Anti-gaming: cap the contribution share of any single role at FEEDBACK_MAX_ROLE_SHARE.
  if (totalWeightedScore > 0) {
    const maxRoleContribution = totalWeightedScore * FEEDBACK_MAX_ROLE_SHARE;
    let cappedTotal = 0;
    for (const role of SUBMITTER_ROLES) {
      const contribution = Math.min(byRole[role].weightedScore, maxRoleContribution);
      byRole[role].weightedScore = Number(contribution.toFixed(4));
      cappedTotal += contribution;
    }
    totalWeightedScore = cappedTotal;
  }

  const weightedScore = totalWeight === 0
    ? 0
    : Number((totalWeightedScore / totalWeight).toFixed(2));

  return {
    count: events.length,
    averageScore: Number((totalScore / events.length).toFixed(2)),
    weightedScore,
    byRole,
    lastFeedbackAt: lastTs === 0 ? null : new Date(lastTs).toISOString(),
  };
}

export function applyIndependentValidationToScore(
  baseScore: number,
  summary: IndependentValidationSummary,
): number {
  if (summary.count === 0 || summary.weightedScore === 0) {
    return baseScore;
  }
  // Each weighted-score point above 0 contributes up to FEEDBACK_MAX_SCORE_BOOST when at 100.
  const boost = Math.min(
    FEEDBACK_MAX_SCORE_BOOST,
    Math.round((summary.weightedScore / 100) * FEEDBACK_MAX_SCORE_BOOST),
  );
  return Math.max(0, Math.min(100, baseScore + boost));
}

@Injectable()
export class AgentReputationFeedbackService {
  private readonly logger = new Logger(AgentReputationFeedbackService.name);

  async submitFeedback(input: SubmitFeedbackInput): Promise<AgentReputationFeedback> {
    if (!isSubmitterRole(input.submitterRole)) {
      throw new BadRequestException(`Invalid submitterRole: ${input.submitterRole}`);
    }
    if (!isFeedbackKind(input.feedbackKind)) {
      throw new BadRequestException(`Invalid feedbackKind: ${input.feedbackKind}`);
    }
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
      throw new BadRequestException("score must be between 0 and 100");
    }

    const subject = await prisma.agentConfig.findUnique({
      where: { id: input.subjectAgentConfigId },
    });
    if (!subject) {
      throw new NotFoundException(`AgentConfig ${input.subjectAgentConfigId} not found`);
    }

    this.assertNotSelfFeedback(subject, input);

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (input.submitterUserId) {
      const recentCount = await prisma.agentReputationFeedback.count({
        where: {
          submitterUserId: input.submitterUserId,
          createdAt: { gte: dayAgo },
        },
      });
      if (recentCount >= FEEDBACK_DAILY_SUBMISSION_CAP) {
        throw new ConflictException(
          `Submitter exceeded ${FEEDBACK_DAILY_SUBMISSION_CAP} feedback events in 24h`,
        );
      }
    }

    const replayHash = computeReplayHash({
      subjectAgentConfigId: input.subjectAgentConfigId,
      submitterUserId: input.submitterUserId ?? null,
      submitterIdentifier: input.submitterIdentifier ?? null,
      feedbackKind: input.feedbackKind,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    });

    const existing = await prisma.agentReputationFeedback.findUnique({ where: { replayHash } });
    if (existing) {
      throw new ConflictException(
        `Feedback already submitted for this submitter and reference (id=${existing.id})`,
      );
    }

    const weight = computeFeedbackWeight(input.submitterRole, input.score);

    return prisma.agentReputationFeedback.create({
      data: {
        subjectAgentConfigId: input.subjectAgentConfigId,
        submitterUserId: input.submitterUserId ?? null,
        submitterRole: input.submitterRole,
        submitterIdentifier: input.submitterIdentifier ?? null,
        feedbackKind: input.feedbackKind,
        score: Math.round(input.score),
        weight,
        evidenceUri: input.evidenceUri ?? null,
        notes: input.notes ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        replayHash,
        onchainStatus: "Pending",
      },
    });
  }

  async listFeedback(subjectAgentConfigId: string): Promise<AgentReputationFeedback[]> {
    return prisma.agentReputationFeedback.findMany({
      where: { subjectAgentConfigId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async summarize(subjectAgentConfigId: string): Promise<IndependentValidationSummary> {
    const events = await prisma.agentReputationFeedback.findMany({
      where: { subjectAgentConfigId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return summarizeFeedback(events);
  }

  private assertNotSelfFeedback(subject: AgentConfig, input: SubmitFeedbackInput): void {
    if (input.submitterUserId && input.submitterUserId === subject.userId) {
      throw new BadRequestException("Self-feedback is not permitted");
    }
    if (
      input.submitterIdentifier &&
      input.submitterIdentifier.toLowerCase() === subject.userId.toLowerCase()
    ) {
      throw new BadRequestException("Self-feedback is not permitted");
    }
  }
}
