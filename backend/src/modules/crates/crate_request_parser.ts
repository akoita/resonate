import {
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_GENRES,
  TASTE_EDIT_MOOD_ALIASES,
  TASTE_EDIT_MOODS,
} from "../recommendations/taste_edit_vocabulary";
import { parseKeyToCamelot } from "./crate_camelot";
import {
  CRATE_BPM_MAX,
  CRATE_BPM_MIN,
  CRATE_MAX_GENRES,
  CRATE_MAX_KEYS,
  CRATE_MAX_MOODS,
  CRATE_MAX_PRICE_USD,
  canonicalCrateGenre,
  canonicalCrateMood,
  defaultCrateFilters,
  sanitizeCrateFilters,
} from "./crate_filters";
import {
  CRATE_MAX_COUNT,
  CRATE_MIN_COUNT,
  CRATE_REQUEST_MAX_TEXT_LENGTH,
  CRATE_STEM_TYPES,
  type CrateFilters,
  type CrateLicenseType,
  type CrateNumberRange,
  type CrateParseResult,
  type CrateStemType,
} from "./crate.types";

/**
 * Deterministic Crate Digger request parser (#1962,
 * docs/rfc/taste-engine.md §5.1).
 *
 * A DJ types "peak-time Afro house, 122–124 BPM, acapella available, under $20
 * total"; this turns it into visible, editable {@link CrateFilters}. It is PURE:
 * no database, no network, no clock, no randomness, and the same text always
 * yields the same filters. Genres and moods come from the taste-edit
 * vocabulary (taste_edit_vocabulary.ts), so a filter can only name a genre the
 * catalog offers; anything the rules cannot read is reported in `unparsed`
 * rather than guessed.
 *
 * The text is never logged. The optional model-assisted parser
 * (model_crate_request_parser.ts) implements the same {@link CrateRequestParser}
 * seam and falls back to this parser on any failure: the filters are the
 * contract, the model is optional.
 */

/** Nest injection token for the configured {@link CrateRequestParser}. */
export const CRATE_REQUEST_PARSER = Symbol("CRATE_REQUEST_PARSER");

/** The seam the optional model-assisted parser also implements. */
export interface CrateRequestParser {
  parse(text: string): Promise<CrateParseResult>;
}

export const CRATE_MAX_UNPARSED = 10;
export const CRATE_MAX_UNPARSED_LENGTH = 120;

/** Energy bands on the measured 0..1 composite for the energy words. */
const ENERGY_HIGH: CrateNumberRange = { min: 0.65, max: 1 };
const ENERGY_LOW: CrateNumberRange = { min: 0, max: 0.45 };
const ENERGY_MEDIUM: CrateNumberRange = { min: 0.35, max: 0.7 };

/** Half-width of the range a single "124 bpm" becomes. */
const BPM_EXACT_TOLERANCE = 2;
/** Half-width for "around 124 bpm". */
const BPM_APPROX_TOLERANCE = 3;

// ---------------------------------------------------------------------------
// Working text
// ---------------------------------------------------------------------------

/** Characters that read as one thing; each is replaced one-for-one. */
const CHARACTER_FIXES: Readonly<Record<string, string>> = {
  "\u2013": "-", // en dash
  "\u2014": "-", // em dash
  "\u2212": "-", // minus sign
  "\u2011": "-", // non-breaking hyphen
  "\u266f": "#", // music sharp sign
  "\u266d": "b", // music flat sign
  "\u2019": "'",
  "\u2018": "'",
  "\u00a0": " ", // no-break space
};

/** Same length as the input, so indices into it stay valid. */
function normalizeCharacters(text: string): string {
  let out = "";
  for (const char of text) {
    const fixed = CHARACTER_FIXES[char];
    // `for...of` walks code points; keep every code unit so lengths match.
    out += fixed ?? char;
  }
  return out;
}

class Workspace {
  /** The text with each consumed span blanked out. */
  work: string;

  constructor(readonly norm: string) {
    this.work = norm;
  }

  /** Blanks `[start, end)` so later steps never read it again. */
  mask(start: number, end: number): void {
    this.work = this.work.slice(0, start) + " ".repeat(end - start) + this.work.slice(end);
  }

