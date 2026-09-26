/**
 * "Describe it" for Remix Studio (#1900, epic #1896): plain words → visible,
 * adjustable changes to the studio's existing controls.
 *
 * v1 is deterministic and client-side: a small phrase parser
 * (`parseRemixDescription`) turns text such as "slower and dreamy, no drums,
 * make it longer" into a list of directives, and `planToEdits` turns those
 * into new edits plus a human-readable diff. No model call, no credits; the
 * text never leaves the browser. Both functions are pure.
 */

import type { RemixSectionGrid } from "./api";
import {
  applyVibe,
  formatFxAmount,
  formatFxSpeed,
  formatFxTone,
  normalizeRemixFx,
  remixFxMaster,
  remixFxStem,
  withMasterFx,
  withStemFx,
  type RemixFxMaster,
  type RemixFxRecipe,
  type RemixFxStem,
  type RemixVibeId,
} from "./remixFx";
import { applyRecipe, type StemEditLike } from "./remixRecipes";
import {
  extendedMix,
  normalizeRemixStructure,
  resetStructure,
  shortEdit,
  structureEditState,
  structureTimeline,
  structureTooLongReason,
  type RemixBlockMasks,
  type RemixStructure,
  type RemixStructureEditResult,
} from "./remixStructure";

// ---------------------------------------------------------------------------
// Plan types.

/** Stem families the parser knows, matched against stem types. */
export type RemixDescribeStemType =
  | "vocals"
  | "drums"
  | "bass"
  | "guitar"
  | "piano"
  | "other";

/** "a bit" / (none) / "very". */
export type RemixDescribeIntensity = "bit" | "normal" | "very";

/** Song shapes a description can ask for. */
export type RemixDescribeShapeId = "extended" | "short" | "original";

export type RemixIntentDirective = {
  /** The words that produced this directive, e.g. "a bit slower". */
  phrase: string;
} & (
  | { kind: "vibe"; id: RemixVibeId }
  | {
      kind: "speed";
      direction: "slower" | "faster" | "less_slow" | "less_fast";
      intensity: RemixDescribeIntensity;
    }
  | { kind: "space"; direction: "more" | "less"; intensity: RemixDescribeIntensity }
  | {
      kind: "tone";
      direction: "darker" | "brighter" | "less_dark" | "less_bright";
      intensity: RemixDescribeIntensity;
      /** Implied by another word ("dreamy"); an explicit tone word wins. */
      implied?: boolean;
    }
  | { kind: "warmth"; direction: "more" | "less"; intensity: RemixDescribeIntensity }
  | {
      kind: "stemEcho";
      /** null: "more" → the vocals, "less" → every part. */
      stemType: RemixDescribeStemType | null;
      direction: "more" | "less";
      intensity: RemixDescribeIntensity;
    }
  | { kind: "stemMute"; stemType: RemixDescribeStemType }
  | { kind: "only"; stemType: RemixDescribeStemType }
  | { kind: "instrumental" }
  | { kind: "shape"; id: RemixDescribeShapeId }
);

export type RemixIntentPlan = {
  /** Recognized directives, in the order they were written. */
  directives: RemixIntentDirective[];
  /** Meaningful words that were not understood (stopwords excluded). */
  unrecognizedWords: string[];
  /** Honest notes on words understood but not supported. */
  notes: string[];
};

// ---------------------------------------------------------------------------
// Amount table.

/**
 * Deterministic amounts (#1900). Every change is relative to the current
 * value, so repeating a word keeps moving the same way and a vibe named in
 * the same sentence is adjusted, not overwritten:
 *
 * | Directive                          | a bit  | (plain) | very   |
 * |------------------------------------|--------|---------|--------|
 * | speed slower (× current)           | × 0.92 | × 0.85  | × 0.78 |
 * | speed faster (× current)           | × 1.07 | × 1.15  | × 1.25 |
 * | space more (+ current)             | + 0.2  | + 0.4   | + 0.6  |
 * | tone darker / brighter (∓ current) | 0.15   | 0.3     | 0.45   |
 * | warmth more (+ current)            | + 0.2  | + 0.4   | + 0.6  |
 * | stem echo more (+ current)         | + 0.2  | + 0.4   | + 0.6  |
 *
 * From the defaults, speed therefore lands on 0.92× / 0.85× / 0.78× and
 * 1.07× / 1.15× / 1.25×. "Dreamy" words add space plus an implied
 * "a bit darker" tone (−0.15), which an explicit tone word overrides.
 *
 * Removing a quality ("dry", "no reverb", "not so dark", "too slow",
 * "clean", "no echo") returns it to neutral; with "a bit" it goes halfway.
 * Speed never passes 1.00× and tone never passes neutral when removing.
 * Every result is clamped to the control's range and rounded like any
 * other edit (`normalizeRemixFx`).
 */
