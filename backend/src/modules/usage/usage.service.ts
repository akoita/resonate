import { Injectable, Optional } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import {
  GenerationCreditsService,
  type GenerationCreditBalance,
} from "../credits/generation-credits.service";
import type { MeteredActionKind } from "../credits/metered-actions";
import { GenerationService } from "../generation/generation.service";
import { RemixProjectService } from "../remix/remix-project.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import type { EntitlementPlan, EntitlementSource } from "../entitlements/entitlements.policy";
import {
  USAGE_BREAKDOWN_PERIOD_DAYS,
  buildUsageBreakdown,
  buildUsageLimits,
  type DebitGroup,
  type RateLimitPeek,
  type RefundRow,
  type UsageBreakdown,
  type UsageLimitSummary,
} from "./usage-aggregation";

export type {
  UsageBreakdown,
  UsageBreakdownItem,
  UsageLimitSummary,
} from "./usage-aggregation";

/**
 * Canonical `GET /usage/summary` contract (#1422). The frontend codes to this.
 * Three deliberately separate concepts (RFC docs/rfc/usage-billing.md):
 *   - `credits`   — the prepaid monetary balance + recent ledger
 *   - `limits`    — fair-use rate-quota windows (% left, reset time)
 *   - `breakdown` — what each metered kind cost over the last 30 days
 */
export interface UsageSummary {
  credits: GenerationCreditBalance;
  limits: UsageLimitSummary[];
  breakdown: UsageBreakdown;
  plan: UsagePlan;
}

/**
 * The person's plan, from the one entitlement service (#2406). `source` and
 * `validUntil` are set only for `pro` (today: an operator or promo grant).
 * `monthlyAllowanceCents` stays null until the allowance lands (#2408).
 */
export interface UsagePlan {
  tier: EntitlementPlan;
  monthlyAllowanceCents: number | null;
  source?: EntitlementSource;
  validUntil?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregates the usage concepts (see `UsageSummary`). The metered-action
 * registry supplies labels, unit sizes and ledger-reason attribution; the
 * enforcing services supply live window counts through side-effect-free peek
 * getters (a read here never records a hit); the credit ledger supplies spend.
 */
@Injectable()
export class UsageService {
  private readonly entitlements: EntitlementsService;

  constructor(
    private readonly credits: GenerationCreditsService,
    private readonly generation: GenerationService,
    private readonly remix: RemixProjectService,
    @Optional() entitlements?: EntitlementsService,
  ) {
    this.entitlements = entitlements ?? new EntitlementsService();
  }

  async getSummary(userId: string): Promise<UsageSummary> {
    const credits = await this.credits.getBalance(userId);
    const since = new Date(Date.now() - USAGE_BREAKDOWN_PERIOD_DAYS * DAY_MS);

    const peeks: Record<MeteredActionKind, RateLimitPeek> = {
      lyria: this.generation.getGenerationRateLimitStatus(userId),
      remix_draft: this.remix.getGenerationRateLimitStatus(userId),
    };

    const [{ debits, refunds }, plan] = await Promise.all([
      this.readLedger(userId, since),
      this.entitlements.resolvePlan(userId),
    ]);

    return {
      credits,
      limits: buildUsageLimits(peeks),
      breakdown: buildUsageBreakdown({
        debits,
        refunds,
        priceCentsPer30s: credits.priceCentsPer30s,
        since,
      }),
      // The plan comes from the entitlement service (#2406): `pro` only for an
      // operator or promo grant today. No allowance exists yet (#2408, ADR-BM-3).
      plan: {
        tier: plan.plan,
        monthlyAllowanceCents: null,
        ...(plan.source ? { source: plan.source } : {}),
        ...(plan.validUntil ? { validUntil: plan.validUntil } : {}),
      },
    };
  }

  /**
   * The caller's debits (grouped by reason) and refunds (tagged with the reason
   * of the debit they return) since `since`. Scoped by `userId` in every query.
   */
  private async readLedger(
    userId: string,
    since: Date,
  ): Promise<{ debits: DebitGroup[]; refunds: RefundRow[] }> {
    const [debitGroups, refundRows] = await Promise.all([
      prisma.generationCreditTransaction.groupBy({
        by: ["reason"],
        where: { userId, type: "debit", createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      prisma.generationCreditTransaction.findMany({
        where: { userId, type: "refund", createdAt: { gte: since } },
        select: { amountCents: true, jobId: true },
      }),
    ]);

    const jobIds = refundRows
      .map((row) => row.jobId)
      .filter((id): id is string => !!id);
    const debitRows = jobIds.length
      ? await prisma.generationCreditTransaction.findMany({
          where: { userId, type: "debit", jobId: { in: jobIds } },
          select: { jobId: true, reason: true },
        })
      : [];
    const reasonByJob = new Map(debitRows.map((row) => [row.jobId, row.reason]));

    return {
      debits: debitGroups.map((group) => ({
        reason: group.reason,
        count: group._count._all,
        amountCents: group._sum.amountCents ?? 0,
      })),
      refunds: refundRows.map((row) => ({
        amountCents: row.amountCents,
        debitReason: row.jobId ? (reasonByJob.get(row.jobId) ?? null) : null,
      })),
    };
  }
}
