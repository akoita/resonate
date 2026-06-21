import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { prisma } from "../../db/prisma";
import {
  EncryptionService,
  RenderDecryptionError,
} from "../encryption/encryption.service";
import { StorageProvider } from "../storage/storage_provider";
import {
  RemixGenerationProviderError,
  type RemixRenderMetadata,
  type StemArrangementEntry,
  type StemRenderAuthorization,
} from "./remix-generation.provider";
import { normalizeRemixStemGainDb } from "./remix-gain";

const execFileAsync = promisify(execFile);

export const STEM_AUDIO_MIXER = "STEM_AUDIO_MIXER";

const FFMPEG_TIMEOUT_MS = 120_000;

/**
 * Product audio policy, not environment configuration. Identical saved
 * arrangements must render identically across environments; changing any
 * value requires a schema-version bump so old drafts remain auditable.
 */
export const REMIX_RENDER_AUDIO_POLICY = Object.freeze({
  schemaVersion: "remix-render-policy/v1",
  targetLufs: -14,
  loudnessRangeLufs: 11,
  truePeakDbtp: -1.5,
  outputCodec: "mp3" as const,
  outputMimeType: "audio/mpeg" as const,
  outputBitrateKbps: 320,
  outputSampleRateHz: 48_000,
  outputChannels: 2,
});

// Re-exported for back-compat: the canonical definition lives in the provider
// boundary so RemixGenerationInput and the mixer share one type.
export type { StemArrangementEntry };

export type MixedStemAudio = {
  buffer: Buffer;
  mimeType: string;
  /** Number of unmuted stems that went into the mix. */
  stemCount: number;
  renderMetadata: RemixRenderMetadata;
};

export type AudioBufferMixInput = {
  buffer: Buffer;
  mimeType: string;
  gainDb?: number | null;
  label: string;
};

export type MixedAudioBuffers = {
  buffer: Buffer;
  mimeType: string;
  inputCount: number;
  renderMetadata: RemixRenderMetadata;
};

/**
 * Mixes a project's unmuted stems into one audio buffer. Extracted from the
 * stem_mix renderer (#1189) so audio-conditioned generation (#1182 slice 4)
 * conditions on exactly what the user arranged, and the encrypted-stem
 * decrypt-for-render boundary (#1214) + path-traversal containment live in one
 * place.
 *
 * Every caller passes a {@link StemRenderAuthorization} the generation worker
 * built after re-verifying project ownership and current eligibility. Encrypted
 * source stems are decrypted in memory into the mixer's unique temp dir and
 * never persisted or returned individually.
 */
export interface StemAudioMixer {
  mixUnmutedStems(
    stems: StemArrangementEntry[],
    authorization: StemRenderAuthorization,
  ): Promise<MixedStemAudio>;
  mixUnmutedStemsWithAudioBuffers(
    stems: StemArrangementEntry[],
    inputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
  ): Promise<MixedAudioBuffers>;
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
    const gain = normalizeRemixStemGainDb(input.gainDb);
    return `[${index}:a]volume=${gain}dB[a${index}]`;
  });
  const mixInputs = inputs.map((_, index) => `[a${index}]`).join("");
  const policy = REMIX_RENDER_AUDIO_POLICY;
  const filter = `${labelled.join(";")};${mixInputs}amix=inputs=${inputs.length}:duration=longest:normalize=0[sum];[sum]loudnorm=I=${policy.targetLufs}:LRA=${policy.loudnessRangeLufs}:TP=${policy.truePeakDbtp}[mix]`;
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[mix]",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${policy.outputBitrateKbps}k`,
    "-ar",
    String(policy.outputSampleRateHz),
    "-ac",
    String(policy.outputChannels),
    outputPath,
  );
  return args;
}

function renderMetadata(
  inputCount: number,
  activeStemCount: number,
): RemixRenderMetadata {
  return {
    ...REMIX_RENDER_AUDIO_POLICY,
    inputCount,
    activeStemCount,
  };
}

@Injectable()
export class FfmpegStemAudioMixer implements StemAudioMixer {
  private readonly logger = new Logger(FfmpegStemAudioMixer.name);

  constructor(
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
  ) {}

  async mixUnmutedStems(
    stems: StemArrangementEntry[],
    authorization: StemRenderAuthorization,
  ): Promise<MixedStemAudio> {
    return this.mixStemArrangement(stems, [], authorization, true);
  }

