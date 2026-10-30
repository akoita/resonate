/**
 * AI DJ filter-adherence eval (docs/engineering/ai-dj-filter-adherence-evals.md):
 * the two-layer fixture catalog. Tests only; nothing here is shipped code.
 *
 * Every invented track has
 *  - a TRUTH layer (`truth`): the genre family, energy band, BPM, the moments it
 *    fits and whether it is explicit, labelled by hand. Only the grader reads it;
 *  - an OBSERVED layer (`observed`): what the system sees, a `GoldenTrack` so the
 *    golden harness's in-memory catalog tools run over it unchanged. It is made as
 *    sparse and messy as a real catalog: free-text genres ("Hip Hop/Rap", "Rap FR"),
 *    vague or missing genres, mood tags on a minority of tracks, measured audio
 *    features on about half.
 *
 * Off-filter picks in production come from exactly this gap: an untagged,
 * unmeasured rap track looks neutral to the selector, while a listener hears it
 * as the opposite of "Zen". The sparsity ratios are ASSUMPTIONS, declared in
 * {@link DECLARED_SPARSITY} and asserted by the spec.
 *
 * All titles and artists are invented. Rows are written out explicitly: no
 * randomness, so the catalog and every number derived from it is reproducible.
 */
import type { GoldenTrack } from "../dj_retrieval_golden/fixtures";

export type EvalFamily =
  | "hiphop"
  | "rnb"
  | "pop"
  | "afro"
  | "reggae"
  | "latin"
  | "world"
  | "electronic"
  | "jazz"
  | "rock"
  | "ambient"
  | "classical"
  /** Has no fixture tracks at all: the family an unmet request asks for. */
  | "country";

/** The families the fixture holds tracks for (about ten each). */
export const EVAL_FAMILIES: readonly EvalFamily[] = [
  "hiphop", "rnb", "pop", "afro", "reggae", "latin", "world", "electronic", "jazz", "rock", "ambient", "classical",
];

/** The Moments starters (web/src/components/agent/sessionPresetData.ts). */
export type Moment = "Focus" | "Hype" | "Chill" | "Dark" | "Zen" | "Club" | "Late Night" | "Warm";
export type EvalEnergy = "low" | "medium" | "high";

export interface TrackTruth {
  /** Credited artist (the same name the observed layer carries). */
  artist: string;
  family: EvalFamily;
  energy: EvalEnergy;
  bpm: number;
  /** The moments a listener would say this track suits. */
  fits: Moment[];
  explicit: boolean;
  /** Artists a listener asking for one of these would also be happy to hear this track for. */
  similarArtists?: string[];
}

export interface EvalTrack {
  observed: GoldenTrack;
  truth: TrackTruth;
}

/** Measured features that read back as each energy band under measured_track_features.ts (0.65*rms/0.3 + 0.35*onset/8). */
const MEASURED_BY_BAND: Record<EvalEnergy, { energyRms: number; onsetDensity: number }> = {
  low: { energyRms: 0.06, onsetDensity: 2 },
  medium: { energyRms: 0.15, onsetDensity: 4 },
  high: { energyRms: 0.24, onsetDensity: 6.5 },
};

type TruthSpec = {
  f: EvalFamily;
  e: EvalEnergy;
  bpm: number;
  fits: Moment[];
  /** Explicit lyrics. */
  x?: true;
  sim?: string[];
};

type ObservedSpec = {
  /** Release genre as an uploader typed it; null = none. */
  g: string | null;
  /** Mood tags from the catalog vocabulary. */
  mood?: Moment[];
  /** Measured audio features exist (energy band and tempo agree with the truth). */
  meas?: true;
};

function row(key: string, title: string, artist: string, t: TruthSpec, o: ObservedSpec): EvalTrack {
  return {
    observed: {
      key,
      title,
      artist,
      genre: o.g,
      ...(o.mood ? { moods: o.mood } : {}),
      ...(t.x ? { explicit: true } : {}),
      ...(o.meas ? { measured: { ...MEASURED_BY_BAND[t.e], tempoBpm: t.bpm } } : {}),
    },
    truth: {
      artist,
      family: t.f,
      energy: t.e,
      bpm: t.bpm,
      fits: t.fits,
      explicit: t.x === true,
      ...(t.sim ? { similarArtists: t.sim } : {}),
    },
  };
}

