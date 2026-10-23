import { canonicalCrateGenre, canonicalCrateMood } from "../crates/crate_filters";

/**
 * Artist names in an AI DJ session sentence (#2241). Pure: no database, no
 * network, no logging. "like Nadia Okoro", "more Kofi Amarteifio" or
 * "Hana Mori-style" name a credited catalog artist; the lookup runs against a
 * name index the caller builds from the catalog, so a name that is not in the
 * catalog never resolves and stays under "Didn't catch".
 *
 * Matching is case- and diacritic-insensitive. A near miss ("Nadia Okro") only
 * resolves when it is conservative: a long enough name, one or two edits, the
 * same first letter, and exactly one catalog name that close.
 */

export const SESSION_ARTIST_MAX = 3;
export const SESSION_ARTIST_MAX_NAME_LENGTH = 64;
/** Longest artist name, in words, the rules look for after or before a cue. */
const MAX_NAME_WORDS = 5;
const MIN_NAME_LENGTH = 3;
/** Shortest normalized name that may match with one edit. */
const FUZZY_MIN_LENGTH = 7;
/** Shortest normalized name that may match with two edits. */
const FUZZY_TWO_EDITS_MIN_LENGTH = 13;

/** Lower case, no diacritics, apostrophes dropped, other punctuation as one space. */
export function normalizeArtistName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface ArtistNameIndex {
  /** Normalized name -> the catalog's spelling. */
  readonly byNormalized: ReadonlyMap<string, string>;
}

export function buildArtistNameIndex(names: Iterable<string>): ArtistNameIndex {
  const byNormalized = new Map<string, string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || name.length > SESSION_ARTIST_MAX_NAME_LENGTH) continue;
    const key = normalizeArtistName(name);
    if (key.length >= MIN_NAME_LENGTH && !byNormalized.has(key)) byNormalized.set(key, name);
  }
  return { byNormalized };
}

function editDistanceAtMost(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/** A genre or mood word is never an artist name, even if some artist is called that. */
function isVocabularyTerm(normalized: string): boolean {
  return Boolean(canonicalCrateGenre(normalized) ?? canonicalCrateMood(normalized));
}

/**
 * The catalog's spelling of the artist `candidate` names, or undefined.
 * Exact (normalized) first; then a unique near match.
 */
export function matchArtistName(candidate: string, index: ArtistNameIndex): string | undefined {
  const key = normalizeArtistName(candidate);
  if (key.length < MIN_NAME_LENGTH || isVocabularyTerm(key)) return undefined;
  const exact = index.byNormalized.get(key);
  if (exact) return exact;
  if (key.length < FUZZY_MIN_LENGTH) return undefined;
  const limit = key.length >= FUZZY_TWO_EDITS_MIN_LENGTH ? 2 : 1;
  let best: { name: string; distance: number } | undefined;
  let tied = false;
  for (const [normalized, name] of index.byNormalized) {
    if (normalized[0] !== key[0]) continue;
    const distance = editDistanceAtMost(key, normalized, limit);
    if (distance > limit) continue;
    if (!best || distance < best.distance) {
      best = { name, distance };
      tied = false;
    } else if (distance === best.distance) {
      tied = true;
    }
  }
  return best && !tied ? best.name : undefined;
}

// ---------------------------------------------------------------------------
// Finding names in a sentence
// ---------------------------------------------------------------------------

type Token = { norm: string; start: number; end: number; kind: "word" | "joiner" | "boundary" };

const TOKEN_PATTERN = /[\p{L}\p{N}'’]+|[,&+]|[.!?;:()]/gu;
const JOINER_WORDS = new Set(["and", "or"]);

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (/^[,&+]$/.test(raw)) tokens.push({ norm: raw, start, end, kind: "joiner" });
    else if (/^[.!?;:()]$/.test(raw)) tokens.push({ norm: raw, start, end, kind: "boundary" });
    else {
      const norm = normalizeArtistName(raw);
      if (norm) tokens.push({ norm, start, end, kind: "word" });
    }
  }
  return tokens;
}

/** Words before a name: "like X", "more from X", "similar to X", "by X". */
const PREFIX_CUES: readonly (readonly string[])[] = [
  ["in", "the", "style", "of"],
  ["similar", "to"],
  ["sounds", "like"],
  ["sound", "like"],
  ["more", "from"],
  ["more", "of"],
  ["fans", "of"],
  ["fan", "of"],
  ["style", "of"],
  ["more"],
  ["like"],
  ["by"],
  ["from"],
  ["play"],
  ["featuring"],
  ["feat"],
];

/** Words after a name: "X style", "X-style", "X vibes". */
const SUFFIX_CUES: readonly (readonly string[])[] = [
  ["style"],
  ["styled"],
  ["vibe"],
  ["vibes"],
  ["esque"],
  ["inspired"],
];

export type ArtistMention = {
  /** The catalog's spelling. */
  name: string;
  /** The words as the listener wrote them (for removal from "Didn't catch"). */
  surface: string;
};

