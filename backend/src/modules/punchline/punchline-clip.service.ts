import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import { PUNCHLINE_SOURCE_STEM_TYPE } from "./punchline-rights";
import {
  PUNCHLINE_CLIP_AUDIO_POLICY,
  PUNCHLINE_CLIP_SOURCE_TOLERANCE_MS,
  resolvePunchlineClipBounds,
} from "./punchline-clip.config";

const execFileAsync = promisify(execFile);

export const PUNCHLINE_CLIP_SERVICE = "PUNCHLINE_CLIP_SERVICE";

// Trimming + re-encoding a <=15s clip is quick; keep a bounded timeout so a
// wedged ffmpeg can never hang the request. Mirrors the mixer's guard shape.
const FFMPEG_TIMEOUT_MS = 60_000;

/** Stable machine codes callers (and #482) can branch on. */
export type PunchlineClipErrorCode =
  | "invalid_range"
  | "clip_too_short"
  | "clip_too_long"
  | "no_vocals_stem"
  | "source_asset_missing"
  | "range_exceeds_source"
  | "extraction_failed";

/**
 * Typed failure for clip extraction. Extends BadRequestException so that when a
 * controller later exposes this service (#482) an unhandled throw surfaces as
 * HTTP 400 with the stable `code`, rather than a 500. `extraction_failed` is
 * still a 400 by default because the common cause is an unusable source range;
 * genuinely transient ffmpeg/storage faults are logged with detail server-side.
 */
export class PunchlineClipException extends BadRequestException {
  constructor(
    public readonly code: PunchlineClipErrorCode,
    message: string,
  ) {
    super({ code, message });
    this.name = "PunchlineClipException";
  }
}

export type PunchlineClipInput = {
  trackId: string;
  startMs: number;
  endMs: number;
};

/**
 * Stable descriptor for an extracted clip asset. #482 persists `clipAssetUri`
 * onto the PunchlineMoment; the rest is provenance for auditing/debugging.
 */
export type PunchlineClipResult = {
  clipAssetUri: string;
  storageProvider: string;
  sourceStemId: string;
  sourceStemType: typeof PUNCHLINE_SOURCE_STEM_TYPE;
  startMs: number;
  endMs: number;
  durationMs: number;
  byteSize: number;
  mimeType: typeof PUNCHLINE_CLIP_AUDIO_POLICY.outputMimeType;
};

/**
 * Extracts a short MP3 clip from a track's `vocals` stem (#481).
 *
 * This is the media primitive behind Punchline Drops: given a validated
 * [startMs, endMs) range it trims + re-encodes the vocal stem into a stored
 * clip asset and returns a descriptor. It intentionally does NOT touch the DB
 * (no PunchlineMoment write) and does NOT run the rights/eligibility gate —
 * both belong to the mutation boundary in #482. It reuses the remix mixer's
 * source-load + decrypt-for-render boundary so encrypted vocal stems are
 * handled identically and ciphertext never reaches ffmpeg.
 */
@Injectable()
export class PunchlineClipService {
  private readonly logger = new Logger(PunchlineClipService.name);

  constructor(
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
    private readonly configService?: ConfigService,
  ) {}

  async extractClip(input: PunchlineClipInput): Promise<PunchlineClipResult> {
    const { trackId } = input;
    const startMs = input.startMs;
    const endMs = input.endMs;

    // 1. Range shape.
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs
    ) {
      throw new PunchlineClipException(
        "invalid_range",
        "Clip range is invalid: require finite startMs >= 0 and endMs > startMs.",
      );
    }

    // 2. Length bounds.
    const durationMs = endMs - startMs;
    const { minMs, maxMs } = resolvePunchlineClipBounds(this.configService);
    if (durationMs < minMs) {
      throw new PunchlineClipException(
        "clip_too_short",
        `Clip is ${durationMs}ms; minimum is ${minMs}ms.`,
      );
    }
    if (durationMs > maxMs) {
      throw new PunchlineClipException(
        "clip_too_long",
        `Clip is ${durationMs}ms; maximum is ${maxMs}ms.`,
      );
    }

    // 3. Resolve the vocals stem.
    const stem = await prisma.stem.findFirst({
      where: { trackId, type: PUNCHLINE_SOURCE_STEM_TYPE },
      select: {
        id: true,
        uri: true,
        data: true,
        isEncrypted: true,
        encryptionMetadata: true,
        durationSeconds: true,
        storageProvider: true,
      },
    });
    if (!stem) {
      throw new PunchlineClipException(
        "no_vocals_stem",
        `Track ${trackId} has no ${PUNCHLINE_SOURCE_STEM_TYPE} stem to clip.`,
      );
    }