// Hip-hop: mostly high energy (85-100 or 130-150 BPM trap), two chill/lo-fi rap tracks, about half explicit.
const HIPHOP: EvalTrack[] = [
  row("hh01", "Concrete Lullaby", "Kassim Orrel", { f: "hiphop", e: "high", bpm: 142, fits: ["Hype", "Dark"], x: true }, { g: "Trap", mood: ["Dark"], meas: true }),
  row("hh02", "Rooftop Verdict", "Kassim Orrel", { f: "hiphop", e: "high", bpm: 140, fits: ["Hype"], x: true }, { g: "Hip Hop/Rap", meas: true }),
  row("hh03", "Ledger of Ashes", "Kassim Orrel", { f: "hiphop", e: "high", bpm: 96, fits: ["Hype", "Dark"], x: true }, { g: null, meas: true }),
  row("hh04", "Lunchbreak Letters", "Tolu Ferreira", { f: "hiphop", e: "low", bpm: 86, fits: ["Chill", "Focus", "Late Night"] }, { g: "Lo-fi Hip Hop", meas: true }),
  row("hh05", "Backseat Metronome", "Tolu Ferreira", { f: "hiphop", e: "low", bpm: 88, fits: ["Chill", "Late Night", "Warm"] }, { g: null }),
  row("hh06", "Iron Cadence", "Vexa Brandt", { f: "hiphop", e: "high", bpm: 148, fits: ["Hype", "Dark", "Club"], x: true, sim: ["Kassim Orrel"] }, { g: "Rap FR", meas: true }),
  row("hh07", "Zone Nord", "Vexa Brandt", { f: "hiphop", e: "high", bpm: 92, fits: ["Hype"], sim: ["Kassim Orrel"] }, { g: null }),
  row("hh08", "Boulevard des Ombres", "Yacine Delmas", { f: "hiphop", e: "high", bpm: 134, fits: ["Dark", "Hype"], x: true, sim: ["Kassim Orrel"] }, { g: "Drill", mood: ["Dark"] }),
  row("hh09", "Sidewalk Ceremony", "Jinx Valdane", { f: "hiphop", e: "high", bpm: 98, fits: ["Hype"] }, { g: "Hip-Hop", meas: true }),
  row("hh10", "Gold Teeth Hymn", "Jinx Valdane", { f: "hiphop", e: "high", bpm: 88, fits: ["Hype"], x: true }, { g: "Urban" }),
];

// R&B and soul: mostly low and medium energy, slow.
const RNB: EvalTrack[] = [
  row("rb01", "Velvet Ultimatum", "Noor Castellane", { f: "rnb", e: "low", bpm: 68, fits: ["Late Night", "Warm", "Chill"] }, { g: "R&B", mood: ["Late Night"], meas: true }),
  row("rb02", "Slow Dial Tone", "Noor Castellane", { f: "rnb", e: "low", bpm: 72, fits: ["Late Night", "Warm"] }, { g: "Neo Soul", meas: true }),
  row("rb03", "Candle Math", "Noor Castellane", { f: "rnb", e: "medium", bpm: 84, fits: ["Warm", "Chill"] }, { g: "Soul", meas: true }),
  row("rb04", "Sunday Linen", "Deshawn Aubrey-Cole", { f: "rnb", e: "medium", bpm: 92, fits: ["Warm"] }, { g: "Soul", mood: ["Warm"] }),
  row("rb05", "Two Pillows", "Deshawn Aubrey-Cole", { f: "rnb", e: "low", bpm: 64, fits: ["Late Night", "Chill"] }, { g: null }),
  row("rb06", "Brass Knuckle Groove", "Lenny Okafor-Hale", { f: "rnb", e: "high", bpm: 108, fits: ["Hype", "Club"] }, { g: "Funk", meas: true }),
  row("rb07", "Honey in the Wires", "Lenny Okafor-Hale", { f: "rnb", e: "medium", bpm: 98, fits: ["Warm"] }, { g: "Other" }),
  row("rb08", "After Hours Phone", "Siri Kovacevic", { f: "rnb", e: "low", bpm: 70, fits: ["Late Night"] }, { g: null }),
  row("rb09", "Cashmere Argument", "Siri Kovacevic", { f: "rnb", e: "medium", bpm: 90, fits: ["Warm", "Late Night"], x: true }, { g: "R&B", meas: true }),
  row("rb10", "Porchlight Promise", "Tamsin Idowu", { f: "rnb", e: "low", bpm: 66, fits: ["Warm", "Chill", "Late Night"] }, { g: "Slow Jams", mood: ["Warm"] }),
];

