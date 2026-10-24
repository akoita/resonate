import { createHash } from "crypto";
import {
  GENRE_FAMILIES,
  genreFamiliesFor,
  normalizeGenreTerm,
  releaseGenreFamilies,
} from "../recommendations/genre_families";
import {
  bandForEnergy,
  bandForTempo,
  measuredTrackFeatures,
  type MeasuredEnergyBand,
  type MeasuredTempoBand,
} from "../agents/measured_track_features";
import { PLACE_LEXICON } from "./place_lexicon";

/**
 * Enriched track descriptor (#2240): the normalized meaning of a track, derived
 * once from what is known about it and stored (`TrackDescriptor`).
 *
 * This module is pure (no Prisma, no Nest, no model call). It defines the
 * descriptor shape and vocabulary, the DETERMINISTIC strategy (genre families
 * from `genre_families.ts` plus a small place lexicon, bands from measured
 * full-mix features), the sanitization every free-text input and every model
 * answer goes through, and the content hash that decides whether a track needs
 * tagging again.
 *
 * Trust: title, genre and release title are ARTIST-CONTROLLED text. They only
 * ever become (a) lookups in fixed vocabularies, (b) bounded plain-text
 * sub-genre labels and (c) bounded JSON data in a model prompt. They never
 * choose a column, a family outside the vocabulary or any instruction.
 */

/** Bump when the descriptor's meaning changes: it is part of the content hash. */
export const TRACK_DESCRIPTOR_VERSION = 1;

export type TrackDescriptorStrategy = "deterministic" | "model-assisted";
/**
 * Who wrote a descriptor. `artist` is reserved for corrections (#2292): no
 * automatic pass may overwrite such a row.
 */
export type TrackDescriptorSource = "deterministic" | "model" | "artist";
export type TrackDescriptorVocal = "vocal" | "instrumental";

export interface TrackDescriptorValue {
  /** Ids of `GENRE_FAMILIES`, sorted. */
  families: string[];
  /** Free sub-genre labels, lowercase plain text, at most `MAX_SUB_GENRES`. */
  subGenres: string[];
  tempoBand: MeasuredTempoBand | null;
  energyBand: MeasuredEnergyBand | null;
  vocal: TrackDescriptorVocal | null;
}

/** What a descriptor is computed from. Strings are already sanitized. */
export interface TrackDescriptorInput {
  title: string;
  genre: string | null;
  releaseTitle: string | null;
  tempoBand: MeasuredTempoBand | null;
  energyBand: MeasuredEnergyBand | null;
}

export const MAX_SUB_GENRES = 8;
export const MAX_SUB_GENRE_LENGTH = 40;
/** A label longer than this reads as a sentence, not a style. */
export const MAX_SUB_GENRE_WORDS = 4;
export const MAX_INPUT_TEXT_LENGTH = 200;

export const FAMILY_IDS: readonly string[] = GENRE_FAMILIES.map((family) => family.id);
const FAMILY_ID_SET: ReadonlySet<string> = new Set(FAMILY_IDS);

