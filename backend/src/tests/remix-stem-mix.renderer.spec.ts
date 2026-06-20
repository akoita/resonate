import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildStemMixFfmpegArgs } from "../modules/remix/remix-stem-mix.renderer";
import { FfmpegStemMixRenderer } from "../modules/remix/remix-stem-mix.renderer";
import { RemixGenerationProviderError } from "../modules/remix/remix-generation.provider";
import {
  REMIX_RENDER_AUDIO_POLICY,
  type StemAudioMixer,
} from "../modules/remix/stem-audio-mixer";
import type { StorageProvider } from "../modules/storage/storage_provider";

describe("buildStemMixFfmpegArgs (#1189/#1210)", () => {
  it("preserves relative gain then applies the versioned final-render policy", () => {
    const args = buildStemMixFfmpegArgs(
      [
        { path: "/tmp/a.audio", gainDb: 0 },
        { path: "/tmp/b.audio", gainDb: -6.5 },
      ],
      "/tmp/mix.mp3",
    );
    expect(args).toEqual([
      "-y",
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "/tmp/a.audio",
      "-i",
      "/tmp/b.audio",
      "-filter_complex",
      "[0:a]volume=0dB[a0];[1:a]volume=-6.5dB[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[sum];[sum]loudnorm=I=-14:LRA=11:TP=-1.5[mix]",
      "-map",
      "[mix]",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "320k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "/tmp/mix.mp3",
    ]);
  });

  it("renders a single stem without an empty mix graph", () => {
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/solo.audio", gainDb: 2 }],
      "/tmp/mix.mp3",
    );
    expect(args.join(" ")).toContain("amix=inputs=1");
  });

  it("rejects an empty input list as invalid_input", () => {
    expect(() => buildStemMixFfmpegArgs([], "/tmp/mix.mp3")).toThrow(
      RemixGenerationProviderError,
    );
  });

  it("coerces non-finite gain to 0dB instead of emitting NaN into the graph", () => {
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: Number.NaN }],
      "/tmp/mix.mp3",
    );
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("volume=0dB");
    expect(filter).not.toContain("NaN");
  });

  it("clamps out-of-range render gain to the supported product bounds", () => {
    const args = buildStemMixFfmpegArgs(
      [
        { path: "/tmp/loud.audio", gainDb: 1e308 },
        { path: "/tmp/quiet.audio", gainDb: -100 },
      ],
      "/tmp/mix.mp3",
    );
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("volume=6dB");
    expect(filter).toContain("volume=-24dB");
    expect(filter).not.toContain("1e+308");
  });
});

describe("FfmpegStemMixRenderer metadata (#1210)", () => {
  it("returns the complete arrangement and versioned render settings", async () => {
    const renderMetadata = {
      ...REMIX_RENDER_AUDIO_POLICY,
      inputCount: 1,
      activeStemCount: 1,
    };
    const mixer = {
      mixUnmutedStems: jest.fn().mockResolvedValue({
        buffer: Buffer.from("mix"),
        mimeType: "audio/mpeg",
        stemCount: 1,
        renderMetadata,
      }),
    };
    const storage = {
      upload: jest.fn().mockResolvedValue({
        uri: "local://draft.mp3",
        provider: "local",
      }),
    };
    const renderer = new FfmpegStemMixRenderer(
      mixer as unknown as StemAudioMixer,
      storage as unknown as StorageProvider,
    );
    const arrangement = [
      { stemId: "active", gainDb: -3, muted: false },
      { stemId: "muted", gainDb: 2, muted: true },
    ];

    const job = await renderer.render({ remixProjectId: "project", stems: arrangement });

    expect(job.sourceArrangement).toEqual(arrangement);
    expect(job.renderMetadata).toEqual(renderMetadata);
    expect(job.outputMetadata.sampleRate).toBe(48_000);
  });
});

/** Minimal 16-bit mono PCM WAV so the smoke test needs no audio deps. */
function sineWav(
  frequency: number,
  seconds: number,
  sampleRate = 8000,
  amplitude = 12000,
): Buffer {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude,
    );
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
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
  "ffmpeg stem mix smoke (#1189)",
  () => {
    it("mixes two generated WAVs into a playable mp3", () => {
      const workDir = mkdtempSync(join(tmpdir(), "remix-render-spec-"));
      try {
        const a = join(workDir, "a.wav");
        const b = join(workDir, "b.wav");
        writeFileSync(a, sineWav(440, 1));
        writeFileSync(b, sineWav(660, 0.5));
        const out = join(workDir, "mix.mp3");
        const args = buildStemMixFfmpegArgs(
          [
            { path: a, gainDb: 0 },
            { path: b, gainDb: -6 },
          ],
          out,
        );
        execFileSync("ffmpeg", args, { stdio: "ignore", timeout: 60_000 });
        expect(existsSync(out)).toBe(true);
        expect(statSync(out).size).toBeGreaterThan(1000);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    });

    it("keeps an intentionally hot multi-input mix below clipping", () => {
      const workDir = mkdtempSync(join(tmpdir(), "remix-headroom-spec-"));
      try {
        const a = join(workDir, "a.wav");
        const b = join(workDir, "b.wav");
        writeFileSync(a, sineWav(440, 2, 48_000, 30_000));
        writeFileSync(b, sineWav(440, 2, 48_000, 30_000));
        const out = join(workDir, "mix.mp3");
        execFileSync(
          "ffmpeg",
          buildStemMixFfmpegArgs(
            [
              { path: a, gainDb: 0 },
              { path: b, gainDb: 0 },
            ],
            out,
          ),
          { stdio: "ignore", timeout: 60_000 },
        );
        const measured = spawnSync(
          "ffmpeg",
          ["-hide_banner", "-i", out, "-af", "volumedetect", "-f", "null", "-"],
          { encoding: "utf8", timeout: 60_000 },
        );
        expect(measured.status).toBe(0);
        const match = measured.stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBeLessThanOrEqual(-0.5);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    });

  },
);
