/**
 * Deterministic stand-in for a model part clip (#1901), used by the stub
 * provider (dev/test) and the conform specs.
 *
 * A 30 s, 48 kHz stereo clip at the requested tempo × a seeded ±3 %
 * deviation, starting on a seeded downbeat offset, so the conform has real
 * tempo and phase work to do: drums get clear onsets (accented kick on the
 * downbeat, snare on 2 and 4, eighth hats); pitched roles get a line in the
 * requested key (plucked for bass/keys/guitar, slow-attack chords for
 * pad/strings). No samples, no randomness beyond the seed.
 */

import {
  PART_SAMPLE_RATE,
  PITCH_CLASS_NAMES,
  tonicPitchClass,
} from "./remix-part-conform";

export const STUB_PART_CLIP_SECONDS = 30;
export const STUB_PART_MAX_DEVIATION = 0.03;

export type StubPartClipInput = {
  role: string;
  bpm: number;
  /** "A minor" style key; null/unknown = C major. */
  key?: { tonic: string; mode: "major" | "minor" } | null;
  seed: number;
  /** Explicit tempo deviation (tests); default = seeded ±3 %. */
  deviation?: number;
  /** Explicit first downbeat (tests); default = seeded 0.3 s … 0.3 s + 1 beat. */
  firstDownbeatSec?: number;
  durationSec?: number;
  sampleRate?: number;
};

export type StubPartClip = {
  channels: Float32Array[];
  actualBpm: number;
  firstDownbeatSec: number;
  sampleRate: number;
};

/** mulberry32 PRNG → [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
/**
 * Scale degrees per beat over four bars: every degree of the scale (so the
 * key is unambiguous), tonic on every downbeat.
 */
const LINE_DEGREES = [0, 2, 4, 2, 0, 3, 5, 3, 0, 4, 6, 4, 0, 1, 4, 2];
/** Chord roots per bar (degrees) for sustained roles. */
const CHORD_DEGREES = [0, 5, 3, 4];

