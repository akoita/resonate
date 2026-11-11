import { Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Remix watermark detection (#2566 slice 3, #2575). Reads the mark that
 * `remix-watermark.ts` embeds, with the active key and an optional retired
 * key, following the detector the #2572 spike measured
 * (docs/rfc/remix-watermarking.md): a plain `audiowmark get`, then a retry
 * with `--detect-speed`. Only a decoded payload that equals a stored token is
 * a match; the decoder always prints candidates, on unmarked audio too.
 */
export type RemixWatermarkDetectKey = {
  /** The audiowmark key-file text (`key <32 hex>`). Never logged. */
  key: string;
  keyId: string;
  slot: "active" | "retired";
};

export type RemixWatermarkDetectConfig = {
  keys: RemixWatermarkDetectKey[];
  binary: string;
  ffmpegBinary: string;
};

const KEY_FILE_PATTERN = /^\s*key\s+[0-9a-f]{32}\s*$/im;

function readKey(
  slot: RemixWatermarkDetectKey["slot"],
  keyVar: string,
  keyIdVar: string,
  env: NodeJS.ProcessEnv,
  logger?: Pick<Logger, "warn">,
): RemixWatermarkDetectKey | null {
  const key = env[keyVar]?.trim();
  if (!key) return null;
  if (!KEY_FILE_PATTERN.test(key)) {
    logger?.warn(`${keyVar} is not an audiowmark key file; detection skips the ${slot} key`);
    return null;
  }
  const keyId = env[keyIdVar]?.trim();
  if (!keyId) {
    logger?.warn(`${keyVar} is set without ${keyIdVar}; detection skips the ${slot} key`);
    return null;
  }
  return { key, keyId, slot };
}

/**
 * Reads the detection keys: the active key (the one renders embed with) and
 * the retired key kept after a rotation. No key means detection is off.
 */
export function readRemixWatermarkDetectConfig(
  env: NodeJS.ProcessEnv = process.env,
  logger?: Pick<Logger, "warn">,
): RemixWatermarkDetectConfig | null {
  const keys = [
    readKey("active", "REMIX_WATERMARK_KEY", "REMIX_WATERMARK_KEY_ID", env, logger),
    readKey(
      "retired",
      "REMIX_WATERMARK_RETIRED_KEY",
      "REMIX_WATERMARK_RETIRED_KEY_ID",
      env,
      logger,
    ),
  ].filter((key): key is RemixWatermarkDetectKey => key !== null);
  if (keys.length === 0) return null;
  return {
    keys,
    binary: env.REMIX_WATERMARK_BIN?.trim() || "audiowmark",
    ffmpegBinary: "ffmpeg",
  };
}

export type RemixWatermarkDetectStage = "plain" | "speed";

/**
 * One `pattern` line of `audiowmark get`:
 * `pattern <position> <payload> <sync quality> <decode error> [<block type>]`.
 * The two figures are audiowmark's own, passed on as printed. On a real mark
 * the sync quality stands well above the noise candidates around it.
 */
export type RemixWatermarkPattern = {
  position: string;
  /** 32 lowercase hex characters. */
  payload: string;
  /** Higher is better. */
  syncQuality: number | null;
  /** Lower is better. */
  decodeError: number | null;
};

/** Pure: the `pattern` lines of `audiowmark get` output. */
export function parseAudiowmarkGetOutput(stdout: string): RemixWatermarkPattern[] {
  const patterns: RemixWatermarkPattern[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "pattern" || fields.length < 3) continue;
    const payload = fields[2].toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(payload)) continue;
    const quality = Number(fields[3]);
    const error = Number(fields[4]);
    patterns.push({
      position: fields[1],
      payload,
      syncQuality: fields[3] !== undefined && Number.isFinite(quality) ? quality : null,
      decodeError: fields[4] !== undefined && Number.isFinite(error) ? error : null,
    });
  }
  return patterns;
}

/** Pure arg construction. Values go to execFile as an array, never a shell. */
export function buildAudiowmarkGetArgs(
  keyPath: string,
  inputPath: string,
  stage: RemixWatermarkDetectStage,
): string[] {
  return ["get", "--key", keyPath, ...(stage === "speed" ? ["--detect-speed"] : []), inputPath];
}

