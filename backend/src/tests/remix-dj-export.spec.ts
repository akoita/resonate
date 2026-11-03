/**
 * DJ extended export (#2540, S6d of #1903): the splice lands every bar where
 * the sidecar says, measured on real ffmpeg output. The fixture draft has a
 * click at each downbeat; after the export the clicks are found again and
 * compared with the sidecar's beat grid and cues.
 */
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DJ_EXPORT_SAMPLE_RATE,
  djCuesSidecar,
  djExtendedPlan,
  draftGridFor,
  type DjExtendedPlan,
  type RemixCues,
} from "../modules/remix/remix-cues";
import { renderDjExtended } from "../modules/remix/remix-dj-export";
import { storeZip } from "../modules/shared/store_zip";

const FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const SR = DJ_EXPORT_SAMPLE_RATE;
const BPM = 120;
const FIRST_BEAT = 0.5;
const DURATION = 30;
const CLICK_SEC = 0.004;

/** Stereo s16 WAV with a 1 kHz click at every downbeat (louder each bar). */
function clickWav(firstBeat = FIRST_BEAT): Buffer {
  const frames = DURATION * SR;
  const pcm = Buffer.alloc(frames * 4);
  const bar = 240 / BPM;
  for (let t = firstBeat, n = 0; t < DURATION - CLICK_SEC; t += bar, n += 1) {
    const start = Math.round(t * SR);
    for (let i = 0; i < CLICK_SEC * SR; i += 1) {
      const v = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 1000 * i) / SR));
      pcm.writeInt16LE(v, (start + i) * 4);
      pcm.writeInt16LE(v, (start + i) * 4 + 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Encode like the render (MP3 320k, 48 kHz). */
function toMp3(wav: Buffer, dir: string): Buffer {
  const input = join(dir, "in.wav");
  const output = join(dir, "draft.mp3");
  writeFileSync(input, wav);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-c:a", "libmp3lame", "-b:a", "320k", "-ar", String(SR), output]);
  return require("fs").readFileSync(output);
}

/** Decode to mono float samples (left channel). */
function decode(mp3: Buffer, dir: string): Float32Array {
  const path = join(dir, "decode.mp3");
  writeFileSync(path, mp3);
  const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", String(SR), "pipe:1"], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

/** Onsets: first sample over half the click level after 50 ms of quiet. */
function onsets(samples: Float32Array): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > 0.25 && i - last > 0.05 * SR) out.push(i);
    if (Math.abs(samples[i]) > 0.25) last = i;
  }
  return out;
}

const segments = [
  { section: 0, outStartSec: 0, outEndSec: 16.5 },
  { section: 1, outStartSec: 16.5, outEndSec: DURATION },
];
const grid = { bpm: BPM, firstBeatSec: FIRST_BEAT, sections: [], sectionSeconds: 16 } as never;

