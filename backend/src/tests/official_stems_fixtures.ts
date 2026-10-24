/**
 * Deterministic audio for the official-stem tests (#1976): synthetic stems
 * whose sum is the mix, and WAV / FLAC-header writers. No audio files are
 * checked in and nothing random is used, so the level and alignment numbers
 * are stable.
 */

export const FIXTURE_SAMPLE_RATE = 44_100;

/** Small deterministic noise source (LCG), values in [-1, 1). */
function noise(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

export type SyntheticStems = {
  vocals: Float32Array;
  drums: Float32Array;
  bass: Float32Array;
  /** The mix: the stems added and scaled like a master bus. */
  mix: Float32Array;
};

/** A short song: a held vocal, kick-like noise bursts every 0.5 s, a bass line. */
export function syntheticStems(seconds = 4, sampleRate = FIXTURE_SAMPLE_RATE): SyntheticStems {
  const length = Math.round(seconds * sampleRate);
  const vocals = new Float32Array(length);
  const drums = new Float32Array(length);
  const bass = new Float32Array(length);
  const random = noise(7);
  const beat = Math.round(0.5 * sampleRate);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    vocals[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t));
    const sinceBeat = (i % beat) / sampleRate;
    drums[i] = 0.5 * random() * Math.exp(-sinceBeat * 18);
    bass[i] = 0.08 * Math.sin(2 * Math.PI * 80 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t) ** 2);
  }
  const mix = new Float32Array(length);
  for (let i = 0; i < length; i += 1) mix[i] = 0.9 * (vocals[i] + drums[i] + bass[i]);
  return { vocals, drums, bass, mix };
}

/** Circularly shifts samples later by `seconds`. */
export function shifted(samples: Float32Array, seconds: number, sampleRate = FIXTURE_SAMPLE_RATE): Float32Array {
  const offset = Math.round(seconds * sampleRate);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[(i + offset) % samples.length] = samples[i];
  return out;
}

export function scaled(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * gain;
  return out;
}

/** A WAV file: 16-bit PCM by default; `formatTag` 0x55 writes a (fake) MP3-in-WAV header. */
export function wavBuffer(
  samples: Float32Array,
  options: { sampleRate?: number; channels?: 1 | 2; formatTag?: number } = {},
): Buffer {
  const sampleRate = options.sampleRate ?? FIXTURE_SAMPLE_RATE;
  const channels = options.channels ?? 1;
  const formatTag = options.formatTag ?? 1;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = samples.length * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(formatTag, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    const int = Math.round(value * 32767);
    for (let channel = 0; channel < channels; channel += 1) {
      buffer.writeInt16LE(int, offset);
      offset += 2;
    }
  }
  return buffer;
}

/** Just a FLAC marker and STREAMINFO block: enough for the header reader. */
export function flacHeaderBuffer(input: {
  sampleRate: number;
  channels: number;
  bitsPerSample?: number;
  totalSamples: number;
}): Buffer {
  const buffer = Buffer.alloc(4 + 4 + 34);
  buffer.write("fLaC", 0, "ascii");
  buffer[4] = 0x80; // last metadata block, type 0 (STREAMINFO)
  buffer.writeUIntBE(34, 5, 3);
  const info = 8;
  const bits = (input.bitsPerSample ?? 16) - 1;
  buffer[info + 10] = (input.sampleRate >> 12) & 0xff;
  buffer[info + 11] = (input.sampleRate >> 4) & 0xff;
  buffer[info + 12] = ((input.sampleRate & 0x0f) << 4) | (((input.channels - 1) & 0x07) << 1) | ((bits >> 4) & 0x01);
  buffer[info + 13] = ((bits & 0x0f) << 4) | (Math.floor(input.totalSamples / 2 ** 32) & 0x0f);
  buffer.writeUInt32BE(input.totalSamples % 2 ** 32, info + 14);
  return buffer;
}
