/**
 * Mashups (#2559, Remix Studio Pro S6f-3b of #1903): the studio half of the
 * conform. Mirrors `backend/src/modules/remix/remix-mashup.ts`: B's bar 1
 * lands on A's bar `offsetBars` (A's unstructured downbeats, the bars the
 * cues and the beat count), after B is stretched by its tempo ratio. The
 * preview applies the same stretch (the pinned Signalsmith engine), shift
 * and cut to B's stems, so B plays in A's source time like an A stem.
 * `remix-mashup-v1.parity.json` pins both plans to the same numbers.
 */
import type { RemixSectionGrid } from "./api";
import { timelineDownbeats } from "./remixCues";
import { structureTimeline } from "./remixStructure";

export const REMIX_MASHUP_SCHEMA_VERSION = "remix-mashup/v1" as const;
export const MASHUP_TEMPO_RATIO_MIN = 0.75;
export const MASHUP_TEMPO_RATIO_MAX = 1.33;

export type RemixMashupSecondary = {
  tempoRatio: number;
  semitones: number;
  offsetBars: number;
  firstBeatSec?: number;
};

export type RemixMashup = {
  schemaVersion: typeof REMIX_MASHUP_SCHEMA_VERSION;
  secondary: RemixMashupSecondary;
};

/** How one of B's stems is conformed to A's source time. */
export type MashupConform = {
  tempo: number;
  semitones: number;
  shiftSec: number;
  endSec: number | null;
};

export type MashupConformSkip = "no_lead_grid" | "offset_past_end";

function round9(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** A source's most confident measured tempo and its first downbeat. */
export function measuredTempo(stems: Array<{ audioFeatures?: unknown }>): {
  bpm: number | null;
  firstBeatSec: number | null;
} {
  let best: { bpm: number; firstBeatSec: number | null; confidence: number } | null = null;
  for (const stem of stems) {
    const features = stem.audioFeatures as Record<string, unknown> | null | undefined;
    if (!features || typeof features !== "object") continue;
    const bpm = features.tempoBpm;
    if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm < 30 || bpm > 300) continue;
    const confidence =
      typeof features.tempoConfidence === "number" && Number.isFinite(features.tempoConfidence)
        ? features.tempoConfidence
        : 0;
    const first = features.firstBeatSec;
    if (!best || confidence > best.confidence) {
      best = {
        bpm,
        firstBeatSec:
          typeof first === "number" && Number.isFinite(first) && first >= 0 ? first : null,
        confidence,
      };
    }
  }
  return { bpm: best?.bpm ?? null, firstBeatSec: best?.firstBeatSec ?? null };
}

/** The conform plan for B, or why B plays as it is (mirrors the backend). */
export function mashupConformPlan(input: {
  leadGrid: RemixSectionGrid | null;
  secondaryStems: Array<{ audioFeatures?: unknown }>;
  mashup: RemixMashup;
}): { conform: MashupConform } | { skipped: MashupConformSkip } {
  const { leadGrid, mashup } = input;
  if (!leadGrid || leadGrid.kind !== "bars" || !leadGrid.bpm) {
    return { skipped: "no_lead_grid" };
  }
  const downbeats = timelineDownbeats(
    { bpm: leadGrid.bpm, firstBeatSec: leadGrid.firstBeatSec ?? null },
    structureTimeline(leadGrid, null).segments,
  );
  const target = downbeats[mashup.secondary.offsetBars];
  if (target === undefined) return { skipped: "offset_past_end" };
  const secondaryFirstBeat =
    mashup.secondary.firstBeatSec ?? measuredTempo(input.secondaryStems).firstBeatSec ?? 0;
  const { tempoRatio, semitones } = mashup.secondary;
  return {
    conform: {
      tempo: tempoRatio,
      semitones,
      shiftSec: round9(target - secondaryFirstBeat / tempoRatio),
      endSec: leadGrid.durationSeconds,
    },
  };
}

/** Cache key of a conform: a changed plan re-conforms the stem. */
export function mashupConformKey(conform: MashupConform): string {
  return `${conform.tempo}|${conform.semitones}|${conform.shiftSec}|${conform.endSec ?? ""}`;
}

/**
 * Shift and cut stretched channels onto A's time (whole samples), as the
 * render does: a positive shift delays (leading silence), a negative one
 * trims the start; the result ends at `endSec` (A's length) when set.
 */
export function shiftConformedChannels(
  channels: Float32Array[],
  sampleRate: number,
  conform: Pick<MashupConform, "shiftSec" | "endSec">,
): Float32Array[] {
  const shift = Math.round(conform.shiftSec * sampleRate);
  const sourceLength = channels[0]?.length ?? 0;
  const shiftedLength = Math.max(0, sourceLength + shift);
  const end =
    conform.endSec !== null && conform.endSec > 0
      ? Math.round(conform.endSec * sampleRate)
      : Number.POSITIVE_INFINITY;
  const length = Math.max(1, Math.min(shiftedLength, end));
  return channels.map((channel) => {
    const out = new Float32Array(length);
    if (shift >= 0) {
      out.set(channel.subarray(0, Math.max(0, length - shift)), Math.min(shift, length));
    } else {
      out.set(channel.subarray(-shift, -shift + length));
    }
    return out;
  });
}
