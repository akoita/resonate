/**
 * Genre families for AI DJ retrieval, ranking and coverage (#2088).
 *
 * Catalog genres are FREE TEXT typed by artists ("African", "French Rap",
 * "Hip Hop"), so a listener's "World" session or "Hip-Hop" request cannot rely
 * on literal substring equality. A family groups the labels that mean the same
 * or a nested thing. This module is pure (no Prisma, no Nest) so retrieval,
 * ranking and coverage share one vocabulary.
 *
 * Matching is directional on purpose:
 *  - A release genre belongs to EVERY family one of whose members appears in it
 *    as a whole word or phrase ("French Rap" -> hip-hop, "Afro House" ->
 *    african + electronic).
 *  - A requested term resolves to the families it NAMES or narrowly belongs to.
 *    `broad` families (world, african, electronic, latin) are only reached by
 *    their own names, never through a member: asking for "Afrobeats" must not
 *    widen to everything under "World", while a "World" request does match an
 *    Afrobeats release.
 */

export interface GenreFamily {
  id: string;
  label: string;
  /** Extra names a request can use to reach a broad family. */
  names?: readonly string[];
  /**
   * Broad families are reached from a request only by id, label or `names`;
   * their members still classify release genres.
   */
  broad?: boolean;
  /** Labels in this family, lowercase. Accents and hyphens are allowed. */
  members: readonly string[];
}

export const GENRE_FAMILIES: readonly GenreFamily[] = [
  {
    id: "hip-hop",
    label: "Hip-Hop",
    members: [
      "hip hop", "hip-hop", "hiphop", "rap", "french rap", "rap francais",
      "rap français", "trap", "drill", "uk drill", "grime", "boom bap",
      "gangsta rap", "conscious hip hop", "phonk", "cloud rap", "afro trap",
      "old school hip hop",
    ],
  },
  {
    id: "r&b-soul",
    label: "R&B / Soul",
    members: [
      "r&b", "r and b", "rnb", "soul", "neo soul", "neo-soul", "funk",
      "contemporary r&b", "contemporary r and b",
    ],
  },
  {
    id: "world",
    label: "World",
    broad: true,
    names: ["world music", "musiques du monde", "musique du monde", "worldwide", "global"],
    members: [
      "world", "world music", "musiques du monde", "musique du monde",
      "african", "africa", "afro", "afrobeat", "afrobeats", "afro pop",
      "afropop", "highlife", "mandingue", "manding", "wassoulou", "griot",
      "soukous", "rumba congolaise", "ndombolo", "makossa", "mbalax",
      "coupe decale", "coupé-décalé", "zouk", "kompa", "rai", "raï", "gnawa",
      "maghreb", "arabic", "oriental", "flamenco", "fado", "celtic",
      "traditional", "folk", "latin folk", "bossa nova", "samba", "cumbia",
      "kuduro", "amapiano",
    ],
  },
  {
    id: "african",
    label: "African",
    broad: true,
    names: ["african music", "africa", "afro"],
    members: [
      "african", "africa", "afro", "afrobeat", "afrobeats", "afro pop",
      "afropop", "highlife", "mandingue", "manding", "wassoulou", "griot",
      "soukous", "rumba congolaise", "ndombolo", "makossa", "mbalax",
      "coupe decale", "coupé-décalé", "kuduro", "amapiano", "gqom", "gnawa",
      "maghreb", "afro swing", "afro fusion", "afro house",
    ],
  },
  {
    id: "afrobeats",
    label: "Afrobeats",
    members: [
      "afrobeats", "afrobeat", "afro pop", "afropop", "amapiano",
      "afro swing", "afro fusion", "naija",
    ],
  },
  {
    id: "reggae-dancehall",
    label: "Reggae / Dancehall",
    members: [
      "reggae", "dancehall", "dub", "ska", "roots reggae", "ragga",
      "reggae fusion",
    ],
  },
  {
    id: "reggaeton",
    label: "Reggaeton",
    members: [
      "reggaeton", "urbano", "dembow", "latin trap", "perreo", "latin urban",
    ],
  },
  {
    id: "latin",
    label: "Latin",
    broad: true,
    names: ["latin music", "musica latina", "latino"],
    members: [
      "latin", "latino", "reggaeton", "urbano", "dembow", "latin pop",
      "salsa", "bachata", "cumbia", "baile funk", "merengue", "bossa nova",
      "samba",
    ],
  },
  {
    id: "pop",
    label: "Pop",
    members: [
      "pop", "dance pop", "synth pop", "synthpop", "electropop", "indie pop",
      "k pop", "k-pop", "j pop", "j-pop", "pop rock", "chanson",
    ],
  },
  {
    id: "electronic",
    label: "Electronic",
    broad: true,
    names: ["electronica", "edm", "electronic music", "dance"],
    members: [
      "electronic", "electronica", "edm", "house", "deep house", "techno",
      "trance", "drum and bass", "drum & bass", "dnb", "dubstep", "garage",
      "uk garage", "breakbeat", "electro", "synthwave", "idm", "afro house",
      "melodic house", "tech house", "progressive house",
    ],
  },
  {
    id: "jazz",
    label: "Jazz",
    members: [
      "jazz", "bebop", "swing", "smooth jazz", "acid jazz", "jazz fusion",
      "nu jazz", "big band", "bossa jazz",
    ],
  },
  {
    id: "rock",
    label: "Rock",
    members: [
      "rock", "indie rock", "alternative", "alternative rock", "punk",
      "post punk", "post-punk", "metal", "hard rock", "grunge", "shoegaze",
      "indie",
    ],
  },
  {
    id: "ambient-lofi",
    label: "Ambient / Lo-fi",
    members: [
      "ambient", "lo-fi", "lo fi", "lofi", "chillhop", "downtempo",
      "chillout", "chill out", "drone", "atmospheric", "new age",
    ],
  },
  {
    id: "classical",
    label: "Classical",
    members: [
      "classical", "orchestral", "baroque", "symphony", "chamber music",
      "piano", "cinematic", "opera", "neoclassical",
    ],
  },
];

