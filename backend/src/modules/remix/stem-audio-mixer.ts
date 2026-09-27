import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { prisma } from "../../db/prisma";
import {
  EncryptionService,
  RenderDecryptionError,
} from "../encryption/encryption.service";
import { StorageProvider } from "../storage/storage_provider";
import {
  RemixGenerationProviderError,
  type RemixRenderMetadata,
  type StemArrangementEntry,
  type StemRenderAuthorization,
} from "./remix-generation.provider";
import { normalizeRemixStemGainDb } from "./remix-gain";
import {
  buildSectionGateVolumeExpression,
  type SectionInterval,
} from "./remix-arrangement";
import {
  echoTaps,
  panGains,
  REMIX_FX_DSP_VERSION,
  REMIX_FX_EQ_BANDS,
  REMIX_FX_FILTER_Q,
  REMIX_FX_IMPULSE,
  REMIX_FX_PRO_DSP_VERSION,
  REMIX_FX_SCHEMA_VERSION,
  remixFxSpeed,
  remixFxUsesPro,
  stemEqStages,
  remixFxStretchPlan,
  remixFxVarispeedRate,
  reverbWet,
  toneFilter,
  warmthK,
  writeImpulseWav,
  type RemixFxRecipe,
  type RemixFxStem,
  type RemixRenderFx,
} from "./remix-fx";
import {
  JOIN_FADE_SECONDS,
  masterFadeRamps,
  REMIX_STRUCTURE_DSP_VERSION,
  type RemixMasterFadeRamp,
  type RemixRenderStructure,
  type RemixStructureSegment,
} from "./remix-structure";
import {
  beatTimingAtSpeed,
  REMIX_BEAT_DSP_VERSION,
  REMIX_BEAT_RENDER_SAMPLE_RATE,
  writeBeatWav,
  type RemixRenderBeat,
} from "./remix-beat";
import {
  decodePartTakeLoop,
  partLengthSeconds,
  partPlacementSpans,
  partStretchPlan,
  REMIX_PARTS_DSP_VERSION,
  renderedPartLineage,
  writePartTrackWav,
  type PartSkippedReason,
  type RemixRenderedPart,
  type RemixRenderParts,
} from "./remix-parts";
import {
  REMIX_STRETCH_CHANNELS,
  REMIX_STRETCH_DITHER_SEED_BASE,
  REMIX_STRETCH_SAMPLE_RATE,
  remixStretchMetadata,
  stretchRawFileToWavInWorker,
} from "./remix-stretch";

const execFileAsync = promisify(execFile);

export const STEM_AUDIO_MIXER = "STEM_AUDIO_MIXER";

const FFMPEG_TIMEOUT_MS = 120_000;
/**
 * Stems stretched at once (#1898): each stretch is a worker thread at ~30×
 * realtime; a small pool bounds CPU, heap and temp-dir use per render.
 */
export const STRETCH_POOL_SIZE = 2;

/**
 * Product audio policy, not environment configuration. Identical saved
 * arrangements must render identically across environments; changing any
 * value requires a schema-version bump so old drafts remain auditable.
 */
export const REMIX_RENDER_AUDIO_POLICY = Object.freeze({
  schemaVersion: "remix-render-policy/v1",
  targetLufs: -14,
  loudnessRangeLufs: 11,
  truePeakDbtp: -1.5,
  outputCodec: "mp3" as const,
  outputMimeType: "audio/mpeg" as const,
  outputBitrateKbps: 320,
  outputSampleRateHz: 48_000,
  outputChannels: 2,
});

// Re-exported for back-compat: the canonical definition lives in the provider
// boundary so RemixGenerationInput and the mixer share one type.
export type { StemArrangementEntry };

export type MixedStemAudio = {
  buffer: Buffer;
  mimeType: string;
  /** Number of unmuted stems that went into the mix. */
  stemCount: number;
  renderMetadata: RemixRenderMetadata;
};

export type AudioBufferMixInput = {
  buffer: Buffer;
  mimeType: string;
  gainDb?: number | null;
  label: string;
};

export type MixedAudioBuffers = {
  buffer: Buffer;
  mimeType: string;
  inputCount: number;
  renderMetadata: RemixRenderMetadata;
};

/**
 * Mixes a project's unmuted stems into one audio buffer. Extracted from the
 * stem_mix renderer (#1189) so audio-conditioned generation (#1182 slice 4)
 * conditions on exactly what the user arranged, and the encrypted-stem
 * decrypt-for-render boundary (#1214) + path-traversal containment live in one
 * place.
 *
 * Every caller passes a {@link StemRenderAuthorization} the generation worker
 * built after re-verifying project ownership and current eligibility. Encrypted
 * source stems are decrypted in memory into the mixer's unique temp dir and
 * never persisted or returned individually.
 */
