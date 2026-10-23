/**
 * Places and traditional instruments that name a musical tradition (#2240).
 *
 * Artists type a country, a region or a city where a genre belongs ("Senegal",
 * "West Africa", "Songs from Bamako"). `genre_families.ts` lists musical
 * styles, not places, so the deterministic descriptor strategy reads this small
 * lexicon as well. It is deliberately conservative: European and North American
 * places are left out (a track called "Paris" is not world music), as are names
 * that double as common words or first names (Chad, Jordan, Georgia). Each
 * group maps to family ids of `genre_families.ts`. Terms are written in the
 * normalized form of `normalizeGenreTerm` (lowercase, accent-free, no
 * punctuation) and matched as whole words or phrases.
 */

export interface PlaceLexiconGroup {
  /** Family ids of `genre_families.ts` a match adds. */
  families: readonly string[];
  /** Whole-phrase terms, normalized. */
  terms: readonly string[];
}

export const PLACE_LEXICON: readonly PlaceLexiconGroup[] = [
  {
    // Sub-Saharan and North Africa.
    families: ["world", "african"],
    terms: [
      "algeria", "angola", "benin", "botswana", "burkina faso", "burundi",
      "cameroon", "cape verde", "cabo verde", "central african republic",
      "comoros", "congo", "dr congo", "drc", "cote d ivoire", "ivory coast",
      "djibouti", "egypt", "equatorial guinea", "eritrea", "eswatini",
      "ethiopia", "gabon", "gambia", "ghana", "guinea", "guinea bissau",
      "kenya", "lesotho", "liberia", "libya", "madagascar", "malawi", "mali",
      "mauritania", "mauritius", "morocco", "mozambique", "namibia", "niger",
      "nigeria", "rwanda", "senegal", "sierra leone", "somalia", "south africa",
      "south sudan", "sudan", "tanzania", "togo", "tunisia", "uganda", "zambia",
      "zanzibar", "zimbabwe", "sahel", "sahara", "west africa", "east africa",
      "north africa", "southern africa", "central africa", "sub saharan",
      "bamako", "dakar", "lagos", "accra", "kinshasa", "abidjan", "nairobi",
      "addis ababa", "cairo", "marrakech", "casablanca", "tunis", "algiers",
      "ouagadougou", "conakry", "kampala", "johannesburg", "soweto",
      "bambara", "wolof", "yoruba", "igbo", "swahili", "zulu", "xhosa",
      "tuareg", "berber", "amazigh", "fula", "peul", "mandinka", "malinke",
      "kora", "balafon", "djembe", "ngoni", "kamele ngoni", "mbira", "kalimba",
      "talking drum", "sabar",
    ],
  },
  {
    // Middle East, Central and South Asia.
    families: ["world"],
    terms: [
      "afghanistan", "armenia", "azerbaijan", "bangladesh", "bhutan", "india",
      "iran", "persia", "persian", "iraq", "israel", "kazakhstan", "kurdistan",
      "kurdish", "kuwait", "lebanon", "nepal", "oman", "pakistan", "palestine",
      "qatar", "saudi arabia", "sri lanka", "syria", "tajikistan", "turkey",
      "turkiye", "turkmenistan", "uzbekistan", "yemen", "middle east",
      "levant", "bollywood", "punjabi", "bhangra", "qawwali", "carnatic",
      "hindustani",
      "oud", "sitar", "tabla", "sarod", "santoor", "duduk", "saz", "qanun",
    ],
  },
  {
    // Oceania, the Pacific and Asian traditions named by a people or an
    // instrument. Countries with a large mainstream scene (Japan, South Korea,
    // China...) are left out on purpose: a "Japan" genre is as likely city pop.
    families: ["world"],
    terms: [
      "mongolia", "tibet", "bali", "gamelan", "okinawa", "polynesia", "samoa",
      "tonga", "hawaii", "maori", "aboriginal", "papua new guinea", "shamisen",
      "koto", "erhu", "guzheng", "pipa", "didgeridoo", "taiko",
    ],
  },
  {
    // Latin America and the Caribbean.
    families: ["world", "latin"],
    terms: [
      "argentina", "bolivia", "brazil", "brasil", "chile", "colombia",
      "costa rica", "cuba", "dominican republic", "ecuador", "el salvador",
      "guatemala", "haiti", "honduras", "mexico", "nicaragua", "panama",
      "paraguay", "peru", "puerto rico", "uruguay", "venezuela", "caribbean",
      "latin america", "andes", "andean", "amazonia", "havana", "bogota",
      "medellin", "buenos aires", "rio de janeiro", "sao paulo",
      "charango", "quena", "zampona", "bombo leguero", "cajon",
    ],
  },
];