export const REMIX_DESCRIBE_AMOUNTS = {
  speedFactor: {
    slower: { bit: 0.92, normal: 0.85, very: 0.78 },
    faster: { bit: 1.07, normal: 1.15, very: 1.25 },
  },
  step: { bit: 0.2, normal: 0.4, very: 0.6 },
  toneStep: { bit: 0.15, normal: 0.3, very: 0.45 },
} as const;

/** m:ss for a length in seconds (shared with the shape buttons). */
export function formatSongLength(sec: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The input box's character cap. */
export const REMIX_DESCRIBE_MAX_LENGTH = 200;

// ---------------------------------------------------------------------------
// Lexicon.

type Term =
  | { t: "speed"; dir: "slower" | "faster"; intensity?: RemixDescribeIntensity }
  | { t: "space"; dir: "more" | "less"; dreamy?: boolean }
  | { t: "tone"; dir: "darker" | "brighter" }
  | { t: "warmth"; dir: "more" | "less" }
  | { t: "vibe"; id: RemixVibeId }
  | { t: "effects" }
  | { t: "echo" }
  | { t: "stem"; type: RemixDescribeStemType }
  | { t: "only" }
  | { t: "postOnly" }
  | { t: "postMute" }
  | { t: "acapella" }
  | { t: "instrumental" }
  | { t: "shape"; id: "extended" | "short" | "original" }
  | { t: "neg"; strength: "no" | "less" | "too" }
  | { t: "intensity"; level: "bit" | "very" }
  | { t: "break" };

function entries(words: string[], term: Term): Array<[string, Term]> {
  return words.map((word) => [word, term]);
}

const LEXICON = new Map<string, Term>([
  // Tempo.
  ...entries(
    ["slower", "slow", "slowed", "slow down", "slowed down", "slow it down"],
    { t: "speed", dir: "slower" },
  ),
  ...entries(
    ["faster", "fast", "quicker", "sped up", "speed up", "speed it up"],
    { t: "speed", dir: "faster" },
  ),
  ["nightcore", { t: "speed", dir: "faster", intensity: "very" }],
  // Space.
  ...entries(
    [
      "dreamy",
      "dreamier",
      "spacey",
      "spacy",
      "spaced out",
      "ethereal",
      "airy",
      "floaty",
      "floating",
    ],
    { t: "space", dir: "more", dreamy: true },
  ),
  ...entries(
    ["reverb", "reverby", "roomy", "roomier", "spacious", "space", "wet"],
    { t: "space", dir: "more" },
  ),
  ...entries(["dry", "drier", "dryer", "tight", "tighter"], {
    t: "space",
    dir: "less",
  }),
  // Tone.
  ...entries(
    ["dark", "darker", "moody", "moodier", "muffled", "dull", "duller"],
    { t: "tone", dir: "darker" },
  ),
  ...entries(
    ["bright", "brighter", "crisp", "crisper", "crispy", "sparkly", "clearer"],
    { t: "tone", dir: "brighter" },
  ),
  // Warmth.
  ...entries(
    ["warm", "warmer", "vintage", "tape", "analog", "analogue", "saturated"],
    { t: "warmth", dir: "more" },
  ),
  ...entries(["clean", "cleaner"], { t: "warmth", dir: "less" }),
  // Vibes.
  ...entries(["lofi", "lo fi", "chill", "chilled", "chillout", "chill out", "chillhop"], {
    t: "vibe",
    id: "lofi",
  }),
  ...entries(["club", "clubby", "dance", "dancey", "danceable", "party"], {
    t: "vibe",
    id: "club",
  }),
  ...entries(["slowed reverb", "slowed and reverb"], {
    t: "vibe",
    id: "slowed_reverb",
  }),
  ...entries(["effects", "effect", "fx"], { t: "effects" }),
  // Parts.
  ...entries(["echo", "echoes", "echoey", "echoy", "delay"], { t: "echo" }),
  ...entries(
    ["vocals", "vocal", "voice", "voices", "vox", "singing", "singer", "vocalist"],
    { t: "stem", type: "vocals" },
  ),
  ...entries(["drums", "drum", "beat", "beats", "percussion"], {
    t: "stem",
    type: "drums",
  }),
  ...entries(["bass", "bassline", "basses"], { t: "stem", type: "bass" }),
  ...entries(["guitar", "guitars"], { t: "stem", type: "guitar" }),
  ...entries(["piano", "pianos", "keys", "keyboard", "keyboards"], {
    t: "stem",
    type: "piano",
  }),
  ...entries(["other", "others"], { t: "stem", type: "other" }),
  ...entries(["only", "just", "solo"], { t: "only" }),
  ...entries(["alone"], { t: "postOnly" }),
  ...entries(["off", "out", "gone"], { t: "postMute" }),
  ...entries(
    ["acapella", "acappella", "a cappella", "a capella", "a capela", "capella"],
    { t: "acapella" },
  ),
  ...entries(["instrumental", "instrumentals", "karaoke", "backing track"], {
    t: "instrumental",
  }),
  // Shape.
  ...entries(
    ["longer", "long", "extended", "extend", "extended mix", "lengthen"],
    { t: "shape", id: "extended" },
  ),
  ...entries(
    ["shorter", "short", "shorten", "radio edit", "short edit"],
    { t: "shape", id: "short" },
  ),
  ...entries(["original length", "full length"], { t: "shape", id: "original" }),
  // Negation and intensity.
  ...entries(
    [
      "no",
      "not",
      "without",
      "minus",
      "dont",
      "never",
      "remove",
      "mute",
      "cut",
      "drop",
      "kill",
      "lose",
      "get rid of",
      "take out",
      "turn off",
    ],
    { t: "neg", strength: "no" },
  ),
  ["less", { t: "neg", strength: "less" }],
  ["too", { t: "neg", strength: "too" }],
  ...entries(
    [
      "a bit",
      "bit",
      "a little",
      "little",
      "a touch",
      "touch",
      "slightly",
      "somewhat",
      "kinda",
      "kind of",
      "a tad",
      "tad",
    ],
    { t: "intensity", level: "bit" },
  ),
  ...entries(
    [
      "very",
      "super",
      "really",
      "way",
      "much",
      "a lot",
      "lot",
      "extra",
      "extremely",
      "totally",
    ],
    { t: "intensity", level: "very" },
  ),
  ...entries(["but", "then", "|"], { t: "break" }),
]);

const MAX_PHRASE_WORDS = Math.max(
  ...[...LEXICON.keys()].map((phrase) => phrase.split(" ").length),
);

/** Filler words: skipped without breaking a phrase, never "unrecognized". */
const STOPWORDS = new Set(
  (
    "a an the and or with it its make makes making made more some please i im id " +
    "want wanna would like love me my to of on in for be is are was sound sounds " +
    "sounding feel feels feeling so that this these those can could you we let lets " +
    "add put give turn keep have has get got remix song track tune version mix " +
    "up down all everything also plus yet one into from at as by stuff part parts " +
    "stem stems vibe vibes vibey mood even still now amount should will than " +
    "thing things whole sort any there here them they their our us do does"
  ).split(" "),
);

/** Lowercased tokens; clause punctuation becomes a "|" break token. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[,.;:!?\n\r()[\]{}"/]+/g, " | ")
    .replace(/[^a-z0-9|]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0);
}

type Token = { term: Term | null; words: string };

function lexTokens(words: string[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < words.length) {
    let matched = false;
    for (let size = Math.min(MAX_PHRASE_WORDS, words.length - index); size >= 1; size -= 1) {
      const phrase = words.slice(index, index + size).join(" ");
      const term = LEXICON.get(phrase);
      if (term) {
        tokens.push({ term, words: phrase });
        index += size;
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push({ term: null, words: words[index] });
      index += 1;
    }
  }
  return tokens;
}

const STEM_LABELS: Record<RemixDescribeStemType, string> = {
  vocals: "vocal",
  drums: "drum",
  bass: "bass",
  guitar: "guitar",
  piano: "piano",
  other: '"other"',
};

/**
 * Parse a plain-language description into directives (#1900). Pure and
 * deterministic: lowercases, strips punctuation (commas, periods… end a
 * clause), matches the v1 vocabulary (tempo, space, tone, warmth, vibes,
 * parts, shape) with intensity ("a bit", "very"…) and negation ("no", "not
 * so", "too", "less", "without"…), and lists the meaningful words it did not
 * understand.
 */
export function parseRemixDescription(text: string): RemixIntentPlan {
  const directives: RemixIntentDirective[] = [];
  const unrecognized: string[] = [];
  const notes: string[] = [];
  const tokens = lexTokens(tokenize(typeof text === "string" ? text : ""));

  // Pending modifiers remember where they started so a directive's phrase
  // is the span the listener wrote ("a bit less reverb").
  let neg: { strength: "no" | "less" | "too"; words: string; index: number } | null =
    null;
  let intensity: { level: "bit" | "very"; index: number } | null = null;
  let onlyPending: { words: string; index: number } | null = null;
  /** "echo" seen with no part yet: "echo on the vocals" or the default. */
  let echoPending: {
    direction: "more" | "less";
    intensity: RemixDescribeIntensity;
    start: number;
    end: number;
  } | null = null;
  /** Parts named with no action yet ("vocal" in "vocal echo"). */
  let dangling: Array<{ type: RemixDescribeStemType; words: string; index: number }> =
    [];
  /** An action that carries over "and"-joined parts ("no drums and bass"). */
  let stemMode: "mute" | "only" | "echo" | null = null;
  let stemModeWords = "";
  let echoMode: {
    direction: "more" | "less";
    intensity: RemixDescribeIntensity;
  } | null = null;

  const prefix = (...parts: Array<string | null | undefined>) =>
    parts.filter((part) => part && part.length > 0).join(" ");
  const level = (): RemixDescribeIntensity => intensity?.level ?? "normal";
  /** The words from token `from` through token `to`. */
  const span = (from: number, to: number) =>
    tokens
      .slice(from, to + 1)
      .map((token) => token.words)
      .join(" ");
  /** Where the modifiers of the current term start. */
  const startOf = (index: number, ...others: Array<number | undefined>) =>
    Math.min(index, ...others.filter((other): other is number => other !== undefined));

  const flushEcho = () => {
    if (!echoPending) return;
    directives.push({
      kind: "stemEcho",
      stemType: null,
      direction: echoPending.direction,
      intensity: echoPending.intensity,
      phrase: span(echoPending.start, echoPending.end),
    });
    echoPending = null;
  };
  const flushDangling = () => {
    for (const stem of dangling) unrecognized.push(stem.words);
    dangling = [];
  };
  const endClause = () => {
    flushEcho();
    flushDangling();
    neg = null;
    intensity = null;
    onlyPending = null;
    stemMode = null;
    echoMode = null;
  };
  /** Next token with a term, skipping filler words. */
  const nextTerm = (from: number): { term: Term; index: number } | null => {
    for (let index = from; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.term) return { term: token.term, index };
      if (!STOPWORDS.has(token.words)) return null;
    }
    return null;
  };
  /** Postfix words ("only", "off") already claimed by the part before them. */
  const consumed = new Set<number>();
  const pushEcho = (
    stemType: RemixDescribeStemType,
    direction: "more" | "less",
    echoIntensity: RemixDescribeIntensity,
    phrase: string,
  ) => {
    directives.push({
      kind: "stemEcho",
      stemType,
      direction,
      intensity: echoIntensity,
      phrase,
    });
  };

  tokens.forEach((token, index) => {
    if (consumed.has(index)) return;
    const term = token.term;
    if (!term) {
      if (!STOPWORDS.has(token.words) && !/^\d+$/.test(token.words)) {
        unrecognized.push(token.words);
      }
      return;
    }
    switch (term.t) {
      case "break":
        endClause();
        return;
      case "intensity":
        intensity = { level: term.level, index };
        return;
      case "neg":
        flushDangling();
        neg = { strength: term.strength, words: token.words, index };
        stemMode = null;
        return;
      case "only":
        // "vocals only" is handled by the part itself (lookahead).
        onlyPending = { words: token.words, index };
        stemMode = null;
        return;
      case "postOnly":
      case "postMute":
        // Consumed by the preceding part; alone they mean nothing.
        return;
      case "stem": {
        const next = nextTerm(index + 1);
        if (next?.term.t === "echo") {
          // "vocal echo", "no vocal echo": the echo claims this part.
          dangling.push({ type: term.type, words: token.words, index });
          return;
        }
        if (neg) {
          if (neg.strength === "no") {
            directives.push({
              kind: "stemMute",
              stemType: term.type,
              phrase: span(neg.index, index),
            });
            stemMode = "mute";
            stemModeWords = neg.words;
          } else if (neg.strength === "less") {
            notes.push(
              `I can't turn a part down from here yet — use its volume slider, or try "no ${token.words}" to mute it.`,
            );
          } else {
            dangling.push({ type: term.type, words: token.words, index });
          }
          neg = null;
          intensity = null;
          return;
        }
        if (onlyPending) {
          directives.push({
            kind: "only",
            stemType: term.type,
            phrase: span(onlyPending.index, index),
          });
          stemMode = "only";
          stemModeWords = onlyPending.words;
          onlyPending = null;
          return;
        }
        if (echoPending) {
          const pending = echoPending;
          pushEcho(term.type, pending.direction, pending.intensity, span(pending.start, index));
          echoMode = { direction: pending.direction, intensity: pending.intensity };
          stemMode = "echo";
          stemModeWords = tokens[pending.end].words;
          echoPending = null;
          return;
        }
        if (stemMode === "mute" || stemMode === "only") {
          directives.push({
            kind: stemMode === "mute" ? "stemMute" : "only",
            stemType: term.type,
            phrase: prefix(stemModeWords, token.words),
          });
          return;
        }
        if (stemMode === "echo" && echoMode) {
          pushEcho(term.type, echoMode.direction, echoMode.intensity, prefix(stemModeWords, token.words));
          return;
        }
        // Postfix forms on a bare part: "vocals only", "vocals alone",
        // "drums off"/"drums out".
        if (next && (next.term.t === "only" || next.term.t === "postOnly")) {
          consumed.add(next.index);
          directives.push({
            kind: "only",
            stemType: term.type,
            phrase: span(index, next.index),
          });
          stemMode = "only";
          stemModeWords = "only";
          return;
        }
        if (next?.term.t === "postMute") {
          consumed.add(next.index);
          directives.push({
            kind: "stemMute",
            stemType: term.type,
            phrase: span(index, next.index),
          });
          return;
        }
        dangling.push({ type: term.type, words: token.words, index });
        return;
      }
      case "echo": {
        // "no echo", "less echo", "too much echo": take it away.
        const direction = neg ? "less" : "more";
        const echoIntensity = level();
        const start = startOf(index, neg?.index, intensity?.index);
        if (dangling.length > 0) {
          for (const stem of dangling) {
            pushEcho(
              stem.type,
              direction,
              echoIntensity,
              span(startOf(stem.index, neg?.index, intensity?.index), index),
            );
          }
          dangling = [];
        } else {
          flushEcho();
          echoPending = { direction, intensity: echoIntensity, start, end: index };
        }
        neg = null;
        intensity = null;
        onlyPending = null;
        stemMode = null;
        return;
      }
      default:
        break;
    }

    // Everything below acts on the whole remix: close the part context.
    flushEcho();
    flushDangling();
    stemMode = null;
    echoMode = null;
    onlyPending = null;
    const negated = neg !== null;
    const words = span(startOf(index, neg?.index, intensity?.index), index);

    switch (term.t) {
      case "speed":
        directives.push({
          kind: "speed",
          direction: negated
            ? term.dir === "slower"
              ? "less_slow"
              : "less_fast"
            : term.dir,
          intensity: intensity?.level ?? term.intensity ?? "normal",
          phrase: words,
        });
        break;
      case "space": {
        const direction = negated ? "less" : term.dir;
        directives.push({ kind: "space", direction, intensity: level(), phrase: words });
        if (term.dreamy && direction === "more") {
          directives.push({
            kind: "tone",
            direction: "darker",
            intensity: "bit",
            implied: true,
            phrase: words,
          });
        }
        break;
      }
      case "tone":
        directives.push({
          kind: "tone",
          direction: negated
            ? term.dir === "darker"
              ? "less_dark"
              : "less_bright"
            : term.dir,
          intensity: level(),
          phrase: words,
        });
        break;
      case "warmth":
        directives.push({
          kind: "warmth",
          direction: negated ? "less" : term.dir,
          intensity: level(),
          phrase: words,
        });
        break;
      case "vibe":
        if (negated) {
          notes.push(
            `I can't take "${token.words}" away by name — try "no effects" to start from a clean sound.`,
          );
        } else {
          directives.push({ kind: "vibe", id: term.id, phrase: words });
        }
        break;
      case "effects":
        // "no effects" clears every effect; a bare "effects" is filler.
        if (negated && neg?.strength === "no") {
          directives.push({ kind: "vibe", id: "none", phrase: words });
        }
        break;
      case "acapella":
        if (negated) {
          notes.push(`To lose the vocals, try "no vocals" or "instrumental".`);
        } else {
          directives.push({ kind: "only", stemType: "vocals", phrase: words });
        }
        break;
      case "instrumental":
        if (negated) {
          notes.push(`To hear only the vocals, try "only vocals".`);
        } else {
          directives.push({ kind: "instrumental", phrase: words });
        }
        break;
      case "shape":
        directives.push({
          kind: "shape",
          // "not so long", "too short": back to the original length.
          id: negated ? "original" : term.id,
          phrase: words,
        });
        break;
    }
    neg = null;
    intensity = null;
  });
  endClause();

  return {
    directives,
    unrecognizedWords: [...new Set(unrecognized)],
    notes: [...new Set(notes)],
  };
}

