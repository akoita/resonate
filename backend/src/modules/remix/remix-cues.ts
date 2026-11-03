/**
 * Cue and loop points + the DJ extended export (#2540, Remix Studio Pro S6d
 * of #1903).
 *
 * The artist marks an intro loop and an outro loop as whole bars of the
 * remix timeline (so they are snapped to the grid, corrected by S6c when
 * set). The preview can loop either one. The DJ extended export repeats
 * each loop right after itself, `repeats` more times, so the song keeps its
 * pickup and its ending and every inserted span is whole bars: the beat grid
 * stays even and lands where the artist put it. A sidecar JSON
 * (`resonate-dj-cues/v1`) carries the beat grid and the cues.
 *
 * Bars are indices into {@link timelineDownbeats}: every downbeat of the
 * timeline, placed exactly like the beat maker places its bars
 * (`beatBarPhase`), so the cues, the beat and the AI parts share one grid.
 * Mirrored by `web/src/lib/remixCues.ts`; `remix-cues-v1.parity.json` pins
 * downbeats, loop spans, the export plan and the sidecar for both.
 */
import { beatBarPhase, type BeatGrid, type BeatSegment } from "./remix-beat";

export const REMIX_CUES_SCHEMA_VERSION = "remix-cues/v1" as const;
export const REMIX_DRAFT_GRID_SCHEMA_VERSION = "remix-draft-grid/v1" as const;
export const REMIX_DJ_CUES_SCHEMA_VERSION = "resonate-dj-cues/v1" as const;
/** The splice and crossfade rules of the DJ extended export. */
export const REMIX_DJ_EXPORT_DSP_VERSION = "remix-dj-export/v1" as const;

/** Bars a cue loop may span. */
export const CUE_LOOP_BAR_CHOICES = [1, 2, 4, 8, 16, 32] as const;
/** Extra plays of a loop in the DJ extended export. */
export const CUE_MIN_REPEATS = 1;
export const CUE_MAX_REPEATS = 8;
/** Highest bar index accepted (a 15 min timeline at 300 BPM has 1125). */
export const CUE_MAX_START_BAR = 2000;

/** Export sample rate: the render policy's output rate. */
export const DJ_EXPORT_SAMPLE_RATE = 48_000;
/**
 * Half of the crossfade at each join, in frames (10 ms). Each join is a
 * 20 ms linear crossfade centred on the bar line, so lengths and the grid
 * are exact and a continuous join reproduces the source sample for sample.
 */
export const DJ_EXPORT_HALF_CROSSFADE_FRAMES = 480;

const EDGE_EPSILON = 1e-9;

export type RemixCueLoop = {
  /** Index into the timeline's downbeats (bar 1 = 0). */
  startBar: number;
  /** Length in bars, one of {@link CUE_LOOP_BAR_CHOICES}. */
  bars: number;
  /** Extra plays in the DJ extended export, 1..8. */
  repeats: number;
};

export type RemixCues = {
  schemaVersion: typeof REMIX_CUES_SCHEMA_VERSION;
  intro: RemixCueLoop | null;
  outro: RemixCueLoop | null;
};

/** The draft's bar grid, recorded by the render, in DRAFT seconds. */
export type RemixDraftGrid = {
  schemaVersion: typeof REMIX_DRAFT_GRID_SCHEMA_VERSION;
  /** Tempo as heard in the draft (grid tempo × speed). */
  bpm: number;
  /** Downbeats of the draft, seconds, 9 decimals. */
  downbeatsSec: number[];
  /** End of the rendered timeline in the draft, seconds. */
  timelineEndSec: number;
};

export type CueSpan = { startSec: number; endSec: number };

export class RemixCuesValidationError extends Error {}

