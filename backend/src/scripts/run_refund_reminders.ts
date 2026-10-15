import "dotenv/config";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";
import { writeStructuredLog } from "../modules/shared/structured_logging";
import {
  REFUND_REMINDER_BATCH_LIMIT,
  ShowRefundReminderService,
  type RefundReminderRunResult,
} from "../modules/shows/show-refund-reminder.service";

/**
 * #2149 — the scheduled entry point for Shows unclaimed-refund reminders.
 *
 * Finds backers whose refund is claimable on-chain and unclaimed and sends them
 * an in-app `refund` notice at the cadence in `show-refund-reminder.service.ts`
 * (refunds open + 0, 7, 30 days). It is idempotent: a rerun on the same day
 * sends nothing new, so the schedule can be as frequent as daily.
 *
 * Like `run_due_erasures.ts`, this is a script rather than an HTTP call because
 * the admin routes need an application JWT that a scheduler cannot mint. It
 * builds its collaborators directly (no Nest boot), so its environment is a
 * database URL plus the RPC settings for the campaigns' chain (`RPC_URL`, or
 * the per-network `*_RPC_URL` the escrow indexer already uses).
 *
 * Scheduling is deployment configuration (resonate-iac#282), not part of this
 * repository.
 *
 * Exit codes: `0` when the run completed, including "nothing to remind"; `1`
 * on an unexpected error or when any backer's check or notice failed (so a
 * failing RPC shows as a failed execution, not a green job that did nothing).
 *
 * Usage: `node dist/scripts/run_refund_reminders.js [--dry-run] [--limit N]`
 * `--dry-run` reads the chain and logs the counts but sends no notices.
 */
export function isDryRun(argv: string[]): boolean {
  return argv.includes("--dry-run");
}

export function parseLimit(argv: string[]): number | undefined {
  const index = argv.indexOf("--limit");
  if (index === -1) return undefined;
  const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function exitCodeFor(result: { failed: number }): 0 | 1 {
  return result.failed > 0 ? 1 : 0;
}

export function buildRefundReminderService(): ShowRefundReminderService {
  return new ShowRefundReminderService(new NoticeService(new EventBus(), new AuditService()));
}

/** Counts only: no wallet addresses, user ids or amounts reach the log. */
export function refundReminderLogFields(result: RefundReminderRunResult) {
  return {
    dryRun: result.dryRun,
    ranAt: result.ranAt,
    scanned: result.scanned,
    refundable: result.refundable,
    reminded: result.reminded,
    skipped: result.skipped,
    failed: result.failed,
  };
}

export async function runRefundRemindersScript(argv: string[] = process.argv.slice(2)) {
  try {
    const result = await buildRefundReminderService().run({
      dryRun: isDryRun(argv),
      limit: parseLimit(argv) ?? REFUND_REMINDER_BATCH_LIMIT,
    });
    writeStructuredLog({
      level: result.failed > 0 ? "error" : "info",
      event: "shows.refund_reminders.run",
      message: result.dryRun
        ? `Refund reminders dry run: ${result.reminded} would be sent`
        : `Refund reminders run: ${result.reminded} sent, ${result.failed} failed`,
      ...refundReminderLogFields(result),
    });
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runRefundRemindersScript()
    .then((result) => {
      process.exit(exitCodeFor(result));
    })
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "shows.refund_reminders.crashed",
        message: "Refund reminders run could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
