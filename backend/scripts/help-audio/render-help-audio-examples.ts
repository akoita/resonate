#!/usr/bin/env npx ts-node
/**
 * Regenerates the User Guide's Remix Studio audio examples (#1943).
 *
 * It (1) synthesizes the purpose-made demo song (demo-song.ts: four stems, no
 * third-party audio), then (2) renders each example THROUGH THE STUDIO'S OWN
 * RENDER CODE: the same ffmpeg filter graph the server builds for a draft
 * (`buildStemMixFfmpegArgs`: varispeed, per-stem echo, the code-generated reverb
 * impulse, structure blocks with fades, the versioned loudness policy), driven
 * by the same recipes the studio's controls produce (`applyVibe` and
 * `shortEdit` from web/src/lib). The "AI Bass" example goes through the same
 * part pipeline as a generated take (prompt -> clip -> conform -> loop ->
 * placement), but the clip comes from the studio's deterministic stub
 * generator, not an AI model (see the description in the guide).
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/help-audio/render-help-audio-examples.ts \
 *     [--out ../web/public/help/audio] [--stems-dir <dir to keep the stem WAVs>]
 *
 * Needs `ffmpeg` (>= 7) on PATH. No network, no paid APIs, no database. The
 * only difference from a studio draft is the output bitrate (128 kbps instead
 * of the draft's 320 kbps, to keep the guide light); the loudness policy and
 * the filter graph are the draft's.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { promisify } from "util";

import {
  deriveSectionGrid,
  type SectionGrid,
} from "../../src/modules/remix/remix-arrangement";
import {
  normalizeRemixFxInput,
  buildImpulseWav,
  type RemixFxRecipe,
} from "../../src/modules/remix/remix-fx";
import {
  PART_SAMPLE_RATE,
  conformPartClip,
  type PartConformTarget,
} from "../../src/modules/remix/remix-part-conform";
import {
  buildPartPrompt,
  decodePartTakeLoop,
  partLengthSeconds,
  partPlacementSpans,
  writePartTrackWav,
} from "../../src/modules/remix/remix-parts";
import {
  encodeStubWav,
  parseStubPartPrompt,
  synthesizeStubPartClip,
} from "../../src/modules/remix/remix-part-stub-clip";
import {
  normalizeRemixStructureInput,
  structureTimeline,
  timelineDurationSec,
  type RemixStructureBlock,
} from "../../src/modules/remix/remix-structure";
import {
  REMIX_RENDER_AUDIO_POLICY,
  buildStemMixFfmpegArgs,
  resolveAfirUnityGainOptions,
  stemMixReverbSends,
  type StemMixFfmpegInput,
} from "../../src/modules/remix/stem-audio-mixer";
// The studio's own recipe builders (pure TypeScript, no browser APIs).
import { applyVibe } from "../../../web/src/lib/remixFx";
import { identityBlocks, shortEdit } from "../../../web/src/lib/remixStructure";

import {
  DEMO_BARS,
  DEMO_BPM,
  DEMO_DURATION_SEC,
  DEMO_KEY,
  DEMO_SAMPLE_RATE,
  DEMO_STEM_NAMES,
  synthesizeDemoStems,
  type DemoStemName,
} from "./demo-song";

const execFileAsync = promisify(execFile);

/** Web delivery bitrate; the graph and loudness policy are the draft's. */
const GUIDE_BITRATE_KBPS = 128;
/** Seed of the stub bass clip (the issue number). */
const AI_BASS_SEED = 1943;
/** Level of the example's bass part: the stub clip is quieter than the song's bass stem. */
const AI_BASS_GAIN_DB = 6;
/** Echo level for the vocals example (Echo slider 60%). */
const VOCAL_ECHO = 0.6;
/** The middle 8-bar section of the demo song: every instrument plays. */
const SHOWCASE_SECTION = 1;

type ClipSpec = {
  id: string;
  file: string;
  /** What the guide says it shows. */
  summary: string;
  mutedStems: DemoStemName[];
  effects: RemixFxRecipe | null;
  blocks: RemixStructureBlock[];
  aiBass: boolean;
};

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function buildGrid(): SectionGrid {
  const grid = deriveSectionGrid([
    {
      audioFeatures: {
        tempoBpm: DEMO_BPM,
        tempoConfidence: 5,
        firstBeatSec: 0,
        durationSeconds: DEMO_DURATION_SEC,
      },
    },
  ]);
  if (!grid || grid.kind !== "bars" || grid.sections.length !== DEMO_BARS / 8) {
    throw new Error("The demo song does not derive the expected three-section bar grid.");
  }
  return grid;
}

