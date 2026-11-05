/**
 * Stem export (#2550, S6f-1 of #1903): the stem taps in the render graph, the
 * file names and manifest, the export state, the streamed zip writer, and a
 * real-ffmpeg render that checks the stems line up and keep each layer's own
 * gain.
 */
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StoredZipWriter, storeZip } from "../modules/shared/store_zip";
import { FfmpegStemMixRenderer } from "../modules/remix/remix-stem-mix.renderer";
import {
  REMIX_STEMS_SCHEMA_VERSION,
  parseRenderedStems,
  renderedStemUris,
  renderedStemsRecord,
  stemFileName,
  stemFileSlug,
  stemTapLabel,
  stemsExportState,
  stemsManifest,
  type RenderedStemFile,
} from "../modules/remix/remix-stems";
import {
  buildStemMixFfmpegArgs,
  stemTapLayer,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";

const FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

const inputs: StemMixFfmpegInput[] = [
  { path: "/tmp/a.audio", gainDb: -6, fxStemId: "vocals" },
  { path: "/tmp/b.audio", gainDb: 0, fxStemId: "drums" },
];

function filterOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

describe("stem taps in the render graph (#2550)", () => {
  it("taps every layer after its own chain and writes one 24-bit FLAC per layer", () => {
    const args = buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", null, null, [
      "/tmp/s0.flac",
      "/tmp/s1.flac",
    ]);
    const filter = filterOf(args);
    // Each layer's chain ends in a split: one copy to the mix, one tap.
    expect(filter).toContain("volume=-6dB,asplit=2[a0][t0]");
    expect(filter).toContain("volume=0dB,asplit=2[a1][t1]");
    // The taps take the mix's length from a silenced copy of the sum.
    expect(filter).toContain("[a0][a1]amix=inputs=2:duration=longest:normalize=0[sumall]");
    expect(filter).toContain("[sumall]asplit=3[sum][z0][z1]");
    expect(filter).toContain("[t1][zz1]amix=inputs=2:duration=longest:normalize=0[stem1]");
    // The loudness stage stays on the mix only.
    expect(filter).toMatch(/\[sum\][^;]*loudnorm[^;]*\[mix\]$/);
    const tail = args.slice(args.indexOf("/tmp/mix.mp3") + 1);
    expect(tail).toEqual([
      "-map", "[stem0]", "-codec:a", "flac", "-sample_fmt", "s32",
      "-bits_per_raw_sample", "24", "-ar", "48000", "-ac", "2", "/tmp/s0.flac",
      "-map", "[stem1]", "-codec:a", "flac", "-sample_fmt", "s32",
      "-bits_per_raw_sample", "24", "-ar", "48000", "-ac", "2", "/tmp/s1.flac",
    ]);
  });

  it("taps before the reverb send, so the shared space stays out of the stems", () => {
    const args = buildStemMixFfmpegArgs(
      inputs,
      "/tmp/mix.mp3",
      {
        effects: {
          schemaVersion: "remix-fx/v1",
          master: { space: 0.5 },
        } as never,
        impulsePath: "/tmp/ir.wav",
      },
      null,
      ["/tmp/s0.flac", "/tmp/s1.flac"],
    );
    const filter = filterOf(args);
    expect(filter).toContain("asplit=3[d0][s0][t0]");
    expect(filter).not.toMatch(/\[rv\][^;]*\[stem/);
  });

  it("leaves a render without stems untouched", () => {
    expect(buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", null, null, null)).toEqual(
      buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3"),
    );
    expect(() =>
      buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", null, null, ["/tmp/s0.flac"]),
    ).toThrow("one stem output per input");
  });

  it("names the layers", () => {
    expect(stemTapLayer(inputs[0], 0)).toEqual({ index: 0, kind: "stem", stemId: "vocals" });
    expect(stemTapLayer({ path: "x", gainDb: 0, beat: true }, 2)).toEqual({ index: 2, kind: "beat" });
    expect(stemTapLayer({ path: "x", gainDb: 0, part: { role: "bass" } }, 3)).toEqual({
      index: 3,
      kind: "part",
      partRole: "bass",
    });
    const labels = { vocals: "Lead Vocals" };
    expect(stemTapLabel({ index: 0, kind: "stem", stemId: "vocals" }, labels)).toBe("Lead Vocals");
    expect(stemTapLabel({ index: 1, kind: "stem", stemId: "gone" }, labels)).toBe("Stem");
    expect(stemTapLabel({ index: 2, kind: "beat" }, labels)).toBe("Beat");
    expect(stemTapLabel({ index: 3, kind: "part", partRole: "lead_synth" }, labels)).toBe("Lead synth part");
    expect(stemFileSlug("Vocals / Élan!!")).toBe("vocals-elan");
    expect(stemFileSlug("***")).toBe("layer");
    expect(stemFileName(0, "Lead Vocals")).toBe("01-lead-vocals.flac");
    expect(stemFileName(11, "Beat")).toBe("12-beat.flac");
  });
});