// Pop: spread across energy, 70-130 BPM.
const POP: EvalTrack[] = [
  row("pp01", "Glitter Receipts", "Mara Quillfeather", { f: "pop", e: "high", bpm: 122, fits: ["Hype", "Club"] }, { g: "Dance Pop", meas: true }),
  row("pp02", "Ferris Wheel Feelings", "Mara Quillfeather", { f: "pop", e: "medium", bpm: 108, fits: ["Warm", "Hype"] }, { g: "Pop" }),
  row("pp03", "Paper Crowns", "Mara Quillfeather", { f: "pop", e: "medium", bpm: 100, fits: ["Warm"] }, { g: "Pop", meas: true }),
  row("pp04", "Satellite Heart", "Joss Whitlow", { f: "pop", e: "high", bpm: 126, fits: ["Hype", "Club"] }, { g: "Synth Pop", mood: ["Club"] }),
  row("pp05", "Last Train Chorus", "Joss Whitlow", { f: "pop", e: "medium", bpm: 96, fits: ["Warm", "Late Night"] }, { g: "Synthpop", meas: true }),
  row("pp06", "Lemonade Static", "Pip Ravensdale", { f: "pop", e: "high", bpm: 118, fits: ["Hype"] }, { g: "Indie Pop" }),
  row("pp07", "Whisper Karaoke", "Pip Ravensdale", { f: "pop", e: "low", bpm: 78, fits: ["Chill", "Warm", "Late Night"] }, { g: "Pop", meas: true }),
  row("pp08", "Cherry Bomb Weather", "Dalia Mirchandani", { f: "pop", e: "high", bpm: 130, fits: ["Hype", "Club"] }, { g: "Music" }),
  row("pp09", "Soft Launch", "Dalia Mirchandani", { f: "pop", e: "medium", bpm: 104, fits: ["Warm", "Focus"] }, { g: null }),
  row("pp10", "Goodnight Confetti", "Dalia Mirchandani", { f: "pop", e: "low", bpm: 72, fits: ["Chill", "Late Night", "Warm"] }, { g: "Pop", meas: true }),
];

// Afrobeat, Afro-pop, amapiano: 100-115 BPM, mixed energy.
const AFRO: EvalTrack[] = [
  row("af01", "Lagos Hour", "Ifeoma Danjuma", { f: "afro", e: "high", bpm: 108, fits: ["Hype", "Club", "Warm"] }, { g: "Afrobeats", mood: ["Club"], meas: true }),
  row("af02", "Sunset Mama Put", "Ifeoma Danjuma", { f: "afro", e: "medium", bpm: 102, fits: ["Warm", "Hype"] }, { g: "Afro" }),
  row("af03", "Gidigidi Rain", "Ifeoma Danjuma", { f: "afro", e: "medium", bpm: 110, fits: ["Warm"] }, { g: "Urban" }),
  row("af04", "Township Lights", "Sipho Dlamini-Reyes", { f: "afro", e: "high", bpm: 112, fits: ["Club", "Hype"] }, { g: "Amapiano", meas: true }),
  row("af05", "Piano Under Moonlight", "Sipho Dlamini-Reyes", { f: "afro", e: "low", bpm: 108, fits: ["Late Night", "Chill", "Warm"] }, { g: "Amapiano" }),
  row("af06", "Calabash Dreams", "Kwaku Tetteh-Moreau", { f: "afro", e: "medium", bpm: 104, fits: ["Warm"] }, { g: null }),
  row("af07", "Tropical Fever Dance", "Kwaku Tetteh-Moreau", { f: "afro", e: "high", bpm: 114, fits: ["Hype", "Club"] }, { g: "Afrobeats", mood: ["Hype"] }),
  row("af08", "Jollof Soundsystem", "Amara Lindgren-Okoye", { f: "afro", e: "high", bpm: 106, fits: ["Hype", "Warm", "Club"] }, { g: null, meas: true }),
  row("af09", "Slow Mango", "Amara Lindgren-Okoye", { f: "afro", e: "low", bpm: 100, fits: ["Chill", "Warm"] }, { g: "Musiques du monde" }),
  row("af10", "Harmattan Sway", "Amara Lindgren-Okoye", { f: "afro", e: "medium", bpm: 103, fits: ["Warm"] }, { g: "Afrobeat", meas: true }),
];

