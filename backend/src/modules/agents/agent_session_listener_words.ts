import {
  CRATE_MAX_GENRES,
  CRATE_MAX_MOODS,
  canonicalCrateGenre,
  canonicalCrateMood,
  sanitizeCrateFilters,
} from "../crates/crate_filters";
import type { CrateFilters, CrateNumberRange, CrateParseResult } from "../crates/crate.types";
import { CRATE_MAX_UNPARSED, CRATE_MAX_UNPARSED_LENGTH } from "../crates/crate_request_parser";
import {
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_GENRES,
  TASTE_EDIT_HIGH_ENERGY_WORDS,
  TASTE_EDIT_LOW_ENERGY_WORDS,
  TASTE_EDIT_MEDIUM_ENERGY_WORDS,
  TASTE_EDIT_MOODS,
} from "../recommendations/taste_edit_vocabulary";

/**
 * The listener layer of the AI DJ session parser (#2452).
 *
 * The Crate Digger rules (crate_request_parser.ts) are written for DJs: their
 * energy words are crate jargon ("peak-time", "warm-up", "bangers"), they know
 * no accents, no French and no typos. A listener who types "something calm to
 * read", "pump me up for the gym", "musique classique calme" or "hip hpo" used
 * to get a session with no filters at all, because every one of those phrases
 * came back in `unparsed` and the session fell back to the saved taste.
 *
 * This layer reads ONLY what the crate rules left in `unparsed` (it never
 * re-reads consumed text) and adds, in the same {@link CrateParseResult} shape,
 *  - listener words for energy ("calm", "relaxing", "upbeat", "tranquille"),
 *  - activity words for mood ("gym" is Hype, "party" is Club, "to read" is Focus),
 *  - French and adjectival genre names ("classique", "jazzy", "ambiant"),
 *  - one-edit typos of genre names ("afrobaet", "techo", "hip hpo").
 * Nothing downstream changes: the session maps the result exactly as before.
 *
 * Rules that keep it honest:
 *  - Text is lowercased and accent-folded ("fete" matches "fête"); matching is
 *    whole-word and phrase-aware, with spaces and hyphens interchangeable.
 *  - Energy is set only when the crate rules set none; an energy word that
 *    disagrees with the energy already read, or with another listener energy
 *    word, is left in `unparsed` rather than guessed.
 *  - An activity implies energy only as a fallback: a Hype activity (gym) or a
 *    party implies high energy unless an explicit energy word or the crate rules
 *    already decided. Dancing implies the Club mood and no energy.
 *  - Typo tolerance is for GENRES only: optimal-string-alignment distance of at
 *    most one, a vocabulary target of at least {@link TYPO_MIN_TARGET_LENGTH}
 *    characters, a token of at least {@link TYPO_MIN_TOKEN_LENGTH}, a stoplist
 *    of ordinary words that sit one edit from a genre, and no match on a tie.
 *    Moods and energy words are never fuzzy-matched.
 *
 * Pure: no I/O, no clock, no randomness. The same input yields the same output.
 */

type EnergyBand = "low" | "medium" | "high";

/**
 * Energy bands, the same ranges the crate rules give "high energy", "low
 * energy" and "medium energy". A spec pins them to the crate parser so they
 * cannot drift apart.
 */
export const LISTENER_ENERGY_RANGES: Readonly<Record<EnergyBand, CrateNumberRange>> = {
  high: { min: 0.65, max: 1 },
  low: { min: 0, max: 0.45 },
  medium: { min: 0.35, max: 0.7 },
};

/** The session turns an energy range into a band by its midpoint (agent_session_request.ts). */
const BAND_LOW_BELOW = 0.4;
const BAND_HIGH_ABOVE = 0.6;

/** A vocabulary target must be at least this long (spaces and hyphens ignored) to be fuzzy-matched. */
export const TYPO_MIN_TARGET_LENGTH = 6;
/** A leftover token must be at least this long to be fuzzy-matched. */
export const TYPO_MIN_TOKEN_LENGTH = 5;
/** Largest optimal-string-alignment distance that still reads as a typo. */
export const TYPO_MAX_DISTANCE = 1;
/** In a two-word window the misspelt word must have at least this many characters. */
export const TYPO_MIN_WINDOW_WORD_LENGTH = 3;