  /** True when the span still holds the text it held when it was matched. */
  intact(start: number, end: number, expected: string): boolean {
    return this.work.slice(start, end) === expected;
  }

  /** Every match of `pattern` in the text as it is now. */
  matches(pattern: RegExp): RegExpExecArray[] {
    return [...this.work.matchAll(pattern)];
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word matcher in which whitespace and hyphens inside a phrase are
 * interchangeable ("warm up", "warm-up", "warmup"). `&` counts as a word
 * character so "r&b" is never read as "r" plus "b".
 */
function phraseRegex(phrase: string, suffix = ""): RegExp {
  const body = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join("[\\s-]*");
  return new RegExp(`(^|[^a-z0-9&])(${body})(?![a-z0-9&])${suffix}`, "i");
}

interface PhraseEntry {
  value: string;
  regex: RegExp;
  length: number;
}

function buildEntries(pairs: Array<[string, string]>, suffixes: Record<string, string> = {}): PhraseEntry[] {
  const seen = new Set<string>();
  const entries: PhraseEntry[] = [];
  for (const [phrase, value] of pairs) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ value, regex: phraseRegex(key, suffixes[key] ?? ""), length: key.length });
  }
  // Longest phrase first, so "deep house" is read before "house".
  return entries.sort((a, b) => b.length - a.length);
}

interface PhraseHit {
  value: string;
  start: number;
  end: number;
}

