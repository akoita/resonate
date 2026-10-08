import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { AnalyticsGovernanceService } from "../analytics/analytics_governance.service";
import { analyticsActorIdCandidates } from "../analytics/analytics_identity";
import { writeStructuredLog } from "../shared/structured_logging";

/** The reason written into the deletion lineage for every withdrawal-driven removal. */
export const ANALYTICS_CONSENT_WITHDRAWN_REASON = "analytics_consent_withdrawn";

/** Bounded so one run cannot hold the warehouse lock for an unbounded queue. */
export const DEFAULT_WITHDRAWAL_BATCH_LIMIT = 100;

export interface ConsentWithdrawalOutcome {
  /** The `AnalyticsConsentWithdrawal` row id. Never the person's identifier. */
  id: string;
  /** `requeued`: a newer withdrawal moved the bound mid-run; the row stays pending. */
  status: "completed" | "requeued" | "failed";
}

export interface RunPendingConsentWithdrawalsResult {
  status: "ok" | "failures";
  ranAt: string;
  due: number;
  completed: number;
  failed: number;
  results: ConsentWithdrawalOutcome[];
}

/**
 * #2119: carries out analytics-consent withdrawals asynchronously.
 *
 * `AnalyticsConsentService.record(userId, false)` enqueues one pending
 * `AnalyticsConsentWithdrawal` when a granted decision is withdrawn; this
 * service drains the queue from the scheduled account-erasure job. It reuses
 * `AnalyticsGovernanceService.withdrawConsent`, which owns the warehouse-first
 * ordering, the Postgres delete/redact split and the deletion lineage, rather
 * than reimplementing any of it.
 *
 * Semantics mirror account erasure on purpose:
 *
 * - a warehouse `failed` outcome keeps the row pending and the run reports a
 *   failure, so the next scheduled run retries (Postgres still holds the event
 *   ids, because the governance service leaves it untouched on a failed
 *   warehouse call);
 * - a `skipped` warehouse (none configured) counts as done, like erasure does
 *   for Postgres-only environments;
 * - nothing here logs or stores an identifier: results and logs carry row ids,
 *   counts and warehouse statuses only.
 *
 * Only events received up to the withdrawal are touched (`receivedBefore`), so
 * events captured after a later re-grant are never deleted by an old
 * withdrawal.
 */
@Injectable()
export class ConsentWithdrawalPropagationService {
  constructor(private readonly analyticsGovernance: AnalyticsGovernanceService) {}

  async runPendingWithdrawals(options?: {
    now?: Date;
    limit?: number;
  }): Promise<RunPendingConsentWithdrawalsResult> {
    const now = options?.now ?? new Date();
    const pending = await prisma.analyticsConsentWithdrawal.findMany({
      where: { status: "pending" },
      orderBy: [{ withdrawnAt: "asc" }, { id: "asc" }],
      take: options?.limit ?? DEFAULT_WITHDRAWAL_BATCH_LIMIT,
    });

    const results: ConsentWithdrawalOutcome[] = [];
    for (const withdrawal of pending) {
      results.push(await this.runOne(withdrawal));
    }

    const failed = results.filter((result) => result.status === "failed").length;
    return {
      status: failed === 0 ? "ok" : "failures",
      ranAt: now.toISOString(),
      due: pending.length,
      completed: results.filter((result) => result.status === "completed").length,
      failed,
      results,
    };
  }

