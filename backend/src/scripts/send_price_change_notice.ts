import "dotenv/config";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { RenewalNoticeService } from "../modules/billing/renewal_notices.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";
import { writeStructuredLog } from "../modules/shared/structured_logging";

/**
 * #2597: tell Artist Pro subscribers about a new price 7 to 30 days before it
 * applies, as US automatic-renewal rules expect. Run it before switching the
 * Stripe price the plan uses; it refuses a date outside that window. Every
 * notice is a `purchase` notice (always emailed to a confirmed contact
 * address) with a dedupe key, so a rerun sends nothing twice.
 *
 * Usage:
 *   npm run billing:price-change-notice -- --interval month --currency usd \
 *     --price-cents 1699 --effective 2026-12-20
 * Add `--dry-run` to only count the recipients.
 */
export type PriceChangeArgs = {
  interval: "month" | "year";
  currency: string;
  newPriceCents: number;
  effectiveAt: Date;
  dryRun: boolean;
};

function value(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function parsePriceChangeArgs(argv: string[]): PriceChangeArgs {
  const interval = value(argv, "--interval");
  const currency = (value(argv, "--currency") ?? "").toLowerCase();
  const newPriceCents = Number.parseInt(value(argv, "--price-cents") ?? "", 10);
  const effective = value(argv, "--effective") ?? "";
  const effectiveAt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(effective) ? `${effective}T00:00:00Z` : "invalid");
  if (interval !== "month" && interval !== "year") throw new Error("--interval must be month or year");
  if (currency !== "usd" && currency !== "eur") throw new Error("--currency must be usd or eur");
  if (!Number.isSafeInteger(newPriceCents) || newPriceCents <= 0) throw new Error("--price-cents must be a positive integer");
  if (Number.isNaN(effectiveAt.getTime())) throw new Error("--effective must be a date like 2026-12-20");
  return { interval, currency, newPriceCents, effectiveAt, dryRun: argv.includes("--dry-run") };
}

export async function runPriceChangeNotice(argv: string[] = process.argv.slice(2)) {
  const args = parsePriceChangeArgs(argv);
  try {
    const service = new RenewalNoticeService(new NoticeService(new EventBus(), new AuditService()));
    if (args.dryRun) {
      const count = await prisma.subscription.count({
        where: { interval: args.interval, status: { in: ["active", "trialing", "past_due"] }, cancelAtPeriodEnd: false },
      });
      writeStructuredLog({ level: "info", event: "billing.price_change_dry_run", message: `${count} subscribers of this interval (before the currency filter)` });
      return { recipients: count, sent: 0 };
    }
    return await service.sendPriceChangeNotices(args);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPriceChangeNotice()
    .then(() => process.exit(0))
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "billing.price_change_notice_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