// Reggae, dancehall, dub: 70-100 BPM.
const REGGAE: EvalTrack[] = [
  row("rg01", "Yard Clock", "Marlowe Ricketts", { f: "reggae", e: "low", bpm: 74, fits: ["Chill", "Warm", "Late Night"] }, { g: "Reggae", mood: ["Warm"], meas: true }),
  row("rg02", "Mango Tree Council", "Marlowe Ricketts", { f: "reggae", e: "medium", bpm: 80, fits: ["Warm"] }, { g: "Roots Reggae" }),
  row("rg03", "Bassline Parliament", "Marlowe Ricketts", { f: "reggae", e: "low", bpm: 70, fits: ["Chill", "Late Night"] }, { g: "Dub", meas: true }),
  row("rg04", "Riddim Rodeo", "Chantelle Boyce-Ndiaye", { f: "reggae", e: "high", bpm: 96, fits: ["Hype", "Club"] }, { g: "Dancehall" }),
  row("rg05", "Sound Clash Sunday", "Chantelle Boyce-Ndiaye", { f: "reggae", e: "high", bpm: 100, fits: ["Hype", "Club"] }, { g: "Dancehall", mood: ["Hype"], meas: true }),
  row("rg06", "Sea Breeze Lecture", "Orville Tennant", { f: "reggae", e: "medium", bpm: 78, fits: ["Warm", "Chill"] }, { g: "Various" }),
  row("rg07", "Rocksteady Letter", "Orville Tennant", { f: "reggae", e: "medium", bpm: 82, fits: ["Warm"] }, { g: null }),
  row("rg08", "Echo Chamber Garden", "Orville Tennant", { f: "reggae", e: "low", bpm: 66, fits: ["Chill", "Late Night", "Zen"] }, { g: "Dub" }),
  row("rg09", "Carnival Dust", "Chantelle Boyce-Ndiaye", { f: "reggae", e: "medium", bpm: 90, fits: ["Warm", "Hype"] }, { g: "Dancehall", meas: true }),
  row("rg10", "Roots Radio", "Marlowe Ricketts", { f: "reggae", e: "medium", bpm: 76, fits: ["Warm"] }, { g: "Other" }),
];

// Latin: reggaeton and salsa, mostly high and medium.
const LATIN: EvalTrack[] = [
  row("lt01", "Fuego en la Plaza", "Rafael Montenegro-Ahn", { f: "latin", e: "high", bpm: 96, fits: ["Hype", "Club"], x: true }, { g: "Reggaeton", mood: ["Club"], meas: true }),
  row("lt02", "Dembow Domingo", "Rafael Montenegro-Ahn", { f: "latin", e: "high", bpm: 94, fits: ["Hype", "Club"] }, { g: "Reggaeton" }),
  row("lt03", "Luna de Cobre", "Rafael Montenegro-Ahn", { f: "latin", e: "medium", bpm: 104, fits: ["Warm", "Late Night"] }, { g: "Latin Pop" }),
  row("lt04", "Salsa de la Esquina", "Itzel Barrientos", { f: "latin", e: "high", bpm: 128, fits: ["Hype", "Club", "Warm"] }, { g: "Salsa", meas: true }),
  row("lt05", "Bolero de Medianoche", "Itzel Barrientos", { f: "latin", e: "low", bpm: 72, fits: ["Late Night", "Warm", "Chill"] }, { g: "Música Latina", mood: ["Late Night"], meas: true }),
  row("lt06", "Bachata Azul", "Itzel Barrientos", { f: "latin", e: "medium", bpm: 126, fits: ["Warm"] }, { g: "Bachata" }),
  row("lt07", "Cumbia Eléctrica", "Emiliano Sarmiento", { f: "latin", e: "high", bpm: 100, fits: ["Hype", "Club"] }, { g: null, meas: true }),
  row("lt08", "Costa Rota", "Emiliano Sarmiento", { f: "latin", e: "medium", bpm: 98, fits: ["Warm"] }, { g: null }),
  row("lt09", "Perreo Lento", "Emiliano Sarmiento", { f: "latin", e: "medium", bpm: 92, fits: ["Late Night", "Club"] }, { g: "Reggaeton" }),
  row("lt10", "Noche de Tambor", "Valeria Quispe", { f: "latin", e: "medium", bpm: 110, fits: ["Warm", "Hype"] }, { g: "Urban", meas: true }),
];

