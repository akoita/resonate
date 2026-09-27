/**
 * AI part conform remix-part-conform/v1 (#1901) — unit tests.
 *
 * Pure DSP on deterministic stub clips with a KNOWN tempo ratio, downbeat and
 * key: the ratio is estimated within 0.5 %, the output is sample-exact, the
 * key shift is the minimal one, a relative major/minor needs no shift, and a
 * low confidence skips (recorded). The ffmpeg edges (decode → FLAC) run when
 * ffmpeg is installed.
 */

import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  chromaVector,
  conformPartClip,
  conformPartPcm,
  estimateDownbeat,
  estimateKeyFromChroma,
  estimateTempoRatio,
  keySetOf,
  minimalKeyShift,
  mixToMono,
  onsetEnvelope,
  PART_SAMPLE_RATE,
  PART_TEMPO_CONFIDENCE_MIN,
  partLengthFrames,
  planKeyShift,
  REMIX_PART_CONFORM_VERSION,
  type PartConformTarget,
} from "../modules/remix/remix-part-conform";
import {
  encodeStubWav,
  parseStubPartPrompt,
  synthesizeStubPartClip,
} from "../modules/remix/remix-part-stub-clip";
import { sha256Of } from "./remix-stretch-test-signals";

jest.setTimeout(120_000);

type Case = {
  role: string;
  bpm: number;
  deviation: number;
  downbeat: number;
  key?: { tonic: string; mode: "major" | "minor" };
};

const TEMPO_CASES: Case[] = [
  { role: "drums", bpm: 120, deviation: 0.02, downbeat: 0.61 },
  { role: "drums", bpm: 92, deviation: -0.025, downbeat: 0.37 },
  { role: "drums", bpm: 140, deviation: 0.029, downbeat: 0.9 },
  { role: "bass", bpm: 100, deviation: -0.015, downbeat: 0.45, key: { tonic: "E", mode: "minor" } },
  { role: "keys", bpm: 128, deviation: 0.01, downbeat: 0.52, key: { tonic: "D", mode: "major" } },
  { role: "guitar", bpm: 85, deviation: -0.03, downbeat: 0.33, key: { tonic: "F#", mode: "minor" } },
];

// DSP under jest's VM runs several times slower than in production, so
// clips and conform results are memoized across tests.
const clips = new Map<string, ReturnType<typeof synthesizeStubPartClip>>();
function clipFor(c: Case, seed = 7) {
  const key = JSON.stringify({ c, seed });
  let clip = clips.get(key);
  if (!clip) {
    clip = synthesizeStubPartClip({
      role: c.role,
      bpm: c.bpm,
      deviation: c.deviation,
      firstDownbeatSec: c.downbeat,
      key: c.key ?? null,
      seed,
    });
    clips.set(key, clip);
  }
  return clip;
}

const conformed = new Map<string, ReturnType<typeof conformPartPcm>>();
function conformCase(c: Case, target: PartConformTarget) {
  const key = JSON.stringify({ c, target });
  let result = conformed.get(key);
  if (!result) {
    result = conformPartPcm(clipFor(c).channels, target);
    conformed.set(key, result);
  }
  return result;
}

const D_MAJOR_ON_C: [Case, PartConformTarget] = [
  { role: "keys", bpm: 128, deviation: 0.01, downbeat: 0.52, key: { tonic: "D", mode: "major" } },
  { bpm: 128, bars: 8, pitched: true, key: { tonic: "C", mode: "major", confidence: 0.3 } },
];

