/**
 * AI DJ filter-adherence eval: the generated request matrix
 * (docs/engineering/ai-dj-filter-adherence-evals.md).
 *
 * Every case is a request a listener makes, the listener profile it runs under,
 * and an INTENT: what the listener meant, written by hand. The intent is never
 * derived from the parser, so a parser misread shows up here as a selection
 * failure too. Groups:
 *
 *  - moments   the eight Moments starters, as the tapped starter sends them
 *  - sounds    the twelve Sounds starters
 *  - single    one filter at a time (energy, tempo, explicit)
 *  - combo     two or three filters in one sentence
 *  - typed     typos, aliases, French, loose phrasing
 *  - artist    "like <artist>", lower case, one-letter typo
 *  - unmet     requests the catalog cannot meet
 *  - discovery the Discovery control (New, Familiar) on three cases
 */
import type { EvalEnergy, EvalFamily, Moment } from "./catalog";
import type { Intent } from "./grader";

export type EvalProfileName = "fresh" | "conflicting" | "aligned";
export type EvalGroup = "moments" | "sounds" | "single" | "combo" | "typed" | "artist" | "unmet" | "discovery";

/** A listener's saved taste, as the preference assembly reads it. */
export interface ListenerProfile {
  /** `AgentConfig.vibes`. */
  vibes: string[];
  /** The taste profile's `favoredGenres`. */
  favoredGenres: string[];
  /** The taste profile's `genreWeights`, keyed by the genres tracks carry. */
  genreWeights: Record<string, number>;
}

/** The filters of a request, as the web's chips and `AgentSessionRequest` carry them. */
export interface RequestFilters {
  genres: string[];
  moods: string[];
  energy: EvalEnergy | null;
  bpm: { min: number | null; max: number | null } | null;
}

/**
 * A starter the listener tapped. Copied from
 * web/src/components/agent/sessionPresetData.ts (the backend cannot import web).
 * A tapped starter sends its preset's own request and intent, not a parsed sentence.
 */
export interface StarterRef {
  intent: string;
  name: string;
  queueStyle: string;
  /** The preset's `preferences.mood` (a Moments starter only). */
  mood?: string;
  /** The preset's `request`; absent for a Sounds starter, whose request is its genres. */
  request?: RequestFilters;
}

export type EvalRequest =
  | {
      kind: "structured";
      genres?: string[];
      moods?: string[];
      energy?: EvalEnergy;
      bpm?: { min: number; max: number };
      /** The listener's saved explicit choice; the default is off. */
      allowExplicit?: boolean;
      discovery?: "familiar" | "mixed" | "new";
      artists?: string[];
      starter?: StarterRef;
    }
  | {
      kind: "text";
      text: string;
      allowExplicit?: boolean;
      discovery?: "familiar" | "mixed" | "new";
      /** When the sentence is a Moments starter's own, the starter that sends it. */
      starter?: StarterRef;
    };