export interface StemAudioMixer {
  /**
   * @param fx Shared effects recipe (#1897) + grid tempo; absent = the
   *   pre-#1897 graph, byte-identical.
   * @param structure Structure blocks (#1899) + derived timeline; absent =
   *   the original section order, byte-identical. Stem `activeIntervals` are
   *   then in timeline time (block-indexed masks).
   * @param beat Beat maker recipe (#1902) + bar grid + timeline; absent = no
   *   beat, byte-identical. Rendered to a 48 kHz track in the temp dir and
   *   mixed as one extra input.
   * @param parts AI parts (#1901) + bar grid + timeline; absent = no parts,
   *   byte-identical. Each part's take is fetched through the storage
   *   provider into the temp dir, laid out on the timeline and mixed as one
   *   extra input; skipped parts are only recorded.
   */
  mixUnmutedStems(
    stems: StemArrangementEntry[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
    structure?: RemixRenderStructure,
    beat?: RemixRenderBeat,
    parts?: RemixRenderParts,
  ): Promise<MixedStemAudio>;
  mixUnmutedStemsWithAudioBuffers(
    stems: StemArrangementEntry[],
    inputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
    structure?: RemixRenderStructure,
    beat?: RemixRenderBeat,
    parts?: RemixRenderParts,
  ): Promise<MixedAudioBuffers>;
}

export type StemMixFfmpegInput = {
  path: string;
  gainDb: number;
  /** Section-grid gating (#1314); undefined/null = play the whole stem. */
  activeIntervals?: SectionInterval[] | null;
  /** Project stem id keying this input's per-stem fx (#1897). */
  fxStemId?: string;
  /**
   * The input file's channel count, probed only for a source stem with a Pro
   * pan (#1903): 1 inserts the explicit unity mono → stereo up-mix before
   * the pan. Absent = stereo.
   */
  channels?: number;
  /**
   * AI-generated layer input (#1209): varispeed applies, per-stem fx do not,
   * and it sends `master.space` to the reverb bus (#1897).
   */
  aiLayer?: boolean;
  /**
   * The synthesized beat track (#1902): a mono WAV already in timeline time
   * with block on/off baked in. Varispeed and its gain apply; per-stem fx,
   * gating and the structure front end do not; it sends `master.space` to the
   * reverb bus like an AI layer. With keepPitch (#1898) the track is already
   * in output time and the varispeed rate is 1.
   */
  beat?: boolean;
  /**
   * An AI part track (#1901): a stereo WAV already in timeline time with its
   * blocks and loop phase baked in, like the beat. Varispeed and its gain
   * (stem gain rules) apply; per-stem fx, gating and the structure front end
   * do not; it sends `master.space` to the reverb bus like an AI layer. It
   * goes through the time-stretch pre-stage like a stem (drums never
   * transposed).
   */
  part?: { role: string };
};

/** Effects context for {@link buildStemMixFfmpegArgs} (#1897). */
export type StemMixFfmpegFx = {
  effects: RemixFxRecipe | null;
  /** Grid tempo for echo timing; null/undefined = the 0.375 s fallback. */
  bpm?: number | null;
  /** Stereo reverb IR WAV; required when any input sends to the reverb bus. */
  impulsePath?: string | null;
  /**
   * afir options that disable its IR auto-gain so the bus is a plain
   * convolution with the energy-normalized IR. ffmpeg >= 7 needs
   * `irnorm=-1` (default); `gtype` is a deprecated no-op there.
   */
  afirOptions?: string;
};

/**
 * Structure context for {@link buildStemMixFfmpegArgs} (#1899): the derived
 * timeline (see remix-structure.ts). Empty/absent = the original order.
 */
export type StemMixFfmpegStructure = {
  segments: RemixStructureSegment[];
};

/** Default afir options: no IR normalization (ffmpeg >= 7.0). */
export const AFIR_UNITY_GAIN_OPTIONS = "irnorm=-1";

/**
 * Pure arg construction (unit-tested without ffmpeg). Inputs are passed as an
 * execFile argument array — stem-derived values are never interpolated into a
 * shell string. Per-stem gain applies as an ffmpeg volume filter (dB), then
 * amix sums to the longest input without renormalizing each source down,
 * matching the studio's preview gain model.
 *
 * With a non-null effects recipe (#1897) and/or a structure timeline (#1899)
 * the graph gains the remix-fx/v1 chain and the structure front end (see
 * {@link buildFxStemMixFilter}); without either the args are byte-identical
 * to the pre-#1897 graph, and without a structure they are byte-identical to
 * the #1897 graph.
 */
export function buildStemMixFfmpegArgs(
  inputs: StemMixFfmpegInput[],
  outputPath: string,
  fx?: StemMixFfmpegFx | null,
  structure?: StemMixFfmpegStructure | null,
): string[] {
  if (inputs.length === 0) {
    throw new RemixGenerationProviderError(
      "invalid_input",
      "A stem mix render needs at least one unmuted stem.",
      false,
    );
  }
  // -loglevel error keeps execFile's stderr buffer tiny on long renders.
  const args: string[] = ["-y", "-nostdin", "-hide_banner", "-loglevel", "error"];
  const hasStructure = !!structure && structure.segments.length > 0;
  // A beat (#1902) or AI part (#1901) input needs the fx graph; without one
  // nothing changes.
  const hasAddedTrack = inputs.some((input) => input.beat || input.part);
  if (fx?.effects || hasStructure || hasAddedTrack) {
    const renderFx: StemMixFfmpegFx = fx ?? { effects: null };
    const segments = hasStructure
      ? stretchedSourceSegments(structure!.segments, renderFx.effects)
      : null;
    // One ffmpeg input per source run with a structure (#1899): every run of
    // one stem reads the same (already decrypted) temp file.
    for (const plan of ffmpegInputPlan(inputs, segments)) {
      for (const source of plan.sources) {
        if (source.run) {
          args.push(
            "-ss",
            fxNum(source.run.seekSec),
            "-t",
            fxNum(source.run.readSec),
          );
        }
        args.push("-i", source.path);
      }
    }
    const { filter, needsImpulse } = buildFxStemMixFilter(
      inputs,
      renderFx,
      hasStructure ? structure : null,
    );
    if (needsImpulse) {
      if (!renderFx.impulsePath) {
        throw new Error("A reverb send needs the impulse response file path.");
      }
      args.push("-i", renderFx.impulsePath);
    }
    return pushOutputArgs(args, filter, outputPath);
  }
  for (const input of inputs) {
    args.push("-i", input.path);
  }
  const labelled = inputs.map((input, index) => {
    const gain = normalizeRemixStemGainDb(input.gainDb);
    // Section gating (#1314) applies after the user's static gain: a generated
    // per-frame volume envelope with short edge fades. The expression contains
    // only validated numeric spans (commas escaped for the filtergraph
    // parser), never user strings. Fully-active stems skip the filter so
    // untouched arrangements render byte-identically to pre-#1314.
    const gate =
      input.activeIntervals && input.activeIntervals.length > 0
        ? `,volume=volume=${buildSectionGateVolumeExpression(input.activeIntervals)}:eval=frame`
        : "";
    return `[${index}:a]volume=${gain}dB${gate}[a${index}]`;
  });
  const mixInputs = inputs.map((_, index) => `[a${index}]`).join("");
  const filter = `${labelled.join(";")};${mixInputs}amix=inputs=${inputs.length}:duration=longest:normalize=0[sum];[sum]${loudnormFilter()}[mix]`;
  return pushOutputArgs(args, filter, outputPath);
}

function loudnormFilter(): string {
  const policy = REMIX_RENDER_AUDIO_POLICY;
  return `loudnorm=I=${policy.targetLufs}:LRA=${policy.loudnessRangeLufs}:TP=${policy.truePeakDbtp}`;
}

function pushOutputArgs(
  args: string[],
  filter: string,
  outputPath: string,
): string[] {
  const policy = REMIX_RENDER_AUDIO_POLICY;
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[mix]",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${policy.outputBitrateKbps}k`,
    "-ar",
    String(policy.outputSampleRateHz),
    "-ac",
    String(policy.outputChannels),
    outputPath,
  );
  return args;
}

/** Filter-graph number: finite, ≤ 6 decimals, never exponent notation. */
function fxNum(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Non-finite value in the effects filter graph.");
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
}

function fxToneFilter(tone: number | undefined): string | null {
  const filter = toneFilter(tone ?? 0);
  if (!filter) return null;
  return `${filter.type}=f=${fxNum(filter.frequencyHz)}:width_type=q:width=${fxNum(REMIX_FX_FILTER_Q)}`;
}

/**
 * Pro stages of one source stem (#1903 S6a, remix-fx-pro-dsp/v1), in chain
 * order: EQ low → mid → high → pan. Each is inserted only when its value is
 * non-default, so a stem without Pro fields gets none. The biquads are the
 * Audio EQ Cookbook filters the preview's BiquadFilterNodes compute (shelves
 * with slope 1, the peaking band with a linear Q). The pan applies the
 * StereoPannerNode stereo law as an explicit matrix with '=' (no
 * renormalization); a mono input is first duplicated to both channels at
 * unity, like the preview's explicit 2-channel "speakers" up-mix (ffmpeg's
 * automatic mono up-mix would be −3 dB).
 */