// ---------------------------------------------------------------------------
// Vocabulary (hand-written; every table is folded to lowercase ASCII on use)
// ---------------------------------------------------------------------------

/**
 * Explicit LOW energy. The first rows reuse the words the taste-edit parser
 * already treats as low energy; the rest are the other ways a listener asks for
 * calm music in English and in French.
 */
export const LISTENER_LOW_ENERGY_WORDS: readonly string[] = [
  ...TASTE_EDIT_LOW_ENERGY_WORDS,
  // English: calm family, soft family, winding down, sleep.
  "relax",
  "relaxation",
  "calmly",
  "peaceful",
  "quiet",
  "soft",
  "gently",
  "tranquil",
  "unwind",
  "unwinding",
  "wind down",
  "winding down",
  "easy listening",
  "easygoing",
  "easy going",
  "downtempo",
  "slow",
  "lazy",
  "chilling",
  "chillin",
  "chill out",
  "chillout",
  "sleep",
  "sleeping",
  "bedtime",
  "lullaby",
  // French.
  "calme",
  "calmes",
  "doux",
  "douce",
  "douces",
  "doucement",
  "tranquille",
  "tranquilles",
  "detente",
  "detendu",
  "detendue",
  "relaxant",
  "relaxante",
  "apaisant",
  "apaisante",
  "paisible",
  "reposant",
  "reposante",
  "serein",
  "lent",
  "lente",
  "dormir",
  "sommeil",
  "berceuse",
];

/**
 * Explicit HIGH energy. Activities that imply high energy (gym, party) are NOT
 * here: they are mood words with an implied energy, so an explicit word wins.
 * The bare noun "energy" is left out of the reused taste-edit list: it carries
 * no direction ("calm energy").
 */
export const LISTENER_HIGH_ENERGY_WORDS: readonly string[] = [
  ...TASTE_EDIT_HIGH_ENERGY_WORDS.filter((word) => word !== "energy"),
  "uptempo",
  "up tempo",
  "energizing",
  "energising",
  "fast paced",
  "driving",
  "powerful",
  "hard hitting",
  // French.
  "energique",
  "energiques",
  "dynamique",
  "dynamiques",
  "entrainant",
  "entrainante",
];

/** Explicit MEDIUM energy (the taste-edit words). */
export const LISTENER_MEDIUM_ENERGY_WORDS: readonly string[] = [...TASTE_EDIT_MEDIUM_ENERGY_WORDS];

/**
 * Words for each catalog mood. "Chill" is energy, never a mood. Hype and Club
 * hold the activity words; {@link ENERGY_IMPLYING_ACTIVITY_WORDS} lists which of
 * them also imply high energy.
 */
export const LISTENER_MOOD_WORDS: Readonly<Record<string, readonly string[]>> = {
  // Training and being pumped up.
  Hype: [
    "workout",
    "work out",
    "working out",
    "gym",
    "training",
    "cardio",
    "exercise",
    "exercising",
    "fitness",
    // Not bare "running": "running late" or "running errands" is no workout.
    "for a run",
    "for running",
    "go running",
    "running playlist",
    "running mix",
    "running music",
    "jogging",
    "crossfit",
    "hiit",
    "lifting",
    "weightlifting",
    "pump me up",
    "pump up",
    "pumped up",
    "get pumped",
    "hype me up",
    "hype me",
    "get hyped",
    "salle de sport",
    "sport",
    "sports",
    "musculation",
    "entrainement",
    "s entrainer",
    "entrainer",
    "footing",
  ],
  // The dance floor, parties, going out.
  Club: [
    "party",
    "parties",
    "partying",
    "party time",
    "fete",
    "fetes",
    "faire la fete",
    "pour faire la fete",
    "dance floor",
    "dancefloor",
    "dancing",
    "danser",
    "pour danser",
    "dansant",
    "dansante",
    "clubbing",
    "nightclub",
    "night club",
  ],
  // Reading, studying, working, concentrating.
  Focus: [
    "read",
    "reading",
    "to read",
    "lire",
    "pour lire",
    "study",
    "studying",
    "homework",
    "revise",
    "revising",
    "exam",
    "exams",
    "work",
    "working",
    "deep work",
    "coding",
    "programming",
    "concentration",
    "concentrate",
    "concentrating",
    "se concentrer",
    "concentrer",
    "travailler",
    "travail",
    "etudier",
    "reviser",
  ],
  // Moody, brooding, eerie. Only words that mean nothing else.
  Dark: ["gloomy", "brooding", "sinister", "eerie", "spooky", "menacing", "sombre", "sombres"],
  // Deep into the night. "Night" alone is not here: it is far too common.
  "Late Night": [
    "midnight",
    "after hours",
    "afterhours",
    "nighttime",
    "night time",
    "nocturnal",
    "late at night",
    "la nuit",
    "de nuit",
    "tard le soir",
  ],
  // Cosy.
  Warm: ["cozy", "cosy", "warmth", "chaleureux", "chaleureuse"],
  // Meditation and stillness.
  Zen: ["meditation", "meditate", "meditating", "yoga", "mindfulness", "mindful", "serene", "serenity", "spa"],
};

