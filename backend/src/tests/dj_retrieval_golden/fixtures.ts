/**
 * AI DJ retrieval golden set (#2235): the fixture catalog and the typed case
 * table. Tests only; nothing here is shipped code.
 *
 * The catalog is labelled by hand. A case's `relevant` list is the set of
 * tracks a listener would be surprised to NOT hear for that request, whatever
 * the current retrieval does. Cases the current ranker misses are kept, with
 * `knownGap` explaining why, and a `baseline` that is only ever the value the
 * current code achieves (never an aspiration). A later retrieval change must
 * not drop below a baseline, and raises it in the same PR when it improves.
 *
 * Descriptors (#2240): every fixture track carries the descriptor the
 * deterministic backfill produces for it (the integration runner runs the real
 * tagger over the seeded rows; the twin runner computes the same value with the
 * same pure functions), so the numbers measure retrieval WITH the stored
 * descriptor, as production reads it.
 *
 * Ranker under test: AgentSelectorService + DiscoveryRankingService through
 * `deterministicSelectorInput`, the same request a listening session builds.
 * Embedding-backed semantic retrieval is OFF here (it needs a real embedding
 * model), so these numbers are the deterministic path only.
 */

export interface MeasuredStemFeatures {
  energyRms: number;
  onsetDensity: number;
  tempoBpm?: number;
}

export interface GoldenTrack {
  /** Stable key; the database id is `<prefix><key>`. */
  key: string;
  title: string;
  /** Release title; defaults to the track title. */
  releaseTitle?: string;
  /** Credited artist. */
  artist: string;
  /** Free-text release genre, as an artist would type it. `null` = none. */
  genre: string | null;
  moods?: string[];
  explicit?: boolean;
  /** Measured full-mix features on the original stem (#1960). */
  measured?: MeasuredStemFeatures;
}

/**
 * Newest first, like the default catalog order. The untargeted requests
 * ("40-minute run", "like <artist>") start from the newest tracks, so the
 * targeted tracks sit below 24 unrelated newer ones, as in a real catalog.
 */
