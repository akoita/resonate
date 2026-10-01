import {
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_GENRES,
  TASTE_EDIT_HIGH_ENERGY_WORDS,
  TASTE_EDIT_INSTRUMENT_WORDS,
  TASTE_EDIT_LOW_ENERGY_WORDS,
  TASTE_EDIT_MEDIUM_ENERGY_WORDS,
  TASTE_EDIT_MOOD_ALIASES,
  TASTE_EDIT_MOODS,
} from "./taste_edit_vocabulary";
import type { TasteSignalAction, TasteSignalType } from "./taste_memory.service";

/**
 * Deterministic taste-edit parser (#1961, ADR-TE-5,
 * docs/rfc/taste-engine.md §3.6).
 *
 * A listener types what they want in their own words ("less drill, more live
 * instruments"); this turns it into the exact statements they will be asked to
 * confirm. It is PURE: no database, no network, no clock, no randomness. The
 * same text always yields the same items, and nothing here writes anything.
 * Artist names are the one thing that needs data, so they arrive through an
 * injected, synchronous `resolveArtist` lookup that the service backs with a
 * database query (see `candidateArtistNames`).
 *
 * The free text is never logged or published: only the structured items leave
 * this module, and only after the listener confirms them.
 *
 * Model seam: `TasteEditParser` is the interface a future model-backed parser
 * would implement (ADR-TE-5 follows the same propose-then-confirm contract).
 * No model parser ships in this slice.
 */

export const TASTE_EDIT_MAX_TEXT_LENGTH = 500;
export const TASTE_EDIT_MAX_CLAUSES = 10;
const MAX_PHRASE_LENGTH = 120;
/** Matches the 80-character bound on taste signal values. */
const MAX_VALUE_LENGTH = 80;

/** Source recorded on every control written from a confirmed text edit. */
export const DECLARED_TEXT_EDIT_SOURCE = "declared_text_edit";

export const TASTE_EDIT_KINDS = [
  "downrank_genre",
  "boost_genre",
  "hide_artist",
  "downrank_mood",
  "boost_mood",
  "energy_preference",
  "written_preference",
  "unmapped",
] as const;

export type TasteEditKind = (typeof TASTE_EDIT_KINDS)[number];

export interface ProposedTasteEdit {
  /** Stable within one preview response; used by the UI as a row key. */
  id: string;
  kind: TasteEditKind;
  /** `null` only for `unmapped` items, which can never be applied. */
  signalType: TasteSignalType | null;
  /** Empty for `unmapped` items. */
  value: string;
  /** `null` only for `unmapped` items. */
  action: TasteSignalAction | null;
  /** The part of the listener's text this item came from. */
  phrase: string;
  /** Human statement shown for confirmation, e.g. "Show less drill". */
  statement: string;
}

export interface ParseTasteEditOptions {
  /**
   * Synchronous artist lookup: returns the artist's display name when `name`
   * matches an existing artist (case-insensitive), otherwise `undefined`. When
   * absent, no artist is ever proposed.
   */
  resolveArtist?: (name: string) => string | undefined;
}

export interface ParsedTasteEdits {
  items: ProposedTasteEdit[];
}

/** The seam a model-backed parser would implement (follow-up, not shipped). */
export interface TasteEditParser {
  parse(text: string, options?: ParseTasteEditOptions): ParsedTasteEdits | Promise<ParsedTasteEdits>;
}

/**
 * The (signalType -> actions) combinations a confirmed text edit may write.
 * The apply endpoint enforces this server-side; it is not only a UI hint.
 */
export const DECLARED_EDIT_RULES: Readonly<Record<string, readonly string[]>> = {
  genre: ["boosted", "downranked"],
  mood: ["boosted", "downranked"],
  artist: ["hidden"],
  energy: ["boosted"],
  note: ["declared"],
};

export const DECLARED_ENERGY_VALUES = ["low", "medium", "high"] as const;

export function isAllowedDeclaredEdit(signalType: unknown, action: unknown): boolean {
  if (typeof signalType !== "string" || typeof action !== "string") return false;
  if (!Object.prototype.hasOwnProperty.call(DECLARED_EDIT_RULES, signalType)) return false;
  return DECLARED_EDIT_RULES[signalType].includes(action);
}

// ---------------------------------------------------------------------------
// Phrase matching
// ---------------------------------------------------------------------------

interface PhraseEntry {
  phrase: string;
  value: string;
  regex: RegExp;
}