// ---------------------------------------------------------------------------
// Plan → edits.

/** The slice of the studio's edits a description can change. */
export type RemixDescribeEdits = {
  stems: Record<string, StemEditLike>;
  effects: RemixFxRecipe | null;
  structure: RemixStructure | null;
};

export type RemixDescribeStem = {
  stemId: string;
  type: string;
  /** Display name, e.g. "Vocals". */
  name: string;
  /** Full-mix A/B reference: never touched. */
  reference: boolean;
};

export type RemixDescribeContext<E extends RemixDescribeEdits = RemixDescribeEdits> = {
  edits: E;
  stems: RemixDescribeStem[];
  grid: RemixSectionGrid | null;
};

/** One line of the proposal's diff, e.g. Speed 1.00× → 0.85×. */
export type RemixDescribeChange = { label: string; from: string; to: string };

export type RemixDescribeResult<E extends RemixDescribeEdits = RemixDescribeEdits> = {
  /** The proposed edits; the input edits (same object) when nothing changes. */
  edits: E;
  changes: RemixDescribeChange[];
  /** Honest notes on what could not be done, e.g. a missing part. */
  skipped: string[];
};

/** Plain names of the song shapes (shared with the shape buttons). */
export const REMIX_DESCRIBE_SHAPE_LABELS: Record<RemixDescribeShapeId, string> = {
  original: "Original length",
  extended: "Extended mix",
  short: "Short edit",
};