/**
 * Mood words that also imply HIGH energy when nothing else sets it: training
 * (Hype) and parties (Club). Dancing and clubbing are Club only.
 */
export const ENERGY_IMPLYING_ACTIVITY_WORDS: readonly string[] = [
  // Hype activities.
  "workout",
  "work out",
  "working out",
  "gym",
  "training",
  "cardio",
  "exercise",
  "exercising",
  "fitness",
  "for a run",
  "for running",
  "go running",
  "running playlist",
  "running mix",
  "running music",
  "jogging",
  "crossfit",
  "hiit",
  "lifting",
  "weightlifting",
  "pump me up",
  "pump up",
  "pumped up",
  "get pumped",
  "hype me up",
  "hype me",
  "get hyped",
  "salle de sport",
  "sport",
  "sports",
  "musculation",
  "entrainement",
  "s entrainer",
  "entrainer",
  "footing",
  // Parties.
  "party",
  "parties",
  "partying",
  "party time",
  "fete",
  "fetes",
  "faire la fete",
  "pour faire la fete",
];

/**
 * Phrases that CONTAIN an activity word but mean something else ("after work"
 * is not Focus, "dinner party" is not a dance floor). They are matched first
 * (longest wins) so the activity word inside cannot fire, and are then left in
 * `unparsed` unread.
 */
export const LISTENER_GUARD_PHRASES: readonly string[] = [
  "after work",
  "after school",
  "dinner party",
  "tea party",
  "garden party",
  "apres le travail",
  "apres le boulot",
  "diner entre amis",
];

/** Genre names a listener types that the crate vocabulary does not carry: French names and adjectival forms. */
export const LISTENER_GENRE_WORDS: Readonly<Record<string, string>> = {
  // French.
  classique: "Classical",
  "musique classique": "Classical",
  "musique du monde": "Musiques du monde",
  "musiques du monde": "Musiques du monde",
  electronique: "Electronic",
  "musique electronique": "Electronic",
  latine: "Latin",
  ambiant: "Ambient",
  ambiante: "Ambient",
  "musique ambiante": "Ambient",
  // Adjectival forms ("rocky" is deliberately absent: it does not mean rock).
  jazzy: "Jazz",
  funky: "Funk",
  soulful: "Soul",
  bluesy: "Blues",
  poppy: "Pop",
  folky: "Folk",
  latino: "Latin",
  latina: "Latin",
  "classical music": "Classical",
};

/**
 * "électro" written WITH the accent is the French word for electronic music;
 * the crate rules keep the plain "electro" as the Electro genre. Matches only
 * when the listener's own text carried an accent.
 */
export const ACCENT_ONLY_GENRE_WORDS: Readonly<Record<string, string>> = {
  electro: "Electronic",
};

/**
 * Ordinary English and French words that sit one edit from a genre, so a
 * typo-tolerant reader must leave them alone ("songs from france" is not
 * Trance). Lowercase ASCII. Derived by taking every vocabulary target of at
 * least {@link TYPO_MIN_TARGET_LENGTH} characters, generating every word one
 * insertion, deletion, substitution or adjacent swap away, and keeping the ones
 * a listener might really type (checked against this repository's own text for
 * frequency, plus a hand review of each target). The multi-word targets
 * ("deep house", "future bass", "big room") add their second words.
 */