  async mixUnmutedStemsWithAudioBuffers(
    stems: StemArrangementEntry[],
    inputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
  ): Promise<MixedAudioBuffers> {
    return this.mixStemArrangement(stems, inputs, authorization, false);
  }

  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: true,
  ): Promise<MixedStemAudio>;
  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: false,
  ): Promise<MixedAudioBuffers>;
  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: boolean,
  ): Promise<MixedStemAudio | MixedAudioBuffers> {
    const label = authorization.remixProjectId;
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
        isEncrypted: true,
        encryptionMetadata: true,
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

    const workDir = await mkdtemp(join(tmpdir(), "remix-mix-"));
    try {
      const ffmpegInputs: Array<{ path: string; gainDb: number }> = [];
      for (const stem of activeStems) {
        const row = rowsById.get(stem.stemId)!;
        const audio = await this.loadStemAudio(row, authorization);
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
      for (const input of additionalInputs) {
        const inputPath = join(
          workDir,
          `input-${ffmpegInputs.length}${extensionForMimeType(input.mimeType)}`,
        );
        await writeFile(inputPath, input.buffer);
        ffmpegInputs.push({ path: inputPath, gainDb: input.gainDb ?? 0 });
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
      const metadata = renderMetadata(ffmpegInputs.length, activeStems.length);
      return stemOnly
        ? {
            buffer,
            mimeType: REMIX_RENDER_AUDIO_POLICY.outputMimeType,
            stemCount: activeStems.length,
            renderMetadata: metadata,
          }
        : {
            buffer,
            mimeType: REMIX_RENDER_AUDIO_POLICY.outputMimeType,
            inputCount: ffmpegInputs.length,
            renderMetadata: metadata,
          };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Returns plaintext audio for one active stem (#1214).
   *
   * Stored bytes in fetch order: DB bytes, then the configured storage
   * provider. Local path containment belongs to LocalStorageProvider so local
   * and GCS/IPFS reads share one boundary instead of duplicating URI parsing.
   *
   * For `isEncrypted` rows the loaded bytes are ciphertext: they are decrypted
   * in memory through the strict render boundary only after the stem is
   * confirmed authorized for this render. We never return ciphertext as audio,
   * and never write plaintext anywhere except the caller's temp dir.
   */
  private async loadStemAudio(
    row: {
      id: string;
      uri: string;
      data: Buffer | Uint8Array | null;
      isEncrypted: boolean;
      encryptionMetadata: string | null;
    },
    authorization: StemRenderAuthorization,
  ): Promise<Buffer | null> {
    const raw = await this.loadStoredBytes(row);
    if (!raw) {
      return null;
    }
    if (!row.isEncrypted) {
      return raw;
    }

    // Defense in depth: only decrypt stems the worker re-confirmed as eligible
    // for this owned project. An encrypted stem outside that set must never be
    // decrypted, even though the arrangement comes from the owned project.
    if (!authorization.authorizedStemIds.has(row.id)) {
      this.logger.warn(
        `Refusing to decrypt unauthorized encrypted stem for project ${authorization.remixProjectId}`,
      );
      throw new RemixGenerationProviderError(
        "invalid_input",
        "A source stem is no longer authorized for this remix render.",
        false,
      );
    }

    const internalAuthSig = {
      // Sentinel + internal purpose: the AES provider grants access only when
      // INTERNAL_SERVICE_KEY matches (SBPR-004 / #1214). No user signature.
      address: "0x0000000000000000000000000000000000000000",
      sig: "remix-render-authorized",
      signedMessage: "Remix render decryption authorization",
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    };

    try {
      const plaintext = await this.encryptionService.decryptForRender(
        raw,
        row.encryptionMetadata ?? "",
        internalAuthSig,
      );
      if (!plaintext || plaintext.length === 0) {
        return null;
      }
      return plaintext;
    } catch (error) {
      throw this.mapDecryptError(error, row.id);
    }
  }

  private async loadStoredBytes(row: {
    id: string;
    uri: string;
    data: Buffer | Uint8Array | null;
  }): Promise<Buffer | null> {
    if (row.data && row.data.length > 0) {
      return Buffer.from(row.data);
    }
    try {
      const audio = await this.storageProvider.download(row.uri);
      return audio && audio.length > 0 ? audio : null;
    } catch {
      // Do not log provider messages: they can contain bucket names, local
      // paths, signed URLs, or other storage internals.
      this.logger.warn(`Storage download failed for stem ${row.id}`);
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        `Stored audio for stem ${row.id} could not be loaded. Please try again later.`,
        true,
      );
    }
  }

  /**
   * Translate strict render-decryption failures into safe provider errors.
   * The reason codes carry no secrets; the user-facing messages never name
   * keys, metadata, URIs, or provider internals.
   */
  private mapDecryptError(
    error: unknown,
    stemId: string,
  ): RemixGenerationProviderError {
    if (error instanceof RenderDecryptionError) {
      switch (error.reason) {
        case "unauthorized":
          return new RemixGenerationProviderError(
            "invalid_input",
            "A source stem is no longer authorized for this remix render.",
            false,
          );
        case "invalid_metadata":
          return new RemixGenerationProviderError(
            "invalid_input",
            `Source audio for stem ${stemId} could not be prepared for rendering.`,
            false,
          );
        case "encryption_disabled":
        case "decryption_failed":
        default:
          // Opaque + retryable: distinguishing a transient key/provider fault
          // from corrupt ciphertext here would leak internals.
          this.logger.warn(
            `Render decryption failed for stem ${stemId}: ${error.reason}`,
          );
          return new RemixGenerationProviderError(
            "provider_unavailable",
            `Source audio for stem ${stemId} could not be prepared for rendering. Please try again later.`,
            true,
          );
      }
    }
    if (error instanceof RemixGenerationProviderError) {
      return error;
    }
    this.logger.warn(`Unexpected render decryption error for stem ${stemId}`);
    return new RemixGenerationProviderError(
      "provider_unavailable",
      `Source audio for stem ${stemId} could not be prepared for rendering. Please try again later.`,
      true,
    );
  }
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/mpeg" || normalized === "audio/mp3") return ".mp3";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "audio/flac") return ".flac";
  return ".audio";
}