// World that is not Afro: mandingue, griot, maloya, fado, gnawa.
const WORLD: EvalTrack[] = [
  row("wd01", "Balafon Morning", "Fanta Keita-Brun", { f: "world", e: "low", bpm: 78, fits: ["Zen", "Warm", "Focus"] }, { g: "Mandingue", mood: ["Warm"], meas: true }),
  row("wd02", "Kora Under Stars", "Fanta Keita-Brun", { f: "world", e: "low", bpm: 72, fits: ["Zen", "Late Night", "Focus"] }, { g: "Griot" }),
  row("wd03", "Praise Song for Rain", "Fanta Keita-Brun", { f: "world", e: "medium", bpm: 96, fits: ["Warm"] }, { g: null, meas: true }),
  row("wd04", "Maloya du Lagon", "Axel Payet-Riviere", { f: "world", e: "medium", bpm: 90, fits: ["Warm", "Hype"] }, { g: "Maloya" }),
  row("wd05", "Sega Soleil", "Axel Payet-Riviere", { f: "world", e: "high", bpm: 120, fits: ["Hype", "Warm", "Club"] }, { g: "Musiques du monde", meas: true }),
  row("wd06", "Saudade na Janela", "Leonor Tavares-Quinn", { f: "world", e: "low", bpm: 66, fits: ["Late Night", "Warm", "Chill"] }, { g: "Fado", mood: ["Late Night"], meas: true }),
  row("wd07", "Cordas de Lisboa", "Leonor Tavares-Quinn", { f: "world", e: "medium", bpm: 88, fits: ["Warm"] }, { g: "Fado" }),
  row("wd08", "Desert Caravan Pulse", "Hamza El-Idrissi-Knox", { f: "world", e: "high", bpm: 124, fits: ["Hype", "Dark"] }, { g: "Gnawa" }),
  row("wd09", "Medina at Dusk", "Hamza El-Idrissi-Knox", { f: "world", e: "medium", bpm: 100, fits: ["Warm", "Late Night"] }, { g: "World", meas: true }),
  row("wd10", "Highland Reel", "Cormac O Dalaigh-Reid", { f: "world", e: "medium", bpm: 112, fits: ["Warm"] }, { g: "Other" }),
];

// Electronic: 120-130 BPM, mostly high; one drum & bass, one downtempo.
const ELECTRONIC: EvalTrack[] = [
  row("el01", "Warehouse Telemetry", "Tavi Lindqvist", { f: "electronic", e: "high", bpm: 128, fits: ["Club", "Hype", "Dark"] }, { g: "Techno", mood: ["Dark"], meas: true }),
  row("el02", "Chrome Corridor", "Tavi Lindqvist", { f: "electronic", e: "high", bpm: 126, fits: ["Club", "Hype"] }, { g: "Other" }),
  row("el03", "Subterranean Loop", "Tavi Lindqvist", { f: "electronic", e: "high", bpm: 124, fits: ["Club", "Dark"] }, { g: "Deep House", mood: ["Club"], meas: true }),
  row("el04", "Sunrise Arpeggio", "Nilo Brecken", { f: "electronic", e: "high", bpm: 122, fits: ["Club", "Hype", "Warm"], sim: ["Tavi Lindqvist"] }, { g: "House" }),
  row("el05", "Neon Undertow", "Nilo Brecken", { f: "electronic", e: "high", bpm: 130, fits: ["Hype", "Club", "Dark"], sim: ["Tavi Lindqvist"] }, { g: "EDM", meas: true }),
  row("el06", "Midnight Modular", "Nilo Brecken", { f: "electronic", e: "medium", bpm: 118, fits: ["Late Night", "Focus"], sim: ["Tavi Lindqvist"] }, { g: "Electronic" }),
  row("el07", "Sub Zero Rollers", "Kestrel Moon", { f: "electronic", e: "high", bpm: 174, fits: ["Hype", "Dark"] }, { g: "Drum & Bass", meas: true }),
  row("el08", "Fluorescent Rain", "Kestrel Moon", { f: "electronic", e: "high", bpm: 127, fits: ["Club", "Hype"] }, { g: null }),
  row("el09", "Soft Machine Lullaby", "Ilse Voronova", { f: "electronic", e: "low", bpm: 100, fits: ["Late Night", "Focus", "Chill"] }, { g: "Downtempo", meas: true }),
  row("el10", "Pulse Garden", "Ilse Voronova", { f: "electronic", e: "medium", bpm: 120, fits: ["Focus"] }, { g: "Techno", mood: ["Focus"] }),
];