export const TYPO_STOPLIST: ReadonlySet<string> = new Set([
  // Trance
  "france", "trace", "traces", "prance", "tranche",
  // Country
  "county", "counts",
  // House (second word of deep/tech/future/tropical/acid/slap house)
  "horse", "horses", "mouse", "hose", "rouse", "louse",
  // Metal
  "medal", "medals", "model", "models",
  // Reggae
  "reggie", "reggies",
  // Garage
  "garbage",
  // Hardcore
  "hardcode", "hardcover",
  // Electro / Electronic
  "electron", "electrons", "electra", "electric", "electrical", "electronics",
  // Americana
  "american", "americano", "americans",
  // Jungle
  "jingle", "juggle", "bungle",
  // Plurals that name a thing, not a style
  "alternatives", "acoustics",
  // Second words: future bass, big room, drum and bass
  "base", "bases", "boom", "roof", "broom", "rooms",
  // First words: deep house, tech house
  "deer", "teen",
  // Short targets' neighbours kept from the first list (never fuzzy today, kept as a guard)
  "latte", "soup", "opera", "operas",
]);

/**
 * Words that carry no request of their own at the edge of a leftover phrase,
 * in English and French. Used only for the text this layer partly consumed.
 */
const GLUE_WORDS: ReadonlySet<string> = new Set([
  // English (the crate rules' own list, plus a few conversational words)
  "a", "an", "the", "for", "with", "and", "or", "some", "set", "sets", "track", "tracks", "song",
  "songs", "crate", "of", "to", "in", "on", "at", "me", "my", "i", "im", "id", "ill", "give", "show",
  "want", "need", "looking", "find", "please", "something", "that", "is", "it", "like", "dig", "build",
  "make", "get", "key", "keys", "stem", "stems", "tempo", "energy", "budget", "total", "licence",
  "license", "licensed", "available", "only", "mix", "under", "max", "about", "around", "no",
  "play", "put", "can", "you", "your", "music", "playlist", "while", "when", "during", "good",
  // French
  "de", "du", "des", "la", "le", "les", "un", "une", "et", "ou", "en", "sur", "dans", "au", "aux",
  "pour", "faire", "avec", "quelque", "quelques", "chose", "choses", "truc", "mets", "moi", "veux", "voudrais",
  "jai", "jaimerais", "envie", "dun", "dune", "qui", "que", "musique", "musiques", "morceaux",
  "titres", "chansons",
]);

// ---------------------------------------------------------------------------
// Text handling
// ---------------------------------------------------------------------------

/**
 * Lowercases and strips accents WITHOUT changing the length: a character that
 * would not fold to exactly one character is kept, so indices into the folded
 * text are valid in the original.
 */
