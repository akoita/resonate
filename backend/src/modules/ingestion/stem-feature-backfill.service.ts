import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { join } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { StorageProvider } from "../storage/storage_provider";
import { resolveContainedPath } from "../storage/path_containment";
import { sanitizeStemAudioFeatures, withCamelot } from "./stem-audio-features";
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
  private pendingFilters(requestedTypes: unknown) {
    const types = sanitizeTypes(requestedTypes);
    // AnyNull: the column is nullable JSON, so match DB null and JSON null.
    const pendingWhere: Prisma.StemWhereInput = {
      audioFeatures: { equals: Prisma.AnyNull },
      isEncrypted: false,
    };
    const where: Prisma.StemWhereInput = types
      ? { ...pendingWhere, type: { in: types } }
      : pendingWhere;
    return { types, pendingWhere, where };
  }

  private async countRemaining(
    where: Prisma.StemWhereInput,
    pendingWhere: Prisma.StemWhereInput,
  ): Promise<StemFeatureBackfillStatus> {
    const remaining = await prisma.stem.count({ where });
    const grouped = await prisma.stem.groupBy({
      by: ["type"],
      where: pendingWhere,
      _count: { _all: true },
    });
    const remainingByType: Record<string, number> = {};
    for (const row of grouped) {
      remainingByType[row.type] = row._count._all;
    }
    return { remaining, remainingByType };
  }

  /** Remaining stems lacking features; no worker calls. */
  async status(
    request: { types?: unknown } = {},
  ): Promise<StemFeatureBackfillStatus> {
    const { where, pendingWhere } = this.pendingFilters(request.types);
    return this.countRemaining(where, pendingWhere);
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
    const { types, where, pendingWhere } = this.pendingFilters(request.types);
    const counts = await this.countRemaining(where, pendingWhere);
    this.logger.warn(
      `[backfill] worker_unavailable: neither DEMUCS_WORKER_URL nor the Pub/Sub publisher is available (types=${types ? types.join(",") : "all"}, remaining=${counts.remaining})`,
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
    const { types, where, pendingWhere } = this.pendingFilters(request.types);
    const stems = await prisma.stem.findMany({
      where,
      select: { id: true, uri: true, mimeType: true, storageProvider: true },
      orderBy: { id: "asc" },
      take: limit,
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
      dispatchable.push({
        stemId: stem.id,
        uri: toWorkerFetchableUri(stem.uri, stem.storageProvider, backendBaseUrl),
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

    const counts = await this.countRemaining(where, pendingWhere);
    this.logger.log(
      `[backfill] transport=pubsub scanned=${stems.length} dispatched=${dispatchable.length} skipped=${skipped.length} remaining=${counts.remaining} types=${types ? types.join(",") : "all"}${jobId ? ` jobId=${jobId}` : ""}`,
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
   * sanitize/Camelot path as the HTTP backfill. Idempotent: only stems still
   * lacking features are written, so redelivery never overwrites measured data.
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

      const written = await prisma.stem.updateMany({
        where: { id: stemId, audioFeatures: { equals: Prisma.AnyNull } },
        data: {
          audioFeatures: withCamelot(sanitized) as Prisma.InputJsonValue,
        },
      });
      updated += written.count;
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
    const { types, where, pendingWhere } = this.pendingFilters(request.types);
    const stems = await prisma.stem.findMany({
      where,
      select: {
        id: true,
        uri: true,
        data: true,
        mimeType: true,
        storageProvider: true,
        type: true,
      },
      orderBy: { id: "asc" },
      take: limit,
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

    const counts = await this.countRemaining(where, pendingWhere);
    this.logger.log(
      `[backfill] scanned=${stems.length} updated=${updated} skipped=${skipped.length} remaining=${counts.remaining} types=${types ? types.join(",") : "all"}`,
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