interface PhraseMatch {
  value: string;
  start: number;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word matcher. Whitespace and hyphens inside a phrase are
 * interchangeable ("lo fi", "lo-fi", "lofi"); `&` counts as a word character so
 * "r&b" is never read as "r" plus "b".
 */
function phraseRegex(phrase: string): RegExp {
  const body = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join("[\\s-]*");
  return new RegExp(`(^|[^a-z0-9&])(${body})(?![a-z0-9&])`);
}

function buildEntries(pairs: Array<[string, string]>): PhraseEntry[] {
  const seen = new Set<string>();
  const entries: PhraseEntry[] = [];
  for (const [phrase, value] of pairs) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ phrase: key, value, regex: phraseRegex(key) });
  }
  // Longest phrase first, so "deep house" is read before "house".
  return entries.sort((a, b) => b.phrase.length - a.phrase.length);
}

const GENRE_ENTRIES = buildEntries([
  ...TASTE_EDIT_GENRES.map((genre): [string, string] => [genre, genre]),
  ...Object.entries(TASTE_EDIT_GENRE_ALIASES),
]);
const MOOD_ENTRIES = buildEntries([
  ...TASTE_EDIT_MOODS.map((mood): [string, string] => [mood, mood]),
  ...Object.entries(TASTE_EDIT_MOOD_ALIASES),
]);
const INSTRUMENT_ENTRIES = buildEntries(
  TASTE_EDIT_INSTRUMENT_WORDS.map((word): [string, string] => [word, word]),
);
const ENERGY_ENTRIES = buildEntries([
  ...TASTE_EDIT_HIGH_ENERGY_WORDS.map((word): [string, string] => [word, "high"]),
  ...TASTE_EDIT_LOW_ENERGY_WORDS.map((word): [string, string] => [word, "low"]),
  ...TASTE_EDIT_MEDIUM_ENERGY_WORDS.map((word): [string, string] => [word, "medium"]),
]);

/**
 * Finds every non-overlapping match of `entries` in `text` and returns the
 * matches plus the text with those spans blanked, so later vocabularies never
 * re-read the same words ("drum and bass" is a genre, not a "drum" instrument).
 */
function findPhrases(
  text: string,
  entries: PhraseEntry[],
): { matches: PhraseMatch[]; masked: string } {
  let working = text;
  const matches: PhraseMatch[] = [];
  for (const entry of entries) {
    for (;;) {
      const found = entry.regex.exec(working);
      if (!found) break;
      const start = found.index + found[1].length;
      const length = found[2].length;
      matches.push({ value: entry.value, start });
      working = working.slice(0, start) + " ".repeat(length) + working.slice(start + length);
    }
  }
  matches.sort((a, b) => a.start - b.start);
  return { matches, masked: working };
}

// ---------------------------------------------------------------------------
// Clauses and polarity
// ---------------------------------------------------------------------------

/**
 * Rewrites phrases that contain a clause separator ("drum and bass", "rhythm
 * and blues") into single tokens before the text is split into clauses.
 */
function protectCompoundGenres(text: string): string {
  return text
    .replace(/\bdrum\s*(?:and|&|n|'n')\s*bass\b/gi, "drum-and-bass")
    .replace(/\brhythm\s*(?:and|&)\s*blues\b/gi, "r&b")
    .replace(/\br\s*(?:and|n)\s*b\b/gi, "r&b");
}

function splitClauses(text: string): string[] {
  return protectCompoundGenres(text)
    .split(/[;,\n]+|\.\s+|\s+(?:and|but|plus|also|then)\s+|\s+&\s+|\s+\+\s+/i)
    .map((clause) => clause.replace(/\s+/g, " ").trim())
    .filter((clause) => /[a-z0-9]/i.test(clause));
}

interface Polarity {
  /** `1` asks for more, `-1` asks for less. */
  sign: 1 | -1;
  /** "no", "without", "hide", "stop"...: a rejection rather than a dial-down. */
  strong: boolean;
}