/** The longest stretch of a clip that is decoded and searched. */
export const DETECT_MAX_CLIP_SECONDS = 600;

/**
 * Pure. The clip is an operator upload, so ffmpeg only reads the local file,
 * only as one of the listed containers, and writes plain PCM.
 */
export function buildDetectDecodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    "mp3,wav,flac,ogg,aac,mov,matroska,aiff",
    "-i",
    inputPath,
    "-t",
    String(DETECT_MAX_CLIP_SECONDS),
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    "-y",
    outputPath,
  ];
}

/** A decoded payload, with the best figures seen for it and where it came from. */
export type RemixWatermarkCandidate = {
  payload: string;
  keyId: string;
  keySlot: RemixWatermarkDetectKey["slot"];
  stage: RemixWatermarkDetectStage;
  /** How many `pattern` lines carried this payload. */
  occurrences: number;
  decodeError: number | null;
  syncQuality: number | null;
};

/** Pure: one candidate per payload, keeping the figures of its best-synced line. */
export function candidatesFromPatterns(
  patterns: RemixWatermarkPattern[],
  key: Pick<RemixWatermarkDetectKey, "keyId" | "slot">,
  stage: RemixWatermarkDetectStage,
): RemixWatermarkCandidate[] {
  const byPayload = new Map<string, RemixWatermarkCandidate>();
  for (const pattern of patterns) {
    const seen = byPayload.get(pattern.payload);
    if (!seen) {
      byPayload.set(pattern.payload, {
        payload: pattern.payload,
        keyId: key.keyId,
        keySlot: key.slot,
        stage,
        occurrences: 1,
        decodeError: pattern.decodeError,
        syncQuality: pattern.syncQuality,
      });
      continue;
    }
    seen.occurrences += 1;
    if ((pattern.syncQuality ?? -Infinity) > (seen.syncQuality ?? -Infinity)) {
      seen.decodeError = pattern.decodeError;
      seen.syncQuality = pattern.syncQuality;
    }
  }
  return [...byPayload.values()];
}

const DECODE_TIMEOUT_MS = 120_000;
/** Plain detection takes 2–4 s per 30 s clip, the speed search about 15 s more (RFC "Cost"). */
const GET_TIMEOUT_MS: Record<RemixWatermarkDetectStage, number> = {
  plain: 180_000,
  speed: 600_000,
};

export const REMIX_WATERMARK_DETECT_STAGES: RemixWatermarkDetectStage[] = ["plain", "speed"];

export class RemixWatermarkDetector {
  constructor(private readonly config: RemixWatermarkDetectConfig) {}

  get keyIds(): string[] {
    return this.config.keys.map((key) => key.keyId);
  }

  /** Decodes an uploaded clip to PCM WAV at `outputPath`. */
  async decodeClip(inputPath: string, outputPath: string): Promise<void> {
    await execFileAsync(this.config.ffmpegBinary, buildDetectDecodeArgs(inputPath, outputPath), {
      timeout: DECODE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
  }

  /**
   * Runs one stage with every configured key, one process per key so each
   * candidate is tied to the key that decoded it.
   */
  async candidates(
    wavPath: string,
    stage: RemixWatermarkDetectStage,
  ): Promise<RemixWatermarkCandidate[]> {
    const found: RemixWatermarkCandidate[] = [];
    for (const key of this.config.keys) {
      const dir = await mkdtemp(join(tmpdir(), "remix-wmdetect-"));
      try {
        await chmod(dir, 0o700);
        const keyPath = join(dir, "detect.key");
        await writeFile(keyPath, `${key.key.trim()}\n`, { mode: 0o600 });
        const { stdout } = await execFileAsync(
          this.config.binary,
          buildAudiowmarkGetArgs(keyPath, wavPath, stage),
          { timeout: GET_TIMEOUT_MS[stage], maxBuffer: 8 * 1024 * 1024 },
        );
        found.push(...candidatesFromPatterns(parseAudiowmarkGetOutput(stdout), key, stage));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    return found;
  }
}

/** The detector for this process, or null when no key is configured. */
export function remixWatermarkDetectorFromEnv(
  logger?: Pick<Logger, "warn">,
): RemixWatermarkDetector | null {
  const config = readRemixWatermarkDetectConfig(process.env, logger);
  return config ? new RemixWatermarkDetector(config) : null;
}
