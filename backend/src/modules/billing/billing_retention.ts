/**
 * The billing half of the retention run (#2430), shared by
 * `POST /admin/retention/cleanup` and the scheduled `run_retention_cleanup`
 * job:
 *
 * - prune `StripeEvent` rows processed more than 90 days ago (the idempotency
 *   log only has to outlive Stripe's 3-day retry window);
 * - retry every account-lifecycle step Stripe has not confirmed yet
 *   (`SubscriptionLifecycleService.reconcile`);
 * - send the Artist Pro renewal reminders that are due (#2597,
 *   `renewal_notices.service.ts`).
 *
 * A failure here never hides the analytics result: it is counted in `failed`
 * and logged, and the next run retries.
 */

import { AuditService } from "../audit/audit.service";
import { NoticeService } from "../notifications/notice.service";
import { EventBus } from "../shared/event_bus";
import { writeStructuredLog } from "../shared/structured_logging";
import { RenewalNoticeService, type ReminderResult } from "./renewal_notices.service";
import { BillingConfig } from "./billing_config";
import {
  type BillingReconcileResult,
  STRIPE_EVENT_RETENTION_DAYS,
  SubscriptionLifecycleService,
  failureCode,
} from "./subscription_lifecycle.service";

export type BillingRetentionResult = {
  stripeEventRetentionDays: number;
  stripeEventsPruned: number;
  reconciled: BillingReconcileResult | null;
  /** #2597: renewal reminders sent on this run. */
  renewalReminders: ReminderResult | null;
  /** Steps that did not complete this run (each is retried on the next). */
  failed: number;
};

export async function runBillingRetention(
  lifecycle: SubscriptionLifecycleService | null | undefined,
  now: Date = new Date(),
  renewals?: RenewalNoticeService,
): Promise<BillingRetentionResult> {
  const service = lifecycle ?? new SubscriptionLifecycleService(new BillingConfig({}), null);
  const result: BillingRetentionResult = {
    stripeEventRetentionDays: STRIPE_EVENT_RETENTION_DAYS,
    stripeEventsPruned: 0,
    reconciled: null,
    renewalReminders: null,
    failed: 0,
  };
  try {
    result.stripeEventsPruned = await service.pruneStripeEvents(now);
  } catch (error) {
    result.failed += 1;
    logFailure("prune", error);
  }
  try {
    result.reconciled = await service.reconcile(now);
    result.failed += result.reconciled.failed;
  } catch (error) {
    result.failed += 1;
    logFailure("reconcile", error);
  }
  try {
    const reminders = renewals ?? new RenewalNoticeService(new NoticeService(new EventBus(), new AuditService()));
    result.renewalReminders = await reminders.sendDueReminders(now);
  } catch (error) {
    result.failed += 1;
    logFailure("renewal_reminders", error);
  }
  return result;
}

function logFailure(step: string, error: unknown) {
  writeStructuredLog({
    level: "error",
    event: "billing.retention_step_failed",
    message: "A billing retention step failed; the next run retries it",
    step,
    code: failureCode(error),
  });
}