function round9(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// --- Recipe -------------------------------------------------------------------

function normalizeLoopInput(raw: unknown, name: string): RemixCueLoop | null {
  if (raw === null || raw === undefined) return null;
  if (!isPlainObject(raw)) {
    throw new RemixCuesValidationError(`${name} must be an object or null`);
  }
  const { startBar, bars, repeats } = raw;
  if (
    typeof startBar !== "number" ||
    !Number.isInteger(startBar) ||
    startBar < 0 ||
    startBar > CUE_MAX_START_BAR
  ) {
    throw new RemixCuesValidationError(
      `${name}.startBar must be a whole number from 0 to ${CUE_MAX_START_BAR}`,
    );
  }
  if (
    typeof bars !== "number" ||
    !(CUE_LOOP_BAR_CHOICES as readonly number[]).includes(bars)
  ) {
    throw new RemixCuesValidationError(
      `${name}.bars must be one of ${CUE_LOOP_BAR_CHOICES.join(", ")}`,
    );
  }
  if (
    typeof repeats !== "number" ||
    !Number.isInteger(repeats) ||
    repeats < CUE_MIN_REPEATS ||
    repeats > CUE_MAX_REPEATS
  ) {
    throw new RemixCuesValidationError(
      `${name}.repeats must be a whole number from ${CUE_MIN_REPEATS} to ${CUE_MAX_REPEATS}`,
    );
  }
  return { startBar, bars, repeats };
}

/**
 * Validate a PATCH `cues` payload. Null (or both loops null) clears the
 * cues. Throws {@link RemixCuesValidationError} on bad input. An intro must
 * end at or before the outro starts.
 */
export function normalizeRemixCuesInput(raw: unknown): RemixCues | null {
  if (raw === null) return null;
  if (!isPlainObject(raw)) {
    throw new RemixCuesValidationError("cues must be an object or null");
  }
  if (
    raw.schemaVersion !== undefined &&
    raw.schemaVersion !== REMIX_CUES_SCHEMA_VERSION
  ) {
    throw new RemixCuesValidationError(
      `cues.schemaVersion must be ${REMIX_CUES_SCHEMA_VERSION}`,
    );
  }
  const intro = normalizeLoopInput(raw.intro, "cues.intro");
  const outro = normalizeLoopInput(raw.outro, "cues.outro");
  if (!intro && !outro) return null;
  if (intro && outro && intro.startBar + intro.bars > outro.startBar) {
    throw new RemixCuesValidationError(
      "The intro loop must end at or before the outro loop starts",
    );
  }
  return { schemaVersion: REMIX_CUES_SCHEMA_VERSION, intro, outro };
}

/** Read stored cues tolerantly: anything malformed reads as no cues. */
export function parseRemixCues(raw: unknown): RemixCues | null {
  try {
    return normalizeRemixCuesInput(raw ?? null);
  } catch {
    return null;
  }
}

// --- Grid ---------------------------------------------------------------------

/**
 * Every downbeat of the timeline, in timeline seconds (9 decimals): per
 * block, bars start at the block's timeline start plus the downbeat phase
 * (`beatBarPhase`, non-zero only for section 0) and stop before its end,
 * exactly like the beat maker's bars. Empty without a tempo.
 */
export function timelineDownbeats(
  grid: Pick<BeatGrid, "bpm" | "firstBeatSec">,
  segments: BeatSegment[],
): number[] {
  const bpm = grid.bpm;
  if (!bpm || !(bpm > 0)) return [];
  const barSec = 240 / bpm;
  const out: number[] = [];
  for (const segment of segments) {
    const phase = beatBarPhase(grid as BeatGrid, segment.section, barSec);
    for (let bar = 0; ; bar += 1) {
      const t = segment.outStartSec + phase + bar * barSec;
      if (t >= segment.outEndSec - EDGE_EPSILON) break;
      const rounded = round9(t);
      if (out.length === 0 || rounded > out[out.length - 1] + EDGE_EPSILON) {
        out.push(rounded);
      }
    }
  }
  return out;
}

/**
 * The span of a loop on a grid of downbeats: from its start bar's downbeat
 * to the downbeat `bars` later. The last bar of the timeline ends one bar
 * after its downbeat when that still fits in `endSec`. Null when the loop
 * does not fit.
 */
export function cueLoopSpan(
  downbeats: number[],
  barSec: number,
  endSec: number,
  loop: Pick<RemixCueLoop, "startBar" | "bars">,
): CueSpan | null {
  const { startBar, bars } = loop;
  if (startBar < 0 || bars < 1 || startBar >= downbeats.length) return null;
  const startSec = downbeats[startBar];
  const endIndex = startBar + bars;
  let loopEnd: number;
  if (endIndex < downbeats.length) {
    loopEnd = downbeats[endIndex];
  } else if (endIndex === downbeats.length) {
    loopEnd = round9(downbeats[downbeats.length - 1] + barSec);
    if (loopEnd > endSec + 1e-6) return null;
  } else {
    return null;
  }
  return { startSec, endSec: loopEnd };
}

/**
 * The draft grid the render records: the timeline downbeats and end in
 * draft seconds (timeline ÷ speed) and the tempo as heard (× speed).
 */
export function draftGridFor(
  grid: Pick<BeatGrid, "bpm" | "firstBeatSec">,
  segments: BeatSegment[],
  speed: number,
): RemixDraftGrid | null {
  if (!grid.bpm || !(grid.bpm > 0) || segments.length === 0) return null;
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const downbeats = timelineDownbeats(grid, segments);
  if (downbeats.length === 0) return null;
  return {
    schemaVersion: REMIX_DRAFT_GRID_SCHEMA_VERSION,
    bpm: round9(grid.bpm * s),
    downbeatsSec: downbeats.map((t) => round9(t / s)),
    timelineEndSec: round9(segments[segments.length - 1].outEndSec / s),
  };
}

/** Read a stored draft grid tolerantly; null when malformed. */
export function parseDraftGrid(raw: unknown): RemixDraftGrid | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== REMIX_DRAFT_GRID_SCHEMA_VERSION) return null;
  const { bpm, downbeatsSec, timelineEndSec } = raw;
  if (typeof bpm !== "number" || !(bpm > 0)) return null;
  if (typeof timelineEndSec !== "number" || !(timelineEndSec > 0)) return null;
  if (
    !Array.isArray(downbeatsSec) ||
    downbeatsSec.length === 0 ||
    !downbeatsSec.every(
      (t, i) =>
        typeof t === "number" &&
        Number.isFinite(t) &&
        t >= 0 &&
        (i === 0 || t > (downbeatsSec[i - 1] as number)),
    )
  ) {
    return null;
  }
  return {
    schemaVersion: REMIX_DRAFT_GRID_SCHEMA_VERSION,
    bpm,
    downbeatsSec: downbeatsSec as number[],
    timelineEndSec,
  };
}