/**
 * Lowercase, accent-free, punctuation-free form used for every comparison:
 * "Hip-Hop" -> "hip hop", "Coupé-Décalé" -> "coupe decale", "R&B" -> "r and b".
 */
export function normalizeGenreTerm(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

interface IndexedFamily {
  family: GenreFamily;
  names: Set<string>;
  members: Set<string>;
}

const INDEXED_FAMILIES: readonly IndexedFamily[] = GENRE_FAMILIES.map((family) => {
  const names = new Set(
    [family.id, family.label, ...(family.names ?? [])].map(normalizeGenreTerm),
  );
  const members = new Set([...family.members.map(normalizeGenreTerm), ...names]);
  return { family, names, members };
});

/** True when `member` appears in `normalized` as a whole word or phrase. */
function containsWholePhrase(normalized: string, member: string): boolean {
  return ` ${normalized} `.includes(` ${member} `);
}

function releaseSideFamilies(normalized: string): IndexedFamily[] {
  if (!normalized) return [];
  return INDEXED_FAMILIES.filter((entry) =>
    [...entry.members].some((member) => containsWholePhrase(normalized, member)),
  );
}

function requestSideFamilies(normalized: string): IndexedFamily[] {
  if (!normalized) return [];
  return INDEXED_FAMILIES.filter((entry) => {
    if (entry.names.has(normalized)) return true;
    if (entry.family.broad) return false;
    return [...entry.members].some((member) => containsWholePhrase(normalized, member));
  });
}

/**
 * The families a REQUESTED term resolves to: those it names, plus (for narrow
 * families) those holding it or a phrase inside it ("french rap" -> hip-hop,
 * "World Music" -> world).
 */
export function genreFamiliesFor(term: string): GenreFamily[] {
  return requestSideFamilies(normalizeGenreTerm(term)).map((entry) => entry.family);
}

/** The families a catalog (release) genre label belongs to. */
export function releaseGenreFamilies(releaseGenre: string): GenreFamily[] {
  return releaseSideFamilies(normalizeGenreTerm(releaseGenre)).map((entry) => entry.family);
}

const DEFAULT_MAX_SEARCH_TERMS = 80;

/** Spellings a SQL `contains` needs: as written, accent-free, hyphenated. */
function sqlSpellings(member: string): string[] {
  const lower = member.trim().toLowerCase();
  const normalized = normalizeGenreTerm(member);
  const spellings = [lower, normalized];
  if (normalized.includes(" ")) spellings.push(normalized.replace(/ /g, "-"));
  return spellings.filter((spelling) => spelling.length >= 3);
}

/**
 * Catalog search terms for a requested genre: the term itself first, then the
 * labels of its families, so a "World" request reaches "African" releases.
 * Free-text catalog labels vary in spacing and hyphens, so each label is also
 * offered in its accent-free and hyphenated spelling.
 */
export function expandGenreSearchTerms(
  term: string,
  max = DEFAULT_MAX_SEARCH_TERMS,
): string[] {
  const original = (term ?? "").trim();
  if (!original) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  push(original);
  for (const family of genreFamiliesFor(original)) {
    for (const member of family.members) {
      for (const spelling of sqlSpellings(member)) push(spelling);
    }
  }
  return out.slice(0, Math.max(1, max));
}

/**
 * Whether a catalog genre satisfies a requested genre: same label modulo
 * spacing, hyphens and accents; one contains the other as whole words ("Deep
 * House" satisfies "house", but "Dubstep" does not satisfy "dub"); or the
 * release genre belongs to a family the request names.
 */
export function genreMatchesRequest(
  releaseGenre: string | null | undefined,
  requestedTerm: string | null | undefined,
): boolean {
  const genre = normalizeGenreTerm(releaseGenre ?? "");
  const term = normalizeGenreTerm(requestedTerm ?? "");
  if (!genre || !term) return false;
  if (genre === term) return true;
  if (containsWholePhrase(genre, term)) return true;
  if (genre.length >= 3 && containsWholePhrase(term, genre)) return true;
  const requested = new Set(requestSideFamilies(term).map((entry) => entry.family.id));
  if (requested.size === 0) return false;
  return releaseSideFamilies(genre).some((entry) => requested.has(entry.family.id));
}

/**
 * Other labels in the families a term resolves to, for describing a session in
 * words ("Hip-Hop, plus related styles: rap, trap, ..."). Excludes the term.
 */
export function relatedGenreLabels(term: string, max = 8): string[] {
  const own = normalizeGenreTerm(term);
  const out: string[] = [];
  const seen = new Set<string>([own]);
  for (const family of genreFamiliesFor(term)) {
    for (const member of family.members) {
      const normalized = normalizeGenreTerm(member);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(member);
      if (out.length >= max) return out;
    }
  }
  return out;
}
