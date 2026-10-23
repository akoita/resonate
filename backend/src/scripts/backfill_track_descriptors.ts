import "dotenv/config";
import { prisma } from "../db/prisma";
import {
  TrackDescriptorTagger,
  type TagTracksResult,
} from "../modules/descriptors/track_descriptor_tagger";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { writeStructuredLog } from "../modules/shared/structured_logging";

/**
 * #2240 - tag the existing catalog with track descriptors: genre families,
 * sub-genres, measured tempo/energy bands and vocal/instrumental, stored once
 * per track and recomputed only when the content hash of its inputs changes.
 *
 * ## Dry run is the default
 *
 * Nothing is written, and NO model call is made, unless `--apply` is passed. A
 * dry run reports what `--apply` would do, including `wouldCallModel`, the
 * number of model calls an apply run would spend (capped by the call budget).
 * `--apply` together with `--dry-run` is rejected as ambiguous.
 *
 * ## Strategy
 *
 * `TRACK_DESCRIPTOR_STRATEGY` (default `deterministic`): the free-text genre,
 * title and release title are mapped to genre families with the shared matcher
 * plus a small place lexicon, and bands come from the full-mix features
 * (#1959). `model-assisted` additionally asks the configured model, one call
 * per track, re-validating every tag against the family vocabulary, and falls
 * back to the deterministic result on timeout, malformed output or missing
 * credentials. See docs/deployment/environment.md.
 *
 * ## Bounded and idempotent
 *
 * - `--limit N` tags at most N tracks per run (default 500); re-run until
 *   `deferred` is 0.
 * - `--max-model-calls N` caps model calls for the run (default
 *   `TRACK_DESCRIPTOR_DAILY_CALL_BUDGET`). Over the cap, tracks get the
 *   deterministic descriptor and `catalog.track_descriptor.budget_exceeded` is
 *   logged (the alert hook).
 * - A second run finds every hash current and changes nothing.
 * - Artist-written descriptors (corrections, #2292) are never overwritten.
 * - The job writes `TrackDescriptor` rows only: no track, release, disclosure,
 *   moderation or rights column is touched.
 *
 * ## Re-embedding
 *
 * A changed descriptor changes a track's embedding text, so the existing
 * incremental embedding backfill re-embeds it. `--reembed` (with `--apply`)
 * also embeds the tracks this run changed right away; it needs the embedding
 * provider configuration and is off by default.
 *
 * Exit codes: `0` when the run completed, `1` on a bad flag or an error.
 *
 * Usage: `node dist/scripts/backfill_track_descriptors.js [--dry-run | --apply] [--limit N] [--max-model-calls N] [--reembed]`
 */

export const DEFAULT_BACKFILL_LIMIT = 500;
const MODEL_CONCURRENCY = 4;
const REEMBED_BATCH = 200;

export interface BackfillArgs {
  apply: boolean;
  limit: number;
  maxModelCalls?: number;
  reembed: boolean;
}

function positiveInteger(flag: string, value: string | undefined, allowZero = false): number {
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a number`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw new Error(`${flag} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  }
  return parsed;
}

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  let apply = false;
  let dryRun = false;
  let reembed = false;
  let limit = DEFAULT_BACKFILL_LIMIT;
  let maxModelCalls: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--reembed") reembed = true;
    else if (arg === "--limit") {
      limit = positiveInteger("--limit", argv[index + 1]);
      index += 1;
    } else if (arg === "--max-model-calls") {
      maxModelCalls = positiveInteger("--max-model-calls", argv[index + 1], true);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (apply && dryRun) throw new Error("--apply and --dry-run are mutually exclusive");
  if (reembed && !apply) throw new Error("--reembed needs --apply");
  return { apply, limit, maxModelCalls, reembed };
}

export interface BackfillReport extends TagTracksResult {
  dryRun: boolean;
  limit: number;
  /** Embedding vectors written by `--reembed` (0 otherwise). */
  reembedded: number;
}

export function formatBackfillSummary(report: BackfillReport): string {
  const lines = [
    report.dryRun
      ? "Track descriptor backfill DRY RUN (nothing written, no model call made)"
      : "Track descriptor backfill APPLIED",
    `  strategy:               ${report.strategy}${report.model ? ` (${report.model})` : ""}`,
    `  tracks scanned:         ${report.scanned}`,
    `  already current:        ${report.unchanged}`,
    `  ${report.dryRun ? "would tag" : "tagged"}:${" ".repeat(report.dryRun ? 14 : 18)}${report.tagged}  (limit ${report.limit})`,
    `    deterministic:        ${report.fromDeterministic}`,
    `    model:                ${report.fromModel}`,
    `    model failed -> deterministic: ${report.fallbacks}`,
    `    over call budget -> deterministic: ${report.overBudget}`,
    `  deferred (over limit):  ${report.deferred}`,
    `  kept (artist-written):  ${report.skippedArtistOwned}`,
    `  kept (model cooldown):  ${report.cooldown}`,
    `  failed:                 ${report.failed}`,
    report.dryRun
      ? `  model calls an --apply run would make: ${report.wouldCallModel}`
      : `  model calls made:       ${report.modelCalls}`,
  ];
  if (report.reembedded > 0) lines.push(`  embeddings rewritten:   ${report.reembedded}`);
  return lines.join("\n");
}

export async function runBackfillTrackDescriptors(
  argv: string[] = process.argv.slice(2),
  tagger: TrackDescriptorTagger = new TrackDescriptorTagger(),
): Promise<BackfillReport> {
  const args = parseBackfillArgs(argv);
  const budget = tagger.runBudget(args.maxModelCalls);
  const result = await tagger.tagCatalog({
    apply: args.apply,
    budget,
    maxToTag: args.limit,
    concurrency: MODEL_CONCURRENCY,
  });

  let reembedded = 0;
  if (args.reembed && result.changedTrackIds.length > 0) {
    const embeddings = new TrackEmbeddingService(new EmbeddingService(), new EmbeddingStore());
    for (let i = 0; i < result.changedTrackIds.length; i += REEMBED_BATCH) {
      const outcome = await embeddings.embedTracks(result.changedTrackIds.slice(i, i + REEMBED_BATCH));
      reembedded += outcome.embedded;
    }
  }

  const report: BackfillReport = { ...result, dryRun: !args.apply, limit: args.limit, reembedded };
  process.stdout.write(`${formatBackfillSummary(report)}\n`);
  writeStructuredLog({
    level: "info",
    event: report.dryRun
      ? "catalog.track_descriptor_backfill.dry_run"
      : "catalog.track_descriptor_backfill.applied",
    message: report.dryRun
      ? `Track descriptor backfill dry run: ${report.tagged} track(s) would be tagged`
      : `Track descriptor backfill applied: ${report.tagged} track(s) tagged`,
    strategy: report.strategy,
    scanned: report.scanned,
    unchanged: report.unchanged,
    tagged: report.tagged,
    fromModel: report.fromModel,
    fromDeterministic: report.fromDeterministic,
    fallbacks: report.fallbacks,
    overBudget: report.overBudget,
    deferred: report.deferred,
    failed: report.failed,
    modelCalls: report.modelCalls,
    wouldCallModel: report.wouldCallModel,
    reembedded: report.reembedded,
  });
  return report;
}

if (require.main === module) {
  runBackfillTrackDescriptors()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      writeStructuredLog({
        level: "error",
        event: "catalog.track_descriptor_backfill.failed",
        message: "Track descriptor backfill could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      await prisma.$disconnect().catch(() => undefined);
      process.exit(1);
    });
}