const STEM_TYPE_GROUPS: Record<RemixDescribeStemType, ReadonlySet<string>> = {
  vocals: new Set(["vocals", "vocal"]),
  drums: new Set(["drums", "drum"]),
  bass: new Set(["bass"]),
  guitar: new Set(["guitar", "guitars"]),
  piano: new Set(["piano", "keys"]),
  other: new Set(["other"]),
};

function stemsOfType(
  stems: RemixDescribeStem[],
  type: RemixDescribeStemType,
): RemixDescribeStem[] {
  const group = STEM_TYPE_GROUPS[type];
  return stems.filter((stem) => group.has(stem.type.trim().toLowerCase()));
}

function missingStem(type: RemixDescribeStemType): string {
  return `This track has no ${STEM_LABELS[type]} stem`;
}

type Directive<K extends RemixIntentDirective["kind"]> = Extract<
  RemixIntentDirective,
  { kind: K }
>;

/** Remove a quality: back to `neutral`, or halfway with "a bit". */
function toward(current: number, neutral: number, intensity: RemixDescribeIntensity): number {
  return intensity === "bit" ? neutral + (current - neutral) / 2 : neutral;
}

function speedValue(current: number, directive: Directive<"speed">): number {
  const { speedFactor } = REMIX_DESCRIBE_AMOUNTS;
  switch (directive.direction) {
    case "slower":
      return current * speedFactor.slower[directive.intensity];
    case "faster":
      return current * speedFactor.faster[directive.intensity];
    case "less_slow":
      return current < 1 ? toward(current, 1, directive.intensity) : current;
    case "less_fast":
      return current > 1 ? toward(current, 1, directive.intensity) : current;
  }
}

