import { camelotCode } from "../ingestion/stem-audio-features";

/**
 * Camelot wheel helpers for the Crate Digger (#1962,
 * docs/rfc/taste-engine.md §5.1–5.2).
 *
 * Pure: no database, no clock, no randomness. The tonic -> Camelot table is the
 * one the ingestion pipeline uses to derive `camelot` on stored stem features
 * (`camelotCode` in `stem-audio-features.ts`: 8B = C major, 8A = A minor), so a
 * DJ's typed key and a track's measured key always land on the same code.
 *
 * Neighbours on the wheel are the harmonically compatible keys: the same
 * number on the other ring (relative major/minor) and the adjacent numbers on
 * the same ring (a fifth up or down), with 12 and 1 adjacent.
 */

export type HarmonicRelation = "same" | "neighbor" | "clash" | "unknown";

/** Longest key text read; anything longer is not a key. */
const MAX_KEY_TEXT_LENGTH = 24;

const CAMELOT_PATTERN = /^(0?[1-9]|1[0-2])\s*([ab])$/i;
const MUSICAL_KEY_PATTERN = /^([a-g])([#b]?)[\s-]*(m|min|minor|maj|major)?$/i;

/** Pitch class of each natural note (C = 0). */
const NATURAL_PITCH_CLASS: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Sharp spellings, indexed by pitch class; what `camelotCode` understands. */
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The canonical code ("8A") for a Camelot code, or null when it is not one. */
export function normalizeCamelotCode(text: string): string | null {
  if (typeof text !== "string") return null;
  const match = CAMELOT_PATTERN.exec(text.trim());
  if (!match) return null;
  return `${Number(match[1])}${match[2].toUpperCase()}`;
}

function parseCode(code: string): { number: number; letter: "A" | "B" } | null {
  const normalized = normalizeCamelotCode(code);
  if (!normalized) return null;
  return {
    number: Number(normalized.slice(0, -1)),
    letter: normalized.endsWith("A") ? "A" : "B",
  };
}

/** Wraps a wheel position into 1..12. */
function wrap(position: number): number {
  return ((((position - 1) % 12) + 12) % 12) + 1;
}

/**
 * Canonical upper-case Camelot code for a Camelot code or a musical key, or
 * null when `text` is neither.
 *
 * Accepts "8A", "08a", "11B"; and "A minor", "Am", "A min", "F#m",
 * "F# minor", "Bb major", "Bb", "C", "C major", "Ebm", "D♭ major". A key with no
 * minor marker is major. A capital "M" is read as major ("CM"), a lower-case
 * "m" as minor ("Cm"). "sharp"/"flat" spelled out are accepted.
 */
export function parseKeyToCamelot(text: string): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_KEY_TEXT_LENGTH) return null;

  const camelot = normalizeCamelotCode(trimmed);
  if (camelot) return camelot;

  const spelled = trimmed
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/\s*sharp\b/gi, "#")
    .replace(/\s*flat\b/gi, "b");
  const match = MUSICAL_KEY_PATTERN.exec(spelled);
  if (!match) return null;

  const natural = NATURAL_PITCH_CLASS[match[1].toUpperCase()];
  const accidental = match[2] === "#" ? 1 : match[2] ? -1 : 0;
  const tonic = SHARP_NAMES[(((natural + accidental) % 12) + 12) % 12];

  const marker = match[3] ?? "";
  const minor = marker === "M" ? false : /^m(?:in(?:or)?)?$/i.test(marker);
  return camelotCode({ tonic, mode: minor ? "minor" : "major", confidence: 1 });
}

/**
 * The keys one step from `code` on the wheel: the same number on the other
 * ring, then one number down and one up on the same ring (12 and 1 wrap).
 * The code itself is not included. Empty for anything that is not a code.
 */
export function camelotNeighbors(code: string): string[] {
  const parsed = parseCode(code);
  if (!parsed) return [];
  const other = parsed.letter === "A" ? "B" : "A";
  return [
    `${parsed.number}${other}`,
    `${wrap(parsed.number - 1)}${parsed.letter}`,
    `${wrap(parsed.number + 1)}${parsed.letter}`,
  ];
}

/**
 * Every code a key request accepts: each valid code, plus its neighbours when
 * `includeNeighbors`. Entries that are not Camelot codes are ignored.
 */
export function expandCamelotKeys(codes: string[], includeNeighbors: boolean): Set<string> {
  const expanded = new Set<string>();
  for (const code of codes) {
    const normalized = normalizeCamelotCode(code);
    if (!normalized) continue;
    expanded.add(normalized);
    if (includeNeighbors) {
      for (const neighbor of camelotNeighbors(normalized)) expanded.add(neighbor);
    }
  }
  return expanded;
}

/**
 * How two tracks' keys relate: `same`, `neighbor` (harmonically compatible),
 * `clash`, or `unknown` when either key is missing or not a Camelot code.
 */
export function harmonicRelation(a: string | null, b: string | null): HarmonicRelation {
  if (a === null || b === null) return "unknown";
  const left = normalizeCamelotCode(a);
  const right = normalizeCamelotCode(b);
  if (!left || !right) return "unknown";
  if (left === right) return "same";
  return camelotNeighbors(left).includes(right) ? "neighbor" : "clash";
}