export const GOLDEN_CATALOG: readonly GoldenTrack[] = [
  // --- 24 unrelated, newest tracks (no case targets any of them) ---
  { key: "n_jazz_1", title: "Blue Corner", artist: "Ines Albrecht", genre: "Smooth Jazz" },
  { key: "n_jazz_2", title: "Late Set", artist: "Ines Albrecht", genre: "Jazz" },
  { key: "n_jazz_3", title: "Brass Lantern", artist: "Tomas Verdi", genre: "Acid Jazz" },
  { key: "n_rock_1", title: "Garage Sun", artist: "The Paper Kites Band", genre: "Indie Rock" },
  { key: "n_rock_2", title: "Iron Road", artist: "Black Harbor", genre: "Hard Rock" },
  { key: "n_rock_3", title: "Static Hearts", artist: "Black Harbor", genre: "Alternative" },
  { key: "n_pop_1", title: "Glass Heart", artist: "Mila Ortega", genre: "Pop" },
  { key: "n_pop_2", title: "Neon Letters", artist: "Mila Ortega", genre: "Synth Pop" },
  { key: "n_pop_3", title: "Saturday Light", artist: "June Hollis", genre: "Dance Pop" },
  { key: "n_classical_1", title: "Nocturne in Grey", artist: "Anselm Rieger", genre: "Classical" },
  { key: "n_classical_2", title: "Suite for Strings", artist: "Anselm Rieger", genre: "Baroque" },
  { key: "n_reggae_1", title: "Island Clock", artist: "Marcus Bell", genre: "Reggae" },
  { key: "n_reggae_2", title: "Yard Party", artist: "Marcus Bell", genre: "Dancehall" },
  { key: "n_rnb_1", title: "Slow Dial", artist: "Dana Whitfield", genre: "R&B" },
  { key: "n_rnb_2", title: "Velvet Hour", artist: "Dana Whitfield", genre: "Neo Soul" },
  { key: "n_techno_1", title: "Warehouse 9", artist: "Kern", genre: "Techno" },
  { key: "n_techno_2", title: "Concrete Pulse", artist: "Kern", genre: "Techno" },
  { key: "n_techno_3", title: "Grid Lock", artist: "Orla Voss", genre: "Minimal Techno" },
  { key: "n_tech_house", title: "Back Room Shuffle", artist: "Orla Voss", genre: "Tech House", moods: ["Dark"] },
  { key: "n_prog_house", title: "Sunrise Rails", artist: "Lio Marchetti", genre: "Progressive House" },
  { key: "n_blues", title: "Dust Road", artist: "Hank Dorsey", genre: "Blues" },
  { key: "n_country", title: "Porch Lights", artist: "Hank Dorsey", genre: "Country" },
  { key: "n_metal", title: "Anvil Choir", artist: "Vargr", genre: "Metal" },
  { key: "n_gospel", title: "Morning Chorus", artist: "Grace Ellery", genre: "Gospel" },

  // --- World ---
  { key: "w_african", title: "Savanna Road", artist: "Kofi Amarteifio", genre: "African" },
  { key: "w_mandingue", title: "Balafon Dawn", artist: "Sekou Camara", genre: "Mandingue" },
  { key: "w_region", title: "Harmattan Season", artist: "Ayo Fasanya", genre: "West Africa" },
  { key: "w_country", title: "Teranga Nights", artist: "Fatou Ndiaye", genre: "Senegal" },
  // No genre at all: only the title, release title and artist say it is world music.
  {
    key: "w_nogenre",
    title: "Kora Sunrise",
    releaseTitle: "Songs from Bamako",
    artist: "Ousmane Keita",
    genre: null,
  },

  // Further World-family tracks, older than the labelled ones above: they
  // widen the World pool beyond ten so recall@10 and recall@20 can differ.
  { key: "wx_afrobeats", title: "Lagos Rooftop", artist: "Tunde Bakare", genre: "Afrobeats" },
  { key: "wx_highlife", title: "Palm Wine Hour", artist: "Kwesi Boateng", genre: "Highlife" },
  { key: "wx_soukous", title: "Kinshasa Lights", artist: "Papy Lukusa", genre: "Soukous" },
  { key: "wx_amapiano", title: "Log Drum Sunday", artist: "Thando Mbeki-Rowe", genre: "Amapiano" },
  { key: "wx_zouk", title: "Creole Evening", artist: "Mireille Josephin", genre: "Zouk" },
  { key: "wx_flamenco", title: "Seis Cuerdas", artist: "Paco Alarcon", genre: "Flamenco" },
  { key: "wx_fado", title: "Saudade Lane", artist: "Beatriz Sampaio", genre: "Fado" },
  { key: "wx_cumbia", title: "Rio Magdalena", artist: "Camilo Restrepo", genre: "Cumbia" },
  { key: "wx_gnawa", title: "Essaouira Trance", artist: "Hamid Ouazzani", genre: "Gnawa" },

  // --- Rap / Hip-Hop ---
  { key: "rap_explicit", title: "No Filter Cipher", artist: "Rico Vance", genre: "Rap", explicit: true },
  { key: "rap_clean", title: "Corner Store Poems", artist: "Denzel Moore", genre: "Hip Hop" },
  { key: "rap_boombap", title: "Dusty Crates", artist: "Denzel Moore", genre: "Boom Bap" },
  { key: "rap_french", title: "Banlieue Soleil", artist: "Yanis Berrada", genre: "French Rap" },
  { key: "rap_trap", title: "Gold Chains Slow", artist: "Kwame Lux", genre: "Trap" },
  { key: "rap_drill", title: "Cold Block", artist: "Jaylen Sparks", genre: "Drill" },

  // Further hip-hop-family tracks, older than the labelled ones above.
  { key: "rx_gangsta", title: "Long Beach Dusk", artist: "Dre Calloway", genre: "Gangsta Rap" },
  { key: "rx_cloud", title: "Floating Signal", artist: "Mist Theory", genre: "Cloud Rap" },
  { key: "rx_grime", title: "Eastside Static", artist: "Skepta Jones", genre: "Grime" },
  { key: "rx_ukdrill", title: "Postcode War", artist: "Mazza K", genre: "UK Drill" },
  { key: "rx_conscious", title: "Open Letter", artist: "Nia Solomon", genre: "Conscious Hip Hop" },
  { key: "rx_oldschool", title: "Block Party 85", artist: "DJ Marlon", genre: "Old School Hip Hop" },
  { key: "rx_phonk", title: "Drift Tape", artist: "Cassette Ghost", genre: "Phonk" },

  // --- Sentences ---
  { key: "dh_warm", title: "Kitchen Table Groove", artist: "Lio Marchetti", genre: "Deep House", moods: ["Warm"] },
  { key: "dh_plain", title: "Low Tide Disco", artist: "Sade Okonkwo-Reyes", genre: "Deep House" },
  { key: "dh_soulful", title: "Sunday Simmer", artist: "Pia Lindqvist", genre: "Soulful House", moods: ["Warm", "Mellow"] },
  { key: "f_ambient", title: "Long Desk Hours", artist: "Hana Mori", genre: "Ambient", moods: ["Focus"] },
  { key: "f_lofi", title: "Paper Rain", artist: "Hana Mori", genre: "Lo-fi" },
  { key: "f_chillhop", title: "Study Window", artist: "Beat Cartographer", genre: "Chillhop" },
  {
    key: "run_dnb",
    title: "Tarmac Fire",
    artist: "Pulse Engine",
    genre: "Drum and Bass",
    measured: { energyRms: 0.26, onsetDensity: 6.5, tempoBpm: 172 },
  },
  {
    key: "run_electro",
    title: "Mile Marker",
    artist: "Pulse Engine",
    genre: "Electro",
    measured: { energyRms: 0.24, onsetDensity: 6, tempoBpm: 160 },
  },
  {
    key: "run_punk",
    title: "Finish Line Riot",
    artist: "Cheap Trick Wire",
    genre: "Punk Rock",
    measured: { energyRms: 0.27, onsetDensity: 7, tempoBpm: 168 },
  },
  {
    key: "run_techno",
    title: "Interval Machine",
    artist: "Kern",
    genre: "Techno",
    measured: { energyRms: 0.25, onsetDensity: 6, tempoBpm: 150 },
  },

  // --- Artist name: three tracks by one catalog artist ---
  { key: "ok_1", title: "Lantern Years", artist: "Nadia Okoro", genre: "Neo Soul" },
  { key: "ok_2", title: "Half Light", artist: "Nadia Okoro", genre: "Neo Soul" },
  { key: "ok_3", title: "Paper Boats", artist: "Nadia Okoro", genre: "R&B" },

  // --- Calm ---
  { key: "calm_tagged", title: "Calm Waters", artist: "Hana Mori", genre: "Ambient", moods: ["Calm"] },
  // Measured low energy, no mood tag, and nothing "calm" in title or genre.
  {
    key: "calm_measured",
    title: "Evening Porch",
    artist: "Elsa Brandt",
    genre: "Singer-Songwriter",
    measured: { energyRms: 0.02, onsetDensity: 0.8, tempoBpm: 70 },
  },
];

