import { ConfigService } from "@nestjs/config";

/**
 * Punchline clip extraction bounds + output audio policy (#481).
 *
 * The clip is the media primitive the draft/publish APIs (#482) call to
 * populate `PunchlineMoment.clipAssetUri`: a short MP3 trimmed from a track's
 * `vocals` stem. Two separate concerns live here:
 *
 *   - Clip *bounds* (min/max length) are operational policy an operator can
 *     tune per environment, so they are env-overridable via ConfigService,
 *     mirroring how the generation-credits service reads its int config
 *     (parse, validate finite/positive, fall back to the default).
 *   - The output *audio policy* (codec/bitrate/sample-rate/channels) is product
 *     policy, not environment config — it is frozen so a given range always
 *     encodes the same way. It mirrors the shape of REMIX_RENDER_AUDIO_POLICY.
 */

/** Default minimum clip length (ms). A drop shorter than this is not a moment. */
export const PUNCHLINE_CLIP_MIN_MS = 2000;

/** Default maximum clip length (ms). Keeps a collectible a *punchline*, not a song. */
export const PUNCHLINE_CLIP_MAX_MS = 15000;

/**
 * Frozen output encoding policy. 192 kbps / 44.1 kHz / stereo is a good-quality
 * collectible MP3 without the 320 kbps master weight the remix render uses.
 */
export const PUNCHLINE_CLIP_AUDIO_POLICY = Object.freeze({
  outputCodec: "libmp3lame" as const,
  outputMimeType: "audio/mpeg" as const,
  bitrateKbps: 192,
  sampleRate: 44100,
  channels: 2,
});

/** Small tolerance (ms) when comparing endMs to a known source duration. */
export const PUNCHLINE_CLIP_SOURCE_TOLERANCE_MS = 50;

export type PunchlineClipBounds = {
  minMs: number;
  maxMs: number;
};

/**
 * Resolve the clip length bounds from env, falling back to the defaults and
 * guarding min < max. Reused so the service and its tests agree on one source.
 */
export function resolvePunchlineClipBounds(
  configService?: ConfigService,
): PunchlineClipBounds {
  const minMs = readPositiveInt(
    configService,
    "PUNCHLINE_CLIP_MIN_MS",
    PUNCHLINE_CLIP_MIN_MS,
  );
  const maxMs = readPositiveInt(
    configService,
    "PUNCHLINE_CLIP_MAX_MS",
    PUNCHLINE_CLIP_MAX_MS,
  );

  // A misconfigured min >= max would reject every clip; fall back to the safe
  // built-in bounds rather than trust the broken pair.
  if (minMs >= maxMs) {
    return { minMs: PUNCHLINE_CLIP_MIN_MS, maxMs: PUNCHLINE_CLIP_MAX_MS };
  }
  return { minMs, maxMs };
}

function readPositiveInt(
  configService: ConfigService | undefined,
  key: string,
  fallback: number,
): number {
  const raw = configService?.get<string | number>(key, fallback);
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : raw;
  return Number.isFinite(parsed) && (parsed as number) > 0
    ? Math.floor(parsed as number)
    : fallback;
}
