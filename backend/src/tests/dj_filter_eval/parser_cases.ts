/**
 * Stage A of the AI DJ filter-adherence eval: sentences a listener types and
 * the filters they MEANT. Every expectation is written by hand from what a
 * listener means, never copied from a parser run; where a phrase is open to
 * more than one reasonable reading, `note` says which one was chosen and why.
 *
 * Genre and mood spellings use the canonical vocabulary of the session parser
 * (`taste_edit_vocabulary.ts`); the grader compares them case-insensitively.
 * "Chill" is deliberately energy, not a mood, in that vocabulary.
 *
 * Tests only. Imports nothing, so the cases cannot drift toward the parser.
 */

export type ParserCaseGroup =
  | "starter"
  | "single"
  | "combo"
  | "alias"
  | "typo"
  | "french"
  | "artist"
  | "noise";

export type ExpectedEnergy = "low" | "medium" | "high" | null;
export type ExpectedTempo = { min: number | null; max: number | null } | null;

export interface ParserExpectation {
  genres: string[];
  moods: string[];
  energy: ExpectedEnergy;
  bpm: ExpectedTempo;
  artists?: string[];
}

export interface ParserCase {
  id: string;
  group: ParserCaseGroup;
  text: string;
  expect: ParserExpectation;
  note?: string;
}

const NONE: ParserExpectation = { genres: [], moods: [], energy: null, bpm: null };

function want(partial: Partial<ParserExpectation>): ParserExpectation {
  return { ...NONE, ...partial };
}

/**
 * Starters, copied from `web/src/components/agent/sessionPresetData.ts`
 * (`SESSION_PRESETS`; the backend cannot import web). The `sentence` and
 * `request` there are documented as "the DJ's parser reads it with nothing left
 * over", so a starter that does not read as its documented request is a
 * product bug. A "Around 124 BPM" starter is documented as 121..127.
 */
const STARTERS: ParserCase[] = [
  { id: "starter-focus", group: "starter", text: "Focus, low energy", expect: want({ moods: ["Focus"], energy: "low" }) },
  { id: "starter-hype", group: "starter", text: "High energy, hype", expect: want({ moods: ["Hype"], energy: "high" }) },
  {
    id: "starter-chill",
    group: "starter",
    text: "Chill, mellow",
    expect: want({ energy: "low" }),
    note: "Documented chips: no mood chip, because chill means low energy.",
  },
  { id: "starter-dark", group: "starter", text: "Dark, high energy", expect: want({ moods: ["Dark"], energy: "high" }) },
  { id: "starter-zen", group: "starter", text: "Zen, relaxed", expect: want({ moods: ["Zen"], energy: "low" }) },
  {
    id: "starter-club",
    group: "starter",
    text: "Club, high energy, around 124 BPM",
    expect: want({ moods: ["Club"], energy: "high", bpm: { min: 121, max: 127 } }),
  },
  { id: "starter-late-night", group: "starter", text: "Late night, low energy", expect: want({ moods: ["Late Night"], energy: "low" }) },
  { id: "starter-warm", group: "starter", text: "Warm, relaxed", expect: want({ moods: ["Warm"], energy: "low" }) },
  {
    id: "starter-hip-hop",
    group: "starter",
    text: "Hip-hop, rap, trap",
    expect: want({ genres: ["Hip-Hop", "Rap", "Trap"] }),
  },
  { id: "starter-rnb", group: "starter", text: "R&B, soul, funk", expect: want({ genres: ["R&B", "Soul", "Funk"] }) },
  { id: "starter-pop", group: "starter", text: "Pop, dance, synthpop", expect: want({ genres: ["Pop", "Dance", "Synthpop"] }) },
  {
    id: "starter-afrobeats",
    group: "starter",
    text: "Afrobeat, Afro-pop, amapiano",
    expect: want({ genres: ["Afrobeat", "Afro-Pop", "Amapiano"] }),
  },
  { id: "starter-reggae", group: "starter", text: "Reggae, dancehall, dub", expect: want({ genres: ["Reggae", "Dancehall", "Dub"] }) },
  { id: "starter-latin", group: "starter", text: "Latin, reggaeton", expect: want({ genres: ["Latin", "Reggaeton"] }) },
  { id: "starter-world", group: "starter", text: "World, musiques du monde", expect: want({ genres: ["World", "Musiques du monde"] }) },
  {
    id: "starter-electronic",
    group: "starter",
    text: "Electronic, house, techno",
    expect: want({ genres: ["Electronic", "House", "Techno"] }),
  },
  { id: "starter-jazz", group: "starter", text: "Jazz", expect: want({ genres: ["Jazz"] }) },
  { id: "starter-rock", group: "starter", text: "Rock, indie", expect: want({ genres: ["Rock", "Indie"] }) },
  { id: "starter-ambient", group: "starter", text: "Ambient, lo-fi", expect: want({ genres: ["Ambient", "Lo-Fi"] }) },
  { id: "starter-classical", group: "starter", text: "Classical", expect: want({ genres: ["Classical"] }) },
];