/** Consumes every vocabulary phrase found in the workspace, in text order. */
function consumePhrases(space: Workspace, entries: PhraseEntry[]): PhraseHit[] {
  const hits: PhraseHit[] = [];
  for (const entry of entries) {
    for (;;) {
      const found = entry.regex.exec(space.work);
      if (!found) break;
      const start = found.index + found[1].length;
      const end = start + found[2].length;
      hits.push({ value: entry.value, start, end });
      space.mask(start, end);
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

const GENRE_ENTRIES = buildEntries([
  ...TASTE_EDIT_GENRES.map((genre): [string, string] => [genre, genre]),
  ...Object.entries(TASTE_EDIT_GENRE_ALIASES),
]);
const DRUM_AND_BASS_ENTRIES = GENRE_ENTRIES.filter((entry) => entry.value === "Drum & Bass");
const OTHER_GENRE_ENTRIES = GENRE_ENTRIES.filter((entry) => entry.value !== "Drum & Bass");
const MOOD_ENTRIES = buildEntries([
  ...TASTE_EDIT_MOODS.map((mood): [string, string] => [mood, mood]),
  ...Object.entries(TASTE_EDIT_MOOD_ALIASES),
]);

const ENERGY_WORDS: Array<[string, "high" | "low" | "medium"]> = [
  ["peak-time", "high"],
  ["peaktime", "high"],
  ["high energy", "high"],
  ["banging", "high"],
  ["banger", "high"],
  ["bangers", "high"],
  ["energetic", "high"],
  ["warm-up", "low"],
  ["warmup", "low"],
  ["low energy", "low"],
  ["chill", "low"],
  ["chilled", "low"],
  ["mellow", "low"],
  ["relaxed", "low"],
  ["laid back", "low"],
  ["deep", "low"],
  ["medium energy", "medium"],
  ["mid energy", "medium"],
  ["medium", "medium"],
  ["mid", "medium"],
  ["mid-tempo", "medium"],
  ["midtempo", "medium"],
];
const ENERGY_ENTRIES = buildEntries(
  ENERGY_WORDS.map(([phrase, band]): [string, string] => [phrase, band]),
  // "mid"/"medium" before "tempo" is read as the mid-tempo phrase below.
  { mid: "(?![\\s-]*tempo)", medium: "(?![\\s-]*tempo)" },
);
const ENERGY_RANGES: Record<string, CrateNumberRange> = {
  high: ENERGY_HIGH,
  low: ENERGY_LOW,
  medium: ENERGY_MEDIUM,
};

// ---------------------------------------------------------------------------
// Numbers: bpm, count, money
// ---------------------------------------------------------------------------

const NUMBER = String.raw`\d{1,3}(?:\.\d+)?`;
const BPM_RANGE_AFTER = new RegExp(
  String.raw`(?:\bbetween\s+)?\b(${NUMBER})\s*(?:bpm)?\s*(?:-|to|and)\s*(${NUMBER})\s*bpm\b`,
  "gi",
);
const BPM_RANGE_BEFORE = new RegExp(
  String.raw`\b(?:bpm|tempo)\s*(?:of|:|=|at|between)?\s*(${NUMBER})\s*(?:-|to|and)\s*(${NUMBER})\b`,
  "gi",
);
const BPM_UPPER_CUES = String.raw`under|below|max(?:imum)?|up\s+to|at\s+most|no\s+more\s+than|less\s+than`;
const BPM_LOWER_CUES = String.raw`over|above|at\s+least|min(?:imum)?|more\s+than|faster\s+than`;
const BPM_APPROX_CUES = String.raw`around|about|approx(?:imately)?|roughly|circa`;
const BPM_SINGLE = new RegExp(
  String.raw`(?:(?:\b(${BPM_UPPER_CUES})|\b(${BPM_LOWER_CUES})|\b(${BPM_APPROX_CUES})|(~))\s*)?\b(${NUMBER})\s*bpm\b`,
  "gi",
);
const BPM_SINGLE_BEFORE = new RegExp(
  String.raw`\b(?:bpm|tempo)\s*(?:of|:|=|at|around)?\s*(${NUMBER})\b`,
  "gi",
);

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function bpmInBounds(value: number): boolean {
  return Number.isFinite(value) && value >= CRATE_BPM_MIN && value <= CRATE_BPM_MAX;
}

function clampBpm(value: number): number {
  return round1(Math.min(CRATE_BPM_MAX, Math.max(CRATE_BPM_MIN, value)));
}

function parseBpm(space: Workspace): CrateNumberRange | null {
  // A holder, not a local: TypeScript does not track writes made in closures.
  const found: { range: CrateNumberRange | null } = { range: null };

  const claim = (match: RegExpExecArray, range: CrateNumberRange) => {
    const start = match.index;
    const end = start + match[0].length;
    if (!space.intact(start, end, match[0])) return;
    space.mask(start, end);
    found.range = range;
  };

  for (const pattern of [BPM_RANGE_AFTER, BPM_RANGE_BEFORE]) {
    for (const match of space.matches(pattern)) {
      if (found.range) break;
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (!bpmInBounds(a) || !bpmInBounds(b)) continue;
      claim(match, { min: round1(Math.min(a, b)), max: round1(Math.max(a, b)) });
    }
  }

  for (const match of space.matches(BPM_SINGLE)) {
    if (found.range) break;
    const value = Number(match[5]);
    if (!bpmInBounds(value)) continue;
    let range: CrateNumberRange;
    if (match[1]) range = { min: null, max: round1(value) };
    else if (match[2]) range = { min: round1(value), max: null };
    else if (match[3] || match[4]) {
      range = {
        min: clampBpm(value - BPM_APPROX_TOLERANCE),
        max: clampBpm(value + BPM_APPROX_TOLERANCE),
      };
    } else {
      range = {
        min: clampBpm(value - BPM_EXACT_TOLERANCE),
        max: clampBpm(value + BPM_EXACT_TOLERANCE),
      };
    }
    claim(match, range);
  }

  for (const match of space.matches(BPM_SINGLE_BEFORE)) {
    if (found.range) break;
    const value = Number(match[1]);
    if (!bpmInBounds(value)) continue;
    const around = /around/i.test(match[0]);
    const tolerance = around ? BPM_APPROX_TOLERANCE : BPM_EXACT_TOLERANCE;
    claim(match, { min: clampBpm(value - tolerance), max: clampBpm(value + tolerance) });
  }

  return found.range;
}

const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  "a dozen": 12,
};
const COUNT_NOUNS = String.raw`(?:tracks?|songs?|items?|cuts?|tunes?|records?|bangers?)`;
const COUNT_PATTERNS: RegExp[] = [
  // "top 10 tracks" reads as one phrase, before "10 tracks" can split it.
  /\b(?:top|first)\s+(\d{1,3})\b/gi,
  /\b(?:crate|set|pack|list|selection)\s+of\s+(\d{1,3})\b/gi,
  new RegExp(String.raw`\b(\d{1,3})[\s-]*${COUNT_NOUNS}\b`, "gi"),
  new RegExp(
    String.raw`\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:a\s+)?dozen)[\s-]+${COUNT_NOUNS}\b`,
    "gi",
  ),
];

function parseCount(space: Workspace): number | null {
  for (const pattern of COUNT_PATTERNS) {
    for (const match of space.matches(pattern)) {
      const raw = match[1].toLowerCase().replace(/\s+/g, " ");
      const parsed = COUNT_WORDS[raw] ?? Number(raw);
      if (!Number.isFinite(parsed)) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (!space.intact(start, end, match[0])) continue;
      space.mask(start, end);
      return Math.min(CRATE_MAX_COUNT, Math.max(CRATE_MIN_COUNT, Math.round(parsed)));
    }
  }
  return null;
}

const MONEY_CAPS = String.raw`under|below|less\s+than|max(?:imum)?|up\s+to|at\s+most|no\s+more\s+than|within|capped\s+at|cap\s+of|budget\s+of|budget|around|about|roughly`;
/** Cues that make a bare number (no $ or unit) a price. */
const BARE_MONEY_CAPS = String.raw`under|below|less\s+than`;
const MONEY_PER_ITEM_GAP = String.raw`(?:per\s+(?:track|item|song|line|tune|cut)\s*(?:of|:|is)?\s*)`;
const MONEY_WITH_UNIT = new RegExp(
  String.raw`(?:\b(${MONEY_CAPS})\s*)?(?:${MONEY_PER_ITEM_GAP}(?=\$|\d))?(?:\$\s*(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks)\b|\b(\d+(?:\.\d{1,2})?)\s*\$)`,
  "gi",
);
const MONEY_BARE = new RegExp(
  String.raw`\b(${MONEY_CAPS})\s+(?:${MONEY_PER_ITEM_GAP}(?=\d))?(\d+(?:\.\d{1,2})?)\b`,
  "gi",
);
const PER_ITEM_AFTER =
  /^\s*(?:max(?:imum)?\s+)?(?:each\b|apiece\b|(?:per|a|\/)\s*(?:track|item|song|line|tune|cut)s?\b)/i;
const TOTAL_AFTER =
  /^\s*(?:(?:in\s+|all\s+in\s+)?total\b|altogether\b|overall\b|budget\b|combined\b|all\s+in\b|max(?:imum)?\b|(?:for|across)\s+(?:the\s+)?(?:whole\s+|entire\s+)?(?:crate|set|lot|everything|all)\b)/i;

interface Money {
  total: number | null;
  perItem: number | null;
}

function parseMoney(space: Workspace): Money {
  const money: Money = { total: null, perItem: null };

  const consider = (
    match: RegExpExecArray,
    amountText: string,
    cap: string | undefined,
    bare: boolean,
  ) => {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount < 0 || amount > CRATE_MAX_PRICE_USD) return;
    const start = match.index;
    let end = start + match[0].length;
    if (!space.intact(start, end, match[0])) return;

    const after = space.work.slice(end);
    const perItemAfter = PER_ITEM_AFTER.exec(after);
    const totalAfter = perItemAfter ? null : TOTAL_AFTER.exec(after);
    const perItemBefore = /per\s+(?:track|item|song|line|tune|cut)/i.test(match[0]);
    const marker = perItemAfter ?? totalAfter;

    // A bare number is a price only when a cue says so.
    if (bare && !marker && !(cap && new RegExp(`^(?:${BARE_MONEY_CAPS})$`, "i").test(cap.replace(/\s+/g, " ")))) {
      return;
    }

    let kind: "total" | "perItem" | null = null;
    if (perItemBefore || perItemAfter) kind = "perItem";
    else if (totalAfter || cap) kind = "total";
    if (!kind) return;
    if (kind === "total" ? money.total !== null : money.perItem !== null) return;

    if (marker) end += marker[0].length;
    space.mask(start, end);
    if (kind === "total") money.total = Math.round(amount * 100) / 100;
    else money.perItem = Math.round(amount * 100) / 100;
  };

  for (const match of space.matches(MONEY_WITH_UNIT)) {
    consider(match, match[2] ?? match[3] ?? match[4], match[1], false);
  }
  for (const match of space.matches(MONEY_BARE)) {
    consider(match, match[2], match[1], true);
  }
  return money;
}

// ---------------------------------------------------------------------------
// Flags: neighbours, human, AI, license, stems
// ---------------------------------------------------------------------------

const NO_NEIGHBORS = new RegExp(
  String.raw`\b(?:(?:no|without|exclude|skip)\s+(?:camelot\s+|harmonic\s+|adjacent\s+)?(?:neighbou?rs?|neighbou?ring\s+keys)|exact\s+(?:camelot\s+)?(?:keys?|match(?:es)?)|same\s+key\s+only|strict\s+key|neighbou?rs?\s+off)\b`,
  "gi",
);
const YES_NEIGHBORS = new RegExp(
  String.raw`\b(?:with|including|include|plus|allow)\s+(?:camelot\s+|harmonic\s+|adjacent\s+)?neighbou?rs?\b`,
  "gi",
);
const HUMAN_ONLY = new RegExp(
  String.raw`\b(?:verified[\s-]+humans?|humans?[\s-]+only|only[\s-]+(?:verified[\s-]+)?humans?|human[\s-]+(?:made|created|artists?)|(?:no|without|exclude|excluding|avoid)\s+(?:fully\s+)?ai(?:[\s-]*generated)?|ai[\s-]free|non[\s-]ai)\b`,
  "gi",
);
const AI_OK = new RegExp(
  String.raw`\b(?:(?:include|including|allow|allowing|fine\s+with|ok(?:ay)?\s+with)\s+(?:fully\s+)?ai(?:[\s-]*generated)?|ai(?:[\s-]*generated)?\s*(?:is\s+|are\s+)?(?:ok(?:ay)?|allowed|fine|welcome))\b`,
  "gi",
);

/** Consumes every match of `pattern`; true when at least one was found. */
function consumeFlag(space: Workspace, pattern: RegExp): boolean {
  let found = false;
  for (const match of space.matches(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!space.intact(start, end, match[0])) continue;
    space.mask(start, end);
    found = true;
  }
  return found;
}

const LICENSE_PATTERN = new RegExp(
  String.raw`(?:\b(?:licen[cs]e[ds]?|licensing)\s*(?:for|type|:|to)?\s*)?\b(personal|remix(?:able)?|commercial|sync|sample|broadcast)\b(?:\s+use)?(?:\s+licen[cs](?:e|es|ed|ing))?`,
  "gi",
);

function parseLicense(space: Workspace): CrateLicenseType | null {
  let license: CrateLicenseType | null = null;
  for (const match of space.matches(LICENSE_PATTERN)) {
    const word = match[1].toLowerCase();
    const value = (word.startsWith("remix") ? "remix" : word) as CrateLicenseType;
    if (license !== null && license !== value) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (!space.intact(start, end, match[0])) continue;
    space.mask(start, end);
    license = value;
  }
  return license;
}

const STEM_WORD =
  String.raw`(?:a[\s-]*cappella|acapella|acappella|vocals?|vox|drums?|bass|piano|guitars?)(?![\w-])(?!\s+(?:house|music|line|heavy|techno|trap|drop))`;
const STEM_LIST = String.raw`${STEM_WORD}(?:\s*(?:,\s*(?:and\s+)?|/|&|\+|\band\b)\s*${STEM_WORD})*`;
const STEM_WITH = new RegExp(
  String.raw`\b(?:with|w\/|including|includes|incl\.?|has|having|requires?|required|needs?|needing)\s+(?:(?:the|stems?|available|for|of)\s+)*(${STEM_LIST})(?:\s+stems?)?`,
  "gi",
);
const STEM_KEYWORD = new RegExp(
  String.raw`\bstems?\s*(?:available|needed|required)?\s*[:=-]?\s*(${STEM_LIST})`,
  "gi",
);
const STEM_AVAILABLE = new RegExp(
  String.raw`\b(${STEM_LIST})\s+(?:stems?|available|included|ready)\b`,
  "gi",
);
const ACAPELLA = /\b(?:a[\s-]*cappella|acapella|acappella)\b/gi;

function stemsIn(text: string): CrateStemType[] {
  const stems: CrateStemType[] = [];
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let stem: CrateStemType | null = null;
    if (word === "vocal" || word === "vocals" || word === "vox" || word === "acapella" || word === "acappella") {
      stem = "vocals";
    } else if (word === "cappella") stem = "vocals";
    else if (word === "drum" || word === "drums") stem = "drums";
    else if (word === "bass" || word === "piano") stem = word;
    else if (word === "guitar" || word === "guitars") stem = "guitar";
    if (stem && !stems.includes(stem)) stems.push(stem);
  }
  return stems;
}