function toneValue(current: number, directive: Directive<"tone">): number {
  const step = REMIX_DESCRIBE_AMOUNTS.toneStep[directive.intensity];
  switch (directive.direction) {
    case "darker":
      return current - step;
    case "brighter":
      return current + step;
    case "less_dark":
      return current < 0 ? toward(current, 0, directive.intensity) : current;
    case "less_bright":
      return current > 0 ? toward(current, 0, directive.intensity) : current;
  }
}

/** Space, warmth and echo: add a step, or take the quality away. */
function amountValue(
  current: number,
  direction: "more" | "less",
  intensity: RemixDescribeIntensity,
): number {
  return direction === "more"
    ? current + REMIX_DESCRIBE_AMOUNTS.step[intensity]
    : toward(current, 0, intensity);
}

function stemStateLabel(edit: StemEditLike | undefined): string {
  if (!edit) return "on";
  if (edit.muted) return "muted";
  return edit.sections?.some((on) => !on) ? "partly on" : "on";
}

/** Plain name of a structure: one of the three shapes, else "Custom shape". */
export function describeShapeLabel(
  grid: RemixSectionGrid,
  structure: unknown,
): string {
  const sectionCount = grid.sections.length;
  const key = JSON.stringify(normalizeRemixStructure(structure, sectionCount));
  if (key === "null") return REMIX_DESCRIBE_SHAPE_LABELS.original;
  const empty = structureEditState(grid, null, {});
  const extended = extendedMix(grid, empty);
  if (extended && JSON.stringify(extended.structure) === key) {
    return REMIX_DESCRIBE_SHAPE_LABELS.extended;
  }
  const short = shortEdit(grid, empty);
  if (short && JSON.stringify(short.structure) === key) {
    return REMIX_DESCRIBE_SHAPE_LABELS.short;
  }
  return "Custom shape";
}

