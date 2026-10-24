import { execFile } from "child_process";
import { promisify } from "util";
import {
  type OfficialStemAudioFacts,
  type SummedLevelMeasure,
} from "./official-stems.validation";

/**
 * Audio measurements for official stem packages (#1976): container facts read
 * from the WAV or FLAC header, and decoded loudness from `ffmpeg` (already
 * shipped in the backend image for remix rendering, #1189). No ffprobe is
 * needed.
 */

const execFileAsync = promisify(execFile);

/** Decoded analysis rate: speech and music energy sit well below 4 kHz of content that matters for alignment. */
export const OFFICIAL_STEM_ANALYSIS_SAMPLE_RATE = 8_000;
/** Loudness-envelope frame length, in seconds. */
export const OFFICIAL_STEM_ENVELOPE_FRAME_SECONDS = 0.1;
const FFMPEG_TIMEOUT_MS = 120_000;
const FFMPEG_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/**
 * Reads container facts from the bytes of an audio file. Never throws.
 *
 * WAV and FLAC headers are parsed here (a few dozen bytes each) instead of with
 * `music-metadata`: the official-stem rules need exactly the sample rate, the
 * channel count, the codec's losslessness and the duration, and a header
 * reader is deterministic and testable under Jest, where the ESM-only
 * `music-metadata` is stubbed. Other formats are only recognised by name so
 * the refusal can say what the file looks like.
 */
export function probeAudioFacts(buffer: Buffer): OfficialStemAudioFacts {
  const unknown: OfficialStemAudioFacts = {
    container: null,
    lossless: false,
    sampleRate: null,
    channels: null,
    durationSeconds: null,
  };
  try {
    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
      return probeWav(buffer);
    }
    if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "fLaC") {
      return probeFlac(buffer);
    }
    return { ...unknown, container: sniffOtherContainer(buffer) };
  } catch {
    return unknown;
  }
}

function sniffOtherContainer(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "mp3";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return "m4a";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "FORM") return "aiff";
  return null;
}

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function probeWav(buffer: Buffer): OfficialStemAudioFacts {
  let offset = 12;
  let formatTag: number | null = null;
  let channels: number | null = null;
  let sampleRate: number | null = null;
  let blockAlign: number | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const declared = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= buffer.length) {
      formatTag = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      blockAlign = buffer.readUInt16LE(body + 12);
      if (formatTag === WAVE_FORMAT_EXTENSIBLE && declared >= 40 && body + 26 <= buffer.length) {
        formatTag = buffer.readUInt16LE(body + 24);
      }
    } else if (id === "data") {
      // A streamed file may declare 0 or 0xFFFFFFFF; trust only what is there.
      dataBytes = Math.min(declared, buffer.length - body);
      break;
    }
    offset = body + declared + (declared % 2);
  }
  const lossless = formatTag === WAVE_FORMAT_PCM || formatTag === WAVE_FORMAT_IEEE_FLOAT;
  const durationSeconds =
    dataBytes !== null && blockAlign && sampleRate ? dataBytes / blockAlign / sampleRate : null;
  return { container: "wav", lossless, sampleRate, channels, durationSeconds };
}

function probeFlac(buffer: Buffer): OfficialStemAudioFacts {
  // Metadata blocks follow the marker; STREAMINFO (type 0, 34 bytes) is first.
  if (buffer.length < 4 + 4 + 34 || (buffer[4] & 0x7f) !== 0) {
    return { container: "flac", lossless: true, sampleRate: null, channels: null, durationSeconds: null };
  }
  const info = 8;
  const sampleRate = (buffer[info + 10] << 12) | (buffer[info + 11] << 4) | (buffer[info + 12] >> 4);
  const channels = ((buffer[info + 12] >> 1) & 0x07) + 1;
  const totalSamples =
    (buffer[info + 13] & 0x0f) * 2 ** 32 + buffer.readUInt32BE(info + 14);
  return {
    container: "flac",
    lossless: true,
    sampleRate: sampleRate || null,
    channels,
    durationSeconds: sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : null,
  };
}

/**
 * Decodes an audio file to mono 32-bit float samples at 8 kHz. The path is a
 * file the caller owns (a request temp file); it is passed as an argument, never
 * through a shell.
 */
export async function decodeMonoSamples(filePath: string): Promise<Float32Array> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-v", "error",
      "-nostdin",
      "-i", filePath,
      "-vn",
      "-ac", "1",
      "-ar", String(OFFICIAL_STEM_ANALYSIS_SAMPLE_RATE),
      "-f", "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_OUTPUT_BYTES },
  );
  const bytes = stdout as unknown as Buffer;
  const usable = bytes.length - (bytes.length % 4);
  const copy = new Uint8Array(usable);
  copy.set(bytes.subarray(0, usable));
  return new Float32Array(copy.buffer, 0, usable / 4);
}

const EPSILON = 1e-12;

/** RMS level of samples in dBFS (very quiet audio floors at -120). */
export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return -120;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return Math.max(-120, 20 * Math.log10(rms + EPSILON));
}

/** RMS per frame of `frameLength` samples (the last partial frame is dropped). */
export function rmsEnvelope(samples: Float32Array, frameLength: number): number[] {
  const frames = Math.floor(samples.length / frameLength);
  const envelope: number[] = new Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    const start = frame * frameLength;
    for (let i = start; i < start + frameLength; i += 1) sum += samples[i] * samples[i];
    envelope[frame] = Math.sqrt(sum / frameLength);
  }
  return envelope;
}

/** Pearson correlation of two equal-length series, or null when either is flat. */
export function pearsonCorrelation(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA < 1e-12 || varianceB < 1e-12) return null;
  return covariance / Math.sqrt(varianceA * varianceB);
}

/**
 * Adds the stems sample for sample (all start at 0, as aligned exports do) and
 * compares the sum with the mix: level difference in dB over the mix's length,
 * and the correlation of their loudness envelopes. A flat mix envelope gives a
 * null correlation, which the caller treats as "nothing to align against".
 */
export function measureSummedLevel(
  mix: Float32Array,
  stems: readonly Float32Array[],
): SummedLevelMeasure {
  const summed = new Float32Array(mix.length);
  for (const stem of stems) {
    const length = Math.min(stem.length, summed.length);
    for (let i = 0; i < length; i += 1) summed[i] += stem[i];
  }
  const mixRmsDb = rmsDb(mix);
  const summedRmsDb = rmsDb(summed);
  const frameLength = Math.round(OFFICIAL_STEM_ANALYSIS_SAMPLE_RATE * OFFICIAL_STEM_ENVELOPE_FRAME_SECONDS);
  return {
    mixRmsDb,
    summedRmsDb,
    differenceDb: summedRmsDb - mixRmsDb,
    envelopeCorrelation: pearsonCorrelation(
      rmsEnvelope(mix, frameLength),
      rmsEnvelope(summed, frameLength),
    ),
  };
}
