import { ServiceUnavailableException } from "@nestjs/common";
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { MP3_MIME_TYPE, stemFileExtension } from "./stem-media";

/**
 * Public stem previews of lossless official stems (#1976).
 *
 * The public preview route plays a stem before purchase. An official stem is a
 * lossless WAV or FLAC, the very file a buyer pays for, so the public route
 * serves a 128 kbps MP3 transcode of it instead and never the lossless bytes.
 * The transcode is cached per stem in a small in-memory LRU so repeated range
 * requests from a player do not re-encode.
 *
 * The route is public, so the expensive part (fetching and decrypting the
 * lossless file, then encoding it) is bounded: concurrent requests for one stem
 * share a single transcode, and at most `MAX_CONCURRENT_TRANSCODES` run at once
 * per instance. Beyond that the request is refused with 503 instead of queueing
 * unbounded work; a player retries.
 */

const execFileAsync = promisify(execFile);

export const STEM_PREVIEW_BITRATE_KBPS = 128;
const FFMPEG_TIMEOUT_MS = 120_000;
const FFMPEG_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 16;
export const MAX_CONCURRENT_TRANSCODES = 2;

const cache = new Map<string, Buffer>();
const inFlight = new Map<string, Promise<Buffer>>();

export type StemAudio = { data: Buffer; mimeType: string | null | undefined };

/**
 * The lossy public preview of an official stem. `load` fetches the lossless
 * audio and is only called on a cache miss, inside the concurrency bound.
 */
export async function lossyPreviewFor(
  stemId: string,
  load: () => Promise<StemAudio>,
): Promise<{ data: Buffer; mimeType: string }> {
  const cached = cache.get(stemId);
  if (cached) {
    cache.delete(stemId);
    cache.set(stemId, cached);
    return { data: cached, mimeType: MP3_MIME_TYPE };
  }
  let pending = inFlight.get(stemId);
  if (!pending) {
    if (inFlight.size >= MAX_CONCURRENT_TRANSCODES) {
      throw new ServiceUnavailableException({
        code: "stem_preview_busy",
        message: "Previews are busy right now. Try again in a moment.",
      });
    }
    pending = load()
      .then((audio) => transcode(stemId, audio.data, audio.mimeType))
      .finally(() => inFlight.delete(stemId));
    inFlight.set(stemId, pending);
  }
  return { data: await pending, mimeType: MP3_MIME_TYPE };
}

async function transcode(stemId: string, data: Buffer, mimeType: string | null | undefined): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "resonate-stem-preview-"));
  try {
    const input = join(directory, `input.${stemFileExtension(mimeType)}`);
    await writeFile(input, data);
    const { stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-nostdin",
        "-i", input,
        "-vn",
        "-codec:a", "libmp3lame",
        "-b:a", `${STEM_PREVIEW_BITRATE_KBPS}k`,
        "-f", "mp3",
        "pipe:1",
      ],
      { encoding: "buffer", timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_OUTPUT_BYTES },
    );
    const preview = stdout as unknown as Buffer;
    cache.set(stemId, preview);
    while (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return preview;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Clears the preview cache (tests). */
export function clearStemPreviewCache(): void {
  cache.clear();
  inFlight.clear();
}