function clipSpecs(grid: SectionGrid): ClipSpec[] {
  const stems = DEMO_STEM_NAMES.map((name) => ({ stemId: name, type: name }));
  const showcase: RemixStructureBlock[] = [{ section: SHOWCASE_SECTION }];

  const slowed = normalizeRemixFxInput(
    applyVibe("slowed_reverb", null, stems),
    DEMO_STEM_NAMES,
  );
  if ("error" in slowed) throw new Error(slowed.error);
  const echo = normalizeRemixFxInput(
    { schemaVersion: "remix-fx/v3", stems: { vocals: { echo: VOCAL_ECHO } } },
    DEMO_STEM_NAMES,
  );
  if ("error" in echo) throw new Error(echo.error);

  const edit = shortEdit(grid, {
    sectionCount: grid.sections.length,
    blocks: identityBlocks(grid.sections.length),
    masks: {},
  });
  if (!edit) throw new Error("shortEdit refused the demo grid.");
  // Through the server's own validation, like a PATCH of the studio's structure.
  const editStructure = normalizeRemixStructureInput(edit.structure, grid.sections.length);
  if ("error" in editStructure || !editStructure.value) {
    throw new Error("The server did not accept the Short edit structure.");
  }

  return [
    {
      id: "original",
      file: "remix-demo-original.mp3",
      summary: "The middle section of the demo song, no effects.",
      mutedStems: [],
      effects: null,
      blocks: showcase,
      aiBass: false,
    },
    {
      id: "slowed-reverb",
      file: "remix-demo-slowed-reverb.mp3",
      summary: "The same section with the Slowed + reverb vibe.",
      mutedStems: [],
      effects: slowed.value,
      blocks: showcase,
      aiBass: false,
    },
    {
      id: "vocal-echo",
      file: "remix-demo-vocal-echo.mp3",
      summary: "The same section with the Echo slider on the Vocals only.",
      mutedStems: [],
      effects: echo.value,
      blocks: showcase,
      aiBass: false,
    },
    {
      id: "short-edit",
      file: "remix-demo-short-edit.mp3",
      summary: "The whole demo song as a Short edit: two of three sections, fading out.",
      mutedStems: [],
      effects: null,
      blocks: editStructure.value.blocks,
      aiBass: false,
    },
    {
      id: "ai-bass",
      file: "remix-demo-ai-bass.mp3",
      summary:
        "The same section with the song's own bass switched off and a bass part added (generated by the studio's built-in test generator, not an AI model).",
      mutedStems: ["bass"],
      effects: null,
      blocks: showcase,
      aiBass: true,
    },
  ];
}

async function ffmpegVersion(): Promise<string> {
  const { stdout } = await execFileAsync("ffmpeg", ["-version"]);
  return String(stdout).split("\n")[0].trim();
}

type Loudness = { integratedLufs: number; lra: number; truePeakDbtp: number; durationSec: number };

/** ebur128 summary (integrated loudness, LRA, true peak) and the decoded duration. */
async function measure(path: string): Promise<Loudness> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const text = String(stderr);
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const grab = (re: RegExp) => {
    const match = re.exec(summary);
    if (!match) throw new Error(`Could not read ${re} from the loudness summary.`);
    return Number(match[1]);
  };
  const header = /Duration: (\d+):(\d+):([0-9.]+)/.exec(text);
  if (!header) throw new Error("Could not read the clip duration.");
  const durationSec = Number(header[1]) * 3600 + Number(header[2]) * 60 + Number(header[3]);
  return {
    integratedLufs: grab(/I:\s+(-?[0-9.]+) LUFS/),
    lra: grab(/LRA:\s+(-?[0-9.]+) LU/),
    truePeakDbtp: grab(/Peak:\s+(-?[0-9.]+) dBFS/),
    durationSec,
  };
}

/** RMS level in dBFS of an audio file (used to balance the bass part against the song's bass). */
async function rmsDb(path: string): Promise<number> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", path, "-af", "astats=metadata=0", "-f", "null", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const overall = String(stderr).split("Overall")[1] ?? "";
  const match = /RMS level dB:\s+(-?[0-9.]+)/.exec(overall);
  if (!match) throw new Error("Could not read the RMS level.");
  return Number(match[1]);
}

