import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import type { Response } from "express";
import { prisma } from "../../db/prisma";
import { shouldRunBackgroundLoop } from "../../config/runtime_mode";
import { StorageProvider } from "../storage/storage_provider";
import { capRangeHeader } from "../storage/byte_range";
import { MP3_MIME_TYPE, stemFileExtension } from "../shared/stem-media";
import { aiGeneratedTagsFor } from "../remix/remix-watermark";
import { CatalogService } from "./catalog.service";

/**
 * Streaming renditions (#2661).
 *
 * Listeners receive a lossy copy made for streaming, never the uploaded file.
 * The original stays the archive copy (`Stem.uri`); the rendition lives under
 * the `renditions` storage prefix (`Stem.streamUri`). A sweep creates missing
 * renditions for new uploads and backfills the existing catalog; public stream
 * and preview routes answer "not ready" until one exists.
 *
 * Official stems (#1976) are excluded: their public preview is already a
 * bounded lossy transcode, and buyers download them through entitlements.
 *
 * The encode drops the archive's tags (they can hold uploader details), so a
 * rendition of a track disclosed as AI-generated or AI-assisted gets the
 * machine-readable AI tags written again from the track's disclosure. The
 * inaudible remix mark is in the audio itself and survives the encode.
 */

const execFileAsync = promisify(execFile);

export const STREAM_RENDITION_BITRATE_KBPS = 192;
/** Upper bound of one proxied read, so memory does not grow with file size. */
export const STREAM_CHUNK_BYTES = 1024 * 1024;
/** After this many failures a stem leaves the sweep until an operator retries. */
export const STREAM_RENDITION_MAX_FAILURES = 3;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_SWEEP_BATCH = 4;
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

/** Response headers for audio that is proxied to one listener. */
export const STREAM_CACHE_CONTROL = "private, max-age=3600";

export const RENDITION_NOT_READY = {
  statusCode: 503,
  code: "rendition_not_ready",
  message: "This audio is still being prepared for streaming. Try again shortly.",
} as const;

/** Stems that get a rendition: current and not an official (lossless, paid) stem. */
export const RENDITION_ELIGIBLE_WHERE = {
  isCurrent: true,
  OR: [{ source: null }, { source: "separated" as const }],
};

const FULL_MIX_TYPES = ["original", "master"] as const;

const AI_DISCLOSED_LEVELS = ["PARTLY", "ALL"] as const;

/**
 * A rendition that carries the AI tags is stored under a name ending in this
 * suffix, so the sweep can tell which renditions still lack them.
 */
export const AI_TAGGED_RENDITION_SUFFIX = ".ai.mp3";

/**
 * Stems of a track disclosed as AI whose rendition lacks the AI tags: made
 * before the tags existed, or before the track's disclosure changed to AI.
 */
const RENDITION_NEEDS_AI_TAGS_WHERE = {
  streamUri: { not: null },
  NOT: { streamUri: { endsWith: AI_TAGGED_RENDITION_SUFFIX } },
  track: { aiDisclosureLevel: { in: [...AI_DISCLOSED_LEVELS] } },
};

/** Eligible stems the sweep still has to (re)make a rendition for. */
const RENDITION_PENDING_WHERE = {
  AND: [
    RENDITION_ELIGIBLE_WHERE,
    { streamFailureCount: { lt: STREAM_RENDITION_MAX_FAILURES } },
    { OR: [{ streamUri: null }, RENDITION_NEEDS_AI_TAGS_WHERE] },
  ],
};

export type RenditionSweepResult = { processed: number; failed: number; remaining: number };

export type StreamableStem = {
  id: string;
  streamUri: string | null;
  streamMimeType: string | null;
};