// Jazz: wide spread of energy and tempo.
const JAZZ: EvalTrack[] = [
  row("jz01", "Corner Table Quartet", "Isadora Penhallow", { f: "jazz", e: "medium", bpm: 92, fits: ["Late Night", "Warm", "Focus"] }, { g: "Jazz", mood: ["Late Night"], meas: true }),
  row("jz02", "Blue Hour Waltz", "Isadora Penhallow", { f: "jazz", e: "low", bpm: 78, fits: ["Late Night", "Chill", "Warm"] }, { g: "Smooth Jazz", meas: true }),
  row("jz03", "Brushed Snare Confession", "Isadora Penhallow", { f: "jazz", e: "low", bpm: 70, fits: ["Late Night", "Chill", "Focus"] }, { g: "Jazz", meas: true }),
  row("jz04", "Fire Drill Fantasia", "Corvin Aldous", { f: "jazz", e: "high", bpm: 184, fits: ["Hype"], sim: ["Isadora Penhallow"] }, { g: "Bebop" }),
  row("jz05", "Walking Bass Alibi", "Corvin Aldous", { f: "jazz", e: "medium", bpm: 120, fits: ["Focus", "Warm"], sim: ["Isadora Penhallow"] }, { g: "Jazz", meas: true }),
  row("jz06", "Basement Groove Theory", "Corvin Aldous", { f: "jazz", e: "medium", bpm: 106, fits: ["Warm"], sim: ["Isadora Penhallow"] }, { g: "Acid Jazz" }),
  row("jz07", "Trumpet in the Rain", "Odalys Pemberton", { f: "jazz", e: "low", bpm: 74, fits: ["Late Night", "Warm", "Chill"] }, { g: null }),
  row("jz08", "Fusion Fridge Hum", "Odalys Pemberton", { f: "jazz", e: "high", bpm: 112, fits: ["Hype"] }, { g: "Jazz Fusion", meas: true }),
  row("jz09", "Quiet Piano Trio", "Odalys Pemberton", { f: "jazz", e: "low", bpm: 64, fits: ["Focus", "Zen", "Late Night", "Chill"] }, { g: null, meas: true }),
  row("jz10", "Swing Set Sundays", "Barnaby Fenwick-Achebe", { f: "jazz", e: "medium", bpm: 140, fits: ["Warm"] }, { g: "Music" }),
];

// Rock and indie: mostly high and medium energy.
const ROCK: EvalTrack[] = [
  row("rk01", "Garage Door Anthem", "Wren Calloway-Sato", { f: "rock", e: "high", bpm: 150, fits: ["Hype", "Dark"] }, { g: "Indie Rock", meas: true }),
  row("rk02", "Amplifier Summer", "Wren Calloway-Sato", { f: "rock", e: "high", bpm: 140, fits: ["Hype"] }, { g: "Rock", meas: true }),
  row("rk03", "Kerosene Choir", "Wren Calloway-Sato", { f: "rock", e: "high", bpm: 160, fits: ["Hype", "Dark"], x: true }, { g: "Punk", mood: ["Dark"], meas: true }),
  row("rk04", "Basement Static", "The Hollow Lanterns", { f: "rock", e: "medium", bpm: 118, fits: ["Warm"] }, { g: "Alternative", meas: true }),
  row("rk05", "Porch Light Revival", "The Hollow Lanterns", { f: "rock", e: "medium", bpm: 104, fits: ["Warm"] }, { g: "Indie Rock" }),
  row("rk06", "Heavy Weather", "Gideon Marsh-Vael", { f: "rock", e: "high", bpm: 132, fits: ["Hype", "Dark"] }, { g: "Hard Rock", mood: ["Dark"], meas: true }),
  row("rk07", "Thunder Road Clerk", "Gideon Marsh-Vael", { f: "rock", e: "high", bpm: 126, fits: ["Hype"] }, { g: "Music" }),
  row("rk08", "Kitchen Floor Ballad", "Maeve Ostrander", { f: "rock", e: "low", bpm: 70, fits: ["Warm", "Late Night", "Chill"] }, { g: "Indie Rock", meas: true }),
  row("rk09", "Tidewater", "Maeve Ostrander", { f: "rock", e: "medium", bpm: 96, fits: ["Warm", "Focus"] }, { g: null }),
  row("rk10", "Rust Belt Lullaby", "Maeve Ostrander", { f: "rock", e: "low", bpm: 74, fits: ["Late Night", "Chill", "Warm"] }, { g: "Rock" }),
];

