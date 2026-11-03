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

// ---------------------------------------------------------------------------
// Studio helpers (#2560): suggestions, the stems of each source, and the
// conforms the preview engine plays B with.
// ---------------------------------------------------------------------------

export const MASHUP_SEMITONES_MIN = -6;
export const MASHUP_SEMITONES_MAX = 6;
export const MASHUP_OFFSET_BARS_MAX = 2000;
export const MASHUP_FIRST_BEAT_MAX_SEC = 120;

export type MashupKey = { tonic: string; mode: "major" | "minor" };

/**
 * The tempo ratio that brings B to A's tempo (B × ratio = A). A pair too far
 * apart for the 0.75–1.33 range is tried at half or double time; when even
 * that misses, `inRange` is false and the ratio is the clamped one.
 */
export function suggestTempoRatio(
  leadBpm: number | null,
  secondaryBpm: number | null,
): { ratio: number; feel: "same" | "half" | "double"; inRange: boolean } | null {
  if (!leadBpm || !secondaryBpm || leadBpm <= 0 || secondaryBpm <= 0) return null;
  const direct = leadBpm / secondaryBpm;
  const options: Array<{ ratio: number; feel: "same" | "half" | "double" }> = [
    { ratio: direct, feel: "same" },
    // B read at half time (its bars twice as long) or double time.
    { ratio: direct * 2, feel: "half" },
    { ratio: direct / 2, feel: "double" },
  ];
  const inRange = options
    .filter(
      (option) =>
        option.ratio >= MASHUP_TEMPO_RATIO_MIN - 1e-9 &&
        option.ratio <= MASHUP_TEMPO_RATIO_MAX + 1e-9,
    )
    .sort((a, b) => Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)));
  if (inRange.length > 0) {
    return { ratio: roundRatio(inRange[0].ratio), feel: inRange[0].feel, inRange: true };
  }
  return { ratio: roundRatio(clampRatio(direct)), feel: "same", inRange: false };
}

export function clampRatio(ratio: number): number {
  return Math.min(MASHUP_TEMPO_RATIO_MAX, Math.max(MASHUP_TEMPO_RATIO_MIN, ratio));
}

function roundRatio(ratio: number): number {
  return Math.round(ratio * 10000) / 10000;
}

const PITCH_CLASS: Readonly<Record<string, number>> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** Pitch class of a tonic ("C", "F#", "Bb", "D♭"), or null. */
export function tonicPitchClass(tonic: string): number | null {
  const match = /^([A-Ga-g])([#♯b♭]?)$/.exec(tonic.trim());
  if (!match) return null;
  const natural = PITCH_CLASS[match[1].toUpperCase()];
  const accidental = match[2] === "#" || match[2] === "♯" ? 1 : match[2] ? -1 : 0;
  return (natural + accidental + 12) % 12;
}

/**
 * The key shift (semitones, −6..6) that puts B in A's key. Keys of different
 * modes are compared through their relative major (A minor ≈ C major), so a
 * minor B over a major A lands on A's relative minor. Null when a key is
 * unknown.
 */
export function suggestKeyShift(
  leadKey: MashupKey | null,
  secondaryKey: MashupKey | null,
): number | null {
  if (!leadKey || !secondaryKey) return null;
  const lead = tonicPitchClass(leadKey.tonic);
  const secondary = tonicPitchClass(secondaryKey.tonic);
  if (lead === null || secondary === null) return null;
  const relativeMajor = (pc: number, mode: MashupKey["mode"]) =>
    mode === "minor" ? (pc + 3) % 12 : pc;
  const delta =
    (relativeMajor(lead, leadKey.mode) - relativeMajor(secondary, secondaryKey.mode) + 12) % 12;
  return delta > 6 ? delta - 12 : delta;
}

/** A key's name as the studio shows it ("A minor"). */
export function keyLabel(key: MashupKey | null): string | null {
  return key ? `${key.tonic} ${key.mode}` : null;
}

type StemWithSource = {
  stemId: string;
  sourceTrackId?: string;
  audioFeatures?: unknown;
};

/** The stems of one source; on a one-source project every stem is A's. */
export function stemsOfSource<T extends StemWithSource>(
  stems: T[],
  trackId: string,
  leadTrackId: string,
): T[] {
  return stems.filter((stem) => (stem.sourceTrackId ?? leadTrackId) === trackId);
}

/** A source's most confident measured key. */
export function measuredKey(stems: Array<{ audioFeatures?: unknown }>): MashupKey | null {
  let best: { key: MashupKey; confidence: number } | null = null;
  for (const stem of stems) {
    const features = stem.audioFeatures as Record<string, unknown> | null | undefined;
    const key = features && typeof features === "object" ? features.key : null;
    if (!key || typeof key !== "object") continue;
    const { tonic, mode, confidence } = key as Record<string, unknown>;
    if (typeof tonic !== "string" || (mode !== "major" && mode !== "minor")) continue;
    const score = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0;
    if (!best || score > best.confidence) best = { key: { tonic, mode }, confidence: score };
  }
  return best?.key ?? null;
}

/**
 * The conform of each of B's project stems for the preview, or none when the
 * project has one source, no recipe, or B plays as it is (no lead grid, an
 * offset past A's end). Mirrors what the render applies.
 */
export function previewConforms(project: {
  sourceTrackId: string;
  secondarySource?: { trackId: string } | null;
  mashup?: RemixMashup | null;
  sectionGrid?: RemixSectionGrid | null;
  stems: StemWithSource[];
}): { conforms: Record<string, MashupConform>; skipped: MashupConformSkip | null } {
  const secondary = project.secondarySource?.trackId;
  if (!secondary || !project.mashup) return { conforms: {}, skipped: null };
  const secondaryStems = stemsOfSource(project.stems, secondary, project.sourceTrackId);
  const plan = mashupConformPlan({
    leadGrid: project.sectionGrid ?? null,
    secondaryStems,
    mashup: project.mashup,
  });
  if ("skipped" in plan) return { conforms: {}, skipped: plan.skipped };
  return {
    conforms: Object.fromEntries(secondaryStems.map((stem) => [stem.stemId, plan.conform])),
    skipped: null,
  };
}

/** The default recipe for a newly attached B, from the measured features. */
export function initialMashup(input: {
  leadBpm: number | null;
  secondaryBpm: number | null;
  leadKey: MashupKey | null;
  secondaryKey: MashupKey | null;
}): RemixMashup {
  const tempo = suggestTempoRatio(input.leadBpm, input.secondaryBpm);
  return {
    schemaVersion: REMIX_MASHUP_SCHEMA_VERSION,
    secondary: {
      tempoRatio: tempo?.ratio ?? 1,
      semitones: suggestKeyShift(input.leadKey, input.secondaryKey) ?? 0,
      offsetBars: 0,
    },
  };
}

/**
 * Names the source that blocks an action on a two-source project, so the
 * studio can say "Track B needs a commercial license to export" instead of a
 * bare denial. Null when the reason is not tied to a source.
 */
export function denialSourceLabel(
  reason: { sourceRole?: "lead" | "secondary"; sourceTrackId?: string },
  sources: {
    lead: { trackTitle: string };
    secondary?: { trackTitle: string } | null;
  },
): string | null {
  if (!sources.secondary) return null;
  if (reason.sourceRole === "secondary") return `Track B (“${sources.secondary.trackTitle}”)`;
  if (reason.sourceRole === "lead") return `Track A (“${sources.lead.trackTitle}”)`;
  return null;
}