const STRONG_NEGATIVE =
  /\b(?:no|without|avoid|stop|hide|hate|skip|remove|not|nothing|never|don'?t|do not|sick of|tired of)\b/i;
const SOFT_NEGATIVE = /\b(?:less|fewer|reduce)\b/i;
const POSITIVE =
  /\b(?:more|love|want|like|add|need|enjoy|prefer|into|give me|show me|play|boost|crank)\b/i;

function clausePolarity(clause: string): Polarity | null {
  if (STRONG_NEGATIVE.test(clause)) return { sign: -1, strong: true };
  if (SOFT_NEGATIVE.test(clause)) return { sign: -1, strong: false };
  if (POSITIVE.test(clause)) return { sign: 1, strong: false };
  return null;
}

const LEADING_FILLER =
  /^(?:(?:please|just|also|so|i'?d|i'?ll|i|we|would|like to|want to|can you|could you|let me hear|let's hear|hear|see|to|want|need|love|enjoy|like)\b\s*)+/i;

/** The clause with leading pleasantries removed but its more/less/no cue kept. */
function cleanPhrase(clause: string): string {
  const stripped = clause.replace(LEADING_FILLER, "").trim();
  const source = stripped || clause;
  return source.replace(/^[\s"'`]+|[\s"'`.!?]+$/g, "").slice(0, MAX_PHRASE_LENGTH);
}

const LEADING_CUES =
  /^(?:(?:please|just|also|so|i'?d|i'?ll|i|we|would|do|does|not|don'?t|want|like|love|to|see|hear|play|playing|show me|give me|no more|no|without|avoid|stop|hide|hate|skip|remove|less|fewer|more|any|anything from|songs? by|music by|tracks? by|from|by|of|sick of|tired of)\b\s*)+/i;

/** Possible artist names in a negative clause: what is left after the cues. */
function artistTargets(clause: string): string[] {
  const target = clause
    .replace(LEADING_CUES, "")
    .replace(/^[\s"'`]+|[\s"'`.!?]+$/g, "")
    .trim();
  if (!target || target.length > MAX_VALUE_LENGTH || !/[a-z]/i.test(target)) return [];
  const withoutNoun = target.replace(/\s+(?:music|songs|tracks|stuff)$/i, "").trim();
  return withoutNoun && withoutNoun !== target ? [target, withoutNoun] : [target];
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

type ItemDraft = Omit<ProposedTasteEdit, "id">;

function genreItem(value: string, sign: 1 | -1, phrase: string): ItemDraft {
  return sign === 1
    ? {
        kind: "boost_genre",
        signalType: "genre",
        value,
        action: "boosted",
        phrase,
        statement: `Show more ${value}`,
      }
    : {
        kind: "downrank_genre",
        signalType: "genre",
        value,
        action: "downranked",
        phrase,
        statement: `Show less ${value}`,
      };
}

function moodItem(value: string, sign: 1 | -1, phrase: string): ItemDraft {
  return sign === 1
    ? {
        kind: "boost_mood",
        signalType: "mood",
        value,
        action: "boosted",
        phrase,
        statement: `Show more ${value} music`,
      }
    : {
        kind: "downrank_mood",
        signalType: "mood",
        value,
        action: "downranked",
        phrase,
        statement: `Show less ${value} music`,
      };
}

const ENERGY_STATEMENTS: Record<string, string> = {
  high: "Prefer higher-energy music",
  medium: "Prefer medium-energy music",
  low: "Prefer calmer, lower-energy music",
};

function energyItem(band: string, phrase: string): ItemDraft {
  return {
    kind: "energy_preference",
    signalType: "energy",
    value: band,
    action: "boosted",
    phrase,
    statement: ENERGY_STATEMENTS[band],
  };
}

function writtenItem(phrase: string): ItemDraft {
  const value = phrase.slice(0, MAX_VALUE_LENGTH).trim();
  return {
    kind: "written_preference",
    signalType: "note",
    value,
    action: "declared",
    phrase,
    statement: `Save the note "${value}" (shown in your taste memory; where music matching is on, it nudges recommendations toward music like it)`,
  };
}

function artistItem(displayName: string, phrase: string): ItemDraft {
  return {
    kind: "hide_artist",
    signalType: "artist",
    value: displayName,
    action: "hidden",
    phrase,
    statement: `Hide ${displayName}`,
  };
}

function unmappedItem(phrase: string, hint?: string): ItemDraft {
  return {
    kind: "unmapped",
    signalType: null,
    value: "",
    action: null,
    phrase,
    statement: `Couldn't map '${phrase}' to a taste signal${hint ? `. ${hint}` : ""}`,
  };
}

function flipBand(band: string): string | null {
  if (band === "high") return "low";
  if (band === "low") return "high";
  return null;
}

function draftsForClause(
  clause: string,
  inherited: Polarity | null,
  own: Polarity | null,
  options: ParseTasteEditOptions,
): ItemDraft[] {
  const phrase = cleanPhrase(clause);
  const polarity = own ?? inherited;

  // A rejection of a named artist wins over any vocabulary reading.
  if (own?.strong && options.resolveArtist) {
    for (const target of artistTargets(clause)) {
      const artist = options.resolveArtist(target);
      if (artist) return [artistItem(artist, phrase)];
    }
  }

  const lower = clause.toLowerCase();
  const drafts: ItemDraft[] = [];
  let ambiguous = false;

  const genres = findPhrases(lower, GENRE_ENTRIES);
  const moods = findPhrases(genres.masked, MOOD_ENTRIES);
  const energy = findPhrases(moods.masked, ENERGY_ENTRIES);
  const instruments = findPhrases(energy.masked, INSTRUMENT_ENTRIES);

  // Energy is a property of the wording itself ("calmer", "chill"), so it reads
  // the clause's own cue only and never inherits one from a neighbour.
  const band = energy.matches[0]?.value;
  if (band) {
    const resolved = own && own.sign === -1 ? flipBand(band) : band;
    if (resolved) drafts.push(energyItem(resolved, phrase));
  }

  for (const match of genres.matches) {
    if (polarity) drafts.push(genreItem(match.value, polarity.sign, phrase));
    else ambiguous = true;
  }
  for (const match of moods.matches) {
    if (polarity) drafts.push(moodItem(match.value, polarity.sign, phrase));
    else ambiguous = true;
  }

  // "acoustic guitar" is an instrument request, not the Acoustic genre.
  const onlyAcousticGenre = genres.matches.length > 0
    && genres.matches.every((match) => match.value === "Acoustic");
  if (instruments.matches.length > 0 && onlyAcousticGenre) {
    const acoustic = drafts.findIndex((draft) => draft.value === "Acoustic");
    if (acoustic >= 0) drafts.splice(acoustic, 1);
    ambiguous = false;
  }
  if (instruments.matches.length > 0) drafts.push(writtenItem(phrase));

  if (drafts.length === 0) {
    return [
      ambiguous
        ? unmappedItem(phrase, `Say "more ${phrase}" or "less ${phrase}" so we know which you mean.`)
        : unmappedItem(phrase),
    ];
  }
  return drafts;
}

/**
 * Turns free text into proposed taste edits. Pure and deterministic; never
 * writes. Input is bounded to `TASTE_EDIT_MAX_TEXT_LENGTH` characters and
 * `TASTE_EDIT_MAX_CLAUSES` clauses; anything beyond the bound is reported
 * rather than silently dropped.
 */
export function parseTasteEditText(
  text: string,
  options: ParseTasteEditOptions = {},
): ParsedTasteEdits {
  if (typeof text !== "string") return { items: [] };
  const bounded = text.slice(0, TASTE_EDIT_MAX_TEXT_LENGTH);
  const allClauses = splitClauses(bounded);
  const clauses = allClauses.slice(0, TASTE_EDIT_MAX_CLAUSES);

  const drafts: ItemDraft[] = [];
  let lastPolarity: Polarity | null = null;
  for (const clause of clauses) {
    const own = clausePolarity(clause);
    drafts.push(...draftsForClause(clause, lastPolarity, own, options));
    if (own) lastPolarity = own;
  }
  if (allClauses.length > clauses.length) {
    drafts.push(
      unmappedItem(
        "the rest of your message",
        `Only the first ${TASTE_EDIT_MAX_CLAUSES} requests are read at a time.`,
      ),
    );
  }

  const seen = new Set<string>();
  const items: ProposedTasteEdit[] = [];
  for (const draft of drafts) {
    const key = draft.kind === "unmapped"
      ? `unmapped:${draft.phrase.toLowerCase()}`
      : `${draft.signalType}:${draft.value.toLowerCase()}:${draft.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id: `edit-${items.length + 1}`, ...draft });
  }
  return { items };
}

/**
 * Names in `text` that could be an artist being rejected ("no <name>", "hide
 * <name>"). The service looks these up in the catalog and feeds the matches
 * back as `resolveArtist`, which keeps the parser itself free of I/O.
 */
export function candidateArtistNames(text: string): string[] {
  const names = new Set<string>();
  parseTasteEditText(text, {
    resolveArtist: (name) => {
      names.add(name);
      return undefined;
    },
  });
  return [...names];
}

/** The shipped parser: deterministic rules, no model (ADR-TE-5 slice 1). */
export const deterministicTasteEditParser: TasteEditParser = {
  parse: (text, options) => parseTasteEditText(text, options),
};