// Ambient and lo-fi: low energy, slow.
const AMBIENT: EvalTrack[] = [
  row("am01", "Drift Atlas", "Soren Halvorsen-Pike", { f: "ambient", e: "low", bpm: 60, fits: ["Zen", "Focus", "Chill", "Late Night"] }, { g: "Ambient", mood: ["Zen"], meas: true }),
  row("am02", "Slow Glass", "Soren Halvorsen-Pike", { f: "ambient", e: "low", bpm: 56, fits: ["Zen", "Focus", "Late Night"] }, { g: "Drone" }),
  row("am03", "Tidepool Index", "Soren Halvorsen-Pike", { f: "ambient", e: "low", bpm: 62, fits: ["Zen", "Focus", "Chill"] }, { g: "New Age", mood: ["Zen"], meas: true }),
  row("am04", "Library Rain Loop", "Mei-Lin Abernathy", { f: "ambient", e: "low", bpm: 78, fits: ["Focus", "Chill", "Late Night"] }, { g: "Lo-fi beats", meas: true }),
  row("am05", "Cassette Sunbeam", "Mei-Lin Abernathy", { f: "ambient", e: "low", bpm: 82, fits: ["Chill", "Focus", "Warm"] }, { g: "Various" }),
  row("am06", "Study Hall Tape", "Mei-Lin Abernathy", { f: "ambient", e: "low", bpm: 85, fits: ["Focus", "Chill"] }, { g: "Lo-fi beats", mood: ["Focus"] }),
  row("am07", "Aurora Hush", "Yusra Delacroix-Ng", { f: "ambient", e: "low", bpm: 58, fits: ["Zen", "Late Night", "Chill"] }, { g: "Chillout", meas: true }),
  row("am08", "Moss and Mist", "Yusra Delacroix-Ng", { f: "ambient", e: "low", bpm: 64, fits: ["Zen", "Warm", "Chill"] }, { g: null }),
  row("am09", "Pocket Planetarium", "Yusra Delacroix-Ng", { f: "ambient", e: "medium", bpm: 90, fits: ["Focus", "Warm"] }, { g: "Ambient" }),
  row("am10", "Breathing Room", "Theodor Blakeney", { f: "ambient", e: "low", bpm: 60, fits: ["Zen", "Focus", "Chill", "Late Night"] }, { g: "Music", meas: true }),
];