// --- DJ extended export ---------------------------------------------------------

/** One piece of draft audio, in frames; `endFrame` null = to the end. */
export type DjPiece = { startFrame: number; endFrame: number | null };

export type DjLoopPlacement = {
  name: "Intro" | "Outro";
  /** The loop in the draft, frames. */
  sourceStartFrame: number;
  sourceEndFrame: number;
  repeats: number;
};

export type DjExtendedPlan = {
  sampleRateHz: number;
  pieces: DjPiece[];
  loops: DjLoopPlacement[];
  /** Frames added to the draft. */
  insertedFrames: number;
};

export type DjExportUnavailableReason =
  | "no_cues"
  | "no_draft_grid"
  | "cues_outside_draft";

function toFrame(sec: number, sampleRate: number): number {
  return Math.round(sec * sampleRate);
}

/**
 * Plan the DJ extended version of a draft: the draft with each loop played
 * `repeats` more times right after itself. Returns a reason instead when
 * the draft has no recorded grid, there are no cues, or a loop falls
 * outside the draft's grid (the arrangement changed: set the cues again or
 * render again).
 */
export function djExtendedPlan(
  draftGrid: RemixDraftGrid | null,
  cues: RemixCues | null,
  sampleRate = DJ_EXPORT_SAMPLE_RATE,
): DjExtendedPlan | { unavailable: DjExportUnavailableReason } {
  if (!cues || (!cues.intro && !cues.outro)) return { unavailable: "no_cues" };
  if (!draftGrid) return { unavailable: "no_draft_grid" };
  const barSec = 240 / draftGrid.bpm;
  const placements: DjLoopPlacement[] = [];
  for (const [name, loop] of [
    ["Intro", cues.intro],
    ["Outro", cues.outro],
  ] as const) {
    if (!loop) continue;
    const span = cueLoopSpan(
      draftGrid.downbeatsSec,
      barSec,
      draftGrid.timelineEndSec,
      loop,
    );
    if (!span) return { unavailable: "cues_outside_draft" };
    placements.push({
      name,
      sourceStartFrame: toFrame(span.startSec, sampleRate),
      sourceEndFrame: toFrame(span.endSec, sampleRate),
      repeats: loop.repeats,
    });
  }
  const pieces: DjPiece[] = [];
  let cursor = 0;
  let insertedFrames = 0;
  for (const loop of placements) {
    pieces.push({ startFrame: cursor, endFrame: loop.sourceEndFrame });
    for (let i = 0; i < loop.repeats; i += 1) {
      pieces.push({
        startFrame: loop.sourceStartFrame,
        endFrame: loop.sourceEndFrame,
      });
    }
    insertedFrames +=
      loop.repeats * (loop.sourceEndFrame - loop.sourceStartFrame);
    cursor = loop.sourceEndFrame;
  }
  pieces.push({ startFrame: cursor, endFrame: null });
  return { sampleRateHz: sampleRate, pieces, loops: placements, insertedFrames };
}