/**
 * How a listener's request reaches the ranker.
 *  - `text`: a sentence read by the production deterministic request parser,
 *    exactly as `POST /agents/session/parse` does.
 *  - `structured`: the editable filters (genre picker, mood and energy chips).
 */
export type GoldenRequest =
  | { kind: "text"; text: string; allowExplicit?: boolean }
  | {
      kind: "structured";
      genres?: string[];
      moods?: string[];
      energy?: "low" | "medium" | "high";
      allowExplicit?: boolean;
    };

export type GoldenGroup = "world" | "rap" | "sentence" | "artist" | "calm" | "unmet";

export interface GoldenBaseline {
  recallAt10: number;
  recallAt20: number;
}

export interface GoldenCase {
  id: string;
  group: GoldenGroup;
  description: string;
  request: GoldenRequest;
  /** Track keys a listener expects to hear. Empty only for an `unmet` case. */
  relevant: readonly string[];
  /** Track keys that must never be offered (hard guarantee, not a baseline). */
  forbidden?: readonly string[];
  /** The request nothing matches: must end as an honest unmet request (ADR-TE-4). */
  unmet?: true;
  /** Why the current ranker misses some or all relevant tracks. */
  knownGap?: string;
  /** What the current ranker achieves. A change may raise it, never lower it. */
  baseline: GoldenBaseline;
}