const PITCHED_REGISTER: Record<string, number> = {
  bass: 36, // C2
  keys: 60,
  guitar: 52,
  pad: 60,
  strings: 55,
};

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function synthesizeStubPartClip(input: StubPartClipInput): StubPartClip {
  const sampleRate = input.sampleRate ?? PART_SAMPLE_RATE;
  const durationSec = input.durationSec ?? STUB_PART_CLIP_SECONDS;
  const rng = mulberry32(input.seed);
  const deviation =
    input.deviation ?? (rng() * 2 - 1) * STUB_PART_MAX_DEVIATION;
  const actualBpm = input.bpm * (1 + deviation);
  const beatSec = 60 / actualBpm;
  const firstDownbeatSec = input.firstDownbeatSec ?? 0.3 + rng() * beatSec;
  const frames = Math.round(durationSec * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const noise = mulberry32(input.seed ^ 0x5eed1901);

  const add = (startSec: number, render: (t: number) => number, lengthSec: number, pan = 0) => {
    const start = Math.round(startSec * sampleRate);
    const length = Math.round(lengthSec * sampleRate);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < length; i += 1) {
      const idx = start + i;
      if (idx < 0) continue;
      if (idx >= frames) break;
      const v = render(i / sampleRate);
      left[idx] += v * gl;
      right[idx] += v * gr;
    }
  };

  // Beats from the first downbeat on (the audio before it stays silent).
  const beats: number[] = [];
  for (let t = firstDownbeatSec; t < durationSec; t += beatSec) beats.push(t);

  if (input.role === "drums") {
    beats.forEach((t, index) => {
      const beatInBar = index % 4;
      if (beatInBar === 0 || beatInBar === 2) {
        const level = beatInBar === 0 ? 0.9 : 0.55;
        add(t, (x) => {
          const phase = 2 * Math.PI * (50 * x + (70 / 30) * (1 - Math.exp(-30 * x)));
          return level * Math.sin(phase) * Math.exp(-x / 0.18);
        }, 0.5);
      } else {
        const burst = Array.from({ length: Math.round(0.2 * sampleRate) }, () => noise() * 2 - 1);
        add(t, (x) => {
          const i = Math.min(burst.length - 1, Math.round(x * sampleRate));
          return 0.35 * burst[i] * Math.exp(-x / 0.06);
        }, 0.2, -0.2);
      }
      for (const offset of [0, beatSec / 2]) {
        const hat = Array.from({ length: Math.round(0.06 * sampleRate) }, () => noise() * 2 - 1);
        let prev = 0;
        add(t + offset, (x) => {
          const i = Math.min(hat.length - 1, Math.round(x * sampleRate));
          const hp = hat[i] - prev;
          prev = hat[i];
          return 0.12 * hp * Math.exp(-x / 0.02);
        }, 0.06, 0.3);
      }
    });
    return { channels: [left, right], actualBpm, firstDownbeatSec, sampleRate };
  }

  const tonicPc = input.key ? tonicPitchClass(input.key.tonic) ?? 0 : 0;
  const steps = input.key?.mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  const register = PITCHED_REGISTER[input.role] ?? 60;
  const baseMidi = register - (register % 12) + tonicPc;
  const degreeMidi = (degree: number) =>
    baseMidi + steps[degree % 7] + 12 * Math.floor(degree / 7);
  /**
   * Harmonic tone (1/h partials below ~Nyquist/2.2) under `envelope`, with
   * sine recurrences instead of per-sample Math.sin (fast enough for tests).
   */
  const addTone = (
    startSec: number,
    lengthSec: number,
    hzList: number[],
    harmonics: number,
    envelope: (x: number) => number,
  ) => {
    const length = Math.round(lengthSec * sampleRate);
    const buffer = new Float64Array(length);
    for (const hz of hzList) {
      for (let h = 1; h <= harmonics; h += 1) {
        if (hz * h > sampleRate / 2.2) break;
        const w = (2 * Math.PI * hz * h) / sampleRate;
        const k = 2 * Math.cos(w);
        const amp = 1 / h;
        let s0 = 0;
        let s1 = Math.sin(w);
        if (length > 1) buffer[1] += amp * s1;
        for (let i = 2; i < length; i += 1) {
          const s2 = k * s1 - s0;
          buffer[i] += amp * s2;
          s0 = s1;
          s1 = s2;
        }
      }
    }
    add(startSec, (x) => {
      const i = Math.min(length - 1, Math.round(x * sampleRate));
      return buffer[i] * envelope(x);
    }, lengthSec);
  };

  if (input.role === "pad" || input.role === "strings") {
    const barSec = beatSec * 4;
    for (let bar = 0, t = firstDownbeatSec; t < durationSec; bar += 1, t += barSec) {
      const root = CHORD_DEGREES[bar % CHORD_DEGREES.length];
      const notes = [root, root + 2, root + 4].map((d) => midiToHz(degreeMidi(d)));
      addTone(t, barSec, notes, 4, (x) => {
        const attack = Math.min(1, x / 0.08);
        const release = Math.min(1, (barSec - x) / 0.05);
        return 0.12 * attack * Math.max(0, release);
      });
    }
    return { channels: [left, right], actualBpm, firstDownbeatSec, sampleRate };
  }

  beats.forEach((t, index) => {
    const degree = LINE_DEGREES[index % LINE_DEGREES.length];
    const hz = midiToHz(degreeMidi(degree));
    const accent = index % 4 === 0 ? 1 : 0.7;
    addTone(t, beatSec * 0.95, [hz], 6, (x) => 0.3 * accent * Math.exp(-x / 0.25));
  });
  return { channels: [left, right], actualBpm, firstDownbeatSec, sampleRate };
}

/** Parse the server prompt template's tempo/key/role (the stub's only input). */
export function parseStubPartPrompt(prompt: string): {
  role: string;
  bpm: number | null;
  key: { tonic: string; mode: "major" | "minor" } | null;
} {
  const role = /\bsolo (drums|bass|keys|pad|strings|guitar)\b/.exec(prompt)?.[1] ?? "keys";
  // The template puts tempo and key AFTER the style words: take the last match.
  const bpmMatches = [...prompt.matchAll(/(\d{2,3}(?:\.\d+)?) BPM/g)];
  const bpmRaw = bpmMatches.length ? Number(bpmMatches[bpmMatches.length - 1][1]) : NaN;
  const keyMatches = [...prompt.matchAll(/\b([A-G](?:#|b)?) (major|minor)\b/g)];
  const lastKey = keyMatches.length ? keyMatches[keyMatches.length - 1] : null;
  const key =
    lastKey && tonicPitchClass(lastKey[1]) !== null
      ? {
          tonic: PITCH_CLASS_NAMES[tonicPitchClass(lastKey[1]) as number],
          mode: lastKey[2] as "major" | "minor",
        }
      : null;
  return {
    role,
    bpm: Number.isFinite(bpmRaw) && bpmRaw >= 30 && bpmRaw <= 300 ? bpmRaw : null,
    key,
  };
}

/** 16-bit PCM WAV bytes (no dither; the stub is deterministic by design). */
export function encodeStubWav(channels: Float32Array[], sampleRate: number): Buffer {
  const frames = channels[0].length;
  const nCh = channels.length;
  const dataBytes = frames * nCh * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(nCh, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * nCh * 2, 28);
  out.writeUInt16LE(nCh * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < nCh; c += 1) {
      const q = Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767);
      out.writeInt16LE(q, 44 + (i * nCh + c) * 2);
    }
  }
  return out;
}