    // 4. Source asset present (inline bytes OR a non-empty URI to download).
    const hasInlineBytes = !!stem.data && stem.data.length > 0;
    const hasUri = typeof stem.uri === "string" && stem.uri.trim().length > 0;
    if (!hasInlineBytes && !hasUri) {
      throw new PunchlineClipException(
        "source_asset_missing",
        `Vocals stem ${stem.id} has no stored audio to clip.`,
      );
    }

    // 5. Range within source (best-effort: only when the duration is known).
    if (stem.durationSeconds != null) {
      const sourceMs = stem.durationSeconds * 1000;
      if (endMs > sourceMs + PUNCHLINE_CLIP_SOURCE_TOLERANCE_MS) {
        throw new PunchlineClipException(
          "range_exceeds_source",
          `Clip end ${endMs}ms exceeds source length ${Math.round(sourceMs)}ms.`,
        );
      }
    }

    // 6. Load source bytes (data-first, then storage download, then decrypt) and
    //    run ffmpeg in an isolated temp dir that is always cleaned up.
    const buffer = await this.renderClip(
      {
        id: stem.id,
        uri: stem.uri,
        data: stem.data,
        isEncrypted: stem.isEncrypted,
        encryptionMetadata: stem.encryptionMetadata,
      },
      startMs,
      durationMs,
    );