export function stemProFilters(
  stemFx: RemixFxStem,
  channels?: number,
): string[] {
  const filters = stemEqStages(stemFx).map(({ band, gainDb }) => {
    const spec = REMIX_FX_EQ_BANDS[band];
    const g = fxNum(gainDb);
    const f = fxNum(spec.frequencyHz);
    if (spec.type === "peaking") {
      return `equalizer=f=${f}:t=q:w=${fxNum(spec.q!)}:g=${g}`;
    }
    return `${spec.type}=f=${f}:t=s:w=${fxNum(spec.slope!)}:g=${g}`;
  });
  const pan = panGains(stemFx.pan ?? 0);
  if (pan) {
    if (channels === 1) filters.push("pan=stereo|c0=c0|c1=c0");
    const { ll, lr, rl, rr } = pan.matrix;
    filters.push(
      `pan=stereo|c0=${fxNum(ll)}*c0+${fxNum(lr)}*c1|c1=${fxNum(rl)}*c0+${fxNum(rr)}*c1`,
    );
  }
  return filters;
}

function stemFxFor(
  effects: RemixFxRecipe,
  input: StemMixFfmpegInput,
): RemixFxStem {
  if (input.aiLayer || input.beat || input.part || !input.fxStemId) return {};
  return effects.stems?.[input.fxStemId] ?? {};
}

/**
 * Per-input reverb wet level (0 = no send). AI layers, the beat (#1902) and
 * AI parts (#1901) send master.space.
 */
export function stemMixReverbSends(
  inputs: StemMixFfmpegInput[],
  effects: RemixFxRecipe | null,
): number[] {
  if (!effects) return inputs.map(() => 0);
  const masterSpace = effects.master?.space ?? 0;
  return inputs.map((input) =>
    reverbWet(stemFxFor(effects, input).space ?? 0, masterSpace),
  );
}

/**
 * An empty recipe: structure or a beat without effects renders the plain
 * chain.
 */
const NO_EFFECTS: RemixFxRecipe = { schemaVersion: REMIX_FX_SCHEMA_VERSION };

/**
 * The timeline as the source stems' structure front end reads it (#1898):
 * with a keepPitch time-stretch (tempo ≠ 1) every source stem was stretched
 * before the graph, so its source times scale by 1/tempo — the run seeks and
 * trims land in the stretched file's time. Timeline (out*) times are
 * untouched; without a tempo stretch the segments are returned as is.
 */
export function stretchedSourceSegments(
  segments: RemixStructureSegment[],
  effects: RemixFxRecipe | null | undefined,
): RemixStructureSegment[] {
  const tempo = remixFxStretchPlan(effects)?.tempo ?? 1;
  if (tempo === 1) return segments;
  return segments.map((segment) => ({
    ...segment,
    srcStartSec: segment.srcStartSec / tempo,
    srcEndSec: segment.srcEndSec / tempo,
  }));
}

/**
 * ffmpeg volume expression for the whole-mix structure fades (#1899), in
 * OUTPUT time (ramp times ÷ speed). Each ramp is
 * `if(between(t,s,e), from+(to-from)*(t-s)/(e-s), 1)`; a `holdAfter` ramp
 * (last-block fade-out) is wrapped in `if(gte(t,e), 0, …)` so the reverb and
 * echo tails stay silent; the terms multiply. Numbers only, never user
 * strings (commas escaped for the filtergraph parser). Null = no ramps.
 */
export function buildMasterFadeVolumeExpression(
  ramps: RemixMasterFadeRamp[],
  speed = 1,
): string | null {
  if (ramps.length === 0) return null;
  const terms = ramps.map((ramp) => {
    const start = ramp.startSec / speed;
    const end = ramp.endSec / speed;
    const s = fxNum(start);
    const e = fxNum(end);
    const value = `${fxNum(ramp.from)}+(${fxNum(ramp.to - ramp.from)})*(t-${s})/${fxNum(end - start)}`;
    const term = `if(between(t\\,${s}\\,${e})\\,${value}\\,1)`;
    return ramp.holdAfter ? `if(gte(t\\,${e})\\,0\\,${term})` : term;
  });
  return terms.join("*");
}

/**
 * Pre/post-roll decoded around every structure run and discarded in-graph
 * (#1899). A cold seek glitches at the cut — an MP3 decoder lacks its bit
 * reservoir and the resampler starts from silence — so each run decodes from
 * up to {@link RUN_PREROLL_SECONDS} earlier (and past its end), resamples,
 * then trims at 48 kHz exactly like a full decode would.
 */
export const RUN_PREROLL_SECONDS = 0.1;
/**
 * Seek points land on a 1/50 s grid: exact in ffmpeg's microsecond time base
 * and on the sample grid of every common rate (44.1/48/88.2/96/32/22.05/16
 * kHz), so the resampler phase matches a full decode.
 */
const RUN_SEEK_GRID_PER_SECOND = 50;

/**
 * One contiguous stretch of source audio on the timeline: consecutive blocks
 * (section k then k+1) are one run — their join is seamless source audio —
 * and join fades only ever sit at run edges.
 */
export type StructureRun = {
  srcStartSec: number;
  srcEndSec: number;
  joinFadeIn: boolean;
  joinFadeOut: boolean;
  /** Input seek (`-ss`): the run start minus the pre-roll, grid-aligned. */
  seekSec: number;
  /** Decoded pre-roll trimmed off the front: srcStartSec − seekSec. */
  prerollSec: number;
  /** Input read length (`-t`): pre-roll + run + post-roll. */
  readSec: number;
};

/** Group the timeline into source runs (see {@link StructureRun}). */
export function structureRuns(
  segments: RemixStructureSegment[],
): StructureRun[] {
  const groups: RemixStructureSegment[][] = [];
  segments.forEach((segment, index) => {
    const previous = index > 0 ? segments[index - 1] : null;
    const continues =
      previous !== null &&
      !segment.joinFadeIn &&
      !previous.joinFadeOut &&
      Math.abs(previous.srcEndSec - segment.srcStartSec) < 1e-9;
    if (continues) groups[groups.length - 1].push(segment);
    else groups.push([segment]);
  });
  return groups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    const seekSec = Math.max(
      0,
      Math.floor(
        (first.srcStartSec - RUN_PREROLL_SECONDS) * RUN_SEEK_GRID_PER_SECOND,
      ) / RUN_SEEK_GRID_PER_SECOND,
    );
    const prerollSec = first.srcStartSec - seekSec;
    return {
      srcStartSec: first.srcStartSec,
      srcEndSec: last.srcEndSec,
      joinFadeIn: first.joinFadeIn,
      joinFadeOut: last.joinFadeOut,
      seekSec,
      prerollSec,
      readSec:
        prerollSec + (last.srcEndSec - first.srcStartSec) + RUN_PREROLL_SECONDS,
    };
  });
}

type FfmpegInputPlan = {
  /** ffmpeg input index of this stem input's first source. */
  firstIndex: number;
  sources: Array<{ path: string; run: StructureRun | null }>;
};

/**
 * ffmpeg input layout: without a structure one input per stem (identical to
 * the pre-#1899 layout); with one, every SOURCE stem contributes one seeked
 * input per run of the same file, while AI layers stay a single input.
 */
function ffmpegInputPlan(
  inputs: StemMixFfmpegInput[],
  segments: RemixStructureSegment[] | null,
): FfmpegInputPlan[] {
  const runs = segments ? structureRuns(segments) : null;
  let next = 0;
  return inputs.map((input) => {
    const sources =
      runs && !input.aiLayer && !input.beat && !input.part
        ? runs.map((run) => ({ path: input.path, run }))
        : [{ path: input.path, run: null }];
    const plan = { firstIndex: next, sources };
    next += sources.length;
    return plan;
  });
}

