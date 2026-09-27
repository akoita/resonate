/**
 * remix-fx/v2 tempo/key render (#1898) — ffmpeg arg construction (pure), the
 * beat's output-time timing, and ffmpeg-gated renders of the stretch stage
 * (skipped when ffmpeg is absent, like the #1897/#1899/#1902 render specs).
 */

import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildSectionGateVolumeExpression,
  type SectionGrid,
} from "../modules/remix/remix-arrangement";
import type { RemixFxRecipe } from "../modules/remix/remix-fx";
import {
  beatHits,
  beatTimingAtSpeed,
  renderBeatTrack,
  type RemixBeatDspRecipe,
} from "../modules/remix/remix-beat";
import {
  masterFadeRamps,
  structureTimeline,
  type RemixStructureBlock,
} from "../modules/remix/remix-structure";
import {
  buildMasterFadeVolumeExpression,
  buildStemMixFfmpegArgs,
  buildStretchDecodeArgs,
  stretchedSourceSegments,
  stretchMixInputs,
  structureRuns,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";
import { dominantHz } from "./remix-stretch-test-signals";

function filterOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

/** `-ss/-t/-i` triples (null seek/read for a plain `-i`). */
function inputSpecs(args: string[]) {
  const specs: Array<{ path: string; seek: string | null; read: string | null }> = [];
  args.forEach((arg, index) => {
    if (arg !== "-i") return;
    const hasSeek = args[index - 4] === "-ss" && args[index - 2] === "-t";
    specs.push({
      path: args[index + 1],
      seek: hasSeek ? args[index - 3] : null,
      read: hasSeek ? args[index - 1] : null,
    });
  });
  return specs;
}

const v1 = (value: Omit<RemixFxRecipe, "schemaVersion">): RemixFxRecipe => ({
  schemaVersion: "remix-fx/v1",
  ...value,
});
const v2 = (value: Omit<RemixFxRecipe, "schemaVersion">): RemixFxRecipe => ({
  schemaVersion: "remix-fx/v2",
  ...value,
});

const GRID: SectionGrid = {
  kind: "bars",
  sectionSeconds: 16,
  bpm: 120,
  durationSeconds: 58,
  sections: [
    { startSec: 0, endSec: 6 },
    { startSec: 6, endSec: 22 },
    { startSec: 22, endSec: 38 },
    { startSec: 38, endSec: 54 },
    { startSec: 54, endSec: 58 },
  ],
};

const INPUTS: StemMixFfmpegInput[] = [
  {
    path: "/tmp/a.audio",
    gainDb: 1.5,
    activeIntervals: [{ startSec: 6, endSec: 22 }],
    fxStemId: "stem-a",
  },
  { path: "/tmp/b.audio", gainDb: -2, fxStemId: "stem-b" },
  { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true },
];
const BEAT_INPUT: StemMixFfmpegInput = {
  path: "/tmp/beat.wav",
  gainDb: -3,
  beat: true,
};

describe("buildStemMixFfmpegArgs identity without a tempo stretch (#1898)", () => {
  const structure = { segments: structureTimeline(GRID, [
    { section: 2 },
    { section: 1, fadeIn: true },
  ]) };
  const base = {
    master: { speed: 0.85, space: 0.3, tone: -0.2 },
    stems: { "stem-a": { echo: 0.4 } },
  };

  it("a v2 varispeed-only recipe compiles byte-identically to v1", () => {
    for (const withStructure of [false, true]) {
      const args = (effects: RemixFxRecipe) =>
        buildStemMixFfmpegArgs(
          [...INPUTS, BEAT_INPUT],
          "/tmp/mix.mp3",
          { effects, bpm: 120, impulsePath: "/tmp/ir.wav" },
          withStructure ? structure : null,
        );
      expect(args(v2(base))).toEqual(args(v1(base)));
    }
  });

  it("a key shift without keepPitch keeps the varispeed graph (only the input files change)", () => {
    const args = (effects: RemixFxRecipe) =>
      buildStemMixFfmpegArgs(
        [...INPUTS, BEAT_INPUT],
        "/tmp/mix.mp3",
        { effects, bpm: 120, impulsePath: "/tmp/ir.wav" },
        structure,
      );
    const shifted = args(v2({ ...base, master: { ...base.master, semitones: 3 } }));
    expect(shifted).toEqual(args(v1(base)));
    expect(filterOf(shifted)).toContain("asetrate=40800,aresample=48000");
  });

  it("keepPitch at speed 1 renders like the recipe without it", () => {
    const args = (effects: RemixFxRecipe) =>
      buildStemMixFfmpegArgs(INPUTS, "/tmp/mix.mp3", { effects }, structure);
    expect(args(v2({ master: { keepPitch: true, warmth: 0.2 } }))).toEqual(
      args(v1({ master: { warmth: 0.2 } })),
    );
  });

  it("no effects keeps the pre-#1897 graph", () => {
    const plain = buildStemMixFfmpegArgs(INPUTS, "/tmp/mix.mp3");
    expect(filterOf(plain)).not.toContain("asetrate");
    expect(buildStemMixFfmpegArgs(INPUTS, "/tmp/mix.mp3", null)).toEqual(plain);
  });
});

describe("buildStemMixFfmpegArgs with keepPitch (#1898)", () => {
  const effects = v2({
    master: { speed: 0.8, keepPitch: true, semitones: 2 },
    stems: { "stem-a": { echo: 0.5 } },
  });

  it("drops varispeed everywhere; gates and echo stay in output time (÷ speed)", () => {
    const args = buildStemMixFfmpegArgs(
      [...INPUTS, BEAT_INPUT],
      "/tmp/mix.mp3",
      { effects, bpm: 120 },
    );
    const filter = filterOf(args);
    expect(filter).not.toContain("asetrate");
    const gate = buildSectionGateVolumeExpression([
      { startSec: 6 / 0.8, endSec: 22 / 0.8 },
    ]);
    expect(filter).toContain(`volume=volume=${gate}:eval=frame`);
    // Dotted eighth at 120 bpm in output tempo: 0.375 s ÷ 0.8 = 468.75 ms.
    expect(filter).toContain("aecho=in_gain=1:out_gain=1:delays=468.75|937.5|1406.25|1875");
    // AI layer and beat: normalize (+ mono→stereo) → gain, no rate change.
    const parts = filter.split(";");
    expect(parts[2]).toBe("[2:a]aresample=48000,aformat=sample_fmts=fltp,volume=0dB[a2]");
    expect(parts[3]).toBe(
      "[3:a]aresample=48000,aformat=sample_fmts=fltp,pan=stereo|c0=c0|c1=c0,volume=-3dB[a3]",
    );
  });

  it("seeks structure runs in the stretched file's time (÷ tempo); master fades stay ÷ speed", () => {
    const blocks: RemixStructureBlock[] = [
      { section: 2, fadeIn: true },
      { section: 1 },
      { section: 3, fadeOut: true },
    ];
    const segments = structureTimeline(GRID, blocks);
    const args = buildStemMixFfmpegArgs(
      INPUTS.slice(0, 2),
      "/tmp/mix.mp3",
      { effects },
      { segments },
    );
    const runs = structureRuns(stretchedSourceSegments(segments, effects));
    // Source 22..38 → stretched 27.5..47.5; 6..22 → 7.5..27.5; 38..54 →
    // 47.5..67.5 (every block is its own run: each join jumps).
    expect(runs.map((run) => [run.srcStartSec, run.srcEndSec])).toEqual([
      [27.5, 47.5],
      [7.5, 27.5],
      [47.5, 67.5],
    ]);
    const expected = runs.map((run) => ({
      seek: String(Math.round(run.seekSec * 1e6) / 1e6),
      read: String(Math.round(run.readSec * 1e6) / 1e6),
    }));
    expect(Number(expected[0].seek)).toBeCloseTo(27.4, 6);
    expect(Number(expected[0].read)).toBeCloseTo(20.2, 6);
    const specs = inputSpecs(args);
    expect(specs).toEqual([
      ...expected.map((run) => ({ path: "/tmp/a.audio", ...run })),
      ...expected.map((run) => ({ path: "/tmp/b.audio", ...run })),
    ]);
    // Each run branch trims exactly 20 s of stretched audio past its pre-roll.
    const filter = filterOf(args);
    expect(filter).toContain(
      `atrim=start=${Math.round(runs[0].prerollSec * 1e6) / 1e6}:end=${Math.round((runs[0].prerollSec + 20) * 1e6) / 1e6}`,
    );
    const fades = buildMasterFadeVolumeExpression(masterFadeRamps(segments), 0.8);
    expect(filter).toContain(`volume=volume=${fades}:eval=frame`);
    expect(filter).not.toContain("asetrate");
  });

  it("does not scale structure runs for a key shift alone", () => {
    const segments = structureTimeline(GRID, [{ section: 2 }, { section: 1 }]);
    const keyOnly = v2({ master: { speed: 0.8, semitones: -2 } });
    expect(stretchedSourceSegments(segments, keyOnly)).toBe(segments);
    expect(
      buildStemMixFfmpegArgs(INPUTS, "/tmp/mix.mp3", { effects: keyOnly }, { segments }),
    ).toEqual(
      buildStemMixFfmpegArgs(
        INPUTS,
        "/tmp/mix.mp3",
        { effects: v1({ master: { speed: 0.8 } }) },
        { segments },
      ),
    );
  });
});

describe("beat timing in output time for keepPitch (#1898)", () => {
  const recipe: RemixBeatDspRecipe = {
    kit: "punchy",
    pattern: {
      kick: Array.from({ length: 16 }, (_, step) => step % 4 === 0),
      hat: Array.from({ length: 16 }, (_, step) => step % 2 === 1),
    },
    swing: 0.3,
  };
  const segments = structureTimeline(GRID, [
    { section: 0 },
    { section: 2 },
    { section: 1 },
  ]);

  it("places every hit at its timeline time ÷ speed, pickup rule unchanged", () => {
    const speed = 0.85;
    const scaled = beatTimingAtSpeed(GRID, segments, speed);
    const original = beatHits(recipe, GRID, segments);
    const stretched = beatHits(recipe, scaled.grid, scaled.segments);
    expect(original.length).toBeGreaterThan(0);
    expect(stretched.map((hit) => hit.instrument)).toEqual(
      original.map((hit) => hit.instrument),
    );
    stretched.forEach((hit, index) => {
      expect(Math.abs(hit.timeSec - original[index].timeSec / speed)).toBeLessThan(2e-9);
    });
    // The 6 s pickup block (section 0) still gets no beat.
    expect(original[0].timeSec).toBeCloseTo(6, 9);
    expect(stretched[0].timeSec).toBeCloseTo(6 / speed, 9);
    expect(scaled.grid.bpm).toBeCloseTo(120 * speed, 12);
    expect(scaled.grid.sections).toBe(GRID.sections);
  });

  it("keeps the one-shots untouched: the track is the timeline ÷ speed plus the same decay room", () => {
    const speed = 1.25;
    const scaled = beatTimingAtSpeed(GRID, segments, speed);
    const plain = renderBeatTrack(recipe, GRID, segments, 48_000);
    const fast = renderBeatTrack(recipe, scaled.grid, scaled.segments, 48_000);
    const timeline = segments[segments.length - 1].outEndSec;
    const decay = plain.length - Math.ceil(timeline * 48_000);
    expect(fast.length).toBe(Math.ceil((timeline / speed) * 48_000) + decay);
    // The first hit's one-shot starts at round(6/1.25 · sr) and matches the
    // unscaled render sample for sample (no rate change, no transposition).
    const start = Math.round((6 / speed) * 48_000);
    const plainStart = Math.round(6 * 48_000);
    for (let i = 0; i < 2000; i += 1) {
      expect(fast[start + i]).toBe(plain[plainStart + i]);
    }
  });

  it("is the identity at speed 1", () => {
    const same = beatTimingAtSpeed(GRID, segments, 1);
    expect(same.grid).toBe(GRID);
    expect(same.segments).toBe(segments);
  });
});

describe("buildStretchDecodeArgs (#1898)", () => {
  it("decodes to raw 48 kHz 16-bit stereo as argv entries", () => {
    expect(buildStretchDecodeArgs("/tmp/in put.mp3", "/tmp/out.s16")).toEqual([
      "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
      "-i", "/tmp/in put.mp3", "-vn",
      "-f", "s16le", "-c:a", "pcm_s16le", "-ac", "2", "-ar", "48000",
      "/tmp/out.s16",
    ]);
  });
});

/** 16-bit PCM WAV sine; stereo by default at 48 kHz. */
function sineWav(
  frequency: number,
  seconds: number,
  { sampleRate = 48_000, channels = 2, amplitude = 12_000 } = {},
): Buffer {
  const frames = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude,
    );
    for (let ch = 0; ch < channels; ch++) {
      data.writeInt16LE(value, (i * channels + ch) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Decode any audio file to mono float samples at 48 kHz. */
function decodeMono(path: string): Float32Array {
  const raw = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-c:a", "pcm_f32le", "-"],
    { timeout: 60_000, maxBuffer: 256 * 1024 * 1024 },
  );
  const samples = new Float32Array(raw.length / 4);
  for (let i = 0; i < samples.length; i += 1) samples[i] = raw.readFloatLE(i * 4);
  return samples;
}

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(ffmpegAvailable ? describe : describe.skip)(
  "ffmpeg remix-fx/v2 tempo/key render (#1898)",
  () => {
    let workDir: string;
    beforeEach(() => {
      workDir = mkdtempSync(join(tmpdir(), "remix-stretch-render-"));
    });
    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    /** Stretch stage + graph, exactly as the mixer runs them. */
    async function render(effects: RemixFxRecipe, seconds: number) {
      const stem = join(workDir, "stem-0.audio");
      const layer = join(workDir, "input-1.wav");
      writeFileSync(stem, sineWav(440, seconds));
      writeFileSync(layer, sineWav(440, seconds, { sampleRate: 44_100, channels: 1, amplitude: 3_000 }));
      const inputs: StemMixFfmpegInput[] = [
        { path: stem, gainDb: 0, fxStemId: "a" },
        { path: layer, gainDb: -6, aiLayer: true },
      ];
      const plan = {
        tempo: effects.master?.keepPitch ? effects.master.speed ?? 1 : 1,
        semitones: effects.master?.semitones ?? 0,
      };
      await stretchMixInputs(inputs, workDir, plan);
      const out = join(workDir, "mix.mp3");
      execFileSync("ffmpeg", buildStemMixFfmpegArgs(inputs, out, { effects }), {
        stdio: "ignore",
        timeout: 120_000,
      });
      return { inputs, samples: decodeMono(out), stem, layer };
    }

    it("replaces each input with its stretched 48 kHz 16-bit WAV and deletes the intermediates", async () => {
      const { inputs, stem, layer } = await render(
        v2({ master: { speed: 0.85, keepPitch: true } }),
        3,
      );
      expect(inputs.map((input) => input.path)).toEqual([
        join(workDir, "stretch-0.wav"),
        join(workDir, "stretch-1.wav"),
      ]);
      expect(existsSync(stem)).toBe(false);
      expect(existsSync(layer)).toBe(false);
      expect(existsSync(join(workDir, "stretch-0.s16"))).toBe(false);
      expect(existsSync(join(workDir, "stretch-1.s16"))).toBe(false);
      const wav = readFileSync(inputs[0].path);
      expect(wav.readUInt16LE(20)).toBe(1);
      expect(wav.readUInt16LE(22)).toBe(2);
      expect(wav.readUInt32LE(24)).toBe(48_000);
      expect(wav.readUInt16LE(34)).toBe(16);
      expect(wav.readUInt32LE(40) / 4).toBe(Math.round((3 * 48_000) / 0.85));
      // The resampled mono AI layer is stretched too (upmixed to stereo).
      const layerWav = readFileSync(inputs[1].path);
      expect(layerWav.readUInt16LE(22)).toBe(2);
      expect(Math.abs(layerWav.readUInt32LE(40) / 4 - (3 * 48_000) / 0.85)).toBeLessThan(10);
    }, 120_000);

    it("the 16-bit stage is deterministic: the same inputs render byte-identical files", async () => {
      const first = await render(v2({ master: { speed: 0.85, keepPitch: true, semitones: 2 } }), 2);
      const firstBytes = first.inputs.map((input) => readFileSync(input.path));
      rmSync(workDir, { recursive: true, force: true });
      workDir = mkdtempSync(join(tmpdir(), "remix-stretch-render-"));
      const second = await render(v2({ master: { speed: 0.85, keepPitch: true, semitones: 2 } }), 2);
      second.inputs.forEach((input, index) => {
        expect(readFileSync(input.path).equals(firstBytes[index])).toBe(true);
      });
      // Each input index has its own dither seed.
      expect(firstBytes[0].subarray(44, 1044).equals(firstBytes[1].subarray(44, 1044))).toBe(false);
    }, 120_000);

    it("keepPitch 0.85: lasts input/0.85 and a 440 Hz sine stays at 440 Hz", async () => {
      const { samples } = await render(
        v2({ master: { speed: 0.85, keepPitch: true } }),
        6,
      );
      const seconds = samples.length / 48_000;
      expect(Math.abs(seconds - 6 / 0.85) / (6 / 0.85)).toBeLessThanOrEqual(0.02);
      const hz = dominantHz(samples, 48_000, (samples.length >> 1) - 32768);
      expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThanOrEqual(10);
    }, 120_000);

    it("+2 semitones: same length, the 440 Hz sine moves up ~12% (493.9 Hz)", async () => {
      const { samples } = await render(v2({ master: { semitones: 2 } }), 6);
      const seconds = samples.length / 48_000;
      expect(Math.abs(seconds - 6) / 6).toBeLessThanOrEqual(0.02);
      const hz = dominantHz(samples, 48_000, (samples.length >> 1) - 32768);
      expect(Math.abs(1200 * Math.log2(hz / (440 * 2 ** (2 / 12))))).toBeLessThanOrEqual(10);
    }, 120_000);

    it("a key shift with varispeed stacks both (pitch × speed × 2^(st/12))", async () => {
      const { samples } = await render(
        v2({ master: { speed: 1.2, semitones: -3 } }),
        6,
      );
      const seconds = samples.length / 48_000;
      expect(Math.abs(seconds - 6 / 1.2) / (6 / 1.2)).toBeLessThanOrEqual(0.02);
      const hz = dominantHz(samples, 48_000, (samples.length >> 1) - 32768);
      const expected = 440 * 1.2 * 2 ** (-3 / 12);
      expect(Math.abs(1200 * Math.log2(hz / expected))).toBeLessThanOrEqual(10);
    }, 120_000);

    it("stretches a stem shorter than the engine minimum (padded, trimmed to round(len/tempo))", async () => {
      const stem = join(workDir, "stem-0.audio");
      writeFileSync(stem, sineWav(440, 0.05));
      const inputs: StemMixFfmpegInput[] = [{ path: stem, gainDb: 0 }];
      await stretchMixInputs(inputs, workDir, { tempo: 0.85, semitones: 0 });
      const wav = readFileSync(inputs[0].path);
      expect(wav.readUInt32LE(40) / 4).toBe(Math.round(2400 / 0.85));
      expect(existsSync(join(workDir, "stretch-0.s16"))).toBe(false);
    }, 60_000);

    it("maps an undecodable input to a retryable provider_unavailable", async () => {
      const stem = join(workDir, "stem-0.audio");
      writeFileSync(stem, Buffer.from("not audio at all"));
      const logged: string[] = [];
      await expect(
        stretchMixInputs(
          [{ path: stem, gainDb: 0 }],
          workDir,
          { tempo: 0.85, semitones: 0 },
          (message) => logged.push(message),
        ),
      ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
      expect(logged[0]).toMatch(/decode failed/);
    }, 60_000);
  },
);