    // 7. Store under a flat, deterministic filename so the same range maps to a
    //    stable asset (LocalStorageProvider cannot create subdirectories).
    const filename = `punchline-clip-${trackId}-${startMs}-${endMs}.mp3`;
    let stored;
    try {
      stored = await this.storageProvider.upload(
        buffer,
        filename,
        PUNCHLINE_CLIP_AUDIO_POLICY.outputMimeType,
      );
    } catch (error) {
      // Storage messages can carry bucket names / local paths — log, don't leak.
      this.logger.error(
        `Failed to store punchline clip for track ${trackId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new PunchlineClipException(
        "extraction_failed",
        "The clip could not be stored. Please try again later.",
      );
    }

    return {
      clipAssetUri: stored.uri,
      storageProvider: stored.provider,
      sourceStemId: stem.id,
      sourceStemType: PUNCHLINE_SOURCE_STEM_TYPE,
      startMs,
      endMs,
      durationMs,
      byteSize: buffer.length,
      mimeType: PUNCHLINE_CLIP_AUDIO_POLICY.outputMimeType,
    };
  }

  /**
   * Trim [startMs, startMs+durationMs) out of the vocal stem and re-encode MP3.
   * The plaintext for encrypted stems lives only inside the unique temp dir and
   * is removed on every exit path.
   */
  private async renderClip(
    stem: {
      id: string;
      uri: string;
      data: Buffer | Uint8Array | null;
      isEncrypted: boolean;
      encryptionMetadata: string | null;
    },
    startMs: number,
    durationMs: number,
  ): Promise<Buffer> {
    const audio = await this.loadStemAudio(stem);
    if (!audio || audio.length === 0) {
      throw new PunchlineClipException(
        "source_asset_missing",
        `Vocals stem ${stem.id} audio could not be loaded.`,
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), "punchline-clip-"));
    try {
      const inputPath = join(workDir, "source.audio");
      const outputPath = join(workDir, "clip.mp3");
      await writeFile(inputPath, audio);

      const args = buildPunchlineClipFfmpegArgs(
        inputPath,
        outputPath,
        startMs,
        durationMs,
      );
      try {
        await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS });
      } catch (error) {
        // Never surface raw ffmpeg stderr (it can echo the temp path / source
        // details); log server-side and return an opaque code.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `ffmpeg clip failed for stem ${stem.id}: ${message}`,
        );
        throw new PunchlineClipException(
          "extraction_failed",
          "The clip could not be extracted from the source audio.",
        );
      }

      const buffer = await readFile(outputPath);
      if (buffer.length === 0) {
        throw new PunchlineClipException(
          "extraction_failed",
          "The extracted clip was empty.",
        );
      }
      return buffer;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch((error) => {
        this.logger.warn(
          `Failed to remove punchline clip temp dir ${workDir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }

  /**
   * Returns plaintext audio for the vocal stem. Fetch order mirrors the remix
   * mixer (#1214): inline DB bytes first, then the configured storage provider;
   * encrypted rows are decrypted in memory through the strict render boundary so
   * ciphertext never reaches ffmpeg. Path containment lives in the storage
   * provider, so this reuses one boundary for local/GCS/IPFS.
   */
  private async loadStemAudio(stem: {
    id: string;
    uri: string;
    data: Buffer | Uint8Array | null;
    isEncrypted: boolean;
    encryptionMetadata: string | null;
  }): Promise<Buffer | null> {
    const raw = await this.loadStoredBytes(stem);
    if (!raw) {
      return null;
    }
    if (!stem.isEncrypted) {
      return raw;
    }

    const internalAuthSig = {
      // Sentinel + internal purpose: the AES provider grants access only when
      // INTERNAL_SERVICE_KEY matches (SBPR-004 / #1214). No user signature. This
      // is a backend-initiated clip extraction of an owned/eligible track; #482
      // enforces ownership/eligibility before calling this service.
      address: "0x0000000000000000000000000000000000000000",
      sig: "punchline-clip-authorized",
      signedMessage: "Punchline clip extraction authorization",
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    };

    try {
      const plaintext = await this.encryptionService.decryptForRender(
        raw,
        stem.encryptionMetadata ?? "",
        internalAuthSig,
      );
      return plaintext && plaintext.length > 0 ? plaintext : null;
    } catch (error) {
      throw this.mapDecryptError(error, stem.id);
    }
  }

  private async loadStoredBytes(stem: {
    id: string;
    uri: string;
    data: Buffer | Uint8Array | null;
  }): Promise<Buffer | null> {
    if (stem.data && stem.data.length > 0) {
      return Buffer.from(stem.data);
    }
    try {
      const audio = await this.storageProvider.download(stem.uri);
      return audio && audio.length > 0 ? audio : null;
    } catch (error) {
      // Do not log provider messages: they can contain bucket names, local
      // paths, or signed URLs.
      this.logger.warn(
        `Storage download failed for punchline vocals stem ${stem.id}`,
      );
      this.logger.debug?.(
        error instanceof Error ? error.message : String(error),
      );
      throw new PunchlineClipException(
        "extraction_failed",
        "The source audio could not be loaded. Please try again later.",
      );
    }
  }

  /**
   * Translate strict render-decryption failures into safe clip errors. The
   * user-facing messages never name keys, metadata, URIs, or provider internals.
   */
  private mapDecryptError(
    error: unknown,
    stemId: string,
  ): PunchlineClipException {
    if (error instanceof PunchlineClipException) {
      return error;
    }
    if (error instanceof RenderDecryptionError) {
      this.logger.warn(
        `Punchline clip decryption failed for stem ${stemId}: ${error.reason}`,
      );
    } else {
      this.logger.warn(
        `Unexpected punchline clip decryption error for stem ${stemId}`,
      );
    }
    return new PunchlineClipException(
      "extraction_failed",
      "The source audio could not be prepared for clipping.",
    );
  }
}

/**
 * Pure ffmpeg arg construction (unit-testable without ffmpeg). Stem-derived
 * paths are passed as execFile arguments — never interpolated into a shell
 * string.
 *
 * `-ss` is placed BEFORE `-i` for a fast input seek to the clip start, and the
 * clip length is expressed with `-t` (duration), NOT `-to` (absolute end). With
 * `-ss` before `-i`, ffmpeg resets the timeline to the seek point, so a `-to`
 * end-timestamp would be interpreted relative to that reset origin and cut the
 * clip short — the classic `-ss`-before-`-i` footgun. `-t durationSec` is
 * unambiguous regardless of seek placement.
 */
export function buildPunchlineClipFfmpegArgs(
  inputPath: string,
  outputPath: string,
  startMs: number,
  durationMs: number,
): string[] {
  const policy = PUNCHLINE_CLIP_AUDIO_POLICY;
  const startSec = (startMs / 1000).toFixed(3);
  const durationSec = (durationMs / 1000).toFixed(3);
  return [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    startSec,
    "-i",
    inputPath,
    "-t",
    durationSec,
    "-codec:a",
    policy.outputCodec,
    "-b:a",
    `${policy.bitrateKbps}k`,
    "-ar",
    String(policy.sampleRate),
    "-ac",
    String(policy.channels),
    outputPath,
  ];
}