const SINGLES: ParserCase[] = [
  {
    id: "single-afrobeat-110-chill",
    group: "single",
    text: "Afrobeat around 110 BPM, chill",
    expect: want({ genres: ["Afrobeat"], energy: "low", bpm: { min: 107, max: 113 } }),
    note: "The screenshot sentence. Around 110 means about 107..113, the same width the Club starter documents.",
  },
  { id: "single-techno", group: "single", text: "techno", expect: want({ genres: ["Techno"] }) },
  { id: "single-low-energy", group: "single", text: "low energy", expect: want({ energy: "low" }) },
  {
    id: "single-128-bpm",
    group: "single",
    text: "128 bpm",
    expect: want({ bpm: { min: 128, max: 128 } }),
    note: "An exact tempo; the grader allows 3 BPM either side of each bound.",
  },
  {
    id: "single-between-90-100",
    group: "single",
    text: "between 90 and 100 bpm",
    expect: want({ bpm: { min: 90, max: 100 } }),
  },
  { id: "single-dark", group: "single", text: "dark", expect: want({ moods: ["Dark"] }) },
];

const COMBOS: ParserCase[] = [
  {
    id: "combo-warm-deep-house-122",
    group: "combo",
    text: "warm deep house around 122 BPM",
    expect: want({ genres: ["Deep House"], moods: ["Warm"], bpm: { min: 119, max: 125 } }),
  },
  {
    id: "combo-hip-hop-chill",
    group: "combo",
    text: "hip-hop but chill",
    expect: want({ genres: ["Hip-Hop"], energy: "low" }),
  },
  {
    id: "combo-jazz-late-night",
    group: "combo",
    text: "jazz for late night",
    expect: want({ genres: ["Jazz"], moods: ["Late Night"] }),
  },
  {
    id: "combo-dnb-high-energy",
    group: "combo",
    text: "dnb high energy",
    expect: want({ genres: ["Drum & Bass"], energy: "high" }),
  },
  {
    id: "combo-reggae-70-90",
    group: "combo",
    text: "reggae 70-90 bpm",
    expect: want({ genres: ["Reggae"], bpm: { min: 70, max: 90 } }),
  },
];

const ALIASES: ParserCase[] = [
  { id: "alias-hiphop", group: "alias", text: "hiphop", expect: want({ genres: ["Hip-Hop"] }) },
  { id: "alias-lofi", group: "alias", text: "lofi", expect: want({ genres: ["Lo-Fi"] }) },
  { id: "alias-rnb", group: "alias", text: "rnb", expect: want({ genres: ["R&B"] }) },
  { id: "alias-drum-and-bass", group: "alias", text: "drum and bass", expect: want({ genres: ["Drum & Bass"] }) },
  { id: "alias-afrobeats", group: "alias", text: "afrobeats", expect: want({ genres: ["Afrobeat"] }) },
  { id: "alias-electronica", group: "alias", text: "electronica", expect: want({ genres: ["Electronic"] }) },
];