export interface EvalCase {
  id: string;
  group: EvalGroup;
  profile: EvalProfileName;
  request: EvalRequest;
  /** What the listener meant. */
  intent: Intent;
  /** Genres the `aligned` profile saves, when they cannot be read off the intent. */
  alignedGenres?: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** The schema default for a fresh listener (`AgentConfig.vibes`, backend/prisma/schema.prisma). */
export const DEFAULT_VIBES = ["Focus"];

const FAMILY_GENRE: Record<EvalFamily, string> = {
  hiphop: "Hip-Hop",
  rnb: "R&B",
  pop: "Pop",
  afro: "Afrobeat",
  reggae: "Reggae",
  latin: "Latin",
  world: "World",
  electronic: "Electronic",
  jazz: "Jazz",
  rock: "Rock",
  ambient: "Ambient",
  classical: "Classical",
  country: "Country",
};

/** Families whose music fits each moment: what an aligned listener has saved for a genre-less request. */
const MOMENT_FAMILIES: Record<Moment, EvalFamily[]> = {
  Focus: ["ambient", "classical", "jazz"],
  Hype: ["hiphop", "electronic"],
  Chill: ["ambient", "jazz", "rnb"],
  Dark: ["electronic", "hiphop"],
  Zen: ["ambient", "classical"],
  Club: ["electronic", "pop"],
  "Late Night": ["jazz", "rnb"],
  Warm: ["rnb", "reggae"],
};

const ENERGY_FAMILIES: Record<EvalEnergy, EvalFamily[]> = {
  low: ["ambient", "classical"],
  medium: ["pop", "afro"],
  high: ["electronic", "rock"],
};

function alignedGenresFor(evalCase: EvalCase): string[] {
  if (evalCase.alignedGenres) return evalCase.alignedGenres;
  const { intent } = evalCase;
  let families: EvalFamily[] = [];
  if (intent.families?.length) families = intent.families;
  else if (intent.moment) families = MOMENT_FAMILIES[intent.moment];
  else if (intent.energy) families = ENERGY_FAMILIES[intent.energy];
  else if (intent.bpm) {
    families =
      intent.bpm.max < 95 ? ["reggae", "rnb"] : intent.bpm.max <= 115 ? ["afro", "pop"] : intent.bpm.max <= 130 ? ["electronic", "pop"] : ["rock", "hiphop"];
  } else families = ["pop"];
  return families.map((family) => FAMILY_GENRE[family]);
}

/**
 * The listener behind a case.
 *  - fresh: the schema default vibes, no learned taste;
 *  - conflicting: saved vibes and learned favourites that are NOT what the
 *    request asks for (a rap listener asking for Zen);
 *  - aligned: vibes and learned favourites equal to what the request asks for.
 */
export function profileFor(evalCase: EvalCase): ListenerProfile {
  switch (evalCase.profile) {
    case "fresh":
      return { vibes: [...DEFAULT_VIBES], favoredGenres: [], genreWeights: {} };
    case "conflicting":
      return {
        vibes: ["Pop", "Hip-Hop", "World"],
        favoredGenres: ["Hip-Hop", "Rap"],
        // Keyed like the genres tracks carry: the listener has played rap tagged several ways.
        genreWeights: { "Hip-Hop": 8, Rap: 6, Trap: 5, "Hip Hop/Rap": 5, "Rap FR": 4 },
      };
    case "aligned": {
      const genres = alignedGenresFor(evalCase);
      return {
        vibes: [...genres],
        favoredGenres: [...genres],
        genreWeights: Object.fromEntries(genres.map((genre) => [genre, 6])),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Case builders
// ---------------------------------------------------------------------------

const PROFILES: EvalProfileName[] = ["fresh", "conflicting", "aligned"];
const FRESH_AND_CONFLICTING: EvalProfileName[] = ["fresh", "conflicting"];

function across(
  profiles: readonly EvalProfileName[],
  base: Omit<EvalCase, "id" | "profile"> & { slug: string },
): EvalCase[] {
  const { slug, ...rest } = base;
  return profiles.map((profile) => ({ ...rest, id: `${slug}@${profile}`, profile }));
}

// (a) Moments starters: web/src/components/agent/sessionPresetData.ts, SESSION_PRESETS (group "mood").
const MOMENTS: Array<{
  slug: string;
  starter: StarterRef;
  sentence: string;
  intent: Intent;
}> = [
  {
    slug: "moment-focus",
    sentence: "Focus, low energy",
    starter: { intent: "Focus", name: "Focus", queueStyle: "Stable pacing", mood: "Focus", request: { genres: [], moods: ["Focus"], energy: "low", bpm: null } },
    intent: { moment: "Focus", energy: "low", explicitAllowed: false },
  },
  {
    slug: "moment-hype",
    sentence: "High energy, hype",
    starter: { intent: "Hype", name: "High energy", queueStyle: "Fast cuts", mood: "Hype", request: { genres: [], moods: ["Hype"], energy: "high", bpm: null } },
    intent: { moment: "Hype", energy: "high", explicitAllowed: false },
  },
  {
    slug: "moment-chill",
    sentence: "Chill, mellow",
    // The parser reads "chill" as energy, so the chips carry no mood; the preset still sends the mood.
    starter: { intent: "Chill", name: "Chill", queueStyle: "Soft transitions", mood: "Chill", request: { genres: [], moods: [], energy: "low", bpm: null } },
    intent: { moment: "Chill", energy: "low", explicitAllowed: false },
  },
  {
    slug: "moment-dark",
    sentence: "Dark, high energy",
    starter: { intent: "Dark", name: "Dark", queueStyle: "Tension build", mood: "Dark", request: { genres: [], moods: ["Dark"], energy: "high", bpm: null } },
    intent: { moment: "Dark", energy: "high", explicitAllowed: false },
  },
  {
    slug: "moment-zen",
    sentence: "Zen, relaxed",
    starter: { intent: "Zen", name: "Calm", queueStyle: "Long blends", mood: "Zen", request: { genres: [], moods: ["Zen"], energy: "low", bpm: null } },
    intent: { moment: "Zen", energy: "low", explicitAllowed: false },
  },
  {
    slug: "moment-club",
    sentence: "Club, high energy, around 124 BPM",
    starter: { intent: "Club", name: "Club", queueStyle: "Steady groove", mood: "Club", request: { genres: [], moods: ["Club"], energy: "high", bpm: { min: 121, max: 127 } } },
    intent: { moment: "Club", energy: "high", bpm: { min: 121, max: 127 }, explicitAllowed: false },
  },
  {
    slug: "moment-late-night",
    sentence: "Late night, low energy",
    starter: { intent: "Late Night", name: "Late night", queueStyle: "Slow burn", mood: "Late Night", request: { genres: [], moods: ["Late Night"], energy: "low", bpm: null } },
    intent: { moment: "Late Night", energy: "low", explicitAllowed: false },
  },
  {
    slug: "moment-warm",
    sentence: "Warm, relaxed",
    starter: { intent: "Warm", name: "Warm", queueStyle: "Easy glow", mood: "Warm", request: { genres: [], moods: ["Warm"], energy: "low", bpm: null } },
    intent: { moment: "Warm", energy: "low", explicitAllowed: false },
  },
];

// (b) Sounds starters: same file, SESSION_PRESETS and EXTRA_SOUND_PRESETS (group "genre").
const SOUNDS: Array<{
  slug: string;
  starter: StarterRef;
  genres: string[];
  families: EvalFamily[];
}> = [
  { slug: "sound-hip-hop", starter: { intent: "Hip-Hop", name: "Hip-Hop & Rap", queueStyle: "Steady bounce" }, genres: ["Hip-Hop", "Rap", "Trap"], families: ["hiphop"] },
  { slug: "sound-rnb", starter: { intent: "R&B", name: "R&B & Soul", queueStyle: "Smooth blends" }, genres: ["R&B", "Soul", "Funk"], families: ["rnb"] },
  { slug: "sound-pop", starter: { intent: "Pop", name: "Pop Hits", queueStyle: "Hit after hit" }, genres: ["Pop", "Synthpop"], families: ["pop"] },
  { slug: "sound-afrobeats", starter: { intent: "Afrobeats", name: "Afrobeats & Amapiano", queueStyle: "Keep it moving" }, genres: ["Afrobeat", "Afro-Pop", "Amapiano"], families: ["afro"] },
  { slug: "sound-reggae", starter: { intent: "Reggae", name: "Reggae & Dancehall", queueStyle: "Easy rocking" }, genres: ["Reggae", "Dancehall", "Dub"], families: ["reggae"] },
  { slug: "sound-latin", starter: { intent: "Latin", name: "Latin & Reggaeton", queueStyle: "Party pace" }, genres: ["Latin", "Reggaeton"], families: ["latin"] },
  { slug: "sound-world", starter: { intent: "World", name: "World Music", queueStyle: "Wide journey" }, genres: ["World", "Musiques du monde"], families: ["world", "afro"] },
  { slug: "sound-electronic", starter: { intent: "Electronic", name: "Electronic", queueStyle: "Steady groove" }, genres: ["Electronic", "House", "Techno"], families: ["electronic"] },
  { slug: "sound-jazz", starter: { intent: "Jazz", name: "Jazz", queueStyle: "Easy swing" }, genres: ["Jazz"], families: ["jazz"] },
  { slug: "sound-rock", starter: { intent: "Rock", name: "Rock & Indie", queueStyle: "Loud and live" }, genres: ["Rock", "Indie"], families: ["rock"] },
  { slug: "sound-ambient", starter: { intent: "Ambient", name: "Ambient & Lo-fi", queueStyle: "Long blends" }, genres: ["Ambient", "Lo-Fi"], families: ["ambient"] },
  { slug: "sound-classical", starter: { intent: "Classical", name: "Classical", queueStyle: "Long blends" }, genres: ["Classical"], families: ["classical"] },
];

const MOMENT_CASES: EvalCase[] = MOMENTS.flatMap(({ slug, starter, sentence, intent }) =>
  across(PROFILES, { slug, group: "moments", request: { kind: "text", text: sentence, starter }, intent }),
);

const SOUND_CASES: EvalCase[] = SOUNDS.flatMap(({ slug, starter, genres, families }) =>
  across(PROFILES, {
    slug,
    group: "sounds",
    request: { kind: "structured", genres, starter },
    intent: { families, explicitAllowed: false },
  }),
);

// (c) Single filters, edited in the chips.
const SINGLE_CASES: EvalCase[] = [
  ...(["low", "medium", "high"] as const).flatMap((energy) =>
    across(FRESH_AND_CONFLICTING, {
      slug: `single-energy-${energy}`,
      group: "single",
      request: { kind: "structured", energy },
      intent: { energy, explicitAllowed: false },
    }),
  ),
  ...[
    { slug: "single-tempo-70-90", min: 70, max: 90 },
    { slug: "single-tempo-95-115", min: 95, max: 115 },
    { slug: "single-tempo-118-128", min: 118, max: 128 },
    { slug: "single-tempo-135-175", min: 135, max: 175 },
  ].flatMap(({ slug, min, max }) =>
    across(FRESH_AND_CONFLICTING, {
      slug,
      group: "single" as const,
      request: { kind: "structured", bpm: { min, max } },
      intent: { bpm: { min, max }, explicitAllowed: false },
    }),
  ),
  ...across(FRESH_AND_CONFLICTING, {
    slug: "single-hip-hop-explicit-off",
    group: "single",
    request: { kind: "structured", genres: ["Hip-Hop"], allowExplicit: false },
    intent: { families: ["hiphop"], explicitAllowed: false },
  }),
  ...across(FRESH_AND_CONFLICTING, {
    slug: "single-hip-hop-explicit-on",
    group: "single",
    request: { kind: "structured", genres: ["Hip-Hop"], allowExplicit: true },
    intent: { families: ["hiphop"], explicitAllowed: true },
  }),
];

// (d) Combinations, typed as one sentence.
const COMBOS: Array<{ slug: string; text: string; intent: Intent }> = [
  { slug: "combo-afrobeat-110-chill", text: "Afrobeat around 110 BPM, chill", intent: { families: ["afro"], moment: "Chill", bpm: { min: 105, max: 115 }, explicitAllowed: false } },
  { slug: "combo-hip-hop-low-energy", text: "hip-hop, low energy", intent: { families: ["hiphop"], energy: "low", explicitAllowed: false } },
  { slug: "combo-electronic-124", text: "electronic 124 BPM", intent: { families: ["electronic"], bpm: { min: 121, max: 127 }, explicitAllowed: false } },
  { slug: "combo-jazz-late-night", text: "jazz late night", intent: { families: ["jazz"], moment: "Late Night", explicitAllowed: false } },
  { slug: "combo-rock-high-energy", text: "rock high energy", intent: { families: ["rock"], energy: "high", explicitAllowed: false } },
  { slug: "combo-ambient-focus", text: "ambient focus", intent: { families: ["ambient"], moment: "Focus", explicitAllowed: false } },
  { slug: "combo-pop-warm", text: "pop warm", intent: { families: ["pop"], moment: "Warm", explicitAllowed: false } },
  { slug: "combo-reggae-70-90", text: "reggae 70-90 BPM", intent: { families: ["reggae"], bpm: { min: 70, max: 90 }, explicitAllowed: false } },
  { slug: "combo-dark-high-140", text: "dark, high energy, 140 bpm", intent: { moment: "Dark", energy: "high", bpm: { min: 137, max: 143 }, explicitAllowed: false } },
  { slug: "combo-latin-high-energy", text: "latin high energy", intent: { families: ["latin"], energy: "high", explicitAllowed: false } },
  { slug: "combo-classical-focus", text: "classical focus", intent: { families: ["classical"], moment: "Focus", explicitAllowed: false } },
  { slug: "combo-rnb-late-night", text: "r&b late night", intent: { families: ["rnb"], moment: "Late Night", explicitAllowed: false } },
  { slug: "combo-world-relaxed", text: "world music, relaxed", intent: { families: ["world", "afro"], energy: "low", explicitAllowed: false } },
  { slug: "combo-house-club-126", text: "house music, club, 126 BPM", intent: { families: ["electronic"], moment: "Club", bpm: { min: 123, max: 129 }, explicitAllowed: false } },
  { slug: "combo-hip-hop-hype-explicit-on", text: "hip-hop, hype", intent: { families: ["hiphop"], moment: "Hype", explicitAllowed: true } },
];

const COMBO_CASES: EvalCase[] = COMBOS.flatMap(({ slug, text, intent }) =>
  across(FRESH_AND_CONFLICTING, {
    slug,
    group: "combo",
    request: { kind: "text", text, ...(intent.explicitAllowed ? { allowExplicit: true } : {}) },
    intent,
  }),
);

// (e) Typed sentence variants: typos, aliases, French, loose phrasing. Mostly the conflicting listener.
const TYPED: Array<{ slug: string; text: string; intent: Intent; profile?: EvalProfileName }> = [
  { slug: "typed-zen-relaxed", text: "zen relaxed", intent: { moment: "Zen", energy: "low", explicitAllowed: false } },
  { slug: "typed-calm-to-read", text: "something calm to read", intent: { energy: "low", explicitAllowed: false } },
  { slug: "typed-rap-francais", text: "rap français", intent: { families: ["hiphop"], explicitAllowed: false } },
  { slug: "typed-afrobeats-chill", text: "afrobeats chill", intent: { families: ["afro"], moment: "Chill", explicitAllowed: false } },
  { slug: "typed-lofi-study", text: "lofi beats to study", intent: { families: ["ambient"], moment: "Focus", explicitAllowed: false } },
  { slug: "typed-hiphop", text: "hiphop", intent: { families: ["hiphop"], explicitAllowed: false } },
  { slug: "typed-techno-128", text: "techno 128", intent: { families: ["electronic"], bpm: { min: 125, max: 131 }, explicitAllowed: false } },
  { slug: "typed-classique-calme", text: "musique classique calme", intent: { families: ["classical"], energy: "low", explicitAllowed: false } },
  { slug: "typed-dnb-high-energy", text: "dnb high energy", intent: { families: ["electronic"], energy: "high", explicitAllowed: false } },
  { slug: "typed-rnb-slow-jams", text: "r&b slow jams late night", intent: { families: ["rnb"], moment: "Late Night", explicitAllowed: false } },
  { slug: "typed-trap", text: "trap", intent: { families: ["hiphop"], explicitAllowed: false } },
  { slug: "typed-chill-vibes", text: "chill out vibes", intent: { moment: "Chill", explicitAllowed: false } },
  { slug: "typed-workout", text: "high energy workout", intent: { energy: "high", moment: "Hype", explicitAllowed: false } },
  { slug: "typed-jazzy-dinner", text: "jazzy dinner music", intent: { families: ["jazz"], moment: "Warm", explicitAllowed: false } },
  { slug: "typed-dancehall", text: "dancehall bangers", intent: { families: ["reggae"], energy: "high", explicitAllowed: false } },
  { slug: "typed-sad-slow", text: "slow sad songs late night", intent: { moment: "Late Night", energy: "low", explicitAllowed: false } },
  { slug: "typed-reggaeton-party", text: "reggaeton party", intent: { families: ["latin"], energy: "high", explicitAllowed: false } },
  { slug: "typed-metal", text: "metal", intent: { families: ["rock"], explicitAllowed: false } },
  { slug: "typed-ambiant-typo", text: "ambiant calme", intent: { families: ["ambient"], energy: "low", explicitAllowed: false } },
  { slug: "typed-electro-dark-130", text: "electro dark 130bpm", intent: { families: ["electronic"], moment: "Dark", bpm: { min: 127, max: 133 }, explicitAllowed: false } },
  { slug: "typed-focus-coding", text: "focus music for coding", intent: { moment: "Focus", explicitAllowed: false } },
  { slug: "typed-zen-fresh", text: "zen, relaxed", intent: { moment: "Zen", energy: "low", explicitAllowed: false }, profile: "fresh" },
];

const TYPED_CASES: EvalCase[] = TYPED.flatMap(({ slug, text, intent, profile }) =>
  across([profile ?? "conflicting"], { slug, group: "typed", request: { kind: "text", text }, intent }),
);

// (f) Named artists: each has three or more tracks, and listed similar artists.
const ARTIST_CASES: EvalCase[] = [
  ...across(["conflicting"], {
    slug: "artist-like-tavi-lindqvist",
    group: "artist",
    request: { kind: "text", text: "like Tavi Lindqvist" },
    intent: { artist: "Tavi Lindqvist", explicitAllowed: false },
    alignedGenres: ["Electronic", "House", "Techno"],
  }),
  ...across(["fresh", "conflicting"], {
    slug: "artist-more-lowercase",
    group: "artist",
    request: { kind: "text", text: "more isadora penhallow" },
    intent: { artist: "Isadora Penhallow", explicitAllowed: false },
    alignedGenres: ["Jazz"],
  }),
  ...across(["conflicting"], {
    slug: "artist-typo-quilfeather",
    group: "artist",
    request: { kind: "text", text: "like Mara Quilfeather" },
    intent: { artist: "Mara Quillfeather", explicitAllowed: false },
    alignedGenres: ["Pop"],
  }),
];

// (g) Requests the catalog cannot meet: the system should say so, not fill silently.
const UNMET_CASES: EvalCase[] = [
  ...across(FRESH_AND_CONFLICTING, {
    slug: "unmet-country",
    group: "unmet",
    request: { kind: "structured", genres: ["Country"] },
    intent: { families: ["country"], explicitAllowed: false },
  }),
  ...across(["conflicting"], {
    slug: "unmet-classical-high-170",
    group: "unmet",
    request: { kind: "text", text: "classical high energy 170 bpm" },
    intent: { families: ["classical"], energy: "high", bpm: { min: 167, max: 173 }, explicitAllowed: false },
  }),
  ...across(["conflicting"], {
    slug: "unmet-zen-drill",
    group: "unmet",
    request: { kind: "text", text: "zen drill" },
    intent: { families: ["hiphop"], moment: "Zen", explicitAllowed: false },
  }),
];

// (h) The Discovery control.
const DISCOVERY_CASES: EvalCase[] = [
  ...across(["conflicting"], {
    slug: "discovery-new-hip-hop",
    group: "discovery",
    request: { kind: "structured", genres: ["Hip-Hop", "Rap", "Trap"], discovery: "new", starter: SOUNDS[0].starter },
    intent: { families: ["hiphop"], explicitAllowed: false },
  }),
  ...across(["conflicting"], {
    slug: "discovery-familiar-zen",
    group: "discovery",
    request: { kind: "text", text: "Zen, relaxed", discovery: "familiar", starter: MOMENTS[4].starter },
    intent: MOMENTS[4].intent,
  }),
  ...across(["fresh"], {
    slug: "discovery-new-jazz",
    group: "discovery",
    request: { kind: "structured", genres: ["Jazz"], discovery: "new", starter: SOUNDS[8].starter },
    intent: { families: ["jazz"], explicitAllowed: false },
  }),
];

export const EVAL_CASES: readonly EvalCase[] = [
  ...MOMENT_CASES,
  ...SOUND_CASES,
  ...SINGLE_CASES,
  ...COMBO_CASES,
  ...TYPED_CASES,
  ...ARTIST_CASES,
  ...UNMET_CASES,
  ...DISCOVERY_CASES,
];
