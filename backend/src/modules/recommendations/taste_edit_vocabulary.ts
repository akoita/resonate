/**
 * Vocabulary for the deterministic taste-edit parser (#1961, ADR-TE-5).
 *
 * The backend has no single canonical genre or mood list: catalog genres are
 * free text chosen by artists at upload, with the upload form's suggestion list
 * (`web/src/lib/catalogVocabulary.ts`: `CATALOG_GENRE_OPTIONS`,
 * `MOOD_TAG_OPTIONS`) as the de-facto vocabulary. This file mirrors that list so the parser proposes only values a
 * listener can actually meet in the catalog. Keep it in step with the upload
 * form when genres or mood tags are added there (tracked as a follow-up to move
 * both onto one shared list).
 *
 * Pure data. No imports, no I/O.
 */

/** Catalog genres, as offered by the artist upload form. */
export const TASTE_EDIT_GENRES: readonly string[] = [
  "Acid House",
  "Acid Jazz",
  "Acoustic",
  "Afro-Pop",
  "Afrobeat",
  "Amapiano",
  "Alternative",
  "Ambient",
  "Americana",
  "Baile Funk",
  "Big Room",
  "Bluegrass",
  "Blues",
  "Bossa Nova",
  "Breakbeat",
  "Classical",
  "Country",
  "Dance",
  "Dancehall",
  "Deep House",
  "Disco",
  "Drill",
  "Drum & Bass",
  "Dub",
  "Dubstep",
  "EDM",
  "Electronic",
  "Electro",
  "Experimental",
  "Folk",
  "Funk",
  "Future Bass",
  "Future House",
  "Garage",
  "Glitch",
  "Gospel",
  "Grime",
  "Hardcore",
  "Hardstyle",
  "Heavy Metal",
  "Hip-Hop",
  "House",
  "Hyperpop",
  "IDM",
  "Indie",
  "Industrial",
  "J-Pop",
  "Jazz",
  "Jungle",
  "K-Pop",
  "Kuduro",
  "Latin",
  "Lo-Fi",
  "Melodic Techno",
  "Metal",
  "Minimal",
  "Musiques du monde",
  "New Age",
  "Nu-Disco",
  "Opera",
  "Phonk",
  "Pop",
  "Post-Punk",
  "Psytrance",
  "Psych-Rock",
  "Punk",
  "R&B",
  "Rap",
  "Reggae",
  "Reggaeton",
  "Rock",
  "Ska",
  "Slap House",
  "Soul",
  "Soulful House",
  "Synthpop",
  "Synthwave",
  "Tech House",
  "Techno",
  "Trance",
  "Trap",
  "Trip-Hop",
  "Tropical House",
  "UK Garage",
  "Vaporwave",
  "World",
];

/**
 * Common spellings that map onto a catalog genre above. Keys are lowercase
 * phrases as a listener would type them; values must be entries of
 * `TASTE_EDIT_GENRES`.
 */
export const TASTE_EDIT_GENRE_ALIASES: Readonly<Record<string, string>> = {
  "hip hop": "Hip-Hop",
  hiphop: "Hip-Hop",
  lofi: "Lo-Fi",
  "lo fi": "Lo-Fi",
  rnb: "R&B",
  "r and b": "R&B",
  "rhythm and blues": "R&B",
  dnb: "Drum & Bass",
  "drum and bass": "Drum & Bass",
  "drum n bass": "Drum & Bass",
  "drum'n'bass": "Drum & Bass",
  afrobeats: "Afrobeat",
  electronica: "Electronic",
  "synth pop": "Synthpop",
  "synth wave": "Synthwave",
  "trip hop": "Trip-Hop",
  "k pop": "K-Pop",
  "j pop": "J-Pop",
  "heavy metal": "Heavy Metal",
  "uk drill": "Drill",
  "trap music": "Trap",
};

/**
 * Mood tags, as offered by the artist upload form. "Chill" is deliberately not
 * a mood here: listeners who ask for something chill are describing energy, so
 * it maps to the energy preference (ADR-TE-5 design decision 3).
 */
export const TASTE_EDIT_MOODS: readonly string[] = [
  "Focus",
  "Hype",
  "Dark",
  "Zen",
  "Club",
  "Late Night",
  "Warm",
];

/** Words that map to a mood, lowercase. */
export const TASTE_EDIT_MOOD_ALIASES: Readonly<Record<string, string>> = {
  focus: "Focus",
  study: "Focus",
  studying: "Focus",
  hype: "Hype",
  hyped: "Hype",
  dark: "Dark",
  darker: "Dark",
  zen: "Zen",
  club: "Club",
  "late night": "Late Night",
  "late-night": "Late Night",
  warm: "Warm",
  warmer: "Warm",
};

/**
 * Instrument and production words. A clause that mentions one of these (and no
 * genre) becomes a written preference: it is kept and shown, not dropped, but
 * the catalog has no instrument signal to rank on yet.
 */
export const TASTE_EDIT_INSTRUMENT_WORDS: readonly string[] = [
  "live instruments",
  "live instrument",
  "live band",
  "live bands",
  "live music",
  "instrumental",
  "instrumentals",
  "instruments",
  "instrument",
  "guitar",
  "guitars",
  "piano",
  "drums",
  "drummer",
  "violin",
  "cello",
  "saxophone",
  "sax",
  "trumpet",
  "brass",
  "horns",
  "strings",
  "synths",
  "synth",
  "keys",
  "vocals",
  "vocal",
  "choir",
  "orchestra",
  "autotune",
  "auto-tune",
];

/** Words that express a wish for higher energy. */
export const TASTE_EDIT_HIGH_ENERGY_WORDS: readonly string[] = [
  "energetic",
  "energy",
  "upbeat",
  "high energy",
  "high-energy",
  "intense",
  "faster",
  "harder",
  "pumped",
  "lively",
  "punchy",
];

/** Words that express a wish for lower energy. */
export const TASTE_EDIT_LOW_ENERGY_WORDS: readonly string[] = [
  "calm",
  "calmer",
  "calming",
  "chill",
  "chilled",
  "relaxed",
  "relaxing",
  "mellow",
  "slower",
  "quieter",
  "softer",
  "gentle",
  "laid back",
  "laid-back",
  "low energy",
  "low-energy",
  "sleepy",
  "soothing",
];

export const TASTE_EDIT_MEDIUM_ENERGY_WORDS: readonly string[] = [
  "medium energy",
  "medium-energy",
  "mid-tempo",
  "mid tempo",
  "moderate",
];