describe("remix part conform (#1901)", () => {
  describe("tempo ratio and downbeat", () => {
    it.each(TEMPO_CASES)(
      "$role at $bpm BPM × (1 + $deviation): ratio within 0.5 %, downbeat found",
      (c) => {
        const clip = clipFor(c);
        const onset = onsetEnvelope(mixToMono(clip.channels));
        const tempo = estimateTempoRatio(onset, c.bpm);
        const trueRatio = 1 + c.deviation;
        expect(Math.abs(tempo.ratio / trueRatio - 1)).toBeLessThan(0.005);
        expect(tempo.confidence).toBeGreaterThanOrEqual(PART_TEMPO_CONFIDENCE_MIN);
        const { downbeatSec } = estimateDownbeat(onset, c.bpm * tempo.ratio);
        // Estimates land at or a few ms before the attack (never clip it).
        expect(downbeatSec - c.downbeat).toBeGreaterThan(-0.015);
        expect(downbeatSec - c.downbeat).toBeLessThan(0.02);
      },
    );

    it("keeps r = 1 for a sustained texture (low tempo confidence)", async () => {
      const n = PART_SAMPLE_RATE * 30;
      const drone = new Float32Array(n);
      let s = 1;
      for (let i = 0; i < n; i += 1) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        drone[i] =
          0.2 * Math.sin((2 * Math.PI * 220 * i) / PART_SAMPLE_RATE) +
          0.05 * ((s / 4294967296) * 2 - 1);
      }
      const onset = onsetEnvelope(drone);
      expect(estimateTempoRatio(onset, 120).confidence).toBeLessThan(
        PART_TEMPO_CONFIDENCE_MIN,
      );
      const { record } = await conformPartPcm([drone, drone], {
        bpm: 120,
        bars: 4,
        pitched: true,
        key: { tonic: "C", mode: "major", confidence: 0.5 },
      });
      expect(record.estimatedRatio).toBe(1);
      expect(record.tempoConfidence).toBeLessThan(PART_TEMPO_CONFIDENCE_MIN);
      // A single tone is no key either.
      expect(record.keySkippedReason).toBe("low_take_key_confidence");
      expect(record.keyShiftSemitones).toBe(0);
    });
  });

  describe("sample-exact output", () => {
    it.each([
      { bpm: 120, bars: 4 },
      { bpm: 93.7, bars: 4 },
      { bpm: 137.25, bars: 8 },
    ])("$bars bars at $bpm BPM → exactly N·4·60/B seconds", async ({ bpm, bars }) => {
      const { channels, record } = await conformCase(
        { role: "drums", bpm, deviation: -0.02, downbeat: 0.42 },
        { bpm, bars, pitched: false, key: null },
      );
      const expected = Math.round(((bars * 4 * 60) / bpm) * PART_SAMPLE_RATE);
      expect(partLengthFrames(bpm, bars)).toBe(expected);
      expect(channels).toHaveLength(2);
      expect(channels[0].length).toBe(expected);
      expect(channels[1].length).toBe(expected);
      expect(record.lengthFrames).toBe(expected);
      expect(record.conformVersion).toBe(REMIX_PART_CONFORM_VERSION);
      expect(record.keySkippedReason).toBe("unpitched_role");
      expect(Math.abs(record.estimatedRatio / 0.98 - 1)).toBeLessThan(0.005);
      expect(Math.abs(record.startSec - 0.42)).toBeLessThan(0.02);
    });

    it("stretches the take onto the target grid (re-analysis reads ratio ≈ 1, beats on the grid from 0)", async () => {
      const bpm = 137.25;
      const { channels } = await conformCase(
        { role: "drums", bpm, deviation: -0.02, downbeat: 0.42 },
        { bpm, bars: 8, pitched: false, key: null },
      );
      const onset = onsetEnvelope(channels[0]);
      const tempo = estimateTempoRatio(onset, bpm);
      expect(Math.abs(tempo.ratio - 1)).toBeLessThan(0.005);
      const beatSec = 60 / bpm;
      const { beatsSec } = estimateDownbeat(onset, bpm * tempo.ratio);
      // Every detected beat sits on the target grid from sample 0.
      const offGrid = beatsSec
        .slice(0, 16)
        .map((t) => Math.abs(t / beatSec - Math.round(t / beatSec)) * beatSec);
      expect(Math.max(...offGrid)).toBeLessThan(0.02);
    });

    it("is deterministic", async () => {
      const [c, target] = D_MAJOR_ON_C;
      const a = await conformCase(c, target);
      const b = await conformPartPcm(clipFor(c).channels, target);
      expect(sha256Of(a.channels)).toBe(sha256Of(b.channels));
      expect(a.record).toEqual(b.record);
    });

    it("pads (and records it) only when the clip cannot hold N bars", async () => {
      const clip = synthesizeStubPartClip({
        role: "drums",
        bpm: 120,
        deviation: 0,
        firstDownbeatSec: 0.5,
        seed: 3,
        durationSec: 6,
      });
      const { channels, record } = await conformPartPcm(clip.channels, {
        bpm: 120,
        bars: 4,
        pitched: false,
        key: null,
      });
      expect(channels[0].length).toBe(partLengthFrames(120, 4));
      expect(record.padded).toBe(true);
      expect(record.startSec).toBe(0);
    });
  });

  describe("loop-safe edges", () => {
    it("starts at 0 and wraps without a click", async () => {
      const { channels } = await conformCase(...D_MAJOR_ON_C);
      for (const channel of channels) {
        const last = channel.length - 1;
        expect(Math.abs(channel[0])).toBe(0);
        // The tail ends where the faded start begins.
        expect(Math.abs(channel[last])).toBeLessThan(0.01);
        let typical = 0;
        for (let i = 1; i < channel.length; i += 1) {
          typical = Math.max(typical, Math.abs(channel[i] - channel[i - 1]));
        }
        expect(Math.abs(channel[0] - channel[last])).toBeLessThanOrEqual(typical);
      }
    });
  });

  describe("key", () => {
    it("maps keys to pitch-class sets (a major key ≡ its relative minor)", () => {
      expect(keySetOf(0, "major")).toBe(0); // C major
      expect(keySetOf(9, "minor")).toBe(0); // A minor
      expect(keySetOf(4, "minor")).toBe(7); // E minor ≡ G major
      expect(keySetOf(6, "minor")).toBe(9); // F# minor ≡ A major
    });

    it("shifts by the minimal −6..+5 semitones", () => {
      expect(minimalKeyShift(2, 0)).toBe(-2);
      expect(minimalKeyShift(0, 2)).toBe(2);
      expect(minimalKeyShift(0, 5)).toBe(5);
      expect(minimalKeyShift(0, 6)).toBe(-6);
      expect(minimalKeyShift(0, 7)).toBe(-5);
      expect(minimalKeyShift(11, 0)).toBe(1);
      for (let from = 0; from < 12; from += 1) {
        for (let to = 0; to < 12; to += 1) {
          const shift = minimalKeyShift(from, to);
          expect(shift).toBeGreaterThanOrEqual(-6);
          expect(shift).toBeLessThanOrEqual(5);
          expect((((from + shift) % 12) + 12) % 12).toBe(to);
        }
      }
    });

    it.each([
      { index: 3, set: 7 }, // bass, E minor ≡ G major
      { index: 4, set: 2 }, // keys, D major
      { index: 5, set: 9 }, // guitar, F# minor ≡ A major
    ])("estimates the key set of stub line $index", ({ index, set }) => {
      const clip = clipFor(TEMPO_CASES[index]);
      const key = estimateKeyFromChroma(chromaVector(mixToMono(clip.channels)));
      expect(key?.set).toBe(set);
      expect(key?.confidence).toBeGreaterThanOrEqual(0.05);
    });

    it("shifts a D major take onto a C major song (−2) and the output reads C major", async () => {
      const { channels, record } = await conformCase(...D_MAJOR_ON_C);
      expect(record.keyShiftSemitones).toBe(-2);
      expect(record.takeKey).toBe("D major");
      expect(record.targetKey).toBe("C major");
      expect(record.keySkippedReason).toBeUndefined();
      const out = estimateKeyFromChroma(chromaVector(mixToMono(channels)));
      expect(out?.set).toBe(0);
    });

    it("shifts an F# minor take onto an Eb major song (+6 → −6 bound)", async () => {
      const c = TEMPO_CASES[5]; // guitar, F# minor ≡ A major (set 9)
      const { record } = await conformCase(c, {
        bpm: c.bpm,
        bars: 4,
        pitched: true,
        key: { tonic: "Eb", mode: "major", confidence: 0.3 },
      });
      // A (9) → Eb (3): +6 ≡ −6, the bound of −6..+5.
      expect(record.keyShiftSemitones).toBe(-6);
    });

    it("needs no shift for the relative major/minor", async () => {
      const c = TEMPO_CASES[3]; // bass, E minor
      const { record } = await conformCase(c, {
        bpm: c.bpm,
        bars: 4,
        pitched: true,
        key: { tonic: "G", mode: "major", confidence: 0.3 },
      });
      expect(record.keyShiftSemitones).toBe(0);
      expect(record.keySkippedReason).toBeUndefined();
      expect(record.takeKey).toBe("E minor");
    });

    it("skips (and records why) on low or missing confidence, and for drums", () => {
      const take = { tonic: "D", mode: "major" as const, set: 2, confidence: 0.3 };
      const base = { bpm: 120, bars: 4, pitched: true };
      expect(
        planKeyShift(take, { ...base, key: { tonic: "C", mode: "major", confidence: 0.01 } }),
      ).toMatchObject({ semitones: 0, skipped: "low_track_key_confidence" });
      expect(
        planKeyShift(take, { ...base, key: { tonic: "C", mode: "major", confidence: null } }),
      ).toMatchObject({ semitones: 0, skipped: "low_track_key_confidence" });
      expect(planKeyShift(take, { ...base, key: null })).toMatchObject({
        semitones: 0,
        skipped: "no_track_key",
      });
      expect(
        planKeyShift(
          { ...take, confidence: 0.01 },
          { ...base, key: { tonic: "C", mode: "major", confidence: 0.5 } },
        ),
      ).toMatchObject({ semitones: 0, skipped: "low_take_key_confidence", keyConfidence: 0.01 });
      expect(
        planKeyShift(null, { ...base, key: { tonic: "C", mode: "major", confidence: 0.5 } }),
      ).toMatchObject({ semitones: 0, skipped: "no_take_key" });
      expect(
        planKeyShift(take, { ...base, pitched: false, key: { tonic: "C", mode: "major", confidence: 0.5 } }),
      ).toEqual({ semitones: 0, keyConfidence: null, skipped: "unpitched_role" });
      expect(
        planKeyShift(take, { ...base, key: { tonic: "C", mode: "major", confidence: 0.5 } }),
      ).toMatchObject({ semitones: -2, takeKey: "D major", targetKey: "C major" });
    });
  });

  describe("stub prompt parsing", () => {
    it("reads role, the LAST tempo and key (style words come first)", () => {
      expect(
        parseStubPartPrompt(
          "deep groovy bass line, solo bass, isolated instrument, 140 BPM trap in B minor, 97 BPM, E minor, loopable",
        ),
      ).toEqual({ role: "bass", bpm: 97, key: { tonic: "E", mode: "minor" } });
      expect(parseStubPartPrompt("tight drum groove, solo drums, 120 BPM")).toEqual({
        role: "drums",
        bpm: 120,
        key: null,
      });
    });
  });
});

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(ffmpegAvailable ? describe : describe.skip)("remix part conform: ffmpeg edges (#1901)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "part-conform-spec-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function decodedFrames(flac: Buffer): number {
    const path = join(dir, `probe-${Date.now()}.flac`);
    writeFileSync(path, flac);
    const raw = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", path, "-f", "s16le", "-ac", "2", "-ar", "48000", "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return raw.length / 4;
  }

  it.each([false, true])(
    "decodes a WAV clip and stores a sample-exact 16-bit FLAC (worker: %s)",
    async (useWorker) => {
      const clip = synthesizeStubPartClip({
        role: "keys",
        bpm: 124,
        deviation: 0.02,
        firstDownbeatSec: 0.5,
        key: { tonic: "A", mode: "minor" },
        seed: 9,
      });
      const result = await conformPartClip(
        encodeStubWav(clip.channels, clip.sampleRate),
        { bpm: 124, bars: 4, pitched: true, key: { tonic: "C", mode: "major", confidence: 0.3 } },
        { useWorker },
      );
      expect(result.flac.subarray(0, 4).toString("ascii")).toBe("fLaC");
      expect(result.record.lengthFrames).toBe(partLengthFrames(124, 4));
      expect(decodedFrames(result.flac)).toBe(partLengthFrames(124, 4));
      expect(result.durationSec).toBeCloseTo((4 * 4 * 60) / 124, 5);
      expect(Math.abs(result.record.estimatedRatio / 1.02 - 1)).toBeLessThan(0.005);
      expect(result.record.keyShiftSemitones).toBe(0); // A minor ≡ C major
    },
  );

  it("rejects bytes that are not audio with a safe error", async () => {
    await expect(
      conformPartClip(Buffer.from("definitely not audio"), {
        bpm: 120,
        bars: 4,
        pitched: false,
        key: null,
      }),
    ).rejects.toThrow("The generated clip could not be decoded.");
  });
});