describe("stems record, state and manifest (#2550)", () => {
  const files: RenderedStemFile[] = [
    { name: "01-vocals.flac", kind: "stem", label: "Vocals", stemId: "vocals", uri: "gs://b/v", bytes: 10 },
    { name: "02-beat.flac", kind: "beat", label: "Beat", uri: "gs://b/beat", bytes: 20 },
  ];
  const stems = renderedStemsRecord(files);

  it("reads the record strictly", () => {
    expect(stems.schemaVersion).toBe(REMIX_STEMS_SCHEMA_VERSION);
    expect(stems.format).toEqual({ codec: "flac", bitDepth: 24, sampleRateHz: 48000, channels: 2 });
    expect(parseRenderedStems(stems)).toEqual(stems);
    expect(parseRenderedStems({ ...stems, files: [] })).toBeNull();
    expect(parseRenderedStems({ ...stems, files: [{ name: 1 }] })).toBeNull();
    expect(parseRenderedStems({ ...stems, schemaVersion: "x" })).toBeNull();
    expect(renderedStemUris(stems)).toEqual(["gs://b/v", "gs://b/beat"]);
    expect(renderedStemUris(null)).toEqual([]);
  });

  it("says why a draft has no stems", () => {
    expect(stemsExportState({ generationMetadata: null })).toEqual({ available: false, reason: "no_draft" });
    expect(stemsExportState({ generationMetadata: { status: "processing", stems } })).toEqual({
      available: false,
      reason: "no_draft",
    });
    expect(stemsExportState({ generationMetadata: { status: "completed" } })).toEqual({
      available: false,
      reason: "no_stems",
    });
    expect(stemsExportState({ generationMetadata: { status: "completed", stems } })).toEqual({
      available: true,
      reason: null,
    });
  });

  it("writes the manifest without storage URIs", () => {
    const manifest = stemsManifest({
      stems,
      title: "Night Drive",
      draftGrid: { bpm: 120, downbeatsSec: [0, 2, 4] },
      lineage: {
        remixProjectId: "p1",
        sourceTrackId: "t1",
        sourceReleaseId: "r1",
        generationJobId: "j1",
        policyVersion: "v6",
      },
    });
    expect(manifest.schemaVersion).toBe("resonate-stems/v1");
    expect(manifest.tempo).toEqual({ bpm: 120, downbeatsSec: [0, 2, 4] });
    expect(manifest.files.map((f) => f.name)).toEqual(["01-vocals.flac", "02-beat.flac"]);
    expect(JSON.stringify(manifest)).not.toContain("gs://");
  });
});

describe("streamed zip writer (#2550)", () => {
  it("writes the same bytes as the buffered zip, entry by entry", () => {
    const entries = [
      { name: "stems.json", data: Buffer.from("{}\n") },
      { name: "01-vocals.flac", data: Buffer.alloc(1000, 7) },
    ];
    const chunks: Buffer[] = [];
    const writer = new StoredZipWriter((chunk) => chunks.push(chunk));
    writer.add(entries[0]);
    const afterFirst = chunks.length;
    writer.add(entries[1]);
    writer.finish();
    expect(afterFirst).toBeGreaterThan(0);
    expect(Buffer.concat(chunks)).toEqual(storeZip(entries));
  });
});

