import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { join } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { StorageProvider } from "../storage/storage_provider";
import { resolveContainedPath } from "../storage/path_containment";
import {
  CURRENT_STEM_ANALYSIS_REVISION,
  sanitizeStemAudioFeatures,
  stemAnalysisRevision,
  withCamelot,
} from "./stem-audio-features";
import {
  StemAnalysisResultMessage,
  StemPubSubPublisher,
} from "./stem-pubsub.publisher";
import { toWorkerFetchableUri } from "./worker-fetchable-uri";

/** Stems per analysis message on the Pub/Sub transport (contract: 1-50). */
const PUBSUB_MAX_STEMS_PER_MESSAGE = 50;

/**
 * A stem whose analysis failed is held back from the default selection for
 * this long after its last failure (#2012), so a batch moves on to other
 * stems instead of re-trying the same failures on every run.
 */
export const BACKFILL_FAILURE_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * After this many failed analyses a stem is held back until a run passes
 * `retryFailed: true` (#2012).
 */
export const BACKFILL_MAX_FAILURES = 3;

/**
 * Worker `/analyze` statuses that reject the stem's audio itself (#2012):
 * unreadable or unanalyzable audio (422, 400, 415) or an oversized upload
 * (413). Any other non-2xx status is treated as the worker being unavailable.
 */
const STEM_REJECTION_STATUSES = new Set([400, 413, 415, 422]);

/**
 * Skip reasons attributable to the stem, which are recorded as failures and
 * hold it back (#2012). `worker_unavailable` (network error, timeout, other
 * non-2xx status or non-JSON body) and `error` (any other unexpected failure)
 * are logged only and leave the stem eligible.
 */
const STEM_FAILURE_REASONS = new Set(["audio_unavailable", "analysis_failed"]);

/** The analysis worker could not be reached or answered abnormally. */
class WorkerUnavailableError extends Error {}

/** Stem types that exist in the catalog; `original` is the full mix (#1959). */
export const BACKFILL_STEM_TYPES = [
  "original",
  "master",
  "vocals",
  "drums",
  "bass",
  "other",
  "piano",
  "guitar",
] as const;

export type StemFeatureBackfillRequest = {
  /** Stems analyzed per run; 1–100, default 25. Re-run until remaining=0. */
  limit?: number;
  /**
   * Restrict the run to these stem types (e.g. `["original"]` to target full
   * mixes first, #1959). Unknown values are dropped; an empty or absent list
   * means every type.
   */
  types?: string[];
  /**
   * Also re-measure stems whose stored features were produced by an older
   * analysis revision than the current one (#2016); a missing revision counts
   * as 1. Default false: only stems without features are targeted.
   */
  refresh?: boolean;
  /**
   * Also re-attempt stems held back after failed analyses (#2012): those that
   * failed within the retry window or reached the failure cap. Default false.
   */
  retryFailed?: boolean;
};

export type StemFeatureBackfillResult = {
  scanned: number;
  /**
   * Stems written during this call. Always 0 on the `pubsub` transport:
   * results arrive asynchronously and are applied by `applyAnalysisResults`.
   */
  updated: number;
  skipped: Array<{ stemId: string; reason: string }>;
  /**
   * Stems still lacking features that the next default run can select: never
   * tried, or past the retry window after a failure (#2012). Stems held back
   * after failures are counted in `failed` instead, so this reaches 0 even
   * when some stems keep failing. On the `pubsub` transport this still counts
   * stems that are in flight (dispatched but not yet written back), so
   * re-poll it until it stops decreasing.
   */
  remaining: number;
  /**
   * Stems still lacking features that are held back after failed analyses
   * (#2012): failed within the retry window or reached the failure cap. Same
   * `types`/`refresh` filter as `remaining`; `retryFailed` re-attempts them.
   */
  failed: number;
  /**
   * Selectable stems (as `remaining`) per type, across ALL types (ignores
   * `types`).
   */
  remainingByType: Record<string, number>;
  /**
   * Transport used (#2013): `http` when `DEMUCS_WORKER_URL` is set, `pubsub`
   * when the Pub/Sub publisher is initialized (job deployment mode), `none`
   * when neither is available.
   */
  transport: "http" | "pubsub" | "none";
  /**
   * `ok`: nothing outstanding on this transport (HTTP finished, or nothing
   * was dispatchable); `dispatched`: an analysis message was published and
   * results are pending; `worker_unavailable`: no transport is configured.
   */
  status: "ok" | "dispatched" | "worker_unavailable";
  /** Stems sent to the worker in a published analysis message (pubsub only). */
  dispatched: number;
  /** Analysis job id of the published message (pubsub only). */
  jobId?: string;
  /**
   * HTTP only (#2012): set when the run stopped at the first stem the worker
   * could not serve. `scanned` then counts the stems attempted; the rest of
   * the batch was not attempted and stays in `remaining`.
   */
  stoppedEarly?: "worker_unavailable";
};

export type StemFeatureBackfillStatus = Pick<
  StemFeatureBackfillResult,
  "remaining" | "failed" | "remainingByType"
>;

/**
 * SQL for the revision stored in `Stem."audioFeatures"`: the positive integer
 * `analysisRevision`, else 1 (absent, null, non-numeric or out of range).
 * Mirrors `stemAnalysisRevision`; the digit bound keeps the cast within int.
 */
const STORED_REVISION_SQL = Prisma.sql`(CASE WHEN jsonb_typeof("audioFeatures"->'analysisRevision') = 'number' AND ("audioFeatures"->>'analysisRevision') ~ '^[1-9][0-9]{0,8}$' THEN ("audioFeatures"->>'analysisRevision')::int ELSE 1 END)`;

/** Features are missing, or were produced by a revision older than `revisionSql`. */
function needsMeasurementSql(currentRevision: number | Prisma.Sql): Prisma.Sql {
  return Prisma.sql`("audioFeatures" IS NULL OR jsonb_typeof("audioFeatures") = 'null' OR ${STORED_REVISION_SQL} < ${currentRevision})`;
}

/** Failures before this instant are past the retry window. */
function retryCutoff(): Date {
  return new Date(Date.now() - BACKFILL_FAILURE_RETRY_WINDOW_MS);
}

/**
 * Not held back after failures (#2012): never failed, or below the failure
 * cap with the last failure older than the retry window.
 */
function selectableWhere(cutoff: Date): Prisma.StemWhereInput {
  return {
    OR: [
      { audioFeaturesFailureCount: 0 },
      {
        audioFeaturesFailureCount: { lt: BACKFILL_MAX_FAILURES },
        OR: [
          { audioFeaturesFailedAt: null },
          { audioFeaturesFailedAt: { lt: cutoff } },
        ],
      },
    ],
  };
}

/** SQL twin of {@link selectableWhere}. */
function selectableSql(cutoff: Date): Prisma.Sql {
  return Prisma.sql`("audioFeaturesFailureCount" = 0 OR ("audioFeaturesFailureCount" < ${BACKFILL_MAX_FAILURES} AND ("audioFeaturesFailedAt" IS NULL OR "audioFeaturesFailedAt" < ${cutoff})))`;
}

function refreshPredicate(types: string[] | null): Prisma.Sql {
  return Prisma.sql`"isEncrypted" = false AND ${needsMeasurementSql(
    CURRENT_STEM_ANALYSIS_REVISION,
  )}${types ? Prisma.sql` AND "type" IN (${Prisma.join(types)})` : Prisma.empty}`;
}

function sanitizeTypes(types: unknown): string[] | null {
  if (!Array.isArray(types)) return null;
  const allowed = new Set<string>(BACKFILL_STEM_TYPES);
  const kept = Array.from(
    new Set(
      types.filter(
        (type): type is string => typeof type === "string" && allowed.has(type),
      ),
    ),
  );
  return kept.length > 0 ? kept : null;
}

/**
 * Backfills `Stem.audioFeatures` (#1184) for stems ingested before feature
 * extraction shipped. Two transports (#2013): the demucs worker's
 * `POST /analyze` endpoint when `DEMUCS_WORKER_URL` is set, or an
 * analysis-only Pub/Sub message through the separation job dispatch when the
 * worker runs in job mode (results are applied by `applyAnalysisResults`).
 * With neither, the call reports `worker_unavailable`. Admin-triggered and
 * batch-bounded: run it repeatedly until `remaining` reaches 0. A stem whose
 * analysis fails is recorded on the row and held back (#2012) for
 * `BACKFILL_FAILURE_RETRY_WINDOW_MS`, and indefinitely after
 * `BACKFILL_MAX_FAILURES` failures, unless a run passes `retryFailed`; such
 * stems are reported in `failed`, not `remaining`. Stems whose generation drafts
 * recorded `grounding: prompt_only` only because features were missing
 * (#1192) become feature-conditioned on their next generation.
 */
@Injectable()
export class StemFeatureBackfillService {
  private readonly logger = new Logger(StemFeatureBackfillService.name);

  constructor(
    private readonly storageProvider: StorageProvider,
    private readonly publisher: StemPubSubPublisher,
  ) {}

  /** Pending-stem filters shared by backfill and status. */
  private pendingFilters(
    requestedTypes: unknown,
    refresh = false,
    retryFailed = false,
  ) {
    const types = sanitizeTypes(requestedTypes);
    const cutoff = retryCutoff();
    // AnyNull: the column is nullable JSON, so match DB null and JSON null.
    const pendingWhere: Prisma.StemWhereInput = {
      audioFeatures: { equals: Prisma.AnyNull },
      isEncrypted: false,
    };
    const where: Prisma.StemWhereInput = types
      ? { ...pendingWhere, type: { in: types } }
      : pendingWhere;
    return { types, pendingWhere, where, refresh, retryFailed, cutoff };
  }

  /**
   * Query arguments selecting up to `limit` pending stems, fewest failures
   * first, then by id; stems held back after failures are excluded unless
   * `retryFailed` (#2012). With `refresh`, the ids come from a raw query (the
   * revision lives inside the JSON column) and the rows are then loaded by id.
   */
  private async pendingSelection(
    filters: ReturnType<StemFeatureBackfillService["pendingFilters"]>,
    limit: number,
  ): Promise<{
    where: Prisma.StemWhereInput;
    orderBy: Prisma.StemOrderByWithRelationInput[];
    take?: number;
  }> {
    const orderBy: Prisma.StemOrderByWithRelationInput[] = [
      { audioFeaturesFailureCount: "asc" },
      { id: "asc" },
    ];
    if (!filters.refresh) {
      return {
        where: filters.retryFailed
          ? filters.where
          : { AND: [filters.where, selectableWhere(filters.cutoff)] },
        orderBy,
        take: limit,
      };
    }
    const selectable = filters.retryFailed
      ? Prisma.empty
      : Prisma.sql` AND ${selectableSql(filters.cutoff)}`;
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Stem" WHERE ${refreshPredicate(filters.types)}${selectable} ORDER BY "audioFeaturesFailureCount" ASC, "id" ASC LIMIT ${limit}`,
    );
    return { where: { id: { in: rows.map((row) => row.id) } }, orderBy };
  }

  /**
   * Records a failure attributable to the stem (#2012; see
   * `STEM_FAILURE_REASONS`) so it is held back from the next default runs;
   * reset when features are written. Worker, transport and publisher
   * failures are never recorded.
   */
  private async recordFailures(stemIds: string[]): Promise<void> {
    if (stemIds.length === 0) return;
    await prisma.stem.updateMany({
      where: { id: { in: stemIds } },
      data: {
        audioFeaturesFailedAt: new Date(),
        audioFeaturesFailureCount: { increment: 1 },
      },
    });
  }

  private async countRemaining(
    filters: ReturnType<StemFeatureBackfillService["pendingFilters"]>,
  ): Promise<StemFeatureBackfillStatus> {
    if (filters.refresh) {
      const selectable = selectableSql(filters.cutoff);
      const [totalRows, groupedRows] = await Promise.all([
        prisma.$queryRaw<Array<{ remaining: bigint; failed: bigint }>>(
          Prisma.sql`SELECT COUNT(*) FILTER (WHERE ${selectable}) AS "remaining", COUNT(*) FILTER (WHERE NOT ${selectable}) AS "failed" FROM "Stem" WHERE ${refreshPredicate(filters.types)}`,
        ),
        prisma.$queryRaw<Array<{ type: string; count: bigint }>>(
          Prisma.sql`SELECT "type", COUNT(*) AS "count" FROM "Stem" WHERE ${refreshPredicate(null)} AND ${selectable} GROUP BY "type"`,
        ),
      ]);
      const remainingByType: Record<string, number> = {};
      for (const row of groupedRows) {
        remainingByType[row.type] = Number(row.count);
      }
      return {
        remaining: Number(totalRows[0]?.remaining ?? 0),
        failed: Number(totalRows[0]?.failed ?? 0),
        remainingByType,
      };
    }
    const selectable = selectableWhere(filters.cutoff);
    const [remaining, failed, grouped] = await Promise.all([
      prisma.stem.count({ where: { AND: [filters.where, selectable] } }),
      prisma.stem.count({ where: { AND: [filters.where, { NOT: selectable }] } }),
      prisma.stem.groupBy({
        by: ["type"],
        where: { AND: [filters.pendingWhere, selectable] },
        _count: { _all: true },
      }),
    ]);
    const remainingByType: Record<string, number> = {};
    for (const row of grouped) {
      remainingByType[row.type] = row._count._all;
    }
    return { remaining, failed, remainingByType };
  }

  /** Remaining stems lacking (or, with `refresh`, outdated) features; no worker calls. */
  async status(
    request: { types?: unknown; refresh?: unknown } = {},
  ): Promise<StemFeatureBackfillStatus> {
    return this.countRemaining(
      this.pendingFilters(request.types, request.refresh === true),
    );
  }

  async backfill(
    request: StemFeatureBackfillRequest = {},
  ): Promise<StemFeatureBackfillResult> {
    const workerBaseUrl = process.env.DEMUCS_WORKER_URL;
    if (workerBaseUrl) {
      return this.backfillViaHttp(request, workerBaseUrl);
    }
    if (this.publisher.isAvailable()) {
      return this.backfillViaPubSub(request);
    }

    // No localhost fallback (#2013): without a worker every stem would fail.
    const filters = this.pendingFilters(
      request.types,
      request.refresh === true,
      request.retryFailed === true,
    );
    const { types, refresh } = filters;
    const counts = await this.countRemaining(filters);
    this.logger.warn(
      `[backfill] worker_unavailable: neither DEMUCS_WORKER_URL nor the Pub/Sub publisher is available (types=${types ? types.join(",") : "all"}, refresh=${refresh}, remaining=${counts.remaining}, failed=${counts.failed})`,
    );
    return {
      scanned: 0,
      updated: 0,
      skipped: [],
      ...counts,
      transport: "none",
      status: "worker_unavailable",
      dispatched: 0,
    };
  }

  private async backfillViaPubSub(
    request: StemFeatureBackfillRequest,
  ): Promise<StemFeatureBackfillResult> {
    const limit = Math.min(
      PUBSUB_MAX_STEMS_PER_MESSAGE,
      Math.max(1, Math.floor(request.limit ?? 25)),
    );
    const filters = this.pendingFilters(
      request.types,
      request.refresh === true,
      request.retryFailed === true,
    );
    const { types, refresh } = filters;
    const stems = await prisma.stem.findMany({
      ...(await this.pendingSelection(filters, limit)),
      select: { id: true, uri: true, mimeType: true, storageProvider: true },
    });

    const backendBaseUrl =
      process.env.BACKEND_URL || "http://host.docker.internal:3000";
    const skipped: Array<{ stemId: string; reason: string }> = [];
    const dispatchable: Array<{
      stemId: string;
      uri: string;
      mimeType: string;
    }> = [];
    for (const stem of stems) {
      if (!stem.uri) {
        skipped.push({ stemId: stem.id, reason: "audio_unavailable" });
        continue;
      }
      // GCS stems may be stored bucket-relative (`/{bucket}/{object}`); the
      // generic mapping would prefix those with the backend URL, so resolve
      // them to the canonical storage URL the worker downloads directly.
      let uri: string;
      try {
        uri =
          (stem.storageProvider === "gcs"
            ? this.storageProvider.resolveFetchUri?.(stem.uri)
            : undefined) ??
          toWorkerFetchableUri(stem.uri, stem.storageProvider, backendBaseUrl);
      } catch (error) {
        this.logger.warn(
          `[backfill] unusable storage URI for stem ${stem.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        skipped.push({ stemId: stem.id, reason: "audio_unavailable" });
        continue;
      }
      dispatchable.push({
        stemId: stem.id,
        uri,
        mimeType: stem.mimeType || "audio/mpeg",
      });
    }

    await this.recordFailures(skipped.map((skip) => skip.stemId));

    let jobId: string | undefined;
    if (dispatchable.length > 0) {
      jobId = `analyze_${Date.now()}_${randomBytes(4).toString("hex")}`;
      try {
        await this.publisher.publishAnalysisJob({
          kind: "analyze",
          jobId,
          stems: dispatchable,
        });
      } catch (error) {
        this.logger.error(
          `[backfill] failed to dispatch analysis job ${jobId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    }

    const counts = await this.countRemaining(filters);
    this.logger.log(
      `[backfill] transport=pubsub scanned=${stems.length} dispatched=${dispatchable.length} skipped=${skipped.length} remaining=${counts.remaining} failed=${counts.failed} types=${types ? types.join(",") : "all"} refresh=${refresh}${jobId ? ` jobId=${jobId}` : ""}`,
    );
    return {
      scanned: stems.length,
      updated: 0,
      skipped,
      ...counts,
      transport: "pubsub",
      status: dispatchable.length > 0 ? "dispatched" : "ok",
      dispatched: dispatchable.length,
      ...(jobId ? { jobId } : {}),
    };
  }

  /**
   * Applies a worker's analysis result (#2013) through the same
   * sanitize/Camelot path as the HTTP backfill. Idempotent: a stem is written
   * only when it lacks features or its stored analysis revision is older than
   * the incoming one (#2016), so redelivery never overwrites or downgrades
   * measured data.
   */
  async applyAnalysisResults(
    message: StemAnalysisResultMessage,
  ): Promise<{ updated: number; failed: number; malformed: number }> {
    if (message.status === "failed") {
      this.logger.error(
        `[backfill] analysis job ${message.jobId} failed: ${message.error ?? "unknown error"}`,
      );
      return { updated: 0, failed: 0, malformed: 0 };
    }

    let updated = 0;
    let failed = 0;
    let malformed = 0;
    const failedIds: string[] = [];
    const results = Array.isArray(message.results) ? message.results : [];
    for (const raw of results) {
      if (!raw || typeof raw !== "object") continue;
      const result = raw as {
        stemId?: unknown;
        features?: unknown;
        error?: unknown;
      };
      if (typeof result.stemId !== "string" || !result.stemId) continue;
      const stemId = result.stemId;

      if (result.features == null) {
        failed++;
        failedIds.push(stemId);
        this.logger.warn(
          `[backfill] analysis failed for stem ${stemId} (job ${message.jobId}): ${
            typeof result.error === "string" ? result.error : "no features"
          }`,
        );
        continue;
      }

      const sanitized = sanitizeStemAudioFeatures(result.features);
      if (!sanitized) {
        malformed++;
        failedIds.push(stemId);
        this.logger.warn(
          `[backfill] malformed audio features for stem ${stemId} (job ${message.jobId})`,
        );
        continue;
      }

      // Compare-and-set in one statement so concurrent redeliveries cannot
      // overwrite a payload of the same or a newer revision.
      const written = await prisma.$executeRaw(
        Prisma.sql`UPDATE "Stem" SET "audioFeatures" = ${JSON.stringify(withCamelot(sanitized))}::jsonb, "audioFeaturesFailedAt" = NULL, "audioFeaturesFailureCount" = 0 WHERE "id" = ${stemId} AND ${needsMeasurementSql(stemAnalysisRevision(sanitized))}`,
      );
      updated += written;
    }
    await this.recordFailures(failedIds);

    this.logger.log(
      `[backfill] analysis job ${message.jobId} applied: results=${results.length} updated=${updated} failed=${failed} malformed=${malformed}`,
    );
    return { updated, failed, malformed };
  }

  private async backfillViaHttp(
    request: StemFeatureBackfillRequest,
    workerBaseUrl: string,
  ): Promise<StemFeatureBackfillResult> {
    const limit = Math.min(100, Math.max(1, Math.floor(request.limit ?? 25)));
    const filters = this.pendingFilters(
      request.types,
      request.refresh === true,
      request.retryFailed === true,
    );
    const { types, refresh } = filters;
    const stems = await prisma.stem.findMany({
      ...(await this.pendingSelection(filters, limit)),
      select: {
        id: true,
        uri: true,
        data: true,
        mimeType: true,
        storageProvider: true,
        type: true,
      },
    });

    let updated = 0;
    let attempted = 0;
    let stoppedEarly: "worker_unavailable" | undefined;
    const skipped: Array<{ stemId: string; reason: string }> = [];

    for (const stem of stems) {
      attempted++;
      try {
        const audio = await this.loadStemAudio(stem);
        if (!audio) {
          skipped.push({ stemId: stem.id, reason: "audio_unavailable" });
          continue;
        }

        const features = await this.analyze(workerBaseUrl, stem, audio);
        const sanitized = features ? sanitizeStemAudioFeatures(features) : null;
        if (!sanitized) {
          skipped.push({ stemId: stem.id, reason: "analysis_failed" });
          continue;
        }

        await prisma.stem.update({
          where: { id: stem.id },
          data: {
            audioFeatures: withCamelot(sanitized) as Prisma.InputJsonValue,
            audioFeaturesFailedAt: null,
            audioFeaturesFailureCount: 0,
          },
        });
        updated++;
      } catch (error) {
        // Not attributable to the stem (#2012): logged, the stem stays eligible.
        const workerDown = error instanceof WorkerUnavailableError;
        this.logger.warn(
          `Backfill ${workerDown ? "worker unavailable" : "failed"} for stem ${stem.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        skipped.push({
          stemId: stem.id,
          reason: workerDown ? "worker_unavailable" : "error",
        });
        if (workerDown) {
          // Circuit break: the rest of the batch would hit the same outage.
          stoppedEarly = "worker_unavailable";
          break;
        }
      }
    }
    if (stoppedEarly) {
      this.logger.warn(
        `[backfill] worker unavailable: stopped after ${attempted} of ${stems.length} stems; the rest stay pending`,
      );
    }

    await this.recordFailures(
      skipped
        .filter((skip) => STEM_FAILURE_REASONS.has(skip.reason))
        .map((skip) => skip.stemId),
    );

    const counts = await this.countRemaining(filters);
    this.logger.log(
      `[backfill] scanned=${attempted} updated=${updated} skipped=${skipped.length} remaining=${counts.remaining} failed=${counts.failed} types=${types ? types.join(",") : "all"} refresh=${refresh}${stoppedEarly ? ` stoppedEarly=${stoppedEarly}` : ""}`,
    );
    return {
      scanned: attempted,
      updated,
      skipped,
      ...counts,
      transport: "http",
      status: "ok",
      dispatched: 0,
      ...(stoppedEarly ? { stoppedEarly } : {}),
    };
  }

  private async analyze(
    workerBaseUrl: string,
    stem: { id: string; mimeType: string | null },
    audio: Buffer,
  ): Promise<unknown | null> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], {
        type: stem.mimeType ?? "audio/mpeg",
      }),
      `${stem.id}.audio`,
    );
    let response: Response;
    try {
      response = await fetch(`${workerBaseUrl}/analyze`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new WorkerUnavailableError(
        `request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      if (!STEM_REJECTION_STATUSES.has(response.status)) {
        throw new WorkerUnavailableError(`returned ${response.status}`);
      }
      this.logger.warn(
        `Worker /analyze rejected stem ${stem.id} with ${response.status}`,
      );
      return null;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WorkerUnavailableError("returned a non-JSON body");
    }
    return (body as { features?: unknown } | null)?.features ?? null;
  }

  /** Same fetch order as ingestion reads: DB bytes, local uploads, provider. */
  private async loadStemAudio(stem: {
    id: string;
    uri: string;
    data: Buffer | Uint8Array | null;
    storageProvider: string;
  }): Promise<Buffer | null> {
    if (stem.data && stem.data.length > 0) {
      return Buffer.from(stem.data);
    }
    if (stem.storageProvider === "local" && stem.uri) {
      const uploadsDir = join(process.cwd(), "uploads", "stems");
      const localPath = resolveContainedPath(uploadsDir, stem.uri);
      if (localPath && existsSync(localPath)) {
        return readFile(localPath);
      }
    }
    try {
      return await this.storageProvider.download(stem.uri);
    } catch (error) {
      this.logger.warn(
        `Storage download failed for stem ${stem.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