describe("DJ extended export (#2540)", () => {
  const draftGrid = draftGridFor(grid, segments, 1)!;
  const cues: RemixCues = {
    schemaVersion: "remix-cues/v1",
    intro: { startBar: 0, bars: 2, repeats: 2 },
    outro: { startBar: 11, bars: 2, repeats: 1 },
  };

  it("records the draft downbeats", () => {
    expect(draftGrid.downbeatsSec.slice(0, 3)).toEqual([0.5, 2.5, 4.5]);
    expect(draftGrid.downbeatsSec).toHaveLength(15);
  });

  it("plans the loops right after themselves", () => {
    const plan = djExtendedPlan(draftGrid, cues) as DjExtendedPlan;
    expect(plan.pieces).toEqual([
      { startFrame: 0, endFrame: 4.5 * SR },
      { startFrame: 0.5 * SR, endFrame: 4.5 * SR },
      { startFrame: 0.5 * SR, endFrame: 4.5 * SR },
      { startFrame: 4.5 * SR, endFrame: 26.5 * SR },
      { startFrame: 22.5 * SR, endFrame: 26.5 * SR },
      { startFrame: 26.5 * SR, endFrame: null },
    ]);
    expect(plan.insertedFrames).toBe(12 * SR);
    const sidecar = djCuesSidecar(plan, draftGrid, "Neon", "Neon (DJ Extended).mp3");
    expect(sidecar.beatGrid.uniform).toBe(true);
    expect(sidecar.beatGrid.downbeatsSec).toHaveLength(15 + 6);
    expect(sidecar.cues.map((cue) => [cue.name, cue.startSec, cue.endSec])).toEqual([
      ["Mix in", 0.5, undefined],
      ["Intro loop", 0.5, 4.5],
      ["Outro loop", 30.5, 34.5],
      ["Mix out", 38.5, undefined],
    ]);
  });

  it("reports why a DJ version can't be made", () => {
    expect(djExtendedPlan(draftGrid, null)).toEqual({ unavailable: "no_cues" });
    expect(djExtendedPlan(null, cues)).toEqual({ unavailable: "no_draft_grid" });
    expect(
      djExtendedPlan(draftGrid, { ...cues, outro: { startBar: 14, bars: 2, repeats: 1 } }),
    ).toEqual({ unavailable: "cues_outside_draft" });
  });

  (FFMPEG ? it : it.skip)(
    "lands every bar of the exported audio on the sidecar grid (within 1 ms)",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "dj-spec-"));
      try {
        const draft = toMp3(clickWav(), dir);
        const plan = djExtendedPlan(draftGrid, cues) as DjExtendedPlan;
        const sidecar = djCuesSidecar(plan, draftGrid, "Neon", "Neon (DJ Extended).mp3");
        const exported = await renderDjExtended(draft, ".mp3", plan);
        const samples = decode(exported, dir);
        // The draft plus the 12 s inserted, within one MP3 frame.
        expect(Math.abs(samples.length - (DURATION + 12) * SR)).toBeLessThan(1152);
        const found = onsets(samples).map((i) => i / SR);
        expect(found).toHaveLength(sidecar.beatGrid.downbeatsSec.length);
        found.forEach((t, i) => {
          expect(Math.abs(t - sidecar.beatGrid.downbeatsSec[i])).toBeLessThan(0.001);
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  (FFMPEG ? it : it.skip)(
    "pads with silence where a join's crossfade runs before the start (downbeat at 0)",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "dj-spec-"));
      try {
        const draft = toMp3(clickWav(0), dir);
        const zeroGrid = draftGridFor(
          { bpm: BPM, firstBeatSec: 0 } as never,
          [{ section: 0, outStartSec: 0, outEndSec: DURATION }],
          1,
        )!;
        const plan = djExtendedPlan(zeroGrid, {
          schemaVersion: "remix-cues/v1",
          intro: { startBar: 0, bars: 4, repeats: 1 },
          outro: null,
        }) as DjExtendedPlan;
        const sidecar = djCuesSidecar(plan, zeroGrid, "Neon", "Neon.mp3");
        const samples = decode(await renderDjExtended(draft, ".mp3", plan), dir);
        expect(Math.abs(samples.length - (DURATION + 8) * SR)).toBeLessThan(1152);
        const found = onsets(samples).map((i) => i / SR);
        expect(found).toHaveLength(sidecar.beatGrid.downbeatsSec.length);
        found.forEach((t, i) => {
          expect(Math.abs(t - sidecar.beatGrid.downbeatsSec[i])).toBeLessThan(0.001);
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe("storeZip", () => {
  it("writes entries a ZIP reader can read back", () => {
    const zip = storeZip([
      { name: "a.mp3", data: Buffer.from("audio") },
      { name: "a.cues.json", data: Buffer.from("{}") },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
    // Stored entries: the bytes sit right after each local header.
    expect(zip.subarray(30 + 5, 30 + 10).toString()).toBe("audio");
  });

  (spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0 ? it : it.skip)(
    "passes unzip -t",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "zip-spec-"));
      try {
        const path = join(dir, "x.zip");
        writeFileSync(path, storeZip([{ name: "Neon (DJ Extended).mp3", data: Buffer.alloc(1000, 7) }, { name: "Neon (DJ Extended).cues.json", data: Buffer.from('{"a":1}') }]));
        expect(spawnSync("unzip", ["-t", path]).status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
