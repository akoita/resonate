import "dotenv/config";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { type BillingRetentionResult, runBillingRetention } from "../modules/billing/billing_retention";
import {
  STRIPE_EVENT_RETENTION_DAYS,
  createSubscriptionLifecycleFromEnv,
} from "../modules/billing/subscription_lifecycle.service";
import { writeStructuredLog } from "../modules/shared/structured_logging";
import { prisma } from "../db/prisma";

/**
 * #1789 — the scheduled entry point for analytics retention.
 *
 * ## Why this is a script and not an HTTP call
 *
 * `POST /admin/retention/cleanup` exists and an operator can drive it by hand,
 * but nothing scheduled can: every route on `MaintenanceController` is guarded
 * by `AuthGuard("jwt")` + `RolesGuard` + `@Roles("admin")`, and a scheduled
 * caller cannot mint an application JWT carrying an allowlisted admin address.
 * The endpoint was never reachable from a schedule — that is the mechanical
 * reason retention went unscheduled, rather than an oversight in wiring.
 *
 * So this mirrors `run_due_erasures.ts`: a job runs the backend image and calls
 * the service in-process, so no request crosses an authentication boundary.
 * `AnalyticsGovernanceService` takes an `@Optional()` warehouse target that
 * defaults from the environment, so the job needs a database URL and the
 * analytics settings rather than everything the running service needs.
 *
 * ## Exit codes
 *
 * `0` when the run completed, including the ordinary case where nothing had
 * expired — that is the normal state and must not page anyone. `1` when the
 * warehouse half failed, because a run that cleared Postgres while the
 * warehouse refused has left the two stores disagreeing, and the whole point of
 * #1789 was that such a run must not look successful.
 *
 * ## Read this before scheduling it the first time
 *
 * Retention derives its event ids from the Postgres rows. A run deletes or
 * redacts there and then propagates; once a source row is gone there is no
 * handle left to erase its warehouse copy. So a first run against a ledger that
 * has never been pruned is not a routine execution — it is the largest single
 * governance action the system will take, and `--dry-run` exists to size it
 * before committing to it.
 *
 * ## Billing (#2430)
 *
 * The same run prunes `StripeEvent` rows processed more than 90 days ago and
 * retries the billing lifecycle steps Stripe has not confirmed (cancelling the
 * subscription of a closed or erased account, pausing collection for a
 * suspension and resuming it, stopping renewals during a closure window,
 * pushing a changed billing email). Those retries need the Stripe settings
 * (`STRIPE_SECRET_KEY` and the rest of `BillingConfig`) in the job's
 * environment; without them pruning still runs and any step that needs Stripe
 * is counted as failed, so the exit code says so.
 *
 * Usage: `node dist/scripts/run_retention_cleanup.js [--dry-run]`
 */
export function isDryRun(argv: string[]): boolean {
  return argv.includes("--dry-run");
}

/**
 * `0` when the run completed, `1` when the warehouse half failed. Exported
 * because the mapping is the contract with the scheduler, and because getting
 * it backwards is how a governance job goes years without anyone noticing.
 */
export function exitCodeFor(result: { status: string; billing?: { failed: number } | null }): 0 | 1 {
  return result.status === "ok" && (result.billing?.failed ?? 0) === 0 ? 0 : 1;
}

/**
 * What a run *would* do, without doing it.
 *
 * Deliberately a separate read-only path rather than a flag threaded into the
 * service: retention is destructive and its first execution here will be
 * unusually large, so the ability to size it must not depend on the destructive
 * code honouring a boolean.
 */
export async function previewRetention(governance = new AnalyticsGovernanceService()) {
  const policy = governance.getRetentionPolicy();
  const now = new Date();
  const tiers = [
    { tier: "sensitive", days: policy.sensitiveDays },
    { tier: "personal", days: policy.personalDays },
    { tier: "pseudonymous", days: policy.pseudonymousDays },
  ] as const;

  const expired: Array<{ tier: string; days: number; expired: number }> = [];
  for (const { tier, days } of tiers) {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    expired.push({
      tier,
      days,
      expired: await prisma.analyticsEvent.count({
        where: { privacyTier: tier, occurredAt: { lt: cutoff } },
      }),
    });
  }

  const stripeEventsExpired = await prisma.stripeEvent.count({
    where: { processedAt: { lt: new Date(now.getTime() - STRIPE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
  });

  return { ranAt: now.toISOString(), policy, tiers: expired, stripeEventsExpired };
}

type RetentionRunResult = Awaited<ReturnType<AnalyticsGovernanceService["runRetentionCleanup"]>>;

/**
 * The counts a scheduled run logs. Counts and policy only: the events being
 * aged out are the thing whose identifiers we are removing, and naming them
 * here would defeat the run. The demand-observation and pledge-context purges
 * are bounded per run, so their counts are what shows a backlog draining.
 */
export function scheduledRunLogFields(result: RetentionRunResult) {
  return {
    status: result.status,
    deleted: result.deleted,
    redacted: result.redacted,
    lineageRecords: result.lineageRecords,
    demandObservationsDeleted: result.demandObservationsDeleted,
    showPledgeDemandContextsDeleted: result.showPledgeDemandContextsDeleted,
    policy: result.policy,
    warehouse: result.warehouse,
    ranAt: result.ranAt,
  };
}

/** Counts only: never a subscription, a customer or an address. */
export function scheduledBillingLogFields(billing: BillingRetentionResult) {
  return {
    stripeEventsPruned: billing.stripeEventsPruned,
    failed: billing.failed,
    ...(billing.reconciled ?? {}),
  };
}

export async function runRetentionCleanupScript(argv: string[] = process.argv.slice(2)) {
  try {
    const governance = new AnalyticsGovernanceService();

    if (isDryRun(argv)) {
      const preview = await previewRetention(governance);
      writeStructuredLog({
        level: "info",
        event: "analytics.retention.dry_run",
        message: "Retention dry run: counted what a real run would touch",
        ...preview,
      });
      return { status: "ok" as const, dryRun: true, preview };
    }

    const analytics = await governance.runRetentionCleanup();
    const billing = await runBillingRetention(createSubscriptionLifecycleFromEnv());
    const result = { ...analytics, billing };

    writeStructuredLog({
      level: exitCodeFor(result) === 0 ? "info" : "error",
      event: "analytics.retention.scheduled_run",
      message:
        result.status !== "ok"
          ? `Retention run cleared Postgres but the warehouse did not complete`
          : billing.failed > 0
            ? `Retention run completed, but ${billing.failed} billing step(s) did not; the next run retries them`
            : `Retention run completed: ${result.deleted} deleted, ${result.redacted} redacted`,
      billing: scheduledBillingLogFields(billing),
      ...scheduledRunLogFields(result),
    });

    return { ...result, dryRun: false as const };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runRetentionCleanupScript()
    .then((result) => {
      process.exit(exitCodeFor(result));
    })
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "analytics.retention.scheduled_run_crashed",
        message: "Retention run could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
