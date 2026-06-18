import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import { promisify } from "util";
import { prisma } from "../../db/prisma";
import { StorageProvider } from "../storage/storage_provider";
import {
  RemixGenerationProviderError,
  type StemArrangementEntry,
} from "./remix-generation.provider";

const execFileAsync = promisify(execFile);

export const STEM_AUDIO_MIXER = "STEM_AUDIO_MIXER";

const FFMPEG_TIMEOUT_MS = 120_000;

// Re-exported for back-compat: the canonical definition lives in the provider
// boundary so RemixGenerationInput and the mixer share one type.
export type { StemArrangementEntry };

export type MixedStemAudio = {
  buffer: Buffer;
  mimeType: string;
  /** Number of unmuted stems that went into the mix. */
  stemCount: number;
};

/**
 * Mixes a project's unmuted stems into one audio buffer. Extracted from the
 * stem_mix renderer (#1189) so audio-conditioned generation (#1182 slice 4)
 * conditions on exactly what the user arranged, and the encrypted-stem
 * deferral + path-traversal containment live in one place.
 */
export interface StemAudioMixer {
  mixUnmutedStems(
    stems: StemArrangementEntry[],
    label: string,
  ): Promise<MixedStemAudio>;
}

/**
 * Pure arg construction (unit-tested without ffmpeg). Inputs are passed as an
 * execFile argument array — stem-derived values are never interpolated into a
 * shell string. Per-stem gain applies as an ffmpeg volume filter (dB), then
 * amix sums to the longest input without renormalizing each source down,
 * matching the studio's preview gain model.
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
export class FfmpegStemAudioMixer implements StemAudioMixer {
  private readonly logger = new Logger(FfmpegStemAudioMixer.name);

  constructor(private readonly storageProvider: StorageProvider) {}

  async mixUnmutedStems(
    stems: StemArrangementEntry[],
    label: string,
  ): Promise<MixedStemAudio> {
    const activeStems = stems.filter((stem) => !stem.muted);
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
      // exists (#1189) — shared by audio-conditioned generation (#1182).
      throw new RemixGenerationProviderError(
        "invalid_input",
        "Encrypted stems cannot be rendered yet.",
        false,
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), "remix-mix-"));
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
        this.logger.error(`ffmpeg mix failed for ${label}: ${message}`);
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "The stems could not be mixed. Please try again later.",
          true,
        );
      }
      this.logger.log(
        `[mix] ${label}: mixed ${ffmpegInputs.length} stems in ${Date.now() - started}ms`,
      );

      const buffer = await readFile(outputPath);
      return { buffer, mimeType: "audio/mpeg", stemCount: ffmpegInputs.length };
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
      // Containment check: Stem.uri is server-written, but the mixed output is
      // served back to the user, so a traversal-shaped uri must never read
      // outside the uploads dir into the mix.
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