export function foldListenerText(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = char.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase();
    out += folded.length === char.length ? folded : char;
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Whole-word matcher; whitespace and hyphens inside the phrase are interchangeable (as crate phraseRegex). */
function phraseRegex(phrase: string): RegExp {
  const body = phrase
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join("[\\s-]*");
  return new RegExp(`(^|[^a-z0-9&])(${body})(?![a-z0-9&])`, "g");
}

interface ListenerEffect {
  genre?: string;
  mood?: string;
  /** An explicit energy word. */
  energy?: EnergyBand;
  /** Energy implied by an activity; used only when nothing explicit decided. */
  impliedEnergy?: EnergyBand;
  /** Match only when the listener's own text carried an accent. */
  accentOnly?: boolean;
  /** Protects its words from being read; the phrase itself stays unparsed. */
  guard?: boolean;
}

interface ListenerEntry {
  phrase: string;
  regex: RegExp;
  effect: ListenerEffect;
}

function buildEntries(): ListenerEntry[] {
  const effects = new Map<string, ListenerEffect>();
  const add = (phrase: string, effect: ListenerEffect) => {
    const key = foldListenerText(phrase).trim();
    effects.set(key, { ...effects.get(key), ...effect });
  };

  for (const word of LISTENER_LOW_ENERGY_WORDS) add(word, { energy: "low" });
  for (const word of LISTENER_HIGH_ENERGY_WORDS) add(word, { energy: "high" });
  for (const word of LISTENER_MEDIUM_ENERGY_WORDS) add(word, { energy: "medium" });
  const implying = new Set(ENERGY_IMPLYING_ACTIVITY_WORDS.map((word) => foldListenerText(word)));
  for (const [mood, words] of Object.entries(LISTENER_MOOD_WORDS)) {
    for (const word of words) {
      add(word, { mood, ...(implying.has(foldListenerText(word)) ? { impliedEnergy: "high" as const } : {}) });
    }
  }
  for (const word of LISTENER_GUARD_PHRASES) add(word, { guard: true });
  for (const [word, genre] of Object.entries(LISTENER_GENRE_WORDS)) add(word, { genre });
  for (const [word, genre] of Object.entries(ACCENT_ONLY_GENRE_WORDS)) add(word, { genre, accentOnly: true });

  // Every catalog genre and alias, but only when typed WITH an accent
  // ("opéra", "reggaetón"): the crate rules cannot see through the accent, and
  // plain spellings they already read are never re-read here.
  const accentOnlyElectro = new Set(Object.keys(ACCENT_ONLY_GENRE_WORDS));
  const vocabulary: Array<[string, string]> = [
    ...TASTE_EDIT_GENRES.map((genre): [string, string] => [genre, genre]),
    ...Object.entries(TASTE_EDIT_GENRE_ALIASES),
  ];
  for (const [phrase, genre] of vocabulary) {
    const key = foldListenerText(phrase).trim();
    if (accentOnlyElectro.has(key) || effects.has(key)) continue;
    effects.set(key, { genre, accentOnly: true });
  }

  const entries: ListenerEntry[] = [];
  for (const [phrase, effect] of effects) entries.push({ phrase, regex: phraseRegex(phrase), effect });
  // Longest phrase first, so "pump me up" is read before "pump" and "work out" before "work".
  return entries.sort((a, b) => b.phrase.length - a.phrase.length || (a.phrase < b.phrase ? -1 : 1));
}

const ENTRIES: readonly ListenerEntry[] = buildEntries();

// ---------------------------------------------------------------------------
// Typo tolerance (genres only)
// ---------------------------------------------------------------------------

interface FuzzyTarget {
  genre: string;
  words: string[];
  joined: string;
}

function buildFuzzyTargets(): FuzzyTarget[] {
  const seen = new Set<string>();
  const targets: FuzzyTarget[] = [];
  const vocabulary: Array<[string, string]> = [
    ...TASTE_EDIT_GENRES.map((genre): [string, string] => [genre, genre]),
    ...Object.entries(TASTE_EDIT_GENRE_ALIASES),
  ];
  for (const [phrase, genre] of vocabulary) {
    const words = foldListenerText(phrase).split(/[\s-]+/).filter(Boolean);
    const joined = words.join("");
    if (joined.length < TYPO_MIN_TARGET_LENGTH || !/^[a-z&]+$/.test(joined)) continue;
    const key = `${joined}|${genre}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ genre, words, joined });
  }
  return targets;
}

const FUZZY_TARGETS: readonly FuzzyTarget[] = buildFuzzyTargets();

/** Optimal string alignment distance: insert, delete, substitute, swap two neighbours. */
export function osaDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) d[i][0] = i;
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** The one genre every closest target agrees on, or undefined (no target close enough, or a tie). */
function uniqueClosestGenre(candidates: Array<{ genre: string; distance: number }>): string | undefined {
  let best = TYPO_MAX_DISTANCE + 1;
  for (const candidate of candidates) best = Math.min(best, candidate.distance);
  if (best > TYPO_MAX_DISTANCE) return undefined;
  const genres = new Set(candidates.filter((candidate) => candidate.distance === best).map((c) => c.genre));
  return genres.size === 1 ? [...genres][0] : undefined;
}

function fuzzyGenreForToken(token: string): string | undefined {
  if (token.length < TYPO_MIN_TOKEN_LENGTH || !/^[a-z]+$/.test(token) || TYPO_STOPLIST.has(token)) {
    return undefined;
  }
  return uniqueClosestGenre(
    FUZZY_TARGETS.map((target) => ({ genre: target.genre, distance: osaDistance(token, target.joined) })),
  );
}

/**
 * Two adjacent words against a two-word target ("hip hpo" against "hip hop"):
 * one word must be spelt exactly and the other within one edit.
 */
function fuzzyGenreForWindow(first: string, second: string): string | undefined {
  const usable = (word: string) => /^[a-z]+$/.test(word) && !TYPO_STOPLIST.has(word) && !GLUE_WORDS.has(word);
  if (!usable(first) || !usable(second)) return undefined;
  const candidates: Array<{ genre: string; distance: number }> = [];
  for (const target of FUZZY_TARGETS) {
    if (target.words.length !== 2) continue;
    const [a, b] = target.words;
    const firstDistance = osaDistance(first, a);
    const secondDistance = osaDistance(second, b);
    const exactFirst = firstDistance === 0 && second.length >= TYPO_MIN_WINDOW_WORD_LENGTH;
    const exactSecond = secondDistance === 0 && first.length >= TYPO_MIN_WINDOW_WORD_LENGTH;
    if (exactFirst && secondDistance <= TYPO_MAX_DISTANCE) {
      candidates.push({ genre: target.genre, distance: secondDistance });
    } else if (exactSecond && firstDistance <= TYPO_MAX_DISTANCE) {
      candidates.push({ genre: target.genre, distance: firstDistance });
    }
  }
  return uniqueClosestGenre(candidates);
}

// ---------------------------------------------------------------------------
// Reading one phrase
// ---------------------------------------------------------------------------

interface Hit {
  start: number;
  end: number;
  effect: ListenerEffect;
}

function scanPhrase(original: string): Hit[] {
  const folded = foldListenerText(original);
  let work = folded;
  const hits: Hit[] = [];
  const mask = (start: number, end: number) => {
    work = work.slice(0, start) + " ".repeat(end - start) + work.slice(end);
  };

  for (const entry of ENTRIES) {
    entry.regex.lastIndex = 0;
    for (;;) {
      const found = entry.regex.exec(work);
      if (!found) break;
      const start = found.index + found[1].length;
      const end = start + found[2].length;
      if (entry.effect.accentOnly && original.slice(start, end).toLowerCase() === folded.slice(start, end)) {
        continue;
      }
      hits.push({ start, end, effect: entry.effect });
      mask(start, end);
    }
  }

  // Typos, on the words nothing above read. Pairs first ("hip hpo"), then single words.
  const tokens = [...work.matchAll(/[a-z0-9&]+/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const taken = new Set<number>();
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const [first, second] = [tokens[i], tokens[i + 1]];
    if (taken.has(i) || taken.has(i + 1)) continue;
    if (!/^[\s-]+$/.test(folded.slice(first.end, second.start))) continue;
    const genre = fuzzyGenreForWindow(first.text, second.text);
    if (!genre) continue;
    hits.push({ start: first.start, end: second.end, effect: { genre } });
    taken.add(i);
    taken.add(i + 1);
  }
  tokens.forEach((token, i) => {
    if (taken.has(i)) return;
    const genre = fuzzyGenreForToken(token.text);
    if (genre) hits.push({ start: token.start, end: token.end, effect: { genre } });
  });

  return hits.sort((a, b) => a.start - b.start);
}

/** Edge glue is trimmed from a leftover piece; what remains is returned, or undefined when only glue was left. */
function trimGlue(piece: string): string | undefined {
  const words = [...piece.matchAll(/[^\s,;.!?:()[\]"]+/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    bare: match[0].toLowerCase().replaceAll(/[^a-z0-9]/g, ""),
  }));
  const isGlue = (bare: string) => bare === "" || GLUE_WORDS.has(bare) || GLUE_WORDS.has(foldListenerText(bare));
  let first = 0;
  let last = words.length - 1;
  while (first <= last && isGlue(words[first].bare)) first += 1;
  while (last >= first && isGlue(words[last].bare)) last -= 1;
  if (first > last) return undefined;
  const text = piece
    .slice(words[first].start, words[last].end)
    .replaceAll(/\s+/g, " ")
    .replaceAll(/^['"`-]+|['"`-]+$/g, "")
    .trim();
  return /[a-z0-9]/i.test(text) ? text : undefined;
}

function leftoverPieces(original: string, consumed: readonly Hit[]): string[] {
  const pieces: string[] = [];
  let cursor = 0;
  const push = (end: number) => {
    const piece = trimGlue(original.slice(cursor, end));
    if (piece) pieces.push(piece);
  };
  for (const hit of consumed) {
    push(hit.start);
    cursor = hit.end;
  }
  push(original.length);
  return pieces;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function bandOf(range: CrateNumberRange | null | undefined): EnergyBand | null {
  if (!range || (range.min === null && range.max === null)) return null;
  const midpoint = Math.round((((range.min ?? 0) + (range.max ?? 1)) / 2) * 1000) / 1000;
  if (midpoint < BAND_LOW_BELOW) return "low";
  if (midpoint > BAND_HIGH_ABOVE) return "high";
  return "medium";
}

/**
 * Reads the listener words in `parsed.unparsed`. Returns the result with the
 * genres, moods and energy it found merged in and the words it consumed removed
 * from `unparsed`; everything else (tempo, count, keys, artists, strategy) is
 * carried over untouched. A result with nothing to read is returned unchanged.
 */
export function readListenerWords(parsed: CrateParseResult): CrateParseResult {
  const phrases = parsed.unparsed ?? [];
  if (phrases.length === 0) return parsed;

  const scanned = phrases.map((phrase) => ({ phrase, hits: scanPhrase(phrase) }));
  const all = scanned.flatMap((entry) => entry.hits);
  if (all.length === 0) return parsed;

  const filters = parsed.filters;
  const dropped = new Set<Hit>(all.filter((hit) => hit.effect.guard));

  // Energy: the crate rules win; otherwise one explicit band, else one implied band.
  const crateBand = bandOf(filters.energy);
  const explicit = all.filter((hit) => hit.effect.energy !== undefined && !dropped.has(hit));
  let energy: CrateNumberRange | null = filters.energy;
  if (crateBand) {
    for (const hit of explicit) if (hit.effect.energy !== crateBand) dropped.add(hit);
  } else {
    const bands = [...new Set(explicit.map((hit) => hit.effect.energy as EnergyBand))];
    if (bands.length > 1) {
      for (const hit of explicit) dropped.add(hit);
    } else if (bands.length === 1) {
      energy = { ...LISTENER_ENERGY_RANGES[bands[0]] };
    } else {
      const implied = [
        ...new Set(all.filter((hit) => !dropped.has(hit)).map((hit) => hit.effect.impliedEnergy).filter((band) => band !== undefined)),
      ];
      if (implied.length === 1) energy = { ...LISTENER_ENERGY_RANGES[implied[0]] };
    }
  }

  // Genres and moods: union, deduplicated, within the crate maximums.
  const genres = [...filters.genres];
  const moods = [...filters.moods];
  for (const hit of all) {
    if (dropped.has(hit)) continue;
    if (hit.effect.genre) {
      const genre = canonicalCrateGenre(hit.effect.genre);
      if (!genre) dropped.add(hit);
      else if (!genres.includes(genre)) {
        if (genres.length >= CRATE_MAX_GENRES) dropped.add(hit);
        else genres.push(genre);
      }
    }
    if (hit.effect.mood) {
      const mood = canonicalCrateMood(hit.effect.mood);
      if (!mood) dropped.add(hit);
      else if (!moods.includes(mood)) {
        if (moods.length >= CRATE_MAX_MOODS) dropped.add(hit);
        else moods.push(mood);
      }
    }
  }

  const next: CrateFilters = { ...filters, genres, moods, energy };
  const unparsed: string[] = [];
  const seen = new Set<string>();
  for (const { phrase, hits } of scanned) {
    const consumed = hits.filter((hit) => !dropped.has(hit));
    const kept = consumed.length === 0 ? [phrase] : leftoverPieces(phrase, consumed);
    for (const piece of kept) {
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unparsed.push(piece.slice(0, CRATE_MAX_UNPARSED_LENGTH));
    }
  }

  return {
    ...parsed,
    filters: sanitizeCrateFilters(next).filters,
    unparsed: unparsed.slice(0, CRATE_MAX_UNPARSED),
  };
}

/** Every mood this layer can emit is a catalog mood. Exposed so a spec can assert it. */
export const LISTENER_MOODS: readonly string[] = Object.keys(LISTENER_MOOD_WORDS).filter((mood) =>
  TASTE_EDIT_MOODS.includes(mood),
);
