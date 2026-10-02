import { harmonicRelation, type HarmonicRelation } from "./crate_camelot";
import type { CrateCandidateFacts } from "./crate.types";

/**
 * Set-path ordering for a crate (#1962, docs/rfc/taste-engine.md §5.2): a path
 * through energy and harmonic compatibility, so the crate reads as a set rather
 * than a ranked list.
 *
 * Pure and deterministic: no randomness, no clock, no I/O, and equal inputs
 * give the same order. The rank score is only a small tiebreak here; selection
 * already used it to decide WHICH lines make the crate, and ordering never adds
 * or drops a line.
 */

/** Points for how the next track's key relates to the current one. */
export const HARMONIC_POINTS: Readonly<Record<HarmonicRelation, number>> = {
  same: 3,
  neighbor: 2,
  unknown: 1,
  clash: 0,
};
/** Weight of the harmonic points (so a clash costs up to 3.0 against `same`). */
export const SET_WEIGHT_HARMONIC = 1;
/** Largest BPM penalty, reached at a gap of `SET_BPM_FULL_PENALTY_GAP` BPM. */
export const SET_BPM_MAX_PENALTY = 1.5;
export const SET_BPM_FULL_PENALTY_GAP = 15;
/** Unknown tempo is neutral: half the largest penalty. */
export const SET_BPM_UNKNOWN_PENALTY = SET_BPM_MAX_PENALTY / 2;
/** Penalty per unit of energy drop (the path should not fall back). */
export const SET_WEIGHT_ENERGY_DROP = 4;
/** Penalty per unit of energy rise (a mild preference for a gradual build). */
export const SET_WEIGHT_ENERGY_RISE = 0.5;
/** Weight of the min-max normalized rank score, the final small tiebreak. */
export const SET_WEIGHT_SCORE = 0.1;
/** Energy assumed for every track when none has a measured energy. */
const NEUTRAL_ENERGY = 0.5;

type TransitionSide = Pick<CrateCandidateFacts, "camelot" | "tempoBpm" | "energy">;

export type CrateTransitionFacts = {
  harmonic: HarmonicRelation;
  /** `b` minus `a` in BPM (one decimal), or null when either tempo is unknown. */
  bpmDelta: number | null;
  /** `b` minus `a` on the 0..1 energy composite, or null when either is unknown. */
  energyDelta: number | null;
};

function finiteOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** What changes going from `a` to `b`: the facts a transition preview shows. */
export function transitionFacts(a: TransitionSide, b: TransitionSide): CrateTransitionFacts {
  const tempoA = finiteOrNull(a.tempoBpm);
  const tempoB = finiteOrNull(b.tempoBpm);
  const energyA = finiteOrNull(a.energy);
  const energyB = finiteOrNull(b.energy);
  return {
    harmonic: harmonicRelation(a.camelot, b.camelot),
    bpmDelta: tempoA === null || tempoB === null ? null : Math.round((tempoB - tempoA) * 10) / 10,
    energyDelta:
      energyA === null || energyB === null ? null : Math.round((energyB - energyA) * 1000) / 1000,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return NEUTRAL_ENERGY;
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface Entry<T> {
  line: T;
  index: number;
  trackId: string;
  /** Measured energy, or the median of the known energies when unknown. */
  energy: number;
  /** Rank score normalized to 0..1 across the crate. */
  score: number;
}

/** Higher is a better next step from `from`. */
function stepValue<T extends { facts: CrateCandidateFacts }>(from: Entry<T>, to: Entry<T>): number {
  const facts = transitionFacts(from.line.facts, to.line.facts);
  let value = SET_WEIGHT_HARMONIC * HARMONIC_POINTS[facts.harmonic];

  const bpmPenalty = facts.bpmDelta === null
    ? SET_BPM_UNKNOWN_PENALTY
    : SET_BPM_MAX_PENALTY * Math.min(1, Math.abs(facts.bpmDelta) / SET_BPM_FULL_PENALTY_GAP);
  value -= bpmPenalty;

  const energyDelta = to.energy - from.energy;
  value -= energyDelta < 0
    ? SET_WEIGHT_ENERGY_DROP * -energyDelta
    : SET_WEIGHT_ENERGY_RISE * energyDelta;

  return value + SET_WEIGHT_SCORE * to.score;
}

/** Best rank score first, then track id, then input position: a total order. */
function compareTies<T>(a: Entry<T>, b: Entry<T>): number {
  return b.score - a.score || (a.trackId < b.trackId ? -1 : a.trackId > b.trackId ? 1 : 0) || a.index - b.index;
}

/**
 * Orders crate lines as a set path. Starts at the lowest-energy line (an
 * unknown energy counts as the median of the known ones; ties go to the higher
 * rank score, then the track id), then repeatedly takes the remaining line with
 * the best step from the current one:
 *
 * - key: same 3, neighbor 2, unknown 1, clash 0 (`HARMONIC_POINTS`);
 * - tempo: a penalty growing with |ΔBPM| up to `SET_BPM_MAX_PENALTY`, neutral
 *   (half) when either tempo is unknown;
 * - energy: a heavy penalty per unit of drop, a mild one per unit of rise;
 * - rank score: a small bonus (min-max normalized) that breaks near-ties.
 *
 * Returns a new array; the input is not modified.
 */
export function orderCrateAsSetPath<T extends { facts: CrateCandidateFacts; score: number }>(
  lines: T[],
): T[] {
  if (lines.length <= 1) return [...lines];

  const knownEnergies = lines
    .map((line) => finiteOrNull(line.facts.energy))
    .filter((energy): energy is number => energy !== null);
  const fallbackEnergy = median(knownEnergies);

  const scores = lines.map((line) => (Number.isFinite(line.score) ? line.score : 0));
  const lowest = Math.min(...scores);
  const span = Math.max(...scores) - lowest;

  const remaining: Entry<T>[] = lines.map((line, index) => ({
    line,
    index,
    trackId: line.facts.trackId,
    energy: finiteOrNull(line.facts.energy) ?? fallbackEnergy,
    score: span > 0 ? (scores[index] - lowest) / span : 0,
  }));

  const startPosition = remaining.reduce((best, entry, position) => {
    const current = remaining[best];
    if (entry.energy !== current.energy) return entry.energy < current.energy ? position : best;
    return compareTies(entry, current) < 0 ? position : best;
  }, 0);

  const ordered: T[] = [];
  let current = remaining.splice(startPosition, 1)[0];
  ordered.push(current.line);

  while (remaining.length > 0) {
    let bestPosition = 0;
    let bestValue = stepValue(current, remaining[0]);
    for (let position = 1; position < remaining.length; position += 1) {
      const value = stepValue(current, remaining[position]);
      const better = value > bestValue + 1e-12
        || (Math.abs(value - bestValue) <= 1e-12
          && compareTies(remaining[position], remaining[bestPosition]) < 0);
      if (better) {
        bestPosition = position;
        bestValue = value;
      }
    }
    current = remaining.splice(bestPosition, 1)[0];
    ordered.push(current.line);
  }
  return ordered;
}