function isJoiner(token: Token | undefined): boolean {
  return !!token && (token.kind === "joiner" || (token.kind === "word" && JOINER_WORDS.has(token.norm)));
}

function cueAt(tokens: Token[], at: number, cues: readonly (readonly string[])[]): number {
  for (const cue of cues) {
    if (at + cue.length > tokens.length) continue;
    if (cue.every((word, offset) => tokens[at + offset].kind === "word" && tokens[at + offset].norm === word)) {
      return cue.length;
    }
  }
  return 0;
}

function wordRun(tokens: Token[], from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (tokens[i].kind !== "word") return false;
  return true;
}

/**
 * Catalog artists a sentence names after a cue ("like X", "more X", "X-style"),
 * at most {@link SESSION_ARTIST_MAX}, in sentence order. Without a cue a name is
 * not read: "kern" in "a song about kern" is not a request for the artist Kern.
 */
export function findArtistMentions(text: string, index: ArtistNameIndex): ArtistMention[] {
  if (index.byNormalized.size === 0) return [];
  const tokens = tokenize(text);
  const mentions: ArtistMention[] = [];
  const claimed = new Set<number>();

  const remember = (from: number, to: number, name: string): boolean => {
    if (mentions.some((mention) => mention.name === name)) return false;
    for (let i = from; i < to; i += 1) claimed.add(i);
    mentions.push({ name, surface: text.slice(tokens[from].start, tokens[to - 1].end) });
    return true;
  };
  const isClaimed = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (claimed.has(i)) return true;
    return false;
  };

  /** Longest name starting at `from`; returns the end (exclusive) it consumed. */
  const matchForward = (from: number): number => {
    for (let length = Math.min(MAX_NAME_WORDS, tokens.length - from); length >= 1; length -= 1) {
      if (!wordRun(tokens, from, from + length) || isClaimed(from, from + length)) continue;
      const name = matchArtistName(tokens.slice(from, from + length).map((t) => t.norm).join(" "), index);
      if (name && remember(from, from + length, name)) return from + length;
    }
    return from;
  };

  for (let i = 0; i < tokens.length && mentions.length < SESSION_ARTIST_MAX; i += 1) {
    const cueLength = cueAt(tokens, i, PREFIX_CUES);
    if (cueLength === 0) continue;
    let next = i + cueLength;
    let end = matchForward(next);
    // "like X and Y": names joined after one cue.
    while (end > next && isJoiner(tokens[end]) && mentions.length < SESSION_ARTIST_MAX) {
      next = end + 1;
      end = matchForward(next);
    }
  }

  for (let i = 1; i < tokens.length && mentions.length < SESSION_ARTIST_MAX; i += 1) {
    if (cueAt(tokens, i, SUFFIX_CUES) === 0) continue;
    for (let length = Math.min(MAX_NAME_WORDS, i); length >= 1; length -= 1) {
      const from = i - length;
      if (!wordRun(tokens, from, i) || isClaimed(from, i)) continue;
      const name = matchArtistName(tokens.slice(from, i).map((t) => t.norm).join(" "), index);
      if (name && remember(from, i, name)) break;
    }
  }
  return mentions;
}

// ---------------------------------------------------------------------------
// "Didn't catch"
// ---------------------------------------------------------------------------

const CUE_WORDS = new Set([
  "like", "more", "from", "of", "by", "to", "similar", "sounds", "sound", "style", "styled", "vibe", "vibes",
  "esque", "inspired", "fans", "fan", "play", "featuring", "feat", "in", "the", "and", "or", "something",
  "anything", "music", "songs", "tracks", "a", "some",
]);

/**
 * Removes the artist names (and the cue words left around them) from the
 * "Didn't catch" phrases. A phrase with nothing else in it disappears.
 */
export function withoutArtistMentions(phrases: readonly string[], mentions: readonly ArtistMention[]): string[] {
  if (mentions.length === 0) return [...phrases];
  const surfaces = mentions.map((mention) => normalizeArtistName(mention.surface)).filter(Boolean);
  const kept: string[] = [];
  for (const phrase of phrases) {
    const original = normalizeArtistName(phrase);
    let words = original;
    for (const surface of surfaces) {
      words = ` ${words} `.split(` ${surface} `).join(" ").replace(/\s+/g, " ").trim();
    }
    if (words === original) {
      kept.push(phrase);
      continue;
    }
    const remaining = words.split(" ").filter(Boolean);
    if (remaining.every((word) => CUE_WORDS.has(word))) continue;
    kept.push(remaining.join(" "));
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Untrusted artist names (preferences sent back by a client)
// ---------------------------------------------------------------------------

/** Trimmed, bounded, de-duplicated names; at most {@link SESSION_ARTIST_MAX}. Never throws. */
export function sanitizeArtistNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name || name.length > SESSION_ARTIST_MAX_NAME_LENGTH) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= SESSION_ARTIST_MAX) break;
  }
  return names;
}