@Injectable()
export class StreamRenditionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamRenditionService.name);
  private interval: NodeJS.Timeout | null = null;
  private sweepInFlight: Promise<RenditionSweepResult> | null = null;

  constructor(
    private readonly catalogService: CatalogService,
    private readonly storageProvider: StorageProvider,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    if (!shouldRunBackgroundLoop("streamRenditionSweep", this.logger)) return;
    const intervalMs = positiveInt(process.env.STREAM_RENDITION_SWEEP_INTERVAL_MS, DEFAULT_SWEEP_INTERVAL_MS);
    this.interval = setInterval(() => {
      void this.runSweep().catch((err) => this.logger.error(`Rendition sweep failed: ${err}`));
    }, intervalMs);
    this.interval.unref?.();
    void this.runSweep().catch((err) => this.logger.error(`Rendition sweep failed: ${err}`));
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Number of eligible stems that still need a rendition (and can still get one). */
  remaining(): Promise<number> {
    return prisma.stem.count({ where: RENDITION_PENDING_WHERE });
  }

  /**
   * Creates renditions for up to `limit` stems that lack one. Resumable: each
   * stem is committed on its own, so an interrupted run picks up where it
   * stopped. Concurrent callers share one run.
   */
  runSweep(limit = positiveInt(process.env.STREAM_RENDITION_SWEEP_BATCH, DEFAULT_SWEEP_BATCH)): Promise<RenditionSweepResult> {
    if (!this.sweepInFlight) {
      this.sweepInFlight = this.sweep(limit).finally(() => {
        this.sweepInFlight = null;
      });
    }
    return this.sweepInFlight;
  }

  private async sweep(limit: number): Promise<RenditionSweepResult> {
    const take = Math.max(1, Math.min(limit, 50));
    const pending = RENDITION_PENDING_WHERE;
    // Full mixes first: they are what the player streams.
    const mixes = await prisma.stem.findMany({
      where: { ...pending, type: { in: [...FULL_MIX_TYPES] } },
      orderBy: { id: "asc" },
      select: { id: true },
      take,
    });
    const stems =
      mixes.length >= take
        ? mixes
        : mixes.concat(
            await prisma.stem.findMany({
              where: { ...pending, type: { notIn: [...FULL_MIX_TYPES] } },
              orderBy: { id: "asc" },
              select: { id: true },
              take: take - mixes.length,
            }),
          );
    let processed = 0;
    let failed = 0;
    for (const stem of stems) {
      if (await this.createRendition(stem.id)) processed += 1;
      else failed += 1;
    }
    return { processed, failed, remaining: await this.remaining() };
  }

  /** Transcodes one stem and records its rendition. Returns false on failure. */
  async createRendition(stemId: string): Promise<boolean> {
    try {
      const archive = await this.catalogService.loadStemArchiveAudio(stemId);
      if (!archive) throw new Error("archive audio not found");
      const stem = await prisma.stem.findUnique({
        where: { id: stemId },
        select: { streamUri: true, track: { select: { aiDisclosureLevel: true } } },
      });
      const tags = aiGeneratedTagsFor(stem?.track?.aiDisclosureLevel);
      const rendition = await this.transcode(archive.data, archive.mimeType, tags);
      const filename = `rendition-${stemId}${tags.length > 0 ? AI_TAGGED_RENDITION_SUFFIX : ".mp3"}`;
      const stored = await this.storageProvider.upload(rendition, filename, MP3_MIME_TYPE, {
        prefix: "renditions",
      });
      await prisma.stem.update({
        where: { id: stemId },
        data: {
          streamUri: stored.uri,
          streamStorageProvider: stored.provider,
          streamMimeType: MP3_MIME_TYPE,
          streamCreatedAt: new Date(),
          streamFailedAt: null,
          streamFailureCount: 0,
        },
      });
      // A rendition made again under a new name leaves the old object behind.
      if (stem?.streamUri && stem.streamUri !== stored.uri) {
        await this.storageProvider.delete(stem.streamUri).catch((err) => {
          this.logger.warn(`Could not delete the replaced rendition of stem ${stemId}: ${err}`);
        });
      }
      return true;
    } catch (err) {
      this.logger.warn(`Rendition for stem ${stemId} failed: ${err instanceof Error ? err.message : err}`);
      await prisma.stem
        .update({
          where: { id: stemId },
          data: { streamFailedAt: new Date(), streamFailureCount: { increment: 1 } },
        })
        .catch(() => undefined);
      return false;
    }
  }

  /** Seam for tests; production always uses ffmpeg. */
  protected transcode(data: Buffer, mimeType: string, tags: string[] = []): Promise<Buffer> {
    return transcodeForStreaming(data, mimeType, tags);
  }

  /**
   * Sends a rendition to the listener, one bounded range read at a time. A
   * request without a Range header is answered 200 by streaming chunk after
   * chunk; a ranged request is answered 206 with at most one chunk.
   */
  async sendRendition(stem: StreamableStem, rangeHeader: string | undefined, res: Response): Promise<void> {
    if (!stem.streamUri) {
      res.status(503).set({ "Retry-After": "30", "Cache-Control": "no-store" }).json(RENDITION_NOT_READY);
      return;
    }
    const mimeType = stem.streamMimeType || MP3_MIME_TYPE;
    const forwarded = capRangeHeader(rangeHeader, STREAM_CHUNK_BYTES);
    if (!forwarded) {
      res.status(416).set({ "Cache-Control": "no-store" }).end();
      return;
    }
    const first = await this.storageProvider.downloadRange(stem.streamUri, forwarded);
    if (!first) {
      // A Range past the end of the object, or a storage read failure.
      res.status(rangeHeader ? 416 : 502).set({ "Cache-Control": "no-store" }).end();
      return;
    }

    if (rangeHeader) {
      res.status(206).set({
        "Content-Range": `bytes ${first.start}-${first.end}/${first.total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(first.data.length),
        "Content-Type": mimeType,
        "Cache-Control": STREAM_CACHE_CONTROL,
      });
      res.end(first.data);
      return;
    }

    res.status(200).set({
      "Accept-Ranges": "bytes",
      "Content-Length": String(first.total),
      "Content-Type": mimeType,
      "Cache-Control": STREAM_CACHE_CONTROL,
    });
    await writeChunk(res, first.data);
    let next = first.end + 1;
    while (next < first.total && !res.destroyed) {
      const end = Math.min(first.total - 1, next + STREAM_CHUNK_BYTES - 1);
      const chunk = await this.storageProvider.downloadRange(stem.streamUri, `bytes=${next}-${end}`);
      if (!chunk || chunk.data.length === 0) {
        res.destroy(new Error("rendition read failed mid-stream"));
        return;
      }
      await writeChunk(res, chunk.data);
      next = chunk.end + 1;
    }
    res.end();
  }
}

function writeChunk(res: Response, data: Buffer): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(data)) resolve();
    else res.once("drain", () => resolve());
  });
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * MP3 at the streaming bitrate, written to and read from a temp directory.
 * `tags` are ffmpeg `-metadata` arguments written after the archive's own
 * tags are dropped (the AI tags of `aiGeneratedTagsFor`).
 */
export async function transcodeForStreaming(
  data: Buffer,
  mimeType: string | null | undefined,
  tags: string[] = [],
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "resonate-rendition-"));
  try {
    const input = join(directory, `input.${stemFileExtension(mimeType)}`);
    const output = join(directory, "rendition.mp3");
    await writeFile(input, data);
    await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-nostdin",
        "-y",
        "-i", input,
        "-vn",
        "-map_metadata", "-1",
        ...tags,
        "-codec:a", "libmp3lame",
        "-b:a", `${STREAM_RENDITION_BITRATE_KBPS}k`,
        "-f", "mp3",
        output,
      ],
      { timeout: FFMPEG_TIMEOUT_MS },
    );
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