/** Where a draft frame lands in the DJ version (frames before `at` shift by what was inserted before them). */
function exportFrame(plan: DjExtendedPlan, draftFrame: number): number {
  let shift = 0;
  for (const loop of plan.loops) {
    if (draftFrame >= loop.sourceEndFrame) {
      shift += loop.repeats * (loop.sourceEndFrame - loop.sourceStartFrame);
    }
  }
  return draftFrame + shift;
}

export type DjCue = {
  name: string;
  kind: "cue" | "loop";
  startSec: number;
  startFrame: number;
  endSec?: number;
  endFrame?: number;
  bars?: number;
};

export type DjCuesSidecar = {
  schemaVersion: typeof REMIX_DJ_CUES_SCHEMA_VERSION;
  dspVersion: typeof REMIX_DJ_EXPORT_DSP_VERSION;
  title: string;
  audioFile: string;
  sampleRateHz: number;
  beatGrid: {
    bpm: number;
    beatsPerBar: 4;
    firstDownbeatSec: number;
    /** Every downbeat of the exported audio, seconds. */
    downbeatsSec: number[];
    /** True when every bar is the same length (one tempo marker suffices). */
    uniform: boolean;
  };
  cues: DjCue[];
};

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * The sidecar of a DJ extended export: the draft downbeats moved to their
 * place in the export plus one per inserted bar, and the cues. Times are
 * seconds (6 decimals) with the exact frame alongside.
 */
