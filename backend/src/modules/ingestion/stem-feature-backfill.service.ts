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
   * Unprocessed stems still lacking features after this run. On the `pubsub`
   * transport this still counts stems that are in flight (dispatched but not
   * yet written back), so re-poll it until it stops decreasing.
   */
  remaining: number;
  /** Stems still lacking features per type, across ALL types (ignores `types`). */
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
};

export type StemFeatureBackfillStatus = Pick<
  StemFeatureBackfillResult,
  "remaining" | "remainingByType"
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
 * batch-bounded: run it repeatedly until `remaining` reaches 0. Stems whose generation drafts
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
  private pendingFilters(requestedTypes: unknown, refresh = false) {
    const types = sanitizeTypes(requestedTypes);
    // AnyNull: the column is nullable JSON, so match DB null and JSON null.
    const pendingWhere: Prisma.StemWhereInput = {
      audioFeatures: { equals: Prisma.AnyNull },
      isEncrypted: false,
    };
    const where: Prisma.StemWhereInput = types
      ? { ...pendingWhere, type: { in: types } }
      : pendingWhere;
    return { types, pendingWhere, where, refresh };
  }

  /**
   * Query arguments selecting up to `limit` pending stems ordered by id. With
   * `refresh`, the ids come from a raw query (the revision lives inside the
   * JSON column) and the rows are then loaded by id.
   */
  private async pendingSelection(
    filters: ReturnType<StemFeatureBackfillService["pendingFilters"]>,
    limit: number,
  ): Promise<{
    where: Prisma.StemWhereInput;
    orderBy: { id: "asc" };
    take?: number;
  }> {
    if (!filters.refresh) {
      return { where: filters.where, orderBy: { id: "asc" }, take: limit };
    }
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Stem" WHERE ${refreshPredicate(filters.types)} ORDER BY "id" ASC LIMIT ${limit}`,
    );
    return { where: { id: { in: rows.map((row) => row.id) } }, orderBy: { id: "asc" } };
  }

  private async countRemaining(
    filters: ReturnType<StemFeatureBackfillService["pendingFilters"]>,
  ): Promise<StemFeatureBackfillStatus> {
    if (filters.refresh) {
      const [totalRows, groupedRows] = await Promise.all([
        prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT COUNT(*) AS "count" FROM "Stem" WHERE ${refreshPredicate(filters.types)}`,
        ),
        prisma.$queryRaw<Array<{ type: string; count: bigint }>>(
          Prisma.sql`SELECT "type", COUNT(*) AS "count" FROM "Stem" WHERE ${refreshPredicate(null)} GROUP BY "type"`,
        ),
      ]);
      const remainingByType: Record<string, number> = {};
      for (const row of groupedRows) {
        remainingByType[row.type] = Number(row.count);
      }
      return { remaining: Number(totalRows[0]?.count ?? 0), remainingByType };
    }
    const remaining = await prisma.stem.count({ where: filters.where });
    const grouped = await prisma.stem.groupBy({
      by: ["type"],
      where: filters.pendingWhere,
      _count: { _all: true },
    });
    const remainingByType: Record<string, number> = {};
    for (const row of grouped) {
      remainingByType[row.type] = row._count._all;
    }
    return { remaining, remainingByType };
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
    const filters = this.pendingFilters(request.types, request.refresh === true);
    const { types, refresh } = filters;
    const counts = await this.countRemaining(filters);
    this.logger.warn(
      `[backfill] worker_unavailable: neither DEMUCS_WORKER_URL nor the Pub/Sub publisher is available (types=${types ? types.join(",") : "all"}, refresh=${refresh}, remaining=${counts.remaining})`,
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
    const filters = this.pendingFilters(request.types, request.refresh === true);
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
      `[backfill] transport=pubsub scanned=${stems.length} dispatched=${dispatchable.length} skipped=${skipped.length} remaining=${counts.remaining} types=${types ? types.join(",") : "all"} refresh=${refresh}${jobId ? ` jobId=${jobId}` : ""}`,
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
        this.logger.warn(
          `[backfill] malformed audio features for stem ${stemId} (job ${message.jobId})`,
        );
        continue;
      }

      // Compare-and-set in one statement so concurrent redeliveries cannot
      // overwrite a payload of the same or a newer revision.
      const written = await prisma.$executeRaw(
        Prisma.sql`UPDATE "Stem" SET "audioFeatures" = ${JSON.stringify(withCamelot(sanitized))}::jsonb WHERE "id" = ${stemId} AND ${needsMeasurementSql(stemAnalysisRevision(sanitized))}`,
      );
      updated += written;
    }

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
    const filters = this.pendingFilters(request.types, request.refresh === true);
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
    const skipped: Array<{ stemId: string; reason: string }> = [];

    for (const stem of stems) {
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
          },
        });
        updated++;
      } catch (error) {
        this.logger.warn(
          `Backfill failed for stem ${stem.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        skipped.push({ stemId: stem.id, reason: "error" });
      }
    }

    const counts = await this.countRemaining(filters);
    this.logger.log(
      `[backfill] scanned=${stems.length} updated=${updated} skipped=${skipped.length} remaining=${counts.remaining} types=${types ? types.join(",") : "all"} refresh=${refresh}`,
    );
    return {
      scanned: stems.length,
      updated,
      skipped,
      ...counts,
      transport: "http",
      status: "ok",
      dispatched: 0,
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
    const response = await fetch(`${workerBaseUrl}/analyze`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      this.logger.warn(
        `Worker /analyze returned ${response.status} for stem ${stem.id}`,
      );
      return null;
    }
    const body = (await response.json()) as { features?: unknown };
    return body.features ?? null;
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
