const TASTE_EXPANSIONS: Record<string, string[]> = {
  afrobeats: ["afrobeat", "afropop", "amapiano"],
  ambient: ["atmospheric", "downtempo", "drone"],
  classical: ["orchestral", "cinematic", "piano"],
  "deep house": ["house", "deep-house", "melodic house"],
  drill: ["hip hop", "rap", "trap"],
  electronic: ["edm", "house", "techno", "synth"],
  focus: ["ambient", "lo-fi", "downtempo"],
  "hip hop": ["hip-hop", "hiphop", "rap", "trap", "drill", "boom bap"],
  hiphop: ["hip hop", "hip-hop", "rap", "trap", "drill"],
  indie: ["alternative", "indie rock"],
  jazz: ["soul", "funk", "fusion"],
  "lo-fi": ["lofi", "chillhop", "downtempo"],
  lofi: ["lo-fi", "chillhop", "downtempo"],
  pop: ["dance pop", "synth pop", "electropop"],
  "r&b": ["rnb", "soul", "neo soul"],
  reggaeton: ["latin", "urbano", "dembow", "dancehall"],
  rock: ["alternative", "indie rock", "guitar"],
  soul: ["r&b", "rnb", "neo soul", "funk"],
  techno: ["electronic", "house", "edm"],
  trap: ["hip hop", "rap", "drill"],
};

function normalizeTaste(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The expansion key of a query: like `normalizeTaste`, with hyphens read as
 * spaces so "Hip-Hop" and "Deep-House" find the "hip hop" and "deep house"
 * entries (#2316). Entries that keep their hyphen on purpose ("lo-fi", "r&b")
 * are matched as typed first.
 */
function expansionKey(value: string) {
  const key = normalizeTaste(value);
  if (TASTE_EXPANSIONS[key]) return key;
  const spaced = key.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return TASTE_EXPANSIONS[spaced] ? spaced : key;
}

export function expandAgentTasteQueries(queries: string[], maxPerQuery = 6) {
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const rawQuery of queries) {
    const query = rawQuery.trim();
    if (!query) continue;

    const candidates = [
      query,
      ...(TASTE_EXPANSIONS[expansionKey(query)] ?? []),
    ].slice(0, maxPerQuery);

    for (const candidate of candidates) {
      const key = normalizeTaste(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push(candidate);
    }
  }

  return expanded;
}