export function djCuesSidecar(
  plan: DjExtendedPlan,
  draftGrid: RemixDraftGrid,
  title: string,
  audioFile: string,
): DjCuesSidecar {
  const sr = plan.sampleRateHz;
  const barFrames = (240 / draftGrid.bpm) * sr;
  const downbeatFrames: number[] = [];
  let loopIndex = 0;
  const draftFrames = draftGrid.downbeatsSec.map((t) => toFrame(t, sr));
  for (const frame of draftFrames) {
    // Inserted copies of a loop sit right after its end: emit their bars
    // (the loop's own downbeats shifted) before the first draft bar past it.
    while (
      loopIndex < plan.loops.length &&
      frame >= plan.loops[loopIndex].sourceEndFrame
    ) {
      const loop = plan.loops[loopIndex];
      const loopBars = draftFrames.filter(
        (f) => f >= loop.sourceStartFrame && f < loop.sourceEndFrame,
      );
      const length = loop.sourceEndFrame - loop.sourceStartFrame;
      const base = exportFrame(plan, loop.sourceStartFrame);
      for (let copy = 1; copy <= loop.repeats; copy += 1) {
        for (const f of loopBars) {
          downbeatFrames.push(base + copy * length + (f - loop.sourceStartFrame));
        }
      }
      loopIndex += 1;
    }
    downbeatFrames.push(exportFrame(plan, frame));
  }
  downbeatFrames.sort((a, b) => a - b);
  const uniform = downbeatFrames.every(
    (f, i) => i === 0 || Math.abs(f - downbeatFrames[i - 1] - barFrames) <= 1,
  );
  const cues: DjCue[] = [];
  for (const loop of plan.loops) {
    const start = exportFrame(plan, loop.sourceStartFrame);
    const length = loop.sourceEndFrame - loop.sourceStartFrame;
    const bars = Math.round(length / barFrames);
    if (loop.name === "Intro") {
      cues.push({ name: "Mix in", kind: "cue", startSec: round6(start / sr), startFrame: start });
    }
    cues.push({
      name: loop.name === "Intro" ? "Intro loop" : "Outro loop",
      kind: "loop",
      startSec: round6(start / sr),
      startFrame: start,
      endSec: round6((start + length) / sr),
      endFrame: start + length,
      bars,
    });
    if (loop.name === "Outro") {
      const mixOut = start + (loop.repeats + 1) * length;
      cues.push({ name: "Mix out", kind: "cue", startSec: round6(mixOut / sr), startFrame: mixOut });
    }
  }
  return {
    schemaVersion: REMIX_DJ_CUES_SCHEMA_VERSION,
    dspVersion: REMIX_DJ_EXPORT_DSP_VERSION,
    title,
    audioFile,
    sampleRateHz: sr,
    beatGrid: {
      bpm: draftGrid.bpm,
      beatsPerBar: 4,
      firstDownbeatSec: round6(downbeatFrames[0] / sr),
      downbeatsSec: downbeatFrames.map((f) => round6(f / sr)),
      uniform,
    },
    cues,
  };
}

/**
 * ffmpeg arguments for the splice: one input per piece (decoded lazily, so
 * memory stays flat), each trimmed to its frames plus the crossfade margins,
 * chained with 20 ms linear crossfades centred on each join, encoded like
 * the render (MP3 320 kb/s, 48 kHz stereo). A margin that runs past the
 * audio is padded with silence so every join keeps its length.
 */
export function buildDjExtendedFfmpegArgs(
  plan: DjExtendedPlan,
  inputPath: string,
  outputPath: string,
): string[] {
  const h = DJ_EXPORT_HALF_CROSSFADE_FRAMES;
  const sr = plan.sampleRateHz;
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  const filters: string[] = [];
  const last = plan.pieces.length - 1;
  plan.pieces.forEach((piece, i) => {
    args.push("-i", inputPath);
    const pre = i > 0 ? h : 0;
    const post = i < last ? h : 0;
    const from = piece.startFrame - pre;
    const silenceBefore = Math.max(0, -from);
    const trimStart = Math.max(0, from);
    const chain = [`aresample=${sr}`, "aformat=sample_fmts=fltp:channel_layouts=stereo"];
    if (piece.endFrame === null) {
      chain.push(`atrim=start_sample=${trimStart}`);
    } else {
      const to = piece.endFrame + post;
      chain.push(`atrim=start_sample=${trimStart}:end_sample=${to}`);
      chain.push("asetpts=PTS-STARTPTS");
      if (silenceBefore > 0) chain.push(`adelay=delays=${silenceBefore}S:all=1`);
      chain.push(`apad=whole_len=${to - from}`);
    }
    chain.push("asetpts=PTS-STARTPTS");
    filters.push(`[${i}:a]${chain.join(",")}[p${i}]`);
  });
  let current = "p0";
  for (let i = 1; i <= last; i += 1) {
    const out = i === last ? "out" : `x${i}`;
    filters.push(`[${current}][p${i}]acrossfade=ns=${2 * h}:o=1:c1=tri:c2=tri[${out}]`);
    current = out;
  }
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    last === 0 ? "[p0]" : "[out]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "320k",
    "-ar",
    String(sr),
    "-ac",
    "2",
    outputPath,
  );
  return args;
}