const MASTER_CHANGE_ROWS: ReadonlyArray<{
  key: keyof RemixFxMaster;
  label: string;
  format(value: number): string;
}> = [
  { key: "speed", label: "Speed", format: formatFxSpeed },
  { key: "space", label: "Space", format: formatFxAmount },
  { key: "tone", label: "Tone", format: formatFxTone },
  { key: "warmth", label: "Warmth", format: formatFxAmount },
];

const STEM_CHANGE_ROWS: ReadonlyArray<{
  key: keyof RemixFxStem;
  label: string;
  format(value: number): string;
}> = [
  { key: "echo", label: "echo", format: formatFxAmount },
  { key: "space", label: "space", format: formatFxAmount },
  { key: "tone", label: "tone", format: formatFxTone },
];

/**
 * Turn a parsed description into proposed edits and a readable diff
 * (#1900). Pure and deterministic. Directives apply in a fixed order: the
 * (last) vibe first, then the master adjustments in the order written (so an
 * explicit slider word refines a vibe named in the same sentence, and an
 * explicit tone word replaces the tone "dreamy" implies), then the parts
 * ("only …"/instrumental, then mutes, then echo), and the song shape last.
 *
 * Part words match stems by type; a missing part is reported in `skipped`.
 * Full-mix reference stems are never touched. Shapes go through the shared
 * structure operations; a refused extended mix reports the length cap. When
 * nothing visible changes, the input edits are returned as they are.
 */