  private async runOne(withdrawal: {
    id: string;
    userId: string;
    consentBasis: string;
    withdrawnAt: Date;
  }): Promise<ConsentWithdrawalOutcome> {
    const attemptedAt = new Date();
    try {
      await prisma.analyticsConsentWithdrawal.update({
        where: { id: withdrawal.id },
        data: { attempts: { increment: 1 }, lastAttemptAt: attemptedAt },
      });

      const actorIds = await this.storedActorIds(withdrawal);
      const totals = { deleted: 0, redacted: 0 };
      const warehouseStatuses = new Set<string>();

      for (const actorId of actorIds) {
        const outcome = await this.analyticsGovernance.withdrawConsent({
          actorId,
          consentBasis: withdrawal.consentBasis,
          receivedBefore: withdrawal.withdrawnAt,
          reason: ANALYTICS_CONSENT_WITHDRAWN_REASON,
        });
        totals.deleted += outcome.deleted;
        totals.redacted += outcome.redacted;
        warehouseStatuses.add(outcome.warehouse.status);
      }

      const progress = {
        deleted: { increment: totals.deleted },
        redacted: { increment: totals.redacted },
        matched: { increment: totals.deleted + totals.redacted },
      };

      if (warehouseStatuses.has("failed")) {
        const lastErrorStatus = `warehouse:${[...warehouseStatuses].sort().join(",")}`;
        await prisma.analyticsConsentWithdrawal.update({
          where: { id: withdrawal.id },
          data: { ...progress, lastErrorStatus },
        });
        writeStructuredLog({
          level: "error",
          event: "privacy.analytics_consent_withdrawal.incomplete",
          message: "Analytics consent withdrawal is incomplete; it stays pending and is retried",
          withdrawalId: withdrawal.id,
          lastErrorStatus,
        });
        return { id: withdrawal.id, status: "failed" };
      }

      // Complete only if the bound is still the one this attempt used. A
      // withdrawal recorded meanwhile moves `withdrawnAt` forward on the same
      // row (see AnalyticsConsentService.record); completing it here would drop
      // the newer window, so the row stays pending for the next run instead.
      const completed = await prisma.analyticsConsentWithdrawal.updateMany({
        where: { id: withdrawal.id, status: "pending", withdrawnAt: withdrawal.withdrawnAt },
        data: {
          ...progress,
          status: "completed",
          completedAt: new Date(),
          lastErrorStatus: null,
        },
      });
      if (completed.count === 0) {
        await prisma.analyticsConsentWithdrawal.update({
          where: { id: withdrawal.id },
          data: progress,
        });
        return { id: withdrawal.id, status: "requeued" };
      }
      return { id: withdrawal.id, status: "completed" };
    } catch (error) {
      // The error class only: a message can quote a query or an identifier.
      const lastErrorStatus = `error:${error instanceof Error ? error.name : "unknown"}`;
      try {
        await prisma.analyticsConsentWithdrawal.update({
          where: { id: withdrawal.id },
          data: { lastErrorStatus },
        });
      } catch {
        // The structured log below still names the row; nothing more to do.
      }
      writeStructuredLog({
        level: "error",
        event: "privacy.analytics_consent_withdrawal.failed",
        message: "Analytics consent withdrawal could not run; it stays pending and is retried",
        withdrawalId: withdrawal.id,
        lastErrorStatus,
      });
      return { id: withdrawal.id, status: "failed" };
    }
  }

  /**
   * The exact actor ids stored on this person's consent-based events received
   * up to the withdrawal. `withdrawConsent` matches exactly, so discovery runs
   * first over every id shape a producer may have written (raw, lowercased,
   * pseudonymous under the current salt, via `analyticsActorIdCandidates`; like
   * account erasure, events written under a rotated-out salt are not matched),
   * and the governance service is only called for ids that have rows: an empty
   * call would still hit the warehouse and write a lineage summary for nothing.
   */
  private async storedActorIds(withdrawal: {
    userId: string;
    consentBasis: string;
    withdrawnAt: Date;
  }): Promise<string[]> {
    const candidates = analyticsActorIdCandidates(withdrawal.userId);
    if (candidates.length === 0) return [];
    const rows = await prisma.analyticsEvent.findMany({
      where: {
        consentBasis: withdrawal.consentBasis,
        receivedAt: { lte: withdrawal.withdrawnAt },
        actorId: { in: candidates },
      },
      select: { actorId: true },
      distinct: ["actorId"],
    });
    return rows
      .map((row) => row.actorId)
      .filter((actorId): actorId is string => typeof actorId === "string");
  }
}
