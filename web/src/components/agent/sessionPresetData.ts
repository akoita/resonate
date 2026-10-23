import type { AgentNextPreferences, AgentSessionRequest } from "../../lib/api";

/**
 * A quick start ("starter") for the AI DJ (#2052, #2249).
 *
 * Tapping a starter writes its `sentence` into the prompt and shows the filters
 * the sentence reads as (`request`); the listener can edit either. A starter in
 * the Moments row sets mood, energy and tempo only, never genres: it searches
 * every genre, ranked by taste. A starter in the Sounds row sets genres only.
 */
export type SessionPreset = {
  /** Stable id used in analytics and session history. Never renamed (#2249). */
  intent: string;
  /** Plain label shown on the button. */
  name: string;
  /** "genre" starters are the Sounds row; "mood" starters are the Moments row. */
  group: "genre" | "mood";
  /** What the session is for, in plain words. */
  description: string;
  /** Short hint of the style, shown on the gallery card. */
  input: string;
  /** The sentence written into the prompt; the DJ's parser reads it with nothing left over. */
  sentence: string;
  /** The filters `sentence` reads as, so chips appear without waiting for the parser. */
  request: AgentSessionRequest;
  /** What the listener will hear, shown before they start (#2052). */
  output: string;
  gradient: string;
  preferences: AgentNextPreferences;
  /** Genres the starter searches; empty for Moments starters. */
  searchVibes: string[];
  queueStyle: string;
};