const ONE: GoldenBaseline = { recallAt10: 1, recallAt20: 1 };
const NONE: GoldenBaseline = { recallAt10: 0, recallAt20: 0 };

export const GOLDEN_CASES: readonly GoldenCase[] = [
  // ---------------------------------------------------------------- World
  {
    id: "world-african",
    group: "world",
    description: "World reaches a release labelled African.",
    request: { kind: "structured", genres: ["World"] },
    relevant: ["w_african"],
    baseline: ONE,
  },
  {
    id: "world-mandingue",
    group: "world",
    description: "World reaches a release labelled Mandingue.",
    request: { kind: "structured", genres: ["World"] },
    relevant: ["w_mandingue"],
    baseline: ONE,
  },
  {
    id: "world-region",
    group: "world",
    description: "World reaches a release labelled with a region name (West Africa).",
    request: { kind: "structured", genres: ["World"] },
    relevant: ["w_region"],
    baseline: ONE,
  },
  {
    id: "world-country",
    group: "world",
    description: "World reaches a release labelled with a country name (Senegal).",
    request: { kind: "structured", genres: ["World"] },
    relevant: ["w_country"],
    // #2240: the track descriptor maps the country name to world/african, so
    // catalog search and the ranker's session fit reach it (was 0% / 0%).
    baseline: ONE,
  },
  {
    id: "world-no-genre",
    group: "world",
    description: "World reaches a release that has no genre at all.",
    request: { kind: "structured", genres: ["World"] },
    relevant: ["w_nogenre"],
    knownGap:
      "Found only through the track descriptor (#2240), and only because its title and release title name a traditional instrument (kora) and a city (Bamako) the place lexicon knows; a no-genre track with a neutral title is still invisible. It ranks 14th, not in the top 10: with no genre the inferred energy scores one point lower than its tied World peers.",
    baseline: { recallAt10: 0, recallAt20: 1 },
  },
  {
    id: "world-all",
    group: "world",
    description: "World returns every World-family track in the catalog (14), not just a few of them.",
    request: { kind: "structured", genres: ["World"] },
    relevant: [
      "w_african", "w_mandingue", "w_region", "w_country", "w_nogenre",
      "wx_afrobeats", "wx_highlife", "wx_soukous", "wx_amapiano", "wx_zouk",
      "wx_flamenco", "wx_fado", "wx_cumbia", "wx_gnawa",
    ],
    knownGap:
      "Equally scored tracks keep catalog order, so the four oldest slip past rank 10 (rank 10 caps recall@10 at 10 / 14). The country and no-genre tracks are reached through the track descriptor (#2240); see world-no-genre.",
    baseline: { recallAt10: 10 / 14, recallAt20: 1 },
  },

  // ----------------------------------------------------------- Rap / Hip-Hop
  {
    id: "rap-explicit-allowed",
    group: "rap",
    description: "Hip-Hop returns explicit rap when the listener allows explicit tracks.",
    request: { kind: "structured", genres: ["Hip-Hop"], allowExplicit: true },
    relevant: ["rap_explicit"],
    baseline: ONE,
  },
  {
    id: "rap-explicit-blocked",
    group: "rap",
    description: "Hip-Hop never returns explicit rap when explicit tracks are off, and still finds clean rap.",
    request: { kind: "structured", genres: ["Hip-Hop"], allowExplicit: false },
    relevant: ["rap_clean", "rap_boombap"],
    forbidden: ["rap_explicit"],
    baseline: ONE,
  },
  {
    id: "rap-french-rap",
    group: "rap",
    description: "Rap reaches a release labelled French Rap.",
    request: { kind: "structured", genres: ["Rap"] },
    relevant: ["rap_french"],
    baseline: ONE,
  },
  {
    id: "rap-trap",
    group: "rap",
    description: "Rap reaches a release labelled Trap.",
    request: { kind: "structured", genres: ["Rap"] },
    relevant: ["rap_trap"],
    baseline: ONE,
  },
  {
    id: "rap-drill",
    group: "rap",
    description: "Rap reaches a release labelled Drill.",
    request: { kind: "structured", genres: ["Rap"] },
    relevant: ["rap_drill"],
    baseline: ONE,
  },
  {
    id: "hip-hop-all",
    group: "rap",
    description: "Hip-Hop with explicit allowed returns every hip-hop-family track in the catalog (13).",
    request: { kind: "structured", genres: ["Hip-Hop"], allowExplicit: true },
    relevant: [
      "rap_explicit", "rap_clean", "rap_boombap", "rap_french", "rap_trap", "rap_drill",
      "rx_gangsta", "rx_cloud", "rx_grime", "rx_ukdrill", "rx_conscious", "rx_oldschool", "rx_phonk",
    ],
    knownGap: "Every family member scores the same, so ties keep catalog order and the three oldest slip past rank 10.",
    baseline: { recallAt10: 10 / 13, recallAt20: 1 },
  },

  // -------------------------------------------------------------- Sentences
  {
    id: "sentence-warm-deep-house-cooking",
    group: "sentence",
    description: "\"warm deep house for cooking\": deep house, warm first.",
    request: { kind: "text", text: "warm deep house for cooking" },
    relevant: ["dh_warm", "dh_plain", "dh_soulful"],
    baseline: ONE,
  },
  {
    id: "sentence-something-to-focus",
    group: "sentence",
    description: "\"something to focus\": focus music, whether tagged or only ambient, lo-fi or chillhop.",
    request: { kind: "text", text: "something to focus" },
    relevant: ["f_ambient", "f_lofi", "f_chillhop"],
    baseline: ONE,
  },
  {
    id: "sentence-40-minute-run",
    group: "sentence",
    description: "\"40-minute run\": fast, high-energy tracks.",
    request: { kind: "text", text: "40-minute run" },
    relevant: ["run_dnb", "run_electro", "run_punk", "run_techno"],
    knownGap:
      "The parser reads nothing from this sentence, so the DJ asks for no genre and takes the newest tracks regardless of tempo or energy.",
    baseline: NONE,
  },

  // ------------------------------------------------------------ Artist name
  {
    id: "artist-like-nadia-okoro",
    group: "artist",
    description: "\"like Nadia Okoro\": the named catalog artist's tracks.",
    request: { kind: "text", text: "like Nadia Okoro" },
    relevant: ["ok_1", "ok_2", "ok_3"],
    knownGap:
      "The parser leaves the artist name unparsed and catalog search matches only genre and title, never the artist.",
    baseline: NONE,
  },

  // ------------------------------------------------------------------- Calm
  {
    id: "calm-mood-tagged",
    group: "calm",
    description: "Calm and low energy finds a track whose title says calm (control).",
    request: { kind: "structured", moods: ["Calm"], energy: "low" },
    relevant: ["calm_tagged"],
    baseline: ONE,
  },
  {
    id: "calm-measured-low-energy-no-tag",
    group: "calm",
    description: "Calm and low energy finds a track with measured low energy and no mood tag.",
    request: { kind: "structured", moods: ["Calm"], energy: "low" },
    relevant: ["calm_measured"],
    knownGap:
      "Catalog search matches the mood word only against genre and title; measured energy is a ranking signal, never a retrieval source.",
    baseline: NONE,
  },

  // ------------------------------------------------------------------ Unmet
  {
    id: "unmet-gregorian-chant",
    group: "unmet",
    description: "A request nothing in the catalog matches stays an honest unmet request (ADR-TE-4).",
    request: { kind: "structured", genres: ["Gregorian Chant"] },
    relevant: [],
    unmet: true,
    baseline: ONE,
  },
];
