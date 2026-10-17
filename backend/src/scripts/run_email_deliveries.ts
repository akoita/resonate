import "dotenv/config";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { ContactEmailService } from "../modules/email/contact_email.service";
import { EmailConfig } from "../modules/email/email_config";
import {
  EMAIL_SEND_LIMIT,
  EmailDeliveryService,
  type EmailDeliveryRunResult,
} from "../modules/email/email_delivery.service";
import { createEmailTransport } from "../modules/email/email_transport";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";
import { writeStructuredLog } from "../modules/shared/structured_logging";

/**
 * #2169 — the scheduled entry point that drains the notice-email outbox.
 *
 * One run does three things, each bounded: fan new notices out into one
 * `EmailDelivery` row per confirmed recipient, send the rows that are due (with
 * retry/backoff, and disabling an address the provider permanently refuses),
 * and prune delivery-log rows older than 180 days. It is idempotent: a rerun
 * sends nothing twice, so the schedule can be as frequent as every few minutes.
 *
 * Like `run_refund_reminders.ts`, this is a script rather than an HTTP call and
 * builds its collaborators directly (no Nest boot). Its environment is the
 * database URL plus the email settings in `docs/deployment/environment.md`
 * (`EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_SMTP_URL`, `EMAIL_LINK_SIGNING_SECRET`,
 * `FRONTEND_URL`, `PUBLIC_API_URL`). Scheduling is deployment configuration,
 * not part of this repository.
 *
 * With email disabled on the deployment the run does nothing and exits `0`
 * when email was simply never configured, or `1` when it is misconfigured (so
 * a missing variable shows as a failed execution).
 *
 * Exit codes: `0` when the run completed, including "nothing to send"; `1` on
 * an unexpected error, a misconfiguration, or when any email failed for good.
 *
 * Usage: `node dist/scripts/run_email_deliveries.js [--dry-run] [--limit N]`
 * `--dry-run` counts what would be fanned out, sent and pruned and writes nothing.
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

export function exitCodeFor(result: Pick<EmailDeliveryRunResult, "failed">, config?: EmailConfig): 0 | 1 {
  if (config && !config.isAvailable() && config.disabledReason !== "not_configured") return 1;
  return result.failed > 0 ? 1 : 0;
}

export function buildEmailDeliveryService(config: EmailConfig = new EmailConfig()): EmailDeliveryService {
  const transport = createEmailTransport(config);
  const notices = new NoticeService(new EventBus(), new AuditService());
  const contacts = new ContactEmailService(config, transport, notices);
  return new EmailDeliveryService(config, transport, contacts);
}

/** Counts only: no addresses, user ids, tokens or bodies reach the log. */
export function emailDeliveryLogFields(result: EmailDeliveryRunResult) {
  return {
    dryRun: result.dryRun,
    enabled: result.enabled,
    fannedOutNotices: result.fannedOutNotices,
    audienceUnresolvable: result.audienceUnresolvable,
    queued: result.queued,
    due: result.due,
    sent: result.sent,
    failed: result.failed,
    suppressed: result.suppressed,
    bounced: result.bounced,
    pruned: result.pruned,
  };
}

export async function runEmailDeliveriesScript(argv: string[] = process.argv.slice(2)) {
  const config = new EmailConfig();
  try {
    if (!config.isAvailable()) config.logIfDisabled();
    const result = await buildEmailDeliveryService(config).run({
      dryRun: isDryRun(argv),
      limit: parseLimit(argv) ?? EMAIL_SEND_LIMIT,
    });
    writeStructuredLog({
      level: result.failed > 0 ? "error" : "info",
      event: "email.deliveries.run",
      message: !result.enabled
        ? "Email deliveries skipped: email is not enabled on this deployment"
        : result.dryRun
          ? `Email deliveries dry run: ${result.due} due, ${result.queued} would be queued`
          : `Email deliveries run: ${result.sent} sent, ${result.failed} failed, ${result.suppressed} suppressed`,
      ...emailDeliveryLogFields(result),
    });
    return { result, config };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runEmailDeliveriesScript()
    .then(({ result, config }) => {
      process.exit(exitCodeFor(result, config));
    })
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "email.deliveries.crashed",
        message: "Email deliveries run could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