/**
 * Structure front end for one source stem (#1899), in SOURCE time: each run
 * is its own seeked input, normalized to 48 kHz float, padded (a stem shorter
 * than the run's range keeps later blocks aligned), trimmed past its pre-roll
 * to exactly the run, given 10 ms join fades where the audio jumps, and the
 * runs are concatenated. Memory stays flat: runs decode lazily in order.
 * Returns the graph parts and the head feeding the per-stem chain.
 */
function structureFrontEnd(
  index: number,
  plan: FfmpegInputPlan,
): { parts: string[]; head: string } {
  const branch = (run: StructureRun) => {
    const duration = run.srcEndSec - run.srcStartSec;
    const trimEnd = fxNum(run.prerollSec + duration);
    const filters = [
      "aresample=48000",
      "aformat=sample_fmts=fltp",
      `apad=whole_dur=${trimEnd}`,
      `atrim=start=${fxNum(run.prerollSec)}:end=${trimEnd}`,
      "asetpts=PTS-STARTPTS",
    ];
    if (run.joinFadeIn) {
      filters.push(`afade=t=in:st=0:d=${fxNum(JOIN_FADE_SECONDS)}`);
    }
    if (run.joinFadeOut) {
      filters.push(
        `afade=t=out:st=${fxNum(duration - JOIN_FADE_SECONDS)}:d=${fxNum(JOIN_FADE_SECONDS)}`,
      );
    }
    return filters.join(",");
  };
  const runs = plan.sources.map((source) => source.run!);
  if (runs.length === 1) {
    return { parts: [], head: `[${plan.firstIndex}:a]${branch(runs[0])},` };
  }
  const labels = runs.map((_, k) => `[x${index}c${k}]`);
  return {
    parts: runs.map(
      (run, k) => `[${plan.firstIndex + k}:a]${branch(run)}${labels[k]}`,
    ),
    head: `${labels.join("")}concat=n=${runs.length}:v=0:a=1,`,
  };
}

/**
 * remix-fx render graph (#1897, #1903), in the contract order:
 *  - per input: aresample=48000 (float) → varispeed (asetrate=48000·s,
 *    aresample=48000) → gain dB → [source stems only, v3 Pro, each only when
 *    non-default] EQ low → EQ mid → EQ high → pan ({@link stemProFilters}) →
 *    section gate with intervals ÷ s (output time) → [stems only] tone → echo
 *    (aecho, feed-forward taps) → asplit into dry + a reverb send scaled by
 *    its wet level;
 *  - reverb bus: amix(sends) → apad by the IR length → afir with the
 *    energy-normalized stereo IR and afir's own IR auto-gain disabled (plain
 *    convolution). afir stops at its input's EOF, so the pad sits BEFORE it:
 *    afir convolves the padded silence and the full IR tail rings out after
 *    the last send ends (padding after afir would only append silence);
 *  - master: amix(dry + AI layers + reverb) → master tone → warmth
 *    tanh(k·x)/tanh(k) → the versioned loudness policy.
 *
 * With a structure timeline (#1899) each SOURCE stem first runs the
 * structure front end in source time ({@link structureFrontEnd}: one seeked
 * input per run → trim past the pre-roll + join fades → concat) before the
 * chain above, whose gate
 * intervals are then timeline (block) spans ÷ s. AI layers are generated
 * audio, not source stems, so they are NOT restructured. The whole-mix block
 * fades run on the master sum (dry + AI layers + reverb) in output time,
 * before master tone/warmth/loudness ({@link buildMasterFadeVolumeExpression}).
 *
 * The beat input (#1902) is a single plain input already in timeline time:
 * normalize → mono-to-stereo → varispeed → gain → master amix (plus a
 * `0.7 × master.space` reverb send), with no per-stem fx, gate or structure
 * front end; master fades, tone, warmth and loudness apply to it in the mix.
 * AI part inputs (#1901) are stereo tracks already in timeline time, like
 * the beat without the mono up-mix: normalize → varispeed → gain → master
 * amix (plus the same reverb send).
 * Every value is numeric and derived from the validated recipe.
 */