/** The AI-part pipeline with the studio's stub generator, down to a timeline-time track WAV. */
async function buildBassPartTrack(
  workDir: string,
  grid: SectionGrid,
  blocks: RemixStructureBlock[],
): Promise<{ trackPath: string; record: Record<string, unknown> }> {
  const bpm = grid.bpm!;
  const bars = 4;
  const key = { ...DEMO_KEY, confidence: 0.9 };
  const prompt = buildPartPrompt({ role: "bass", style: null, bpm, key });
  const parsed = parseStubPartPrompt(prompt.prompt);
  if (parsed.bpm === null) throw new Error("The part prompt carries no tempo.");
  const clip = synthesizeStubPartClip({
    role: parsed.role,
    bpm: parsed.bpm,
    key: parsed.key,
    seed: AI_BASS_SEED,
  });
  const target: PartConformTarget = { bpm, bars, pitched: true, key };
  const conformed = await conformPartClip(encodeStubWav(clip.channels, clip.sampleRate), target, {
    useWorker: false,
  });
  const flacPath = join(workDir, "bass-take.flac");
  await writeFile(flacPath, conformed.flac);
  const loop = await decodePartTakeLoop(flacPath, join(workDir, "bass-take.f32"));

  const segments = structureTimeline(grid, blocks);
  const spans = partPlacementSpans({ blocks: null }, grid, segments, partLengthSeconds(bpm, bars));
  const trackPath = join(workDir, "bass-part.wav");
  await writePartTrackWav(trackPath, loop, spans, timelineDurationSec(segments), PART_SAMPLE_RATE);
  return {
    trackPath,
    record: {
      role: "bass",
      bars,
      seed: AI_BASS_SEED,
      prompt: prompt.prompt,
      conformVersion: conformed.record.conformVersion,
      source: "studio stub generator (deterministic synthesis), not an AI model",
    },
  };
}

