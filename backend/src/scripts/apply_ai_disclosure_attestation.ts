import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma";
import type { ResonateEvent } from "../events/event_types";
import { AnalyticsDomainEventBridgeService } from "../modules/analytics/analytics_domain_event_bridge.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { analyticsEventPublisherFromEnv } from "../modules/analytics/analytics_event_publisher";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import {
  applyCatalogAttestation,
  formatAttestationApplySummary,
  parseAttestationManifest,
  type AttestationApplyResult,
  type AttestationEventEmitter,
} from "../modules/catalog/ai-disclosure-attestation";
import { EventBus } from "../modules/shared/event_bus";
import { writeStructuredLog } from "../modules/shared/structured_logging";

/**
 * #2252 - apply a REVIEWED manifest of release ids: their `UNDECLARED` +
 * `"migration"` tracks become `NONE` with source `catalog_attestation`.
 *
 * Guards (see `applyCatalogAttestation`): only tracks that are `UNDECLARED`
 * with source `"migration"`, whose release is in the manifest and is not
 * `ai_generated` or `remix`, and that carry no `generationMetadata`. Manifest
 * entries that fail a guard are skipped and reported.
 *
 * ## Dry run is the default
 *
 * Nothing is written unless `--apply` is passed. A dry run prints exactly the
 * counts an `--apply` run would act on. `--apply` together with `--dry-run`
 * is rejected as ambiguous.
 *
 * ## Manifest
 *
 * `--manifest <path>` names a JSON file: an array of release ids, or an object
 * with a `releaseIds` array (the `manifestDraft` of the report script). It is
 * an input for one environment and is never committed.
 *
 * ## Idempotent and audited
 *
 * A second run finds nothing eligible and changes nothing. Each changed track
 * emits the existing `catalog.ai_disclosure_recorded` analytics event
 * (identifiers, level, source) through the same domain-event bridge the
 * running service uses, so the batch leaves an audit trail. The script builds
 * those collaborators directly rather than booting Nest, so its environment is
 * a database URL plus the analytics publisher settings, like the other
 * operator jobs (`run_due_erasures.ts`).
 *
 * Exit codes: `0` when the run completed (skipped manifest entries are
 * reported, not failures), `1` on a bad flag, an unreadable or invalid
 * manifest, or an error.
 *
 * Usage: `node dist/scripts/apply_ai_disclosure_attestation.js --manifest <path> [--dry-run | --apply]`
 */
export function parseApplyArgs(argv: string[]): { manifest: string; apply: boolean } {
  let manifest: string | undefined;
  let apply = false;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--manifest needs a file path");
      manifest = value;
      index += 1;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!manifest) throw new Error("--manifest <path> is required");
  if (apply && dryRun) throw new Error("--apply and --dry-run are mutually exclusive");
  return { manifest, apply };
}

/**
 * Routes `catalog.ai_disclosure_recorded` through the production analytics
 * bridge and lets the caller wait for the writes to settle (the bridge itself
 * is fire-and-forget behind the event bus).
 */
class SettlingIngestService extends AnalyticsIngestService {
  readonly pending: Array<Promise<unknown>> = [];

  override ingest(input: Parameters<AnalyticsIngestService["ingest"]>[0]) {
    const work = super.ingest(input);
    this.pending.push(work.catch(() => undefined));
    return work;
  }
}

export function buildAnalyticsEmitter(): {
  emit: AttestationEventEmitter;
  settle: () => Promise<void>;
  close: () => void;
} {
  const eventBus = new EventBus();
  const ingest = new SettlingIngestService(
    new PrismaAnalyticsEventStore(),
    analyticsEventPublisherFromEnv(),
  );
  const bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
  bridge.onModuleInit();
  return {
    emit: (event) => eventBus.publish(event as ResonateEvent),
    settle: async () => {
      await Promise.allSettled(ingest.pending);
    },
    close: () => {
      bridge.onModuleDestroy();
      eventBus.destroy();
    },
  };
}

export async function runApplyAttestationScript(
  argv: string[] = process.argv.slice(2),
): Promise<AttestationApplyResult> {
  const args = parseApplyArgs(argv);
  const manifest = parseAttestationManifest(JSON.parse(readFileSync(args.manifest, "utf8")));
  const analytics = args.apply ? buildAnalyticsEmitter() : undefined;

  try {
    const result = await applyCatalogAttestation(prisma, {
      releaseIds: manifest.releaseIds,
      apply: args.apply,
      emit: analytics?.emit,
    });
    await analytics?.settle();

    process.stdout.write(`${formatAttestationApplySummary(result)}\n`);
    writeStructuredLog({
      level: "info",
      event: result.dryRun
        ? "catalog.ai_disclosure_attestation.dry_run"
        : "catalog.ai_disclosure_attestation.applied",
      message: result.dryRun
        ? `Attestation dry run: ${result.tracksEligible} track(s) would change`
        : `Attestation applied: ${result.tracksUpdated} track(s) changed`,
      dryRun: result.dryRun,
      manifestReleases: result.manifestReleases,
      tracksEligible: result.tracksEligible,
      tracksUpdated: result.tracksUpdated,
      tracksAlreadyAttested: result.tracksAlreadyAttested,
      eventsEmitted: result.eventsEmitted,
      skippedReleases: result.skippedReleases.length,
      skippedTracks: result.skippedTracks.length,
    });
    return result;
  } finally {
    analytics?.close();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runApplyAttestationScript()
    .then(() => process.exit(0))
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "catalog.ai_disclosure_attestation.failed",
        message: "AI disclosure attestation could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
