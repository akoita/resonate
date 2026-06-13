import { Injectable, Logger } from "@nestjs/common";
import { join } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { StorageProvider } from "../storage/storage_provider";
import { resolveContainedPath } from "../storage/path_containment";
import { sanitizeStemAudioFeatures } from "./stem-audio-features";

export type StemFeatureBackfillRequest = {
  /** Stems analyzed per run; 1–100, default 25. Re-run until remaining=0. */
  limit?: number;
};

export type StemFeatureBackfillResult = {
  scanned: number;
  updated: number;
  skipped: Array<{ stemId: string; reason: string }>;
  /** Unprocessed stems still lacking features after this run. */
  remaining: number;
};

/**
 * Backfills `Stem.audioFeatures` (#1184) for stems ingested before feature
 * extraction shipped, by sending their audio to the demucs worker's
 * `POST /analyze` endpoint. Admin-triggered and batch-bounded: run it
 * repeatedly until `remaining` reaches 0. Stems whose generation drafts
 * recorded `grounding: prompt_only` only because features were missing
 * (#1192) become feature-conditioned on their next generation.
 */
@Injectable()
export class StemFeatureBackfillService {
  private readonly logger = new Logger(StemFeatureBackfillService.name);

  constructor(private readonly storageProvider: StorageProvider) {}

  async backfill(
    request: StemFeatureBackfillRequest = {},
  ): Promise<StemFeatureBackfillResult> {
    const limit = Math.min(100, Math.max(1, Math.floor(request.limit ?? 25)));
    const workerBaseUrl =
      process.env.DEMUCS_WORKER_URL || "http://localhost:8000";

    // AnyNull: the column is nullable JSON, so match DB null and JSON null.
    const where: Prisma.StemWhereInput = {
      audioFeatures: { equals: Prisma.AnyNull },
      isEncrypted: false,
    };
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
          data: { audioFeatures: sanitized as Prisma.InputJsonValue },
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

    const remaining = await prisma.stem.count({ where });
    this.logger.log(
      `[backfill] scanned=${stems.length} updated=${updated} skipped=${skipped.length} remaining=${remaining}`,
    );
    return { scanned: stems.length, updated, skipped, remaining };
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
