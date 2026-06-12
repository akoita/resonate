import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import { promisify } from "util";
import { prisma } from "../../db/prisma";
import { StorageProvider } from "../storage/storage_provider";
import {
  RemixGenerationProviderError,
  type RemixGenerationJob,
} from "./remix-generation.provider";

const execFileAsync = promisify(execFile);

export const REMIX_STEM_MIX_RENDERER = "REMIX_STEM_MIX_RENDERER";

export type StemMixRenderInput = {
  remixProjectId: string;
  stems: Array<{ stemId: string; gainDb: number | null; muted: boolean }>;
};

/**
 * Renders a stem_mix project's arranged stems into one draft file (#1189,
 * slice 2 of #1182). Pure DSP — no AI, no vendor cost — so it sits outside
 * the REMIX_GENERATION_ENABLED master gate, which exists to gate paid
 * generation. The output literally contains the licensed stem audio.
 */
export interface StemMixRenderer {
  render(input: StemMixRenderInput): Promise<RemixGenerationJob>;
}

const FFMPEG_TIMEOUT_MS = 120_000;

/**
 * Pure arg construction (unit-tested without ffmpeg). Inputs are passed as
 * an execFile argument array — stem-derived values are never interpolated
 * into a shell string. Per-stem gain applies as an ffmpeg volume filter
 * (dB), then amix sums to the longest input without renormalizing each
 * source down, matching the studio's preview gain model.
 */
export function buildStemMixFfmpegArgs(
  inputs: Array<{ path: string; gainDb: number }>,
  outputPath: string,
): string[] {
  if (inputs.length === 0) {
    throw new RemixGenerationProviderError(
      "invalid_input",
      "A stem mix render needs at least one unmuted stem.",
      false,
    );
  }
  // -loglevel error keeps execFile's stderr buffer tiny on long renders.
  const args: string[] = ["-y", "-nostdin", "-hide_banner", "-loglevel", "error"];
  for (const input of inputs) {
    args.push("-i", input.path);
  }
  const labelled = inputs.map((input, index) => {
    const gain = Number.isFinite(input.gainDb) ? input.gainDb : 0;
    return `[${index}:a]volume=${gain}dB[a${index}]`;
  });
  const mixInputs = inputs.map((_, index) => `[a${index}]`).join("");
  const filter = `${labelled.join(";")};${mixInputs}amix=inputs=${inputs.length}:duration=longest:normalize=0[mix]`;
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[mix]",
    "-b:a",
    "320k",
    outputPath,
  );
  return args;
}

@Injectable()
export class FfmpegStemMixRenderer implements StemMixRenderer {
  private readonly logger = new Logger(FfmpegStemMixRenderer.name);

  constructor(private readonly storageProvider: StorageProvider) {}

  async render(input: StemMixRenderInput): Promise<RemixGenerationJob> {
    const activeStems = input.stems.filter((stem) => !stem.muted);
    if (activeStems.length === 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        "All stems are muted; unmute at least one stem to render a mix.",
        false,
      );
    }

    const stemRows = await prisma.stem.findMany({
      where: { id: { in: activeStems.map((stem) => stem.stemId) } },
      select: {
        id: true,
        uri: true,
        data: true,
        mimeType: true,
        isEncrypted: true,
        storageProvider: true,
      },
    });
    const rowsById = new Map(stemRows.map((row) => [row.id, row]));
    const missing = activeStems.filter((stem) => !rowsById.has(stem.stemId));
    if (missing.length > 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        `Stems not found: ${missing.map((stem) => stem.stemId).join(", ")}`,
        false,
      );
    }
    const encrypted = stemRows.filter((row) => row.isEncrypted);
    if (encrypted.length > 0) {
      // Honest deferral: feeding ciphertext to ffmpeg would "succeed" into
      // noise or fail confusingly. Lifted when a server-side decrypt path
      // for render exists (#1189).
      throw new RemixGenerationProviderError(
        "invalid_input",
        "Encrypted stems cannot be rendered yet.",
        false,
      );
    }

    const jobId = randomUUID();
    const workDir = await mkdtemp(join(tmpdir(), "remix-render-"));
    try {
      const ffmpegInputs: Array<{ path: string; gainDb: number }> = [];
      for (const stem of activeStems) {
        const row = rowsById.get(stem.stemId)!;
        const audio = await this.loadStemAudio(row);
        if (!audio) {
          throw new RemixGenerationProviderError(
            "invalid_input",
            `Audio for stem ${stem.stemId} is unavailable.`,
            false,
          );
        }
        const inputPath = join(workDir, `stem-${ffmpegInputs.length}.audio`);
        await writeFile(inputPath, audio);
        ffmpegInputs.push({ path: inputPath, gainDb: stem.gainDb ?? 0 });
      }

      const outputPath = join(workDir, "mix.mp3");
      const args = buildStemMixFfmpegArgs(ffmpegInputs, outputPath);
      const started = Date.now();
      try {
        await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `ffmpeg render failed for project ${input.remixProjectId}: ${message}`,
        );
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "The stem mix could not be rendered. Please try again later.",
          true,
        );
      }
      this.logger.log(
        `[render] project ${input.remixProjectId}: mixed ${ffmpegInputs.length} stems in ${Date.now() - started}ms`,
      );

      const output = await readFile(outputPath);
      // Flat object name (#1162 review precedent): the local storage
      // provider cannot create subdirectories.
      const filename = `remix-draft-${input.remixProjectId}-${jobId}.mp3`;
      const stored = await this.storageProvider.upload(
        output,
        filename,
        "audio/mpeg",
      );

      return {
        jobId,
        provider: "stem-mix-render",
        estimatedCostUsd: 0,
        outputMetadata: {
          outputUri: stored.uri,
          mimeType: "audio/mpeg",
          synthIdPresent: false,
          seed: null,
          sampleRate: null,
        },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Stored bytes in fetch order mirroring the catalog blob path: DB bytes,
   * local uploads directory, then the storage provider.
   */
  private async loadStemAudio(row: {
    id: string;
    uri: string;
    data: Buffer | Uint8Array | null;
    storageProvider: string;
  }): Promise<Buffer | null> {
    if (row.data && row.data.length > 0) {
      return Buffer.from(row.data);
    }
    if (row.storageProvider === "local" && row.uri) {
      // Containment check: Stem.uri is server-written, but the rendered
      // output is served back to the user, so a traversal-shaped uri must
      // never read outside the uploads dir into the mix.
      const uploadsDir = resolve(process.cwd(), "uploads", "stems");
      const localPath = resolve(uploadsDir, row.uri);
      if (localPath.startsWith(uploadsDir + sep) && existsSync(localPath)) {
        return readFile(localPath);
      }
    }
    try {
      return await this.storageProvider.download(row.uri);
    } catch (error) {
      this.logger.warn(
        `Storage download failed for stem ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
