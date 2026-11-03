/**
 * Cue and loop points (#2540, Remix Studio Pro S6d of #1903): the studio
 * half. Mirrors the bar math of `backend/src/modules/remix/remix-cues.ts`:
 * cues are whole bars of the timeline, the bars are the beat maker's bars,
 * and `remix-cues-v1.parity.json` pins both engines to the same downbeats
 * and loop spans. The DJ extended export itself is made by the server.
 */
import type { RemixCueLoop, RemixCues, RemixDjExportReason } from "./api";
import { beatBarPhase, type RemixBeatGrid, type RemixBeatSegment } from "./remixBeat";

export const REMIX_CUES_SCHEMA_VERSION = "remix-cues/v1" as const;
export const CUE_LOOP_BAR_CHOICES = [1, 2, 4, 8, 16, 32] as const;
export const CUE_MIN_REPEATS = 1;
export const CUE_MAX_REPEATS = 8;

/** Transport loop indices for the cue loops (block loops use 0..n). */
export const INTRO_LOOP_INDEX = -1;
export const OUTRO_LOOP_INDEX = -2;

export type CueName = "intro" | "outro";
export type CueSpan = { startSec: number; endSec: number };

const EDGE_EPSILON = 1e-9;

function round9(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** Every downbeat of the timeline (seconds, 9 decimals), placed like the beat maker's bars. */
export function timelineDownbeats(
  grid: Pick<RemixBeatGrid, "bpm" | "firstBeatSec">,
  segments: RemixBeatSegment[],
): number[] {
  const bpm = grid.bpm;
  if (!bpm || !(bpm > 0)) return [];
  const barSec = 240 / bpm;
  const out: number[] = [];
  for (const segment of segments) {
    const phase = beatBarPhase(grid as RemixBeatGrid, segment.section, barSec);
    for (let bar = 0; ; bar += 1) {
      const t = segment.outStartSec + phase + bar * barSec;
      if (t >= segment.outEndSec - EDGE_EPSILON) break;
      const rounded = round9(t);
      if (out.length === 0 || rounded > out[out.length - 1] + EDGE_EPSILON) out.push(rounded);
    }
  }
  return out;
}

/** A loop's span on the downbeats; the last bar ends one bar on when it fits. Null when it doesn't fit. */
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

/** The bars a loop can start on so it still fits (as many as `bars` before the end). */
export function lastLoopStartBar(downbeats: number[], barSec: number, endSec: number, bars: number): number {
  for (let start = downbeats.length - 1; start >= 0; start -= 1) {
    if (cueLoopSpan(downbeats, barSec, endSec, { startBar: start, bars })) return start;
  }
  return -1;
}

/**
 * Starting cues for a timeline: the first 8 bars as the intro and the last 8
 * as the outro (4 when the song is short), each played twice more. Null
 * without bars.
 */
export function suggestedCues(downbeats: number[], barSec: number, endSec: number): RemixCues | null {
  if (downbeats.length < 2) return null;
  const bars = downbeats.length >= 32 ? 8 : downbeats.length >= 8 ? 4 : 1;
  const outroStart = lastLoopStartBar(downbeats, barSec, endSec, bars);
  return {
    schemaVersion: REMIX_CUES_SCHEMA_VERSION,
    intro: { startBar: 0, bars, repeats: 2 },
    outro: outroStart >= bars ? { startBar: outroStart, bars, repeats: 2 } : null,
  };
}

/** Problems that keep the cues from saving, in plain words; [] when they're fine. */
export function cuesProblems(
  cues: RemixCues,
  downbeats: number[],
  barSec: number,
  endSec: number,
): string[] {
  const problems: string[] = [];
  const intro = cues.intro && cueLoopSpan(downbeats, barSec, endSec, cues.intro);
  const outro = cues.outro && cueLoopSpan(downbeats, barSec, endSec, cues.outro);
  if (cues.intro && !intro) problems.push("The intro loop runs past the end of the song.");
  if (cues.outro && !outro) problems.push("The outro loop runs past the end of the song.");
  if (cues.intro && cues.outro && cues.intro.startBar + cues.intro.bars > cues.outro.startBar) {
    problems.push("The intro loop must end before the outro loop starts.");
  }
  return problems;
}

/** The PATCH value: null when neither loop is set. */
export function cuesPayload(cues: RemixCues | null): RemixCues | null {
  if (!cues || (!cues.intro && !cues.outro)) return null;
  return { schemaVersion: REMIX_CUES_SCHEMA_VERSION, intro: cues.intro, outro: cues.outro };
}

export function sameCues(a: RemixCues | null | undefined, b: RemixCues | null | undefined): boolean {
  return JSON.stringify(cuesPayload(a ?? null)) === JSON.stringify(cuesPayload(b ?? null));
}

/** "bars 1–8" (1-based, inclusive). */
export function cueBarsLabel(loop: Pick<RemixCueLoop, "startBar" | "bars">): string {
  const first = loop.startBar + 1;
  const last = loop.startBar + loop.bars;
  return first === last ? `bar ${first}` : `bars ${first}–${last}`;
}

/** Seconds the DJ version adds for a loop. */
export function cueAddedSeconds(span: CueSpan | null, repeats: number): number {
  return span ? (span.endSec - span.startSec) * repeats : 0;
}

/** The transport label for a cue loop. */
export function cueLoopLabel(index: number): string | null {
  if (index === INTRO_LOOP_INDEX) return "Looping the intro";
  if (index === OUTRO_LOOP_INDEX) return "Looping the outro";
  return null;
}

/** Why the DJ version can't be exported, in plain words. */
export function djExportReasonText(reason: RemixDjExportReason | null | undefined): string | null {
  switch (reason) {
    case "no_draft":
      return "Render the mix first; the DJ version is made from your draft.";
    case "no_cues":
      return "Set an intro or outro loop first.";
    case "no_draft_grid":
      return "This draft has no beat grid yet. Render the mix again to export a DJ version.";
    case "cues_outside_draft":
      return "The loops don't fit this draft. Render the mix again after changing the arrangement.";
    default:
      return null;
  }
}