function parseStems(space: Workspace): CrateStemType[] {
  const found = new Set<CrateStemType>();
  for (const pattern of [STEM_WITH, STEM_KEYWORD, STEM_AVAILABLE, ACAPELLA]) {
    for (const match of space.matches(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!space.intact(start, end, match[0])) continue;
      space.mask(start, end);
      for (const stem of stemsIn(match[1] ?? match[0])) found.add(stem);
    }
  }
  return CRATE_STEM_TYPES.filter((stem) => found.has(stem));
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const CAMELOT_KEY = /\b(0?[1-9]|1[0-2])([abAB])\b/g;
const KEY_WITH_MODE = /\b([A-Ga-g])([#b]?)[\s-]*(major|minor|maj|min)\b/gi;
const KEY_SHORT_MINOR = /\b([A-G])([#b]?)m\b/g;
const PROSE_AFTER_SHORT_KEY = /^\s+(?:I|I'm|a|an|the|not|so|looking|going|ready|just|in|at)\b/;
const KEY_ACCIDENTAL = /\b([A-G])(#|b)(?![A-Za-z0-9#])/g;
const KEY_AFTER_CONTEXT =
  /\b(?:in|keys?)\s*(?:of|:)?\s+([A-G])(?![A-Za-z0-9#])(?=\s*(?:$|[,;.!?)]|(?:or|and|with|no|exact)\b))/g;
const KEY_CONTEXT_BEFORE = /\b(?:in|keys?(?:\s+of)?|of)\s*:?\s*$/i;

function parseKeys(space: Workspace): { keys: string[]; overflow: string[] } {
  const found: Array<{ start: number; code: string; text: string }> = [];

  const take = (start: number, end: number, key: string, text: string) => {
    if (!space.intact(start, end, text)) return;
    const code = parseKeyToCamelot(key);
    if (!code) return;
    space.mask(start, end);
    found.push({ start, code, text });
  };

  for (const match of space.matches(CAMELOT_KEY)) {
    take(match.index, match.index + match[0].length, match[0], match[0]);
  }
  for (const match of space.matches(KEY_WITH_MODE)) {
    const hasAccidental = match[2] !== "";
    const capital = match[1] === match[1].toUpperCase();
    const context = KEY_CONTEXT_BEFORE.test(space.work.slice(0, match.index));
    // "a minor detail" is not a key; "A minor", "in a minor" and "F# minor" are.
    if (!capital && !hasAccidental && !context) continue;
    take(match.index, match.index + match[0].length, `${match[1]}${match[2]} ${match[3]}`, match[0]);
  }
  for (const match of space.matches(KEY_SHORT_MINOR)) {
    // "Am I ready" is English, not A minor.
    if (PROSE_AFTER_SHORT_KEY.test(space.work.slice(match.index + match[0].length))) continue;
    take(match.index, match.index + match[0].length, match[0], match[0]);
  }
  for (const match of space.matches(KEY_ACCIDENTAL)) {
    take(match.index, match.index + match[0].length, match[0], match[0]);
  }
  for (const match of space.matches(KEY_AFTER_CONTEXT)) {
    const tonicStart = match.index + match[0].indexOf(match[1], match[0].search(/\s/));
    take(tonicStart, tonicStart + 1, match[1], match[1]);
  }

  found.sort((a, b) => a.start - b.start);
  const keys: string[] = [];
  const overflow: string[] = [];
  for (const entry of found) {
    if (keys.includes(entry.code)) continue;
    if (keys.length >= CRATE_MAX_KEYS) overflow.push(entry.text);
    else keys.push(entry.code);
  }
  return { keys, overflow };
}

// ---------------------------------------------------------------------------
// Unparsed phrases
// ---------------------------------------------------------------------------

/** Words that carry no request of their own at the edge of a leftover phrase. */
const STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "and", "or", "some", "set", "sets", "track", "tracks", "song",
  "songs", "crate", "of", "to", "in", "on", "at", "me", "my", "i", "im", "id", "ill", "give", "show",
  "want", "need", "looking", "find", "please", "something", "that", "is", "it", "like", "dig", "build",
  "make", "get", "key", "keys", "stem", "stems", "tempo", "energy", "budget", "total", "licence",
  "license", "licensed", "available", "only", "mix", "under", "max", "about", "around", "no",
]);

function isStopword(word: string): boolean {
  const bare = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return bare === "" || STOPWORDS.has(bare);
}

function leftoverPhrases(space: Workspace): string[] {
  const tokens = [...space.work.matchAll(/[^\s,;.!?:()[\]"]+/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));

  // Words separated only by spaces form one phrase; a delimiter or a consumed
  // span between them starts a new one.
  const groups: Array<Array<{ start: number; end: number }>> = [];
  for (const token of tokens) {
    const previous = groups.at(-1)?.at(-1);
    if (previous && /^\s*$/.test(space.norm.slice(previous.end, token.start))) {
      groups[groups.length - 1].push(token);
    } else {
      groups.push([token]);
    }
  }

  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    let first = 0;
    let last = group.length - 1;
    while (first <= last && isStopword(space.norm.slice(group[first].start, group[first].end))) first += 1;
    while (last >= first && isStopword(space.norm.slice(group[last].start, group[last].end))) last -= 1;
    if (first > last) continue;
    const phrase = space.norm
      .slice(group[first].start, group[last].end)
      .replace(/\s+/g, " ")
      .replace(/^['"`-]+|['"`-]+$/g, "")
      .trim()
      .slice(0, CRATE_MAX_UNPARSED_LENGTH)
      .trim();
    if (!/[a-z0-9]/i.test(phrase)) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
    if (phrases.length >= CRATE_MAX_UNPARSED) break;
  }
  return phrases;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function mergeEnergy(bands: string[]): CrateNumberRange | null {
  if (bands.length === 0) return null;
  let min = 1;
  let max = 0;
  for (const band of bands) {
    const range = ENERGY_RANGES[band];
    min = Math.min(min, range.min ?? 0);
    max = Math.max(max, range.max ?? 1);
  }
  return { min, max };
}

/**
 * Turns request text into filters. Pure and deterministic. The text is cut to
 * `CRATE_REQUEST_MAX_TEXT_LENGTH` characters defensively (the controller
 * rejects longer input with 400 before it gets here). Whatever no rule reads
 * is returned in `unparsed`, bounded to 10 phrases of 120 characters.
 */
export function parseCrateRequestText(text: string): CrateParseResult {
  const bounded = typeof text === "string" ? text.slice(0, CRATE_REQUEST_MAX_TEXT_LENGTH) : "";
  const space = new Workspace(normalizeCharacters(bounded));
  const filters: CrateFilters = defaultCrateFilters();
  const extra: string[] = [];

  if (consumeFlag(space, NO_NEIGHBORS)) filters.includeCamelotNeighbors = false;
  else consumeFlag(space, YES_NEIGHBORS);

  filters.bpm = parseBpm(space);
  filters.count = parseCount(space) ?? filters.count;
  const money = parseMoney(space);
  filters.maxTotalUsd = money.total;
  filters.maxPerItemUsd = money.perItem;

  // "no AI" asks for verified humans and never lets fully AI recordings in.
  if (consumeFlag(space, HUMAN_ONLY)) filters.verifiedHumanOnly = true;
  if (consumeFlag(space, AI_OK)) filters.allowFullyAi = true;

  filters.licenseType = parseLicense(space);

  // "drum and bass" is a genre, never the drums and bass stems, so it is read
  // first; every other genre is read after the stems so that "bass house" is
  // not read as a bass stem.
  const genres = consumePhrases(space, DRUM_AND_BASS_ENTRIES);
  filters.requiredStems = parseStems(space);
  genres.push(...consumePhrases(space, OTHER_GENRE_ENTRIES));
  genres.sort((a, b) => a.start - b.start);

  const keys = parseKeys(space);
  filters.keys = keys.keys;
  extra.push(...keys.overflow);

  const energy = consumePhrases(space, ENERGY_ENTRIES);
  filters.energy = mergeEnergy(energy.map((hit) => hit.value));
  const moods = consumePhrases(space, MOOD_ENTRIES);

  for (const hit of genres) {
    const genre = canonicalCrateGenre(hit.value);
    if (!genre || filters.genres.includes(genre)) continue;
    if (filters.genres.length >= CRATE_MAX_GENRES) extra.push(space.norm.slice(hit.start, hit.end));
    else filters.genres.push(genre);
  }
  for (const hit of moods) {
    const mood = canonicalCrateMood(hit.value);
    if (!mood || filters.moods.includes(mood)) continue;
    if (filters.moods.length >= CRATE_MAX_MOODS) extra.push(space.norm.slice(hit.start, hit.end));
    else filters.moods.push(mood);
  }

  const unparsed = [...leftoverPhrases(space), ...extra]
    .map((phrase) => phrase.slice(0, CRATE_MAX_UNPARSED_LENGTH))
    .slice(0, CRATE_MAX_UNPARSED);

  return {
    // The same validation client-edited filters get, so every source of
    // filters shares one structure and one set of bounds.
    filters: sanitizeCrateFilters(filters).filters,
    unparsed,
    strategy: "deterministic",
  };
}

/** The default parser: deterministic rules, no model. */
export const deterministicCrateRequestParser: CrateRequestParser = {
  parse: async (text) => parseCrateRequestText(text),
};

/** What a reference track contributes to a crate request. */
export interface CrateReferenceTrack {
  tempoBpm: number | null;
  camelot: string | null;
  energy: number | null;
  genre: string | null;
}

/** Tempo tolerance around a reference track (±4%). */
export const CRATE_REFERENCE_BPM_TOLERANCE = 0.04;
/** Energy tolerance around a reference track. */
export const CRATE_REFERENCE_ENERGY_TOLERANCE = 0.15;

/**
 * "More like this": filters from one track's measured tempo, key, energy and
 * genre. The result has exactly the structure a text request produces, so the
 * two are interchangeable downstream. Tempo is ±4% (one decimal), the key is
 * the track's own Camelot code with neighbours, energy is ±0.15 clamped to
 * 0..1, and the genre is kept only when it is in the taste-edit vocabulary.
 * Everything else stays at the defaults, and anything the track lacks stays
 * open.
 */
export function filtersFromReferenceTrack(
  ref: CrateReferenceTrack,
  count: number = defaultCrateFilters().count,
): CrateFilters {
  const filters = defaultCrateFilters();
  if (Number.isFinite(count)) {
    filters.count = Math.min(CRATE_MAX_COUNT, Math.max(CRATE_MIN_COUNT, Math.round(count)));
  }

  if (typeof ref.tempoBpm === "number" && Number.isFinite(ref.tempoBpm) && ref.tempoBpm > 0) {
    filters.bpm = {
      min: round1(ref.tempoBpm * (1 - CRATE_REFERENCE_BPM_TOLERANCE)),
      max: round1(ref.tempoBpm * (1 + CRATE_REFERENCE_BPM_TOLERANCE)),
    };
  }
  const code = typeof ref.camelot === "string" ? parseKeyToCamelot(ref.camelot) : null;
  if (code) filters.keys = [code];
  if (typeof ref.energy === "number" && Number.isFinite(ref.energy)) {
    const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
    filters.energy = {
      min: clamp(ref.energy - CRATE_REFERENCE_ENERGY_TOLERANCE),
      max: clamp(ref.energy + CRATE_REFERENCE_ENERGY_TOLERANCE),
    };
  }
  const genre = typeof ref.genre === "string" ? canonicalCrateGenre(ref.genre) : undefined;
  if (genre) filters.genres = [genre];

  // Same validation as every other source (bounds, rounding, canonical form).
  return sanitizeCrateFilters(filters).filters;
}