// Classical: mostly low energy, one stormy exception.
const CLASSICAL: EvalTrack[] = [
  row("cl01", "Nocturne for Rain", "Cosima Lindemann-Park", { f: "classical", e: "low", bpm: 54, fits: ["Zen", "Late Night", "Focus", "Chill"] }, { g: "Classical", mood: ["Zen"], meas: true }),
  row("cl02", "Sonata in Soft Grey", "Cosima Lindemann-Park", { f: "classical", e: "low", bpm: 62, fits: ["Zen", "Focus", "Chill"] }, { g: "Piano" }),
  row("cl03", "Adagio Over Water", "Cosima Lindemann-Park", { f: "classical", e: "low", bpm: 50, fits: ["Zen", "Late Night", "Chill"] }, { g: "Contemporary Classical" }),
  row("cl04", "Harpsichord Weather", "Matthias Orloff-Quill", { f: "classical", e: "medium", bpm: 96, fits: ["Focus", "Warm"] }, { g: "Baroque", meas: true }),
  row("cl05", "Fugue for Rainy Mondays", "Matthias Orloff-Quill", { f: "classical", e: "medium", bpm: 108, fits: ["Focus"] }, { g: "Baroque", mood: ["Focus"] }),
  row("cl06", "Storm Over the Strings", "Elena Varga-Whitcombe", { f: "classical", e: "high", bpm: 132, fits: ["Hype", "Dark"] }, { g: "Orchestral", mood: ["Dark"], meas: true }),
  row("cl07", "Cello at Dawn", "Elena Varga-Whitcombe", { f: "classical", e: "low", bpm: 58, fits: ["Zen", "Warm", "Focus", "Chill"] }, { g: "Classical" }),
  row("cl08", "Lullaby for Strings", "Elena Varga-Whitcombe", { f: "classical", e: "low", bpm: 52, fits: ["Zen", "Late Night", "Chill"] }, { g: null, meas: true }),
  row("cl09", "Etude in Small Hours", "Theophile Marchand-Oyelaran", { f: "classical", e: "low", bpm: 66, fits: ["Focus", "Late Night", "Zen"] }, { g: "Piano" }),
  row("cl10", "Quiet Chapel Organ", "Theophile Marchand-Oyelaran", { f: "classical", e: "low", bpm: 56, fits: ["Zen", "Focus", "Late Night"] }, { g: "Musique classique" }),
];

const FAMILY_BLOCKS: readonly EvalTrack[][] = [
  HIPHOP, RNB, POP, AFRO, REGGAE, LATIN, WORLD, ELECTRONIC, JAZZ, ROCK, AMBIENT, CLASSICAL,
];

/**
 * Newest first with the families interleaved (not grouped), as a real catalog
 * is: round r takes row r of every family, the family order rotating by five
 * each round so no two rounds share an order. Fixed arithmetic, no randomness.
 */
function interleave(blocks: readonly EvalTrack[][]): EvalTrack[] {
  const rounds = Math.max(...blocks.map((block) => block.length));
  const ordered: EvalTrack[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let slot = 0; slot < blocks.length; slot += 1) {
      const track = blocks[(slot + round * 5) % blocks.length][round];
      if (track) ordered.push(track);
    }
  }
  return ordered;
}

/** The whole catalog, newest first. */
export const EVAL_CATALOG: readonly EvalTrack[] = interleave(FAMILY_BLOCKS);

/** The observed layer alone: the catalog the system under test sees. */
export const OBSERVED_CATALOG: readonly GoldenTrack[] = EVAL_CATALOG.map((track) => track.observed);

/** Truth labels by track key; only the grader and the report read them. */
export const truthByKey: ReadonlyMap<string, TrackTruth> = new Map(
  EVAL_CATALOG.map((track) => [track.observed.key, track.truth]),
);

// ---------------------------------------------------------------------------
// Declared sparsity
// ---------------------------------------------------------------------------

/** Genres that say nothing about the music. */
export const VAGUE_GENRES: readonly string[] = ["Music", "Other", "Urban", "Various"];

/**
 * How sparse the observed layer is, as fractions of the catalog. These are
 * assumptions (the real catalog's coverage is measured separately, in the
 * deployment); the spec asserts the fixture honours them within `tolerance`.
 */
export const DECLARED_SPARSITY = {
  /** No genre at all. */
  genreNull: 0.15,
  /** A genre that names no style ({@link VAGUE_GENRES}). */
  genreVague: 0.1,
  /** A free-text style genre ("Hip Hop/Rap", "Rap FR"): the rest. */
  genreFreeText: 0.75,
  /** Carries at least one mood tag. */
  moodTagged: 0.2,
  /** Carries measured audio features. */
  measured: 0.5,
  tolerance: 0.04,
} as const;

/** The ratios the fixture actually has. */
export function observedSparsity(catalog: readonly GoldenTrack[] = OBSERVED_CATALOG) {
  const share = (count: number) => count / catalog.length;
  return {
    genreNull: share(catalog.filter((track) => track.genre === null).length),
    genreVague: share(catalog.filter((track) => track.genre !== null && VAGUE_GENRES.includes(track.genre)).length),
    genreFreeText: share(catalog.filter((track) => track.genre !== null && !VAGUE_GENRES.includes(track.genre)).length),
    moodTagged: share(catalog.filter((track) => (track.moods ?? []).length > 0).length),
    measured: share(catalog.filter((track) => track.measured !== undefined).length),
  };
}
