import { Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { chmod, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Remix render watermarking (#2566 slice 2, #2573). The scheme was picked in
 * the #2572 spike (docs/rfc/remix-watermarking.md): audiowmark 0.6.5, a
 * 128-bit payload keyed with an AES-128 key, run as a separate program like
 * ffmpeg. It is never linked or vendored (GPLv3, see NOTICE).
 *
 * The payload is an opaque random token. It never encodes a user id, a wallet
 * or an email: the token row (`RemixRenderWatermark`) is the only link back to
 * the render, and only admins can read it.
 */
export const REMIX_WATERMARK_SCHEME = "audiowmark";
export const REMIX_WATERMARK_SCHEME_VERSION = "0.6.5";
/** The spike's pick (RFC "Decision"); a config value, so no code change to move it. */
export const REMIX_WATERMARK_DEFAULT_STRENGTH = 15;

/**
 * Why a render carries no watermark: no key configured, the caller did not ask
 * for one, or the embedder failed (missing binary, timeout, non-zero exit).
 */
export type RemixWatermarkNoneReason = "no_key" | "embed_failed";

/**
 * What a render records in its render metadata. The token itself is never
 * here: render metadata is shown to the project owner, the token is not.
 */
export type RemixRenderWatermarkMetadata =
  | {
      status: "embedded";
      scheme: typeof REMIX_WATERMARK_SCHEME;
      schemeVersion: string;
      strength: number;
      keyId: string;
      /** Stem files of a stems render that carry the mark (#2550). */
      stemsEmbedded?: number;
      /** Stem files shipped without the mark because the embed failed. */
      stemsFailed?: number;
    }
  | { status: "none"; reason: RemixWatermarkNoneReason };

/**
 * The token a render embedded and the stem layers that carry it, returned to
 * the worker so it can write the token row. Never stored in render metadata.
 */
export type RemixRenderWatermark = {
  token: string;
  scheme: typeof REMIX_WATERMARK_SCHEME;
  schemeVersion: string;
  strength: number;
  keyId: string;
  /** Stem-tap layer indexes (#2550) whose files carry the same token. */
  stemIndexes: number[];
};

export type RemixWatermarkConfig = {
  /** The audiowmark key-file text (`key <32 hex>`). Never logged. */
  key: string;
  keyId: string;
  strength: number;
  binary: string;
};

const KEY_FILE_PATTERN = /^\s*key\s+[0-9a-f]{32}\s*$/im;

/**
 * Reads the watermark settings. No key means no watermark: there is no
 * default key. A malformed key or a key without a key id disables
 * watermarking with a warning instead of failing renders.
 */
export function readRemixWatermarkConfig(
  env: NodeJS.ProcessEnv = process.env,
  logger?: Pick<Logger, "warn">,
): RemixWatermarkConfig | null {
  const key = env.REMIX_WATERMARK_KEY?.trim();
  if (!key) return null;
  if (!KEY_FILE_PATTERN.test(key)) {
    logger?.warn(
      "REMIX_WATERMARK_KEY is not an audiowmark key file (`key <32 hex chars>`); remix renders stay unwatermarked",
    );
    return null;
  }
  const keyId = env.REMIX_WATERMARK_KEY_ID?.trim();
  if (!keyId) {
    logger?.warn(
      "REMIX_WATERMARK_KEY is set without REMIX_WATERMARK_KEY_ID; remix renders stay unwatermarked",
    );
    return null;
  }
  const rawStrength = env.REMIX_WATERMARK_STRENGTH?.trim();
  const parsed = rawStrength ? Number(rawStrength) : NaN;
  const strength =
    Number.isFinite(parsed) && parsed > 0 && parsed <= 50
      ? parsed
      : REMIX_WATERMARK_DEFAULT_STRENGTH;
  if (rawStrength && strength !== parsed) {
    logger?.warn(
      `REMIX_WATERMARK_STRENGTH=${rawStrength} is not a number in (0, 50]; using ${REMIX_WATERMARK_DEFAULT_STRENGTH}`,
    );
  }
  return {
    key,
    keyId,
    strength,
    binary: env.REMIX_WATERMARK_BIN?.trim() || "audiowmark",
  };
}

/** A fresh opaque 128-bit payload: 32 lowercase hex characters. */
export function newRemixWatermarkToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Pure arg construction (unit-tested). Values go to execFile as an argument
 * array, never through a shell.
 */
export function buildAudiowmarkAddArgs(
  keyPath: string,
  strength: number,
  inputPath: string,
  outputPath: string,
  token: string,
): string[] {
  return [
    "add",
    "--key",
    keyPath,
    "--strength",
    String(strength),
    inputPath,
    outputPath,
    token,
  ];
}

/** Generous: embedding runs at about 0.3 s per minute of audio (RFC "Cost"). */
const EMBED_TIMEOUT_MS = 120_000;

/**
 * Embeds a token with audiowmark. Callers treat every error as "ship the
 * render unwatermarked": a watermark problem never fails a render.
 */
export class RemixWatermarkEmbedder {
  private keyPath: Promise<string> | null = null;

  constructor(private readonly config: RemixWatermarkConfig) {}

  get keyId(): string {
    return this.config.keyId;
  }

  get strength(): number {
    return this.config.strength;
  }

  /**
   * Reads `inputPath` (WAV or FLAC) and writes the watermarked audio to
   * `outputPath` as WAV.
   */
  async embed(inputPath: string, outputPath: string, token: string): Promise<void> {
    const keyPath = await this.ensureKeyFile();
    await execFileAsync(
      this.config.binary,
      buildAudiowmarkAddArgs(keyPath, this.config.strength, inputPath, outputPath, token),
      { timeout: EMBED_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
  }

  /**
   * `--key` takes a file path, so the key is written once to a 0600 file in a
   * private temp dir. The path holds no secret, the file does.
   */
  private ensureKeyFile(): Promise<string> {
    this.keyPath ??= (async () => {
      const dir = await mkdtemp(join(tmpdir(), "remix-wmkey-"));
      await chmod(dir, 0o700);
      const path = join(dir, "remix-watermark.key");
      await writeFile(path, `${this.config.key.trim()}\n`, { mode: 0o600 });
      return path;
    })().catch((error: unknown) => {
      this.keyPath = null;
      throw error;
    });
    return this.keyPath;
  }
}

/** The embedder for this process, or null when no key is configured. */
export function remixWatermarkEmbedderFromEnv(
  logger?: Pick<Logger, "warn">,
): RemixWatermarkEmbedder | null {
  const config = readRemixWatermarkConfig(process.env, logger);
  return config ? new RemixWatermarkEmbedder(config) : null;
}