export function buildFxStemMixFilter(
  inputs: StemMixFfmpegInput[],
  fx: StemMixFfmpegFx,
  structure?: StemMixFfmpegStructure | null,
): { filter: string; needsImpulse: boolean } {
  const segments =
    structure && structure.segments.length > 0 ? structure.segments : null;
  const hasAddedTrack = inputs.some((input) => input.beat || input.part);
  const effects =
    fx.effects ?? (segments || hasAddedTrack ? NO_EFFECTS : null);
  if (!effects) {
    throw new Error("buildFxStemMixFilter requires an effects recipe.");
  }
  const master = effects.master ?? {};
  // speed has 2 decimals, so 48000·s = 480·(100·s) is an exact integer rate.
  // Output time always scales by 1/speed; the varispeed RATE is the speed,
  // or 1 when a keepPitch time-stretch (#1898) already changed the tempo.
  const speed = remixFxSpeed(effects);
  const rateHundredths = Math.round(remixFxVarispeedRate(effects) * 100);
  const bpm = fx.bpm ?? null;
  const sends = stemMixReverbSends(inputs, effects);
  const needsImpulse = sends.some((wet) => wet > 0);

  // Source runs seek in the (possibly stretched) stem file's time.
  const plans = ffmpegInputPlan(
    inputs,
    segments ? stretchedSourceSegments(segments, effects) : null,
  );
  const graph: string[] = [];
  const dryLabels: string[] = [];
  const wetLabels: string[] = [];
  inputs.forEach((input, index) => {
    const stemFx = stemFxFor(effects, input);
    // aformat pins float processing so gain/echo never clip in an integer
    // sample format before the loudness policy (the preview is float too).
    // With a structure (#1899) every run is normalized before the concat,
    // so all runs share one format.
    const plan = plans[index];
    const restructure =
      segments !== null && !input.aiLayer && !input.beat && !input.part;
    const front = restructure ? structureFrontEnd(index, plan) : null;
    const head = front ? front.head : `[${plan.firstIndex}:a]`;
    if (front) graph.push(...front.parts);
    const chain: string[] = front
      ? []
      : ["aresample=48000", "aformat=sample_fmts=fltp"];
    // The beat track is mono: duplicate it to both channels at unity, like
    // the preview's mono → stereo up-mix (ffmpeg's auto up-mix is −3 dB).
    if (input.beat) chain.push("pan=stereo|c0=c0|c1=c0");
    if (rateHundredths !== 100) {
      chain.push(`asetrate=${480 * rateHundredths}`, "aresample=48000");
    }
    chain.push(`volume=${normalizeRemixStemGainDb(input.gainDb)}dB`);
    // Pro EQ + pan (#1903): source stems only (stemFxFor is empty for AI
    // layers, the beat and parts), each stage only when non-default.
    chain.push(...stemProFilters(stemFx, input.channels));
    // The beat's (and a part's) block on/off is baked into its track: never
    // gated.
    if (
      !input.beat &&
      !input.part &&
      input.activeIntervals &&
      input.activeIntervals.length > 0
    ) {
      // The gate runs after varispeed, i.e. in output time.
      const scaled = input.activeIntervals.map((interval) => ({
        startSec: interval.startSec / speed,
        endSec: interval.endSec / speed,
      }));
      chain.push(
        `volume=volume=${buildSectionGateVolumeExpression(scaled)}:eval=frame`,
      );
    }
    if (!input.aiLayer && !input.beat && !input.part) {
      const tone = fxToneFilter(stemFx.tone);
      if (tone) chain.push(tone);
      const taps = echoTaps(stemFx.echo ?? 0, bpm, speed);
      if (taps.length > 0) {
        const delays = taps.map((tap) => fxNum(tap.delaySec * 1000)).join("|");
        const decays = taps.map((tap) => fxNum(tap.gain)).join("|");
        chain.push(
          `aecho=in_gain=1:out_gain=1:delays=${delays}:decays=${decays}`,
        );
      }
    }
    if (sends[index] > 0) {
      graph.push(`${head}${chain.join(",")},asplit=2[d${index}][s${index}]`);
      graph.push(`[s${index}]volume=${fxNum(sends[index])}[w${index}]`);
      dryLabels.push(`[d${index}]`);
      wetLabels.push(`[w${index}]`);
    } else {
      graph.push(`${head}${chain.join(",")}[a${index}]`);
      dryLabels.push(`[a${index}]`);
    }
  });

  if (needsImpulse) {
    const last = plans[plans.length - 1];
    const irIndex = last.firstIndex + last.sources.length;
    const afirOptions = fx.afirOptions ?? AFIR_UNITY_GAIN_OPTIONS;
    // Stereo bus so afir convolves L/R with the IR's own L/R channels; the
    // pad lets the natural reverb tail ring out (master amix is "longest").
    graph.push(
      `${wetLabels.join("")}amix=inputs=${wetLabels.length}:duration=longest:normalize=0,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=pad_dur=${fxNum(REMIX_FX_IMPULSE.lengthSeconds)}[rvin]`,
    );
    graph.push(`[rvin][${irIndex}:a]afir=${afirOptions}[rv]`);
    dryLabels.push("[rv]");
  }

  const masterChain: string[] = [];
  const fades = segments
    ? buildMasterFadeVolumeExpression(masterFadeRamps(segments), speed)
    : null;
  if (fades) masterChain.push(`volume=volume=${fades}:eval=frame`);
  const masterTone = fxToneFilter(master.tone);
  if (masterTone) masterChain.push(masterTone);
  const warmth = master.warmth ?? 0;
  if (warmth > 0) {
    const k = fxNum(warmthK(warmth));
    masterChain.push(
      `aeval=exprs=tanh(${k}*val(ch))/tanh(${k}):channel_layout=same`,
    );
  }
  masterChain.push(loudnormFilter());
  graph.push(
    `${dryLabels.join("")}amix=inputs=${dryLabels.length}:duration=longest:normalize=0[sum]`,
  );
  graph.push(`[sum]${masterChain.join(",")}[mix]`);
  return { filter: graph.join(";"), needsImpulse };
}

/** ffprobe args reading the first audio stream's channel count. */
export function buildChannelProbeArgs(inputPath: string): string[] {
  return [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=channels",
    "-of",
    "csv=p=0",
    inputPath,
  ];
}

/** The first audio stream's channel count (#1903); throws when unreadable. */
export async function probeAudioChannels(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    buildChannelProbeArgs(inputPath),
    { timeout: 30_000 },
  );
  const channels = Number.parseInt(String(stdout).trim(), 10);
  if (!Number.isInteger(channels) || channels < 1) {
    throw new Error("ffprobe reported no audio channels");
  }
  return channels;
}

let afirOptionsProbe: Promise<string> | null = null;

/**
 * Picks the afir options that make the reverb bus a plain convolution on the
 * installed ffmpeg (#1897). ffmpeg >= 7 normalizes the IR by default and only
 * `irnorm=-1` disables it (`gtype` became a no-op). Older builds lack
 * `irnorm`; there `gtype=none` disables auto-gain — exact on 6.x, but 5.x
 * applies an extra 2x inverse-FFT scale, so parity is only guaranteed on the
 * production ffmpeg (>= 7). Memoized per process.
 */
export function resolveAfirUnityGainOptions(logger?: Logger): Promise<string> {
  afirOptionsProbe ??= execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-h", "filter=afir"],
    { timeout: 15_000 },
  )
    .then(({ stdout }) => {
      if (/\birnorm\b/.test(String(stdout))) return AFIR_UNITY_GAIN_OPTIONS;
      logger?.warn(
        "ffmpeg afir has no irnorm option (ffmpeg < 7); using gtype=none — reverb level parity with the preview is only guaranteed on ffmpeg >= 7.",
      );
      return "gtype=none";
    })
    .catch(() => {
      // Probe failures are retried next render; the render itself surfaces
      // any real ffmpeg problem.
      afirOptionsProbe = null;
      return AFIR_UNITY_GAIN_OPTIONS;
    });
  return afirOptionsProbe;
}

/**
 * ffmpeg args decoding one input to raw interleaved 16-bit stereo at 48 kHz
 * — the time-stretch stage's input (#1898; 16-bit halves the temp-dir
 * footprint, the stretch worker converts to float). Paths are argv entries,
 * never shell-interpolated.
 */
export function buildStretchDecodeArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-f",
    "s16le",
    "-c:a",
    "pcm_s16le",
    "-ac",
    String(REMIX_STRETCH_CHANNELS),
    "-ar",
    String(REMIX_STRETCH_SAMPLE_RATE),
    outputPath,
  ];
}

/** One time-stretch stage (#1898): tempo factor and key shift. */
export type StretchStage = { tempo: number; semitones: number };

/**
 * The stretch stage of one mix input for a recipe's plan (#1901): stems and
 * AI layers take the recipe plan; AI parts take it through
 * {@link partStretchPlan} (drums: tempo only, never transposed; null when
 * that is the identity). The beat never reaches the stretch stage.
 */
export function mixInputStretchStage(
  input: StemMixFfmpegInput,
  plan: StretchStage | null,
): StretchStage | null {
  if (!plan || input.beat) return null;
  if (input.part) return partStretchPlan(input.part.role, plan);
  return plan;
}

/** Run `task` over `items` with at most `limit` in flight; fail fast. */
async function runPooled<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        await task(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const lanes = Array.from({ length: Math.min(limit, items.length) }, lane);
  const results = await Promise.allSettled(lanes);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
}

/**
 * The time-stretch pre-stage (#1898): each input is decoded by ffmpeg to raw
 * 48 kHz 16-bit stereo, stretched chunk-streamed in a worker thread
 * (tempo/semitones from the recipe; float DSP) into a TPDF-dithered 16-bit
 * WAV (dither seed = base + input index, so identical renders are
 * byte-identical) that REPLACES the input's path, at most
 * {@link STRETCH_POOL_SIZE} at a time. 16-bit intermediates keep the temp dir
 * small where it is memory-backed. Every file stays in `workDir` (the
 * render's temp dir, so plaintext of encrypted stems never leaves its cleanup
 * boundary); the decoded source and the raw intermediate are deleted as soon
 * as they are consumed. Audio shorter than the engine minimum is zero-padded
 * and trimmed back by the worker. Errors map to safe provider errors;
 * `logError` receives internal detail only.
 *
 * `plan` is one stage for every input, or a PER-INPUT plan (#1901): a
 * function returning an input's stage, or null to leave that input as is
 * (e.g. a drum part at tempo 1). Dither seeds stay base + input index.
 */