async function main(): Promise<void> {
  const outDir = resolve(argValue("--out") ?? join(__dirname, "../../../web/public/help/audio"));
  const keepStems = argValue("--stems-dir");
  const workDir = await mkdtemp(join(tmpdir(), "help-audio-"));
  try {
    await mkdir(outDir, { recursive: true });

    // 1. The demo song's stems.
    const started = Date.now();
    const stemDir = keepStems ? resolve(keepStems) : join(workDir, "stems");
    await mkdir(stemDir, { recursive: true });
    const stemInfo: Record<string, { sha256: string; seconds: number }> = {};
    const stemPaths = new Map<DemoStemName, string>();
    for (const stem of synthesizeDemoStems()) {
      const wav = encodeStubWav(stem.channels, DEMO_SAMPLE_RATE);
      const path = join(stemDir, `demo-${stem.name}.wav`);
      await writeFile(path, wav);
      stemPaths.set(stem.name, path);
      stemInfo[stem.name] = { sha256: sha256(wav), seconds: stem.channels[0].length / DEMO_SAMPLE_RATE };
      console.log(`stem ${stem.name.padEnd(7)} ${(wav.length / 1e6).toFixed(1)} MB  sha256 ${stemInfo[stem.name].sha256.slice(0, 16)}`);
    }
    console.log(`synthesized ${DEMO_STEM_NAMES.length} stems in ${((Date.now() - started) / 1000).toFixed(1)} s`);

    // 2. Render each example through the studio's graph.
    const grid = buildGrid();
    const impulsePath = join(workDir, "reverb-ir.wav");
    await writeFile(impulsePath, buildImpulseWav());
    const afirOptions = await resolveAfirUnityGainOptions();
    const clips: Array<Record<string, unknown>> = [];

    for (const spec of clipSpecs(grid)) {
      const structure = normalizeRemixStructureInput(
        { schemaVersion: "remix-structure/v1", blocks: spec.blocks },
        grid.sections.length,
      );
      if ("error" in structure) throw new Error(structure.error);
      const blocks = structure.value?.blocks ?? spec.blocks;
      const segments = structureTimeline(grid, blocks);

      const inputs: StemMixFfmpegInput[] = DEMO_STEM_NAMES.filter(
        (name) => !spec.mutedStems.includes(name),
      ).map((name) => ({
        path: stemPaths.get(name)!,
        gainDb: 0,
        activeIntervals: null,
        fxStemId: name,
      }));

      let partRecord: Record<string, unknown> | undefined;
      if (spec.aiBass) {
        const part = await buildBassPartTrack(workDir, grid, blocks);
        partRecord = part.record;
        console.log(
          `bass part track RMS ${(await rmsDb(part.trackPath)).toFixed(1)} dBFS before its ${AI_BASS_GAIN_DB} dB part level (song bass stem: ${(await rmsDb(stemPaths.get("bass")!)).toFixed(1)} dBFS)`,
        );
        inputs.push({ path: part.trackPath, gainDb: AI_BASS_GAIN_DB, part: { role: "bass" } });
      }

      const needsImpulse = stemMixReverbSends(inputs, spec.effects).some((wet) => wet > 0);
      const outputPath = join(outDir, spec.file);
      const args = buildStemMixFfmpegArgs(
        inputs,
        outputPath,
        {
          effects: spec.effects,
          bpm: grid.bpm,
          impulsePath: needsImpulse ? impulsePath : null,
          ...(needsImpulse ? { afirOptions } : {}),
        },
        { segments },
      );
      const bitrateIndex = args.indexOf("-b:a");
      if (bitrateIndex < 0 || args[bitrateIndex + 1] !== `${REMIX_RENDER_AUDIO_POLICY.outputBitrateKbps}k`) {
        throw new Error("Unexpected output arguments from the studio's render graph.");
      }
      args[bitrateIndex + 1] = `${GUIDE_BITRATE_KBPS}k`;

      const renderStarted = Date.now();
      await execFileAsync("ffmpeg", args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
      const bytes = await readFile(outputPath);
      const loudness = await measure(outputPath);
      const size = (await stat(outputPath)).size;
      console.log(
        `${spec.file.padEnd(32)} ${loudness.durationSec.toFixed(2).padStart(6)} s  ${(size / 1024).toFixed(0).padStart(4)} KiB  ` +
          `${loudness.integratedLufs.toFixed(1)} LUFS  LRA ${loudness.lra.toFixed(1)}  TP ${loudness.truePeakDbtp.toFixed(1)} dBTP  ` +
          `(${((Date.now() - renderStarted) / 1000).toFixed(1)} s)`,
      );
      clips.push({
        id: spec.id,
        file: spec.file,
        summary: spec.summary,
        durationSec: Math.round(loudness.durationSec * 100) / 100,
        bytes: size,
        integratedLufs: loudness.integratedLufs,
        loudnessRangeLu: loudness.lra,
        truePeakDbtp: loudness.truePeakDbtp,
        sha256: sha256(bytes),
        recipe: {
          effects: spec.effects,
          structureBlocks: blocks,
          mutedStems: spec.mutedStems,
          ...(partRecord ? { part: { ...partRecord, gainDb: AI_BASS_GAIN_DB } } : {}),
        },
      });
    }

    // 3. Machine-readable provenance record next to the audio.
    const policy = REMIX_RENDER_AUDIO_POLICY;
    const manifest = {
      generator: "backend/scripts/help-audio/render-help-audio-examples.ts",
      source: {
        title: "Resonate Help Demo",
        synthesizer: "backend/scripts/help-audio/demo-song.ts",
        tempoBpm: DEMO_BPM,
        key: `${DEMO_KEY.tonic} ${DEMO_KEY.mode}`,
        bars: DEMO_BARS,
        durationSec: DEMO_DURATION_SEC,
        sampleRateHz: DEMO_SAMPLE_RATE,
        stems: stemInfo,
        thirdPartyAudio: false,
        licence: "Project-generated; no third-party audio. Same licence as this repository.",
      },
      render: {
        graph: "buildStemMixFfmpegArgs (backend/src/modules/remix/stem-audio-mixer.ts)",
        loudnessPolicy: `${policy.schemaVersion}: ${policy.targetLufs} LUFS, LRA ${policy.loudnessRangeLufs}, true peak ${policy.truePeakDbtp} dBTP`,
        outputBitrateKbps: GUIDE_BITRATE_KBPS,
        sampleRateHz: policy.outputSampleRateHz,
        channels: policy.outputChannels,
        node: process.version,
        ffmpeg: await ffmpegVersion(),
      },
      clips,
    };
    await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${clips.length} clips and manifest.json to ${outDir}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
