import "dotenv/config";
import { prisma } from "../db/prisma";
import { createMarketplaceSplitChainReader } from "../modules/contracts/contracts.service";
import {
  SPLIT_BACKFILL_DEFAULT_LIMIT,
  backfillPendingMarketplaceSplits,
  type MarketplaceSplitChainReader,
  type SaleSplitBackfillReport,
} from "../modules/contracts/marketplace_sale_split";
import { writeStructuredLog } from "../modules/shared/structured_logging";

/**
 * #2344 - finalise the split of marketplace sales still pending (#2172).
 *
 * A sale indexed before #2172 has no royalty, platform fee or seller proceeds
 * recorded: it is PENDING ("not known yet", never zero) and is excluded from the
 * artist's net received. The startup retry only looks at the 50 most recent and
 * needs the RPC node to serve the old block. This one-off job walks the backlog
 * and finalises every sale whose split can be proven, using exactly the logic of
 * the live path: the royalty from the indexed `RoyaltyPaid` log (or proven zero
 * by `royaltyInfo` at the Sold block) and `protocolFeeBps()` at the Sold block.
 * A sale that cannot be proven stays pending and is reported with the reason.
 *
 * ## Dry run is the default
 *
 * Nothing is written unless `--apply` is passed. The dry run performs the same
 * reads (including the read-only chain calls) and reports what `--apply` would
 * finalise. `--apply` together with `--dry-run` is rejected as ambiguous.
 *
 * ## Bounded and idempotent
 *
 * - `--limit N` examines at most N pending sales per run (default 200), newest
 *   first. When more remain the report prints `nextBefore`: pass it as
 *   `--before <timestamp>` to continue (inclusive, so re-examining a sale is
 *   harmless).
 * - A final split is never rewritten, so a second run changes nothing.
 * - Only the split columns of `StemPurchase` are written. No fee, split or
 *   payout is changed or moved: the job records what the contract already did.
 * - Sales indexed before the Sold log position was kept cannot be matched to
 *   their RoyaltyPaid log; they stay pending (`no_log_index`) and are never
 *   guessed.
 *
 * Needs the database and the chain RPC the backend itself uses (see
 * docs/deployment/environment.md); the RPC must serve the sale's block
 * (`fee_unreadable` / `royalty_unreadable` mean it did not).
 *
 * Exit codes: `0` when the run completed, `1` on a bad flag or an error.
 *
 * Usage: `node dist/scripts/backfill_sale_splits.js [--dry-run | --apply] [--limit N] [--before ISO_TIMESTAMP]`
 */

export interface SaleSplitBackfillArgs {
  apply: boolean;
  limit: number;
  before?: Date;
}

export function parseSaleSplitBackfillArgs(argv: string[]): SaleSplitBackfillArgs {
  let apply = false;
  let dryRun = false;
  let limit = SPLIT_BACKFILL_DEFAULT_LIMIT;
  let before: Date | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--limit needs a number");
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("--limit must be a positive integer");
      limit = parsed;
      index += 1;
    } else if (arg === "--before") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--before needs an ISO timestamp");
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new Error("--before must be an ISO timestamp");
      before = parsed;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (apply && dryRun) throw new Error("--apply and --dry-run are mutually exclusive");
  return { apply, limit, before };
}

export function formatSaleSplitBackfillSummary(report: SaleSplitBackfillReport): string {
  const reasons = report.stillPending;
  const stillPending = Object.values(reasons).reduce((total, count) => total + count, 0);
  const lines = [
    report.dryRun
      ? "Sale split backfill DRY RUN (nothing written)"
      : "Sale split backfill APPLIED",
    `  pending sales examined:   ${report.scanned}  (limit ${report.limit}${report.before ? `, up to ${report.before}` : ""})`,
    `  ${(report.dryRun ? "would finalise:" : "finalised:").padEnd(24)}${report.finalizable}`,
    `  stay pending:             ${stillPending}`,
    `    no Sold log position:   ${reasons.no_log_index}`,
    `    royalty not indexed:    ${reasons.royalty_not_indexed}`,
    `    StemNFT unknown:        ${reasons.stem_nft_unknown}`,
    `    fee rate unreadable:    ${reasons.fee_unreadable}`,
    `    royalty unreadable:     ${reasons.royalty_unreadable}`,
    `    split inconsistent:     ${reasons.split_inconsistent}`,
    `  failed:                   ${report.failed}`,
    `  deferred (over limit):    ${report.deferred}`,
  ];
  if (report.nextBefore) lines.push(`  continue with:            --before ${report.nextBefore}`);
  return lines.join("\n");
}

export async function runBackfillSaleSplits(
  argv: string[] = process.argv.slice(2),
  reader: MarketplaceSplitChainReader = createMarketplaceSplitChainReader(),
): Promise<SaleSplitBackfillReport> {
  const args = parseSaleSplitBackfillArgs(argv);
  const logger = {
    warn: (message: string) =>
      writeStructuredLog({ level: "warn", event: "contracts.sale_split_backfill.warning", message }),
  };
  const report = await backfillPendingMarketplaceSplits(reader, logger, {
    apply: args.apply,
    limit: args.limit,
    before: args.before,
  });
  process.stdout.write(`${formatSaleSplitBackfillSummary(report)}\n`);
  writeStructuredLog({
    level: "info",
    event: report.dryRun
      ? "contracts.sale_split_backfill.dry_run"
      : "contracts.sale_split_backfill.applied",
    message: report.dryRun
      ? `Sale split backfill dry run: ${report.finalizable} sale(s) would be finalised`
      : `Sale split backfill applied: ${report.finalizable} sale(s) finalised`,
    scanned: report.scanned,
    finalizable: report.finalizable,
    stillPending: report.stillPending,
    failed: report.failed,
    deferred: report.deferred,
  });
  return report;
}

if (require.main === module) {
  runBackfillSaleSplits()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      writeStructuredLog({
        level: "error",
        event: "contracts.sale_split_backfill.failed",
        message: "Sale split backfill could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      await prisma.$disconnect().catch(() => undefined);
      process.exit(1);
    });
}