export async function stretchMixInputs(
  inputs: StemMixFfmpegInput[],
  workDir: string,
  plan: StretchStage | ((input: StemMixFfmpegInput, index: number) => StretchStage | null),
  logError: (message: string) => void = () => undefined,
): Promise<void> {
  await runPooled(inputs, STRETCH_POOL_SIZE, async (input, index) => {
    const stage = typeof plan === "function" ? plan(input, index) : plan;
    if (!stage) return;
    const rawPath = join(workDir, `stretch-${index}.s16`);
    const wavPath = join(workDir, `stretch-${index}.wav`);
    try {
      await execFileAsync("ffmpeg", buildStretchDecodeArgs(input.path, rawPath), {
        timeout: FFMPEG_TIMEOUT_MS,
      });
    } catch (error) {
      await rm(rawPath, { force: true });
      logError(
        `ffmpeg stretch decode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        "The stems could not be prepared for a tempo or key change. Please try again later.",
        true,
      );
    }
    await rm(input.path, { force: true });
    try {
      await stretchRawFileToWavInWorker({
        inputPath: rawPath,
        outputPath: wavPath,
        tempo: stage.tempo,
        semitones: stage.semitones,
        ditherSeed: REMIX_STRETCH_DITHER_SEED_BASE + index,
      });
    } catch (error) {
      logError(
        `time-stretch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        "The tempo or key change could not be rendered. Please try again later.",
        true,
      );
    } finally {
      await rm(rawPath, { force: true });
    }
    input.path = wavPath;
  });
}

/** What the render did with the project's AI parts (#1901). */
type RenderedPartsRecord = {
  rendered: RemixRenderedPart[];
  skipped: Array<{ partId: string; takeId: string; reason: PartSkippedReason }>;
};

function renderMetadata(
  inputCount: number,
  activeStemCount: number,
  fx?: RemixRenderFx,
  structure?: RemixRenderStructure,
  beat?: RemixRenderBeat,
  parts?: RenderedPartsRecord,
): RemixRenderMetadata {
  const stretchPlan = fx ? remixFxStretchPlan(fx.effects) : null;
  const addedParts: Array<"beat" | "ai_part"> = [
    ...(beat ? (["beat"] as const) : []),
    ...(parts && parts.rendered.length > 0 ? (["ai_part"] as const) : []),
  ];
  return {
    ...REMIX_RENDER_AUDIO_POLICY,
    inputCount,
    activeStemCount,
    // #1897: the exact recipe + DSP version this artifact was rendered with.
    ...(fx
      ? {
          effects: fx.effects,
          effectsDspVersion: REMIX_FX_DSP_VERSION,
          // #1903: the Pro EQ/pan mapping, whenever the recipe carries a Pro
          // field.
          ...(remixFxUsesPro(fx.effects)
            ? { effectsProDspVersion: REMIX_FX_PRO_DSP_VERSION }
            : {}),
        }
      : {}),
    // #1898: the time-stretch engine build + stage parameters.
    ...(stretchPlan ? { stretch: remixStretchMetadata(stretchPlan) } : {}),
    // #1899: the structure blocks + timeline rules version.
    ...(structure
      ? {
          structure: structure.structure,
          structureVersion: REMIX_STRUCTURE_DSP_VERSION,
        }
      : {}),
    // #1902: the beat recipe + synthesis rules version; a synthesized part
    // that is neither AI nor source audio.
    ...(beat
      ? {
          beat: beat.beat,
          beatDspVersion: REMIX_BEAT_DSP_VERSION,
        }
      : {}),
    // #1901: the AI parts mixed in (generated audio: the draft is
    // AI-assisted) and the saved parts left out, with a reason.
    ...(parts
      ? {
          parts: parts.rendered,
          partsSkipped: parts.skipped,
          partsDspVersion: REMIX_PARTS_DSP_VERSION,
        }
      : {}),
    ...(addedParts.length > 0 ? { addedParts } : {}),
  };
}

@Injectable()
export class FfmpegStemAudioMixer implements StemAudioMixer {
  private readonly logger = new Logger(FfmpegStemAudioMixer.name);

  constructor(
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
  ) {}