function decodeMono(path: string): Float32Array {
  const raw = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "pipe:1"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

function rmsDb(x: Float32Array, fromSec: number, toSec: number): number {
  const a = Math.floor(fromSec * 48000);
  const b = Math.floor(toSec * 48000);
  let sum = 0;
  for (let i = a; i < b; i++) sum += x[i] * x[i];
  return 10 * Math.log10(sum / (b - a) + 1e-20);
}

(FFMPEG ? describe : describe.skip)("stem render (real ffmpeg)", () => {
  it("writes aligned stems of the mix's length, each with its own gain", () => {
    const dir = mkdtempSync(join(tmpdir(), "remix-stems-spec-"));
    try {
      const a = join(dir, "a.wav");
      const b = join(dir, "b.wav");
      for (const [path, spec] of [
        [a, "sine=frequency=440:duration=2:sample_rate=48000"],
        [b, "sine=frequency=880:duration=3:sample_rate=48000"],
      ]) {
        execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", spec, path]);
      }
      const outs = [join(dir, "s0.flac"), join(dir, "s1.flac")];
      execFileSync(
        "ffmpeg",
        buildStemMixFfmpegArgs(
          [
            { path: a, gainDb: -6, fxStemId: "a" },
            { path: b, gainDb: 0, fxStemId: "b" },
          ],
          join(dir, "mix.mp3"),
          null,
          null,
          outs,
        ),
      );
      const probe = execFileSync("ffprobe", [
        "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_raw_sample",
        "-of", "csv=p=0", outs[0],
      ]).toString().trim();
      expect(probe).toBe("flac,48000,2,24");
      const s0 = decodeMono(outs[0]);
      const s1 = decodeMono(outs[1]);
      const src = decodeMono(a);
      // Same length (the longest layer), both from 0.
      expect(s0.length).toBe(s1.length);
      expect(Math.abs(s0.length - 3 * 48000)).toBeLessThan(48);
      // The −6 dB layer is −6 dB of its source, then silent after its end.
      expect(Math.abs(rmsDb(s0, 0.5, 1.5) - (rmsDb(src, 0.5, 1.5) - 6))).toBeLessThan(0.1);
      expect(rmsDb(s0, 2.2, 2.9)).toBeLessThan(-100);
      // The 0 dB layer is its source, sample for sample.
      const srcB = decodeMono(b);
      expect(Math.abs(rmsDb(s1, 2.2, 2.9) - rmsDb(srcB, 2.2, 2.9))).toBeLessThan(0.01);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stem-mix renderer stores each stem (#2550)", () => {
  function harness(failAfterStems = false) {
    const dir = mkdtempSync(join(tmpdir(), "remix-stems-renderer-"));
    const uploads: Array<{ filename: string; mimeType: string; size: number }> = [];
    const deleted: string[] = [];
    const storage = {
      upload: jest.fn(async (data: Buffer, filename: string, mimeType: string) => {
        uploads.push({ filename, mimeType, size: data.length });
        return { uri: `local://${filename}`, provider: "local" };
      }),
      delete: jest.fn(async (uri: string) => {
        deleted.push(uri);
      }),
    };
    const mixer = {
      mixUnmutedStems: jest.fn(async (...args: unknown[]) => {
        const options = args[6] as { stemTaps?: (layer: unknown, path: string) => Promise<void> } | undefined;
        if (options?.stemTaps) {
          for (const [index, layer] of [
            { index: 0, kind: "stem", stemId: "s-vocals" },
            { index: 1, kind: "beat" },
          ].entries()) {
            const path = join(dir, `t${index}.flac`);
            writeFileSync(path, Buffer.alloc(10 + index));
            await options.stemTaps(layer, path);
          }
        }
        if (failAfterStems) throw new Error("mix failed");
        return {
          buffer: Buffer.from("mix"),
          mimeType: "audio/mpeg",
          stemCount: 1,
          renderMetadata: { outputSampleRateHz: 48000 },
        };
      }),
    };
    return { dir, uploads, deleted, renderer: new FfmpegStemMixRenderer(mixer as never, storage as never), mixer };
  }

  const input = {
    remixProjectId: "p1",
    stems: [{ stemId: "s-vocals", gainDb: 0, muted: false }],
    authorization: { userId: "u", remixProjectId: "p1", authorizedStemIds: new Set(["s-vocals"]) },
    renderStems: { stemLabels: { "s-vocals": "Vocals" } },
  };

  it("uploads one FLAC per layer and records them", async () => {
    const h = harness();
    try {
      const job = (await h.renderer.render(input as never)) as {
        renderedStems: { files: RenderedStemFile[] };
      };
      expect(h.uploads.slice(0, 2).map((u) => [u.mimeType, u.size])).toEqual([
        ["audio/flac", 10],
        ["audio/flac", 11],
      ]);
      expect(h.uploads[0].filename).toMatch(/^remix-stem-p1-.+-01-vocals\.flac$/);
      expect(job.renderedStems.files.map((f: RenderedStemFile) => [f.name, f.kind, f.label, f.bytes])).toEqual([
        ["01-vocals.flac", "stem", "Vocals", 10],
        ["02-beat.flac", "beat", "Beat", 11],
      ]);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  it("removes the stems it stored when the render fails", async () => {
    const h = harness(true);
    try {
      await expect(h.renderer.render(input as never)).rejects.toThrow("mix failed");
      expect(h.deleted).toHaveLength(2);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  it("asks the mixer only for the watermark without the stems option", async () => {
    const h = harness();
    try {
      const job = await h.renderer.render({ ...input, renderStems: undefined } as never);
      // #2573: only the watermark option, no stem taps.
      expect(h.mixer.mixUnmutedStems.mock.calls[0][6]).toEqual({ watermark: true });
      expect(job.renderedStems).toBeUndefined();
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
});
