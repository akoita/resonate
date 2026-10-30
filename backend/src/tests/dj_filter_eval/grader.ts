/**
 * AI DJ filter-adherence eval: the independent grader
 * (docs/engineering/ai-dj-filter-adherence-evals.md, "Grading a pick").
 *
 * It decides from the hand-labelled truth of a track and its own hand-written
 * tables below. It deliberately imports NOTHING from the selector, the genre
 * families, the taste vocabulary, the parser or the golden harness: a grader
 * that shared their predicates would agree with the bugs it exists to catch.
 * The spec fails if this file ever imports anything but `./catalog`.
 */
import type { EvalEnergy, EvalFamily, EvalTrack, Moment, TrackTruth } from "./catalog";

/** What the listener MEANT, written by hand per case; never derived from the parser. */
export interface Intent {
  /** Any of these families satisfies the genre filter. */
  families?: EvalFamily[];
  moment?: Moment;
  energy?: EvalEnergy;
  bpm?: { min: number; max: number };
  explicitAllowed: boolean;
  /** A named artist: that artist, or one the track's truth lists as similar. */
  artist?: string;
}

export type Verdict = "on" | "partial" | "contradiction";

export interface Grade {
  verdict: Verdict;
  reasons: string[];
}

/** BPM slack on either side of a requested range that still counts as in range. */
export const BPM_TOLERANCE = 3;
/** Outside the range (beyond the tolerance) by at most this many BPM is a mismatch; further is a contradiction. */
export const BPM_MISMATCH_LIMIT = 15;

/** The energy each moment stands for. */
export const MOMENT_ENERGY: Record<Moment, EvalEnergy> = {
  Focus: "low",
  Hype: "high",
  Chill: "low",
  Dark: "high",
  Zen: "low",
  Club: "high",
  "Late Night": "low",
  Warm: "low",
};

/**
 * Requested genre names as a listener or a starter says them, and the family
 * each belongs to. The grader's own table (lower-cased keys); not the app's.
 * A "World" request is satisfied by world and Afro music, and by nothing else.
 */
const GENRE_NAME_FAMILIES: Record<string, EvalFamily[]> = {
  "hip-hop": ["hiphop"],
  "hip hop": ["hiphop"],
  hiphop: ["hiphop"],
  rap: ["hiphop"],
  trap: ["hiphop"],
  drill: ["hiphop"],
  "r&b": ["rnb"],
  soul: ["rnb"],
  funk: ["rnb"],
  pop: ["pop"],
  dance: ["pop"],
  synthpop: ["pop"],
  afrobeat: ["afro"],
  afrobeats: ["afro"],
  "afro-pop": ["afro"],
  amapiano: ["afro"],
  reggae: ["reggae"],
  dancehall: ["reggae"],
  dub: ["reggae"],
  latin: ["latin"],
  reggaeton: ["latin"],
  world: ["world", "afro"],
  "musiques du monde": ["world", "afro"],
  electronic: ["electronic"],
  house: ["electronic"],
  techno: ["electronic"],
  edm: ["electronic"],
  "drum & bass": ["electronic"],
  jazz: ["jazz"],
  rock: ["rock"],
  indie: ["rock"],
  metal: ["rock"],
  ambient: ["ambient"],
  "lo-fi": ["ambient"],
  classical: ["classical"],
  country: ["country"],
};

/** The families a requested genre name stands for; empty when the name is not in the table. */
export function familiesForGenreName(name: string): EvalFamily[] {
  return GENRE_NAME_FAMILIES[name.trim().toLowerCase()] ?? [];
}

const ENERGY_RANK: Record<EvalEnergy, number> = { low: 0, medium: 1, high: 2 };

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Grades one pick's truth against what the listener meant. */
export function gradePick(intent: Intent, truth: TrackTruth): Grade {
  const mismatches: string[] = [];
  const contradictions: string[] = [];

  const trackFamilies = [truth.family, ...(truth.alsoFamilies ?? [])];
  if (intent.families && intent.families.length > 0 && !trackFamilies.some((family) => intent.families?.includes(family))) {
    contradictions.push(`genre: ${truth.family} is not ${intent.families.join("/")}`);
  }

  if (intent.moment && !truth.fits.includes(intent.moment)) {
    if (Math.abs(ENERGY_RANK[truth.energy] - ENERGY_RANK[MOMENT_ENERGY[intent.moment]]) >= 2) {
      contradictions.push(`moment: ${intent.moment} wants ${MOMENT_ENERGY[intent.moment]} energy, track is ${truth.energy}`);
    } else {
      mismatches.push(`moment: does not fit ${intent.moment}`);
    }
  }

  if (intent.energy && truth.energy !== intent.energy) {
    const gap = Math.abs(ENERGY_RANK[truth.energy] - ENERGY_RANK[intent.energy]);
    if (gap >= 2) contradictions.push(`energy: wanted ${intent.energy}, track is ${truth.energy}`);
    else mismatches.push(`energy: wanted ${intent.energy}, track is ${truth.energy}`);
  }

  if (intent.bpm) {
    const outside =
      truth.bpm < intent.bpm.min ? intent.bpm.min - truth.bpm : truth.bpm > intent.bpm.max ? truth.bpm - intent.bpm.max : 0;
    if (outside > BPM_MISMATCH_LIMIT) {
      contradictions.push(`tempo: ${truth.bpm} BPM is ${outside} outside ${intent.bpm.min}-${intent.bpm.max}`);
    } else if (outside > BPM_TOLERANCE) {
      mismatches.push(`tempo: ${truth.bpm} BPM is ${outside} outside ${intent.bpm.min}-${intent.bpm.max}`);
    }
  }

  if (!intent.explicitAllowed && truth.explicit) {
    contradictions.push("explicit: track is explicit and explicit is off");
  }

  if (intent.artist) {
    const wanted = intent.artist;
    const isArtist = sameName(truth.artist, wanted);
    const isSimilar = (truth.similarArtists ?? []).some((name) => sameName(name, wanted));
    if (!isArtist && !isSimilar) contradictions.push(`artist: ${truth.artist} is neither ${wanted} nor listed as similar`);
  }

  if (contradictions.length > 0) return { verdict: "contradiction", reasons: [...contradictions, ...mismatches] };
  if (mismatches.length > 0) return { verdict: "partial", reasons: mismatches };
  return { verdict: "on", reasons: [] };
}

/** How many catalog tracks are on-request for this intent (the most a batch could hold). */
export function attainableCount(
  intent: Intent,
  catalog: readonly EvalTrack[],
  excludeKeys: ReadonlySet<string> = new Set(),
): number {
  return catalog.filter(
    (track) => !excludeKeys.has(track.observed.key) && gradePick(intent, track.truth).verdict === "on",
  ).length;
}