const TYPOS: ParserCase[] = [
  { id: "typo-hip-hpo", group: "typo", text: "hip hpo", expect: want({ genres: ["Hip-Hop"] }) },
  { id: "typo-afrobaet", group: "typo", text: "afrobaet", expect: want({ genres: ["Afrobeat"] }) },
  { id: "typo-techo", group: "typo", text: "techo", expect: want({ genres: ["Techno"] }) },
  { id: "typo-classicl", group: "typo", text: "classicl", expect: want({ genres: ["Classical"] }) },
];

const FRENCH: ParserCase[] = [
  { id: "french-rap-francais", group: "french", text: "rap français", expect: want({ genres: ["Rap"] }) },
  {
    id: "french-classique-calme",
    group: "french",
    text: "musique classique calme",
    expect: want({ genres: ["Classical"], energy: "low" }),
  },
  {
    id: "french-musiques-du-monde",
    group: "french",
    text: "musiques du monde",
    expect: want({ genres: ["Musiques du monde"] }),
    note: "Vocabulary spelling. A parser answering World alone means the same thing to a listener but is graded as a miss.",
  },
  {
    id: "french-electro-danser",
    group: "french",
    text: "électro pour danser",
    expect: want({ genres: ["Electronic"], moods: ["Club"] }),
    note: "Electro for dancing: electronic music in the Club mood. No energy or tempo is implied.",
  },
  {
    id: "french-quelque-chose-calme",
    group: "french",
    text: "quelque chose de calme",
    expect: want({ energy: "low" }),
  },
];

const NATURAL: ParserCase[] = [
  {
    id: "combo-calm-to-read",
    group: "combo",
    text: "something calm to read",
    expect: want({ moods: ["Focus"], energy: "low" }),
    note: "Calm means low energy; reading is a concentration activity, so Focus is the mood the listener means.",
  },
  {
    id: "combo-music-to-focus",
    group: "combo",
    text: "music to focus",
    expect: want({ moods: ["Focus"] }),
  },
  {
    id: "combo-zen-relaxed",
    group: "combo",
    text: "zen relaxed",
    expect: want({ moods: ["Zen"], energy: "low" }),
    note: "The Zen starter without its comma.",
  },
  {
    id: "combo-pump-me-up-gym",
    group: "combo",
    text: "pump me up for the gym",
    expect: want({ moods: ["Hype"], energy: "high" }),
    note: "Pump me up is Hype and high energy.",
  },
  {
    id: "combo-relaxing-evening",
    group: "combo",
    text: "relaxing evening",
    expect: want({ energy: "low" }),
    note: "Relaxing is low energy. Evening is not a catalog mood, so no mood is expected.",
  },
  {
    id: "combo-party",
    group: "combo",
    text: "party",
    expect: want({ moods: ["Club"], energy: "high" }),
    note: "Party means a dance-floor, high-energy session: Club mood, high energy.",
  },
];

const ARTISTS: ParserCase[] = [
  {
    id: "artist-like",
    group: "artist",
    text: "like Mila Ortega",
    expect: want({ artists: ["Mila Ortega"] }),
    note: "Artist from GOLDEN_CATALOG (dj_retrieval_golden/fixtures.ts). Naming an artist sets no genre.",
  },
  {
    id: "artist-more-lowercase",
    group: "artist",
    text: "more dana whitfield",
    expect: want({ artists: ["Dana Whitfield"] }),
  },
  {
    id: "artist-style",
    group: "artist",
    text: "Marcus Bell-style",
    expect: want({ artists: ["Marcus Bell"] }),
  },
];

const NOISE: ParserCase[] = [
  {
    id: "noise-for-cooking",
    group: "noise",
    text: "for cooking",
    expect: want({}),
    note: "An activity the vocabulary does not know: the right reading is no filter at all, not a wrong one.",
  },
  { id: "noise-asdf", group: "noise", text: "asdf", expect: want({}) },
];

export const PARSER_CASES: readonly ParserCase[] = [
  ...STARTERS,
  ...SINGLES,
  ...COMBOS,
  ...NATURAL,
  ...ALIASES,
  ...TYPOS,
  ...FRENCH,
  ...ARTISTS,
  ...NOISE,
];