type Gradient = string;
const gradient = (from: string, to: string): Gradient => `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;

function sound(
  fields: Pick<SessionPreset, "intent" | "name" | "description" | "input" | "sentence" | "output" | "queueStyle"> & {
    genres: string[];
    gradient: Gradient;
  },
): SessionPreset {
  const { genres, ...rest } = fields;
  return {
    ...rest,
    group: "genre",
    request: { genres: [...genres], moods: [], energy: null, bpm: null },
    preferences: { genres: [...genres] },
    searchVibes: [...genres],
  };
}

function moment(
  fields: Pick<SessionPreset, "intent" | "name" | "description" | "input" | "sentence" | "output" | "queueStyle" | "gradient"> & {
    mood?: string;
    /**
     * False when the parser reads the word as energy rather than a mood ("chill"
     * means low energy), so the chips show only what the sentence really sets
     * while the catalog mood still guides the picks.
     */
    moodChip?: boolean;
    energy?: "low" | "medium" | "high";
    bpm?: { min: number; max: number };
  },
): SessionPreset {
  const { mood, moodChip = true, energy, bpm, ...rest } = fields;
  return {
    ...rest,
    group: "mood",
    request: { genres: [], moods: mood && moodChip ? [mood] : [], energy: energy ?? null, bpm: bpm ?? null },
    // Mood, energy and tempo only: a Moments starter never names a genre.
    preferences: { ...(mood ? { mood } : {}), ...(energy ? { energy } : {}) },
    searchVibes: [],
  };
}

/**
 * The Moments row first (feel and use, across all genres), then the Sounds row
 * (everyday genre families). Every genre and mood is in the session parser's
 * vocabulary (`taste_edit_vocabulary.ts`), and every sentence reads with nothing
 * left over; `sessionPresetData.test.ts` checks both against the real parser.
 */
export const SESSION_PRESETS: SessionPreset[] = [
  moment({
    intent: "Focus",
    name: "Focus",
    description: "Steady, low-friction selections for deep work or coding.",
    input: "Calm, steady tracks",
    sentence: "Focus, low energy",
    output: "Calm instrumentals and steady grooves with little to distract you",
    gradient: gradient("#5667ff", "#7447ff"),
    queueStyle: "Stable pacing",
    mood: "Focus",
    energy: "low",
  }),
  moment({
    intent: "Hype",
    name: "High energy",
    description: "High-energy picks when the room needs momentum.",
    input: "Loud, fast, big moments",
    sentence: "High energy, hype",
    output: "Loud, fast tracks with big drops and a lot of drive",
    gradient: gradient("#ff3ea5", "#f04438"),
    queueStyle: "Fast cuts",
    mood: "Hype",
    energy: "high",
  }),
  moment({
    intent: "Chill",
    name: "Chill",
    description: "Soft transitions for browsing, winding down, or late work.",
    input: "Easy, mellow tracks",
    sentence: "Chill, mellow",
    output: "Mellow tracks with lighter drums and room to breathe",
    gradient: gradient("#38bdf8", "#7c5cff"),
    queueStyle: "Soft transitions",
    mood: "Chill",
    moodChip: false,
    energy: "low",
  }),
  moment({
    intent: "Dark",
    name: "Dark",
    description: "Moody, underground choices with more tension and texture.",
    input: "Moody, heavy, tense",
    sentence: "Dark, high energy",
    output: "Dark, heavy tracks with deep bass and building tension",
    gradient: gradient("#2d033b", "#160014"),
    queueStyle: "Tension build",
    mood: "Dark",
    energy: "high",
  }),
  moment({
    intent: "Zen",
    name: "Calm",
    description: "Minimal, spacious sessions for reset moments.",
    input: "Quiet, spacious tracks",
    sentence: "Zen, relaxed",
    output: "Slow, quiet pieces with lots of space",
    gradient: gradient("#f59e0b", "#7c3aed"),
    queueStyle: "Long blends",
    mood: "Zen",
    energy: "low",
  }),
  moment({
    intent: "Club",
    name: "Club",
    description: "Dance-floor tracks around a steady club tempo.",
    input: "Danceable, around 124 beats a minute",
    sentence: "Club, high energy, around 124 BPM",
    output: "Four-on-the-floor dance tracks that stay near 124 beats a minute",
    gradient: gradient("#06b6d4", "#8b5cf6"),
    queueStyle: "Steady groove",
    mood: "Club",
    energy: "high",
    bpm: { min: 121, max: 127 },
  }),
  moment({
    intent: "Late Night",
    name: "Late night",
    description: "Slow, hushed tracks for after-hours listening.",
    input: "After-hours, slow and low",
    sentence: "Late night, low energy",
    output: "Hushed, slow-burning tracks for the small hours",
    gradient: gradient("#312e81", "#0f172a"),
    queueStyle: "Slow burn",
    mood: "Late Night",
    energy: "low",
  }),
  moment({
    intent: "Warm",
    name: "Warm",
    description: "Cosy, friendly tracks with a golden, analogue feel.",
    input: "Cosy, friendly, analogue",
    sentence: "Warm, relaxed",
    output: "Soft, welcoming tracks with a glowing, easy feel",
    gradient: gradient("#f97316", "#facc15"),
    queueStyle: "Easy glow",
    mood: "Warm",
    energy: "low",
  }),
  sound({
    intent: "Hip-Hop",
    name: "Hip-Hop & Rap",
    description: "Beats and bars, from classic hip-hop to today's trap.",
    input: "Hip-hop, rap, trap",
    sentence: "Hip-hop, rap, trap",
    output: "Hard-hitting beats with the rapper front and center",
    gradient: gradient("#f97316", "#b91c1c"),
    queueStyle: "Steady bounce",
    genres: ["Hip-Hop", "Rap", "Trap"],
  }),
  sound({
    intent: "R&B",
    name: "R&B & Soul",
    description: "Smooth vocals and slow grooves for any time of day.",
    input: "R&B, soul, funk",
    sentence: "R&B, soul, funk",
    output: "Silky singing over warm, laid-back grooves",
    gradient: gradient("#db2777", "#7c3aed"),
    queueStyle: "Smooth blends",
    genres: ["R&B", "Soul", "Funk"],
  }),
  sound({
    intent: "Pop",
    name: "Pop Hits",
    description: "Catchy songs with big choruses you can sing along to.",
    input: "Pop, dance, synthpop",
    sentence: "Pop, dance, synthpop",
    output: "Upbeat, radio-friendly songs with memorable hooks",
    gradient: gradient("#ec4899", "#f59e0b"),
    queueStyle: "Hit after hit",
    genres: ["Pop", "Dance", "Synthpop"],
  }),
  sound({
    intent: "Afrobeats",
    name: "Afrobeats & Amapiano",
    description: "Dance-floor rhythms from Lagos to Johannesburg.",
    input: "Afrobeat, Afro-pop, amapiano",
    sentence: "Afrobeat, Afro-pop, amapiano",
    output: "Rolling percussion, deep log-drum bass and feel-good vocals",
    gradient: gradient("#16a34a", "#ca8a04"),
    queueStyle: "Keep it moving",
    genres: ["Afrobeat", "Afro-Pop", "Amapiano"],
  }),
  sound({
    intent: "Reggae",
    name: "Reggae & Dancehall",
    description: "Laid-back island grooves and dancehall bounce.",
    input: "Reggae, dancehall, dub",
    sentence: "Reggae, dancehall, dub",
    output: "Offbeat guitars, deep bass and sunny vocals",
    gradient: gradient("#15803d", "#eab308"),
    queueStyle: "Easy rocking",
    genres: ["Reggae", "Dancehall", "Dub"],
  }),
  sound({
    intent: "Latin",
    name: "Latin & Reggaeton",
    description: "Party rhythms and Latin pop to get everyone moving.",
    input: "Latin, reggaeton",
    sentence: "Latin, reggaeton",
    output: "Dembow beats, Latin percussion and Spanish-language hooks",
    gradient: gradient("#e11d48", "#f97316"),
    queueStyle: "Party pace",
    genres: ["Latin", "Reggaeton"],
  }),
  sound({
    intent: "World",
    name: "World Music",
    description: "Traditional and modern sounds from around the globe.",
    input: "World, musiques du monde",
    sentence: "World, musiques du monde",
    output: "Voices and instruments from many cultures, old and new",
    gradient: gradient("#0d9488", "#a16207"),
    queueStyle: "Wide journey",
    genres: ["World", "Musiques du monde"],
  }),
];

/**
 * Plain labels for sessions recorded under an earlier name. History stores the
 * starter's name at the time, so the old brand names map to today's plain label;
 * the old intent ids map too, for any record that kept the id instead (#2249).
 */
const LEGACY_PRESET_LABELS: Readonly<Record<string, string>> = {
  "Neural Flow": "Focus",
  "Pulse Raid": "High energy",
  "Liquid Sky": "Chill",
  "Abyss Shift": "Dark",
  "Static Calm": "Calm",
  Focus: "Focus",
  Hype: "High energy",
  Chill: "Chill",
  Dark: "Dark",
  Zen: "Calm",
};

/** The plain label to show for a stored starter name or intent id. */
export function plainPresetLabel(storedName: string): string {
  return LEGACY_PRESET_LABELS[storedName] ?? storedName;
}

/** The old names a session may still be recorded under, with the plain label each now shows. */
export const LEGACY_PRESET_NAMES: ReadonlyArray<readonly [string, string]> = Object.entries(LEGACY_PRESET_LABELS);

/**
 * Real sentences the prompt cycles through as its placeholder, so the box shows
 * what the DJ can read. Each one parses with nothing left over (checked in
 * `sessionPresetData.test.ts`); words the parser does not know yet, such as
 * activities ("for cooking"), stay out until it reads them.
 */
export const SESSION_PROMPT_EXAMPLES: readonly string[] = [
  "Warm deep house around 122 BPM",
  "Afrobeat around 110 BPM, chill",
  "Late night jazz, low energy",
  "Hip-hop, high energy",
  "Club, around 124 BPM",
];