export function planToEdits<E extends RemixDescribeEdits>(
  plan: RemixIntentPlan,
  context: RemixDescribeContext<E>,
): RemixDescribeResult<E> {
  const { edits, grid } = context;
  const parts = context.stems.filter((stem) => !stem.reference);
  const skipped: string[] = [];
  const of = <K extends RemixIntentDirective["kind"]>(kind: K) =>
    plan.directives.filter((directive): directive is Directive<K> => directive.kind === kind);

  // 1. Vibe: the last one named.
  let effects = edits.effects;
  const vibes = of("vibe");
  if (vibes.length > 0) {
    effects = applyVibe(vibes[vibes.length - 1].id, effects, parts);
  }

  // 2. Master adjustments, in the order written.
  const explicitTone = plan.directives.some(
    (directive) => directive.kind === "tone" && !directive.implied,
  );
  for (const directive of plan.directives) {
    const master = remixFxMaster(effects);
    if (directive.kind === "speed") {
      effects = withMasterFx(effects, "speed", speedValue(master.speed, directive));
    } else if (directive.kind === "tone") {
      if (directive.implied && explicitTone) continue;
      effects = withMasterFx(effects, "tone", toneValue(master.tone, directive));
    } else if (directive.kind === "space" || directive.kind === "warmth") {
      effects = withMasterFx(
        effects,
        directive.kind,
        amountValue(master[directive.kind], directive.direction, directive.intensity),
      );
    }
  }

  // 3. Parts.
  let stems: Record<string, StemEditLike> = { ...edits.stems };
  const sectionCount = grid?.sections.length ?? 0;
  const blockCount =
    sectionCount > 0
      ? (normalizeRemixStructure(edits.structure, sectionCount)?.blocks.length ??
        sectionCount)
      : 0;
  const arrangement = plan.directives.filter(
    (directive): directive is Directive<"only"> | Directive<"instrumental"> =>
      directive.kind === "only" || directive.kind === "instrumental",
  );
  const lastArrangement = arrangement[arrangement.length - 1];
  const recipeStems = parts.map((stem) => ({ stemId: stem.stemId, type: stem.type }));
  if (lastArrangement?.kind === "instrumental") {
    if (stemsOfType(parts, "vocals").length === 0) {
      skipped.push(missingStem("vocals"));
    } else {
      stems = applyRecipe("instrumental", recipeStems, stems, blockCount);
    }
  } else if (lastArrangement?.kind === "only") {
    const keep = new Set<RemixDescribeStemType>();
    for (const directive of of("only")) {
      if (stemsOfType(parts, directive.stemType).length === 0) {
        skipped.push(missingStem(directive.stemType));
      } else {
        keep.add(directive.stemType);
      }
    }
    const kept = [...keep].sort().join("+");
    if (kept === "vocals") {
      stems = applyRecipe("acapella", recipeStems, stems, blockCount);
    } else if (kept === "bass+drums") {
      stems = applyRecipe("drums_bass", recipeStems, stems, blockCount);
    } else if (keep.size > 0) {
      const keepIds = new Set(
        [...keep].flatMap((type) => stemsOfType(parts, type).map((stem) => stem.stemId)),
      );
      for (const stem of parts) {
        const current = stems[stem.stemId];
        if (!current) continue;
        stems[stem.stemId] = keepIds.has(stem.stemId)
          ? { ...current, muted: false, sections: null }
          : { ...current, muted: true };
      }
    }
  }
  for (const directive of of("stemMute")) {
    const matches = stemsOfType(parts, directive.stemType);
    if (matches.length === 0) skipped.push(missingStem(directive.stemType));
    for (const stem of matches) {
      const current = stems[stem.stemId];
      if (current) stems[stem.stemId] = { ...current, muted: true };
    }
  }
  for (const directive of of("stemEcho")) {
    const type = directive.stemType ?? (directive.direction === "more" ? "vocals" : null);
    const targets = type ? stemsOfType(parts, type) : parts;
    if (type && targets.length === 0) skipped.push(missingStem(type));
    for (const stem of targets) {
      const current = remixFxStem(effects, stem.stemId).echo;
      effects = withStemFx(
        effects,
        stem.stemId,
        "echo",
        amountValue(current, directive.direction, directive.intensity),
      );
    }
  }
  effects = normalizeRemixFx(
    effects,
    context.stems.map((stem) => stem.stemId),
  );

  // 4. Song shape: the last one named.
  let structure = edits.structure;
  const shapes = of("shape");
  const shape = shapes[shapes.length - 1];
  if (shape) {
    if (!grid || sectionCount === 0) {
      skipped.push("This song has no sections to reshape yet");
    } else {
      const masks: RemixBlockMasks = {};
      for (const [stemId, edit] of Object.entries(stems)) masks[stemId] = edit.sections;
      const state = structureEditState(grid, structure, masks);
      const result: RemixStructureEditResult | null =
        shape.id === "extended"
          ? extendedMix(grid, state)
          : shape.id === "short"
            ? shortEdit(grid, state)
            : resetStructure(state, grid);
      const currentKey = JSON.stringify(normalizeRemixStructure(structure, sectionCount));
      if (!result) {
        skipped.push(
          shape.id === "extended"
            ? structureTooLongReason(grid)
            : "This song can't be reshaped",
        );
      } else if (JSON.stringify(result.structure) !== currentKey) {
        // Masks move with their blocks; an unchanged shape keeps them as-is.
        structure = result.structure;
        const next = { ...stems };
        for (const [stemId, mask] of Object.entries(result.masks)) {
          const current = next[stemId];
          if (current) next[stemId] = { ...current, sections: mask };
        }
        stems = next;
      }
    }
  }

  // 5. The diff, in the order the controls appear.
  const changes: RemixDescribeChange[] = [];
  const beforeMaster = remixFxMaster(edits.effects);
  const afterMaster = remixFxMaster(effects);
  for (const row of MASTER_CHANGE_ROWS) {
    const from = row.format(beforeMaster[row.key]);
    const to = row.format(afterMaster[row.key]);
    if (from !== to) changes.push({ label: row.label, from, to });
  }
  for (const stem of parts) {
    const from = stemStateLabel(edits.stems[stem.stemId]);
    const to = stemStateLabel(stems[stem.stemId]);
    if (from !== to) changes.push({ label: stem.name, from, to });
    const beforeFx = remixFxStem(edits.effects, stem.stemId);
    const afterFx = remixFxStem(effects, stem.stemId);
    for (const row of STEM_CHANGE_ROWS) {
      const fxFrom = row.format(beforeFx[row.key]);
      const fxTo = row.format(afterFx[row.key]);
      if (fxFrom !== fxTo) {
        changes.push({ label: `${stem.name} ${row.label}`, from: fxFrom, to: fxTo });
      }
    }
  }
  if (grid && sectionCount > 0) {
    const from = describeShapeLabel(grid, edits.structure);
    const to = describeShapeLabel(grid, structure);
    if (from !== to) {
      // The length change rides along: "Extended mix (3:36 → 4:48)".
      const length = (value: RemixStructure | null) =>
        formatSongLength(
          structureTimeline(
            grid,
            normalizeRemixStructure(value, sectionCount)?.blocks ?? null,
          ).durationSec,
        );
      changes.push({
        label: "Song shape",
        from,
        to: `${to} (${length(edits.structure)} → ${length(structure)})`,
      });
    }
  }

  const uniqueSkipped = [...new Set(skipped)];
  if (changes.length === 0) {
    return { edits, changes, skipped: uniqueSkipped };
  }
  return {
    edits: { ...edits, stems, effects, structure },
    changes,
    skipped: uniqueSkipped,
  };
}

/**
 * Whether two edits agree on everything a description can change (mute,
 * block masks, effects, structure); used to retire a stale Undo.
 */
export function sameDescribeEdits(
  left: RemixDescribeEdits,
  right: RemixDescribeEdits,
): boolean {
  const key = (edits: RemixDescribeEdits) =>
    JSON.stringify({
      stems: Object.keys(edits.stems)
        .sort()
        .map((stemId) => [
          stemId,
          edits.stems[stemId].muted,
          edits.stems[stemId].sections ?? null,
        ]),
      effects: normalizeRemixFx(edits.effects),
      structure: edits.structure ?? null,
    });
  return key(left) === key(right);
}

/** Parse + plan in one call: what the proposal shows. */
export function describeRemix<E extends RemixDescribeEdits>(
  text: string,
  context: RemixDescribeContext<E>,
): RemixDescribeResult<E> & { plan: RemixIntentPlan } {
  const plan = parseRemixDescription(text);
  return { ...planToEdits(plan, context), plan };
}