  async mixUnmutedStems(
    stems: StemArrangementEntry[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
    structure?: RemixRenderStructure,
    beat?: RemixRenderBeat,
    parts?: RemixRenderParts,
  ): Promise<MixedStemAudio> {
    return this.mixStemArrangement(
      stems,
      [],
      authorization,
      true,
      fx,
      structure,
      beat,
      parts,
    );
  }

  async mixUnmutedStemsWithAudioBuffers(
    stems: StemArrangementEntry[],
    inputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
    structure?: RemixRenderStructure,
    beat?: RemixRenderBeat,
    parts?: RemixRenderParts,
  ): Promise<MixedAudioBuffers> {
    return this.mixStemArrangement(
      stems,
      inputs,
      authorization,
      false,
      fx,
      structure,
      beat,
      parts,
    );
  }

  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: true,
    fx?: RemixRenderFx,
    structure?: RemixRenderStructure,
    beat?: RemixRenderBeat,
    parts?: RemixRenderParts,
  ): Promise<MixedStemAudio>;
  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: false,
    fx?: RemixRenderFx,
    structure?: RemixRenderStructure,
    beat?: RemixRenderBeat,
    parts?: RemixRenderParts,
  ): Promise<MixedAudioBuffers>;
  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: boolean,
    fx?: RemixRenderFx,
    structure?: RemixRenderStructure,
    renderBeat?: RemixRenderBeat,
    renderParts?: RemixRenderParts,
  ): Promise<MixedStemAudio | MixedAudioBuffers> {
    const label = authorization.remixProjectId;
    // A muted beat (#1902) is skipped entirely: the graph and metadata are
    // identical to a render without a beat.
    const beat = renderBeat && !renderBeat.beat.muted ? renderBeat : undefined;
    // A stem whose section mask disables every section ([]) is effectively
    // muted (#1314); undefined/null intervals mean fully active.
    const activeStems = stems.filter(
      (stem) =>
        !stem.muted &&
        !(stem.activeIntervals && stem.activeIntervals.length === 0),
    );
    if (activeStems.length === 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        "All stems are muted; unmute at least one stem to render a mix.",
        false,
      );
    }

    const stemRows = await prisma.stem.findMany({
      where: { id: { in: activeStems.map((stem) => stem.stemId) } },
      select: {
        id: true,
        uri: true,
        data: true,
        isEncrypted: true,
        encryptionMetadata: true,
      },
    });
    const rowsById = new Map(stemRows.map((row) => [row.id, row]));
    const missing = activeStems.filter((stem) => !rowsById.has(stem.stemId));
    if (missing.length > 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        `Stems not found: ${missing.map((stem) => stem.stemId).join(", ")}`,
        false,
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), "remix-mix-"));
    try {
      const ffmpegInputs: StemMixFfmpegInput[] = [];
      for (const stem of activeStems) {
        const row = rowsById.get(stem.stemId)!;
        const audio = await this.loadStemAudio(row, authorization);
        if (!audio) {
          throw new RemixGenerationProviderError(
            "invalid_input",
            `Audio for stem ${stem.stemId} is unavailable.`,
            false,
          );
        }
        const inputPath = join(workDir, `stem-${ffmpegInputs.length}.audio`);
        await writeFile(inputPath, audio);
        ffmpegInputs.push({
          path: inputPath,
          gainDb: stem.gainDb ?? 0,
          activeIntervals: stem.activeIntervals ?? null,
          fxStemId: stem.stemId,
        });
      }
      for (const input of additionalInputs) {
        const inputPath = join(
          workDir,
          `input-${ffmpegInputs.length}${extensionForMimeType(input.mimeType)}`,
        );
        await writeFile(inputPath, input.buffer);
        ffmpegInputs.push({
          path: inputPath,
          gainDb: input.gainDb ?? 0,
          aiLayer: true,
        });
      }
      // #1901: every audible AI part becomes one timeline-time track, BEFORE
      // the stretch stage (parts take the tempo stretch like stems).
      const partsRecord = renderParts
        ? await this.addPartInputs(renderParts, ffmpegInputs, workDir, label)
        : undefined;
      const stretchPlan = fx ? remixFxStretchPlan(fx.effects) : null;
      if (stretchPlan) {
        // #1898: every source stem and AI layer is time-stretched / pitch-
        // shifted before the graph, replacing its input file. AI parts take
        // a per-input stage (drums: tempo only, #1901).
        const stretchStarted = Date.now();
        const stageOf = (input: StemMixFfmpegInput) =>
          mixInputStretchStage(input, stretchPlan);
        await stretchMixInputs(ffmpegInputs, workDir, stageOf, (message) =>
          this.logger.error(`${label}: ${message}`),
        );
        const stretched = ffmpegInputs.filter((input) => stageOf(input)).length;
        this.logger.log(
          `[mix] ${label}: time-stretched ${stretched} inputs (tempo ${stretchPlan.tempo}, ${stretchPlan.semitones} st) in ${Date.now() - stretchStarted}ms`,
        );
      }
      if (fx) {
        // #1903: a Pro pan needs to know a mono stem (explicit unity
        // up-mix); only such stems are probed, after any stretch replaced
        // the file.
        await this.probePannedStemChannels(ffmpegInputs, fx.effects, label);
      }
      if (beat) {
        // #1902: the beat is synthesized over the (structured) timeline at
        // 48 kHz and streamed to a WAV in this render's temp dir. With
        // keepPitch (#1898) it is synthesized in output time instead (hits ÷
        // speed, no varispeed) and never transposed.
        const beatPath = join(workDir, "beat.wav");
        const beatStarted = Date.now();
        const beatTiming =
          fx && remixFxVarispeedRate(fx.effects) !== remixFxSpeed(fx.effects)
            ? beatTimingAtSpeed(
                beat.grid,
                beat.segments,
                remixFxSpeed(fx.effects),
              )
            : { grid: beat.grid, segments: beat.segments };
        const { frames } = await writeBeatWav(
          beatPath,
          beat.beat,
          beatTiming.grid,
          beatTiming.segments,
        );
        this.logger.log(
          `[mix] ${label}: synthesized a ${(frames / REMIX_BEAT_RENDER_SAMPLE_RATE).toFixed(1)}s beat track in ${Date.now() - beatStarted}ms`,
        );
        ffmpegInputs.push({
          path: beatPath,
          gainDb: beat.beat.gainDb,
          beat: true,
        });
      }

      const outputPath = join(workDir, "mix.mp3");
      let ffmpegFx: StemMixFfmpegFx | undefined;
      if (fx) {
        // #1897: the reverb IR is code-generated (deterministic, unlicensed)
        // and only written when some input actually sends to the bus.
        const needsImpulse = stemMixReverbSends(ffmpegInputs, fx.effects).some(
          (wet) => wet > 0,
        );
        const impulsePath = needsImpulse
          ? join(workDir, "reverb-ir.wav")
          : null;
        if (impulsePath) await writeImpulseWav(impulsePath);
        ffmpegFx = {
          effects: fx.effects,
          bpm: fx.bpm,
          impulsePath,
          ...(needsImpulse
            ? { afirOptions: await resolveAfirUnityGainOptions(this.logger) }
            : {}),
        };
      }
      const args = structure
        ? buildStemMixFfmpegArgs(ffmpegInputs, outputPath, ffmpegFx, structure)
        : buildStemMixFfmpegArgs(ffmpegInputs, outputPath, ffmpegFx);
      const started = Date.now();
      try {
        await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`ffmpeg mix failed for ${label}: ${message}`);
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "The stems could not be mixed. Please try again later.",
          true,
        );
      }
      this.logger.log(
        `[mix] ${label}: mixed ${ffmpegInputs.length} stems in ${Date.now() - started}ms`,
      );

      const buffer = await readFile(outputPath);
      const metadata = renderMetadata(
        ffmpegInputs.length,
        activeStems.length,
        fx,
        structure,
        beat,
        partsRecord,
      );
      return stemOnly
        ? {
            buffer,
            mimeType: REMIX_RENDER_AUDIO_POLICY.outputMimeType,
            stemCount: activeStems.length,
            renderMetadata: metadata,
          }
        : {
            buffer,
            mimeType: REMIX_RENDER_AUDIO_POLICY.outputMimeType,
            inputCount: ffmpegInputs.length,
            renderMetadata: metadata,
          };
    } finally {
      // Plaintext for encrypted stems lives only here; deletion must run on
      // every success/failure path. Log (never silently swallow) a cleanup
      // failure so a leaking-disk condition is observable. The dir path carries
      // no secret — only the random mkdtemp suffix.
      await rm(workDir, { recursive: true, force: true }).catch((error) => {
        this.logger.warn(
          `Failed to remove remix render temp dir ${workDir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }

  /**
   * Pro pan (#1903): records the channel count of every source stem input
   * whose recipe pans it, so a mono stem gets the explicit unity up-mix. A
   * probe failure fails the render (retryable) rather than guessing.
   */
  private async probePannedStemChannels(
    ffmpegInputs: StemMixFfmpegInput[],
    effects: RemixFxRecipe,
    label: string,
  ): Promise<void> {
    for (const input of ffmpegInputs) {
      if (input.aiLayer || input.beat || input.part || !input.fxStemId) {
        continue;
      }
      if (!panGains(effects.stems?.[input.fxStemId]?.pan ?? 0)) continue;
      try {
        input.channels = await probeAudioChannels(input.path);
      } catch (error) {
        this.logger.error(
          `${label}: channel probe failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "The stems could not be mixed. Please try again later.",
          true,
        );
      }
    }
  }

  /**
   * AI parts (#1901): for each audible part, fetch the take's conformed FLAC
   * through the StorageProvider into this render's temp dir, decode it (the
   * loop), lay it out on the timeline ({@link partPlacementSpans}) and
   * stream it to a stereo WAV input. One part at a time, so memory stays at
   * one loop plus one chunk. A take with no stored bytes is skipped
   * (`take_missing`, recorded); a storage or decode failure fails the render
   * (retryable). The takes were already paid for: nothing here costs credits.
   */
  private async addPartInputs(
    renderParts: RemixRenderParts,
    ffmpegInputs: StemMixFfmpegInput[],
    workDir: string,
    label: string,
  ): Promise<RenderedPartsRecord> {
    const record: RenderedPartsRecord = {
      rendered: [],
      skipped: [...renderParts.skipped],
    };
    const bpm = renderParts.grid.bpm;
    const segments = renderParts.segments;
    const durationSec =
      segments.length > 0 ? segments[segments.length - 1].outEndSec : 0;
    if (!bpm || !(bpm > 0) || segments.length === 0) {
      for (const part of renderParts.parts) {
        record.skipped.push({
          partId: part.partId,
          takeId: part.takeId,
          reason: "take_not_ready",
        });
      }
      return record;
    }
    const started = Date.now();
    for (const [index, part] of renderParts.parts.entries()) {
      let audio: Buffer | null;
      try {
        audio = await this.storageProvider.download(part.storageUri);
      } catch {
        // Ids only: storage messages can carry bucket names or paths.
        this.logger.warn(
          `Storage download failed for part take ${part.takeId} (${label})`,
        );
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "An AI part could not be loaded for the mix. Please try again later.",
          true,
        );
      }
      if (!audio || audio.length === 0) {
        record.skipped.push({
          partId: part.partId,
          takeId: part.takeId,
          reason: "take_missing",
        });
        continue;
      }
      const takePath = join(workDir, `part-${index}.take`);
      const rawPath = join(workDir, `part-${index}.f32`);
      const trackPath = join(workDir, `part-${index}.wav`);
      let loop: Float32Array;
      try {
        await writeFile(takePath, audio);
        audio = null;
        loop = await decodePartTakeLoop(takePath, rawPath);
      } catch (error) {
        this.logger.error(
          `${label}: part take ${part.takeId} decode failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "An AI part could not be prepared for the mix. Please try again later.",
          true,
        );
      } finally {
        await rm(takePath, { force: true });
      }
      const spans = partPlacementSpans(
        part,
        renderParts.grid,
        segments,
        partLengthSeconds(bpm, part.bars),
      );
      await writePartTrackWav(trackPath, loop, spans, durationSec);
      ffmpegInputs.push({
        path: trackPath,
        gainDb: part.gainDb,
        part: { role: part.role },
      });
      record.rendered.push(renderedPartLineage(part));
    }
    this.logger.log(
      `[mix] ${label}: laid out ${record.rendered.length} AI part tracks in ${Date.now() - started}ms`,
    );
    return record;
  }

  /**
   * Returns plaintext audio for one active stem (#1214).
   *
   * Stored bytes in fetch order: DB bytes, then the configured storage
   * provider. Local path containment belongs to LocalStorageProvider so local
   * and GCS/IPFS reads share one boundary instead of duplicating URI parsing.
   *
   * For `isEncrypted` rows the loaded bytes are ciphertext: they are decrypted
   * in memory through the strict render boundary only after the stem is
   * confirmed authorized for this render. We never return ciphertext as audio,
   * and never write plaintext anywhere except the caller's temp dir.
   */
  private async loadStemAudio(
    row: {
      id: string;
      uri: string;
      data: Buffer | Uint8Array | null;
      isEncrypted: boolean;
      encryptionMetadata: string | null;
    },
    authorization: StemRenderAuthorization,
  ): Promise<Buffer | null> {
    const raw = await this.loadStoredBytes(row);
    if (!raw) {
      return null;
    }
    if (!row.isEncrypted) {
      return raw;
    }

    // Defense in depth: only decrypt stems the worker re-confirmed as eligible
    // for this owned project. An encrypted stem outside that set must never be
    // decrypted, even though the arrangement comes from the owned project.
    if (!authorization.authorizedStemIds.has(row.id)) {
      this.logger.warn(
        `Refusing to decrypt unauthorized encrypted stem for project ${authorization.remixProjectId}`,
      );
      throw new RemixGenerationProviderError(
        "invalid_input",
        "A source stem is no longer authorized for this remix render.",
        false,
      );
    }

    const internalAuthSig = {
      // Sentinel + internal purpose: the AES provider grants access only when
      // INTERNAL_SERVICE_KEY matches (SBPR-004 / #1214). No user signature.
      address: "0x0000000000000000000000000000000000000000",
      sig: "remix-render-authorized",
      signedMessage: "Remix render decryption authorization",
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    };

    try {
      const plaintext = await this.encryptionService.decryptForRender(
        raw,
        row.encryptionMetadata ?? "",
        internalAuthSig,
      );
      if (!plaintext || plaintext.length === 0) {
        return null;
      }
      return plaintext;
    } catch (error) {
      throw this.mapDecryptError(error, row.id);
    }
  }

  private async loadStoredBytes(row: {
    id: string;
    uri: string;
    data: Buffer | Uint8Array | null;
  }): Promise<Buffer | null> {
    if (row.data && row.data.length > 0) {
      return Buffer.from(row.data);
    }
    try {
      const audio = await this.storageProvider.download(row.uri);
      return audio && audio.length > 0 ? audio : null;
    } catch {
      // Do not log provider messages: they can contain bucket names, local
      // paths, signed URLs, or other storage internals.
      this.logger.warn(`Storage download failed for stem ${row.id}`);
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        `Stored audio for stem ${row.id} could not be loaded. Please try again later.`,
        true,
      );
    }
  }

  /**
   * Translate strict render-decryption failures into safe provider errors.
   * The reason codes carry no secrets; the user-facing messages never name
   * keys, metadata, URIs, or provider internals.
   */
  private mapDecryptError(
    error: unknown,
    stemId: string,
  ): RemixGenerationProviderError {
    if (error instanceof RenderDecryptionError) {
      switch (error.reason) {
        case "unauthorized":
          return new RemixGenerationProviderError(
            "invalid_input",
            "A source stem is no longer authorized for this remix render.",
            false,
          );
        case "invalid_metadata":
          return new RemixGenerationProviderError(
            "invalid_input",
            `Source audio for stem ${stemId} could not be prepared for rendering.`,
            false,
          );
        case "encryption_disabled":
        case "decryption_failed":
        default:
          // Opaque + retryable: distinguishing a transient key/provider fault
          // from corrupt ciphertext here would leak internals.
          this.logger.warn(
            `Render decryption failed for stem ${stemId}: ${error.reason}`,
          );
          return new RemixGenerationProviderError(
            "provider_unavailable",
            `Source audio for stem ${stemId} could not be prepared for rendering. Please try again later.`,
            true,
          );
      }
    }
    if (error instanceof RemixGenerationProviderError) {
      return error;
    }
    this.logger.warn(`Unexpected render decryption error for stem ${stemId}`);
    return new RemixGenerationProviderError(
      "provider_unavailable",
      `Source audio for stem ${stemId} could not be prepared for rendering. Please try again later.`,
      true,
    );
  }
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/mpeg" || normalized === "audio/mp3") return ".mp3";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "audio/flac") return ".flac";
  return ".audio";
}