/** Family label by id, for embedding text and display. */
export function familyLabel(id: string): string {
  return GENRE_FAMILIES.find((family) => family.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

// Control characters (C0, DEL, C1) and line/paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;

/**
 * Bounded single-line plain text for an artist-controlled field: control
 * characters become spaces, whitespace collapses, length is capped.
 */
export function sanitizeDescriptorText(
  value: unknown,
  max = MAX_INPUT_TEXT_LENGTH,
): string {
  if (typeof value !== "string") return "";
  return value
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

const SUB_GENRE_ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N} '&+\-.]*$/u;

/**
 * A free sub-genre label: lowercase plain text of letters, digits, spaces and
 * a few joiners, at most `MAX_SUB_GENRE_LENGTH` characters and
 * `MAX_SUB_GENRE_WORDS` words. Anything else
 * (markup, URLs, sentences long enough to carry an instruction) is dropped.
 */
export function sanitizeSubGenre(value: unknown): string | null {
  const text = sanitizeDescriptorText(value, MAX_SUB_GENRE_LENGTH + 1).toLowerCase();
  if (!text || text.length > MAX_SUB_GENRE_LENGTH) return null;
  if (!SUB_GENRE_ALLOWED.test(text)) return null;
  if (text.split(" ").length > MAX_SUB_GENRE_WORDS) return null;
  return text;
}

// ---------------------------------------------------------------------------
// Measured bands
// ---------------------------------------------------------------------------

export interface DescriptorMeasuredBands {
  tempoBand: MeasuredTempoBand | null;
  energyBand: MeasuredEnergyBand | null;
}

/**
 * Tempo and energy bands from the original stem's `stem-audio-features/v1`
 * payload (#1959), through `measuredTrackFeatures`: the same confidence gates
 * (an unconfident tempo is null) and the same band thresholds as the AI DJ
 * audio features. A band is null whenever its measurement is missing; nothing
 * is inferred from metadata.
 */
export function measuredBandsFromAudioFeatures(rawAudioFeatures: unknown): DescriptorMeasuredBands {
  const measured = measuredTrackFeatures(rawAudioFeatures);
  return {
    tempoBand: measured.tempoBpm !== null ? bandForTempo(measured.tempoBpm) : null,
    energyBand: measured.energy !== null ? bandForEnergy(measured.energy) : null,
  };
}

// ---------------------------------------------------------------------------
// Deterministic strategy
// ---------------------------------------------------------------------------

function containsWholePhrase(normalized: string, term: string): boolean {
  return ` ${normalized} `.includes(` ${term} `);
}

/** Family ids the place lexicon names inside a normalized text, plus the matched terms. */
function lexiconMatches(normalized: string): { families: string[]; terms: string[] } {
  const families = new Set<string>();
  const terms: string[] = [];
  if (!normalized) return { families: [], terms };
  for (const group of PLACE_LEXICON) {
    for (const term of group.terms) {
      if (containsWholePhrase(normalized, term)) {
        terms.push(term);
        for (const id of group.families) families.add(id);
      }
    }
  }
  return { families: [...families], terms };
}

/** Parts of a free-text genre: "Afro House / Deep House" -> two phrases. */
function genrePhrases(genre: string): string[] {
  return genre
    .split(/[/,;|]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
}

const INSTRUMENTAL_HINT = /\b(instrumental|karaoke)\b/iu;
const VOCAL_HINT = /\b(a ?cappella|acapella)\b/iu;

function vocalHint(...texts: Array<string | null>): TrackDescriptorVocal | null {
  const joined = texts.filter(Boolean).join(" ");
  if (INSTRUMENTAL_HINT.test(joined)) return "instrumental";
  if (VOCAL_HINT.test(joined)) return "vocal";
  return null;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * The deterministic descriptor of a track.
 *
 * - Families: those `genre_families.ts` (the one shared matcher, #2236) finds
 *   in the free-text genre and in each of its `/`, `,`, `;`-separated parts,
 *   plus those the place lexicon finds in the genre, the title and the release
 *   title. The title and release title are read ONLY through the lexicon:
 *   family members such as "folk" or "global" are too common in titles.
 * - Sub-genres: the genre's own phrases (when they add something beyond a
 *   family label) and the lexicon places found anywhere.
 * - Bands: the measured bands passed in; vocal only from an explicit
 *   "instrumental" / "a cappella" word, since no vocal measurement exists.
 */
export function deterministicDescriptor(input: TrackDescriptorInput): TrackDescriptorValue {
  const families = new Set<string>();
  const subGenres: string[] = [];
  const addSub = (value: string) => {
    const label = sanitizeSubGenre(value);
    if (label && !subGenres.includes(label) && subGenres.length < MAX_SUB_GENRES) {
      subGenres.push(label);
    }
  };

  const genre = input.genre ?? "";
  if (genre) {
    for (const family of releaseGenreFamilies(genre)) families.add(family.id);
    for (const phrase of genrePhrases(genre)) {
      for (const family of releaseGenreFamilies(phrase)) families.add(family.id);
      const normalized = normalizeGenreTerm(phrase);
      const isFamilyLabel = GENRE_FAMILIES.some(
        (family) =>
          normalizeGenreTerm(family.id) === normalized ||
          normalizeGenreTerm(family.label) === normalized,
      );
      if (!isFamilyLabel) addSub(phrase);
    }
  }

  const places = [
    lexiconMatches(normalizeGenreTerm(genre)),
    lexiconMatches(normalizeGenreTerm(input.title)),
    lexiconMatches(normalizeGenreTerm(input.releaseTitle ?? "")),
  ];
  for (const match of places) {
    for (const id of match.families) families.add(id);
    for (const term of match.terms) addSub(term);
  }

  return {
    families: sortedUnique(families),
    subGenres: [...subGenres].sort(),
    tempoBand: input.tempoBand,
    energyBand: input.energyBand,
    vocal: vocalHint(input.genre, input.title, input.releaseTitle),
  };
}

// ---------------------------------------------------------------------------
// Validating a model answer
// ---------------------------------------------------------------------------

/**
 * Resolves one tag to a family id of the vocabulary: its id, its label, or one
 * of its request names ("world music"). Anything else is NOT a family.
 */
export function resolveFamilyTag(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  const normalized = normalizeGenreTerm(sanitizeDescriptorText(tag, MAX_SUB_GENRE_LENGTH));
  if (!normalized) return null;
  const direct = GENRE_FAMILIES.find(
    (family) =>
      normalizeGenreTerm(family.id) === normalized ||
      normalizeGenreTerm(family.label) === normalized,
  );
  if (direct) return direct.id;
  const named = genreFamiliesFor(normalized).find((family) =>
    (family.names ?? []).some((name) => normalizeGenreTerm(name) === normalized),
  );
  return named?.id ?? null;
}

export interface ModelDescriptorAnswer {
  families: string[];
  subGenres: string[];
  vocal: TrackDescriptorVocal | null;
}

/**
 * Re-validates a model answer: every family tag must resolve to the
 * vocabulary; every other tag is kept as a free sub-genre (sanitized, capped);
 * `vocal` must be exactly "vocal" or "instrumental". Tags that are neither a
 * family nor a clean label are dropped. Never throws.
 */
export function validateModelAnswer(raw: {
  families?: unknown;
  subGenres?: unknown;
  vocal?: unknown;
}): ModelDescriptorAnswer {
  const families = new Set<string>();
  const subGenres: string[] = [];
  const addSub = (tag: unknown) => {
    const label = sanitizeSubGenre(tag);
    if (label && !subGenres.includes(label) && subGenres.length < MAX_SUB_GENRES) {
      subGenres.push(label);
    }
  };
  const asList = (value: unknown): unknown[] =>
    Array.isArray(value) ? value.slice(0, 24) : [];

  for (const tag of [...asList(raw.families), ...asList(raw.subGenres)]) {
    const id = resolveFamilyTag(tag);
    if (id && FAMILY_ID_SET.has(id)) families.add(id);
    else addSub(tag);
  }
  return {
    families: sortedUnique(families),
    subGenres,
    vocal: raw.vocal === "vocal" || raw.vocal === "instrumental" ? raw.vocal : null,
  };
}

/**
 * The model-assisted descriptor: the deterministic one (always computed, wins
 * the measured bands) widened by what the model added. Families are a union;
 * the model never sets a band, and its `vocal` only fills a null.
 */
export function mergeModelDescriptor(
  deterministic: TrackDescriptorValue,
  answer: ModelDescriptorAnswer,
): TrackDescriptorValue {
  const subGenres = [...deterministic.subGenres];
  for (const label of answer.subGenres) {
    if (!subGenres.includes(label) && subGenres.length < MAX_SUB_GENRES) subGenres.push(label);
  }
  return {
    families: sortedUnique([...deterministic.families, ...answer.families]),
    subGenres: subGenres.sort(),
    tempoBand: deterministic.tempoBand,
    energyBand: deterministic.energyBand,
    vocal: deterministic.vocal ?? answer.vocal,
  };
}

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

/**
 * sha256 over everything the descriptor depends on: the sanitized inputs, the
 * measured bands (the only audio-feature values the descriptor uses), the
 * strategy, the model id (model-assisted only) and the descriptor version.
 * Equal hash = nothing to recompute = no model call.
 */
export function descriptorContentHash(
  input: TrackDescriptorInput,
  strategy: TrackDescriptorStrategy,
  model: string | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: TRACK_DESCRIPTOR_VERSION,
        strategy,
        model: strategy === "model-assisted" ? model : null,
        title: input.title,
        genre: input.genre,
        releaseTitle: input.releaseTitle,
        tempoBand: input.tempoBand,
        energyBand: input.energyBand,
      }),
    )
    .digest("hex");
}

/** The sanitized input of a track row. */
export function buildDescriptorInput(track: {
  title: string;
  genre?: string | null;
  releaseTitle?: string | null;
  audioFeatures?: unknown;
}): TrackDescriptorInput {
  const bands = measuredBandsFromAudioFeatures(track.audioFeatures);
  return {
    title: sanitizeDescriptorText(track.title),
    genre: sanitizeDescriptorText(track.genre) || null,
    releaseTitle: sanitizeDescriptorText(track.releaseTitle) || null,
    tempoBand: bands.tempoBand,
    energyBand: bands.energyBand,
  };
}

// ---------------------------------------------------------------------------
// Embedding text
// ---------------------------------------------------------------------------

/** The slice of a descriptor a track embedding is computed from. */
export interface EmbeddingDescriptorSource {
  families?: readonly string[] | null;
  subGenres?: readonly string[] | null;
  tempoBand?: string | null;
  energyBand?: string | null;
  vocal?: string | null;
}

/**
 * Lines appended to the track embedding text. Empty when the track has no
 * descriptor or it carries nothing, so such a track keeps its previous text
 * and hash and is not re-embedded for nothing.
 */
export function descriptorEmbeddingLines(
  descriptor: EmbeddingDescriptorSource | null | undefined,
): string[] {
  if (!descriptor) return [];
  const families = [...(descriptor.families ?? [])].sort().map(familyLabel);
  const subGenres = [...(descriptor.subGenres ?? [])].sort();
  const lines: string[] = [];
  if (families.length) lines.push(`Genre families: ${families.join(", ")}`);
  if (subGenres.length) lines.push(`Styles: ${subGenres.join(", ")}`);
  if (descriptor.tempoBand) lines.push(`Tempo: ${descriptor.tempoBand}`);
  if (descriptor.energyBand) lines.push(`Energy: ${descriptor.energyBand}`);
  if (descriptor.vocal) lines.push(`Vocals: ${descriptor.vocal}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Artist corrections (#2292)
// ---------------------------------------------------------------------------

/**
 * The controlled vocabulary an artist can tag from: the genre families and the
 * sub-genre labels the platform itself recognises (every member of every genre
 * family plus the place lexicon). Free text is never added through a
 * correction. Sorted, sanitized with `sanitizeSubGenre`.
 */
export const SUB_GENRE_VOCABULARY: readonly string[] = (() => {
  const labels = new Set<string>();
  const add = (value: string) => {
    const label = sanitizeSubGenre(value);
    if (label) labels.add(label);
  };
  for (const family of GENRE_FAMILIES) family.members.forEach(add);
  for (const group of PLACE_LEXICON) group.terms.forEach(add);
  return [...labels].sort();
})();
const SUB_GENRE_VOCABULARY_SET: ReadonlySet<string> = new Set(SUB_GENRE_VOCABULARY);

export interface TrackDescriptorVocabulary {
  families: Array<{ id: string; label: string }>;
  subGenres: string[];
}

/** What the release editor offers when an artist corrects tags. */
export function trackDescriptorVocabulary(): TrackDescriptorVocabulary {
  return {
    families: GENRE_FAMILIES.map((family) => ({ id: family.id, label: family.label })),
    subGenres: [...SUB_GENRE_VOCABULARY],
  };
}

export interface DescriptorCorrection {
  families: string[];
  subGenres: string[];
}

export type DescriptorCorrectionResult =
  | { ok: true; value: DescriptorCorrection }
  | { ok: false; errors: string[] };

/**
 * Validates an artist correction against the controlled vocabulary. The
 * correction is the COMPLETE new set of families and sub-genres (removals are
 * just absences). Families must be ids of `GENRE_FAMILIES`. A sub-genre must be
 * in `SUB_GENRE_VOCABULARY`, or already be on the stored descriptor (a
 * generated free label the artist is keeping rather than adding). Bands and
 * `vocal` are measured and not part of a correction. Never throws.
 */
export function validateDescriptorCorrection(
  raw: { families?: unknown; subGenres?: unknown },
  currentSubGenres: readonly string[] = [],
): DescriptorCorrectionResult {
  const errors: string[] = [];
  const families = new Set<string>();
  const subGenres = new Set<string>();
  const kept = new Set(currentSubGenres);

  if (!Array.isArray(raw.families)) errors.push("families must be a list of genre family ids");
  else {
    for (const value of raw.families) {
      if (typeof value === "string" && FAMILY_ID_SET.has(value)) families.add(value);
      else errors.push("families must only contain genre family ids from the vocabulary");
    }
  }
  if (!Array.isArray(raw.subGenres)) errors.push("subGenres must be a list of sub-genre labels");
  else {
    for (const value of raw.subGenres) {
      const label = sanitizeSubGenre(value);
      if (label && (SUB_GENRE_VOCABULARY_SET.has(label) || kept.has(label))) subGenres.add(label);
      else errors.push("subGenres must only contain labels from the vocabulary or already on the track");
    }
    if (subGenres.size > MAX_SUB_GENRES) errors.push(`at most ${MAX_SUB_GENRES} sub-genres`);
  }
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, value: { families: sortedUnique(families), subGenres: [...subGenres].sort() } };
}

/** Content hash of an artist-written descriptor (it only identifies the correction). */
export function artistDescriptorContentHash(value: DescriptorCorrection): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: TRACK_DESCRIPTOR_VERSION, source: "artist", ...value }))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Owner view
// ---------------------------------------------------------------------------

/**
 * The descriptor as the release editor shows it (#2240): owner and credited
 * managers only. Family ids come with their display labels; `source` says who
 * wrote it (`artist` once corrected, #2292).
 */
export interface OwnerTrackDescriptorView {
  families: string[];
  familyLabels: string[];
  subGenres: string[];
  tempoBand: string | null;
  energyBand: string | null;
  vocal: string | null;
  source: string;
}

export function ownerDescriptorView(row: {
  families: readonly string[];
  subGenres: readonly string[];
  tempoBand: string | null;
  energyBand: string | null;
  vocal: string | null;
  source: string;
}): OwnerTrackDescriptorView {
  const families = [...row.families].sort();
  return {
    families,
    familyLabels: families.map(familyLabel),
    subGenres: [...row.subGenres],
    tempoBand: row.tempoBand,
    energyBand: row.energyBand,
    vocal: row.vocal,
    source: row.source,
  };
}
