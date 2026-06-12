import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildStemMixFfmpegArgs } from "../modules/remix/remix-stem-mix.renderer";
import { RemixGenerationProviderError } from "../modules/remix/remix-generation.provider";

describe("buildStemMixFfmpegArgs (#1189)", () => {
  it("builds per-input volume filters and a non-normalizing amix", () => {
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
      "-i",
      "/tmp/a.audio",
      "-i",
      "/tmp/b.audio",
      "-filter_complex",
      "[0:a]volume=0dB[a0];[1:a]volume=-6.5dB[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[mix]",
      "-map",
      "[mix]",
      "-b:a",
      "320k",
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
});

/** Minimal 16-bit mono PCM WAV so the smoke test needs no audio deps. */
function sineWav(frequency: number, seconds: number, sampleRate = 8000): Buffer {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 12000,
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
  },
);
