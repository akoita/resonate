/**
 * The pattern of a playlist used as an AI DJ seed. A playlist often holds
 * several genres, grooves and moods, so the seed describes it as a few
 * "pockets", each a genre family with a groove and its usual moods (for
 * example Hip-Hop · high energy · dark 50%, Afro · medium energy · warm 30%,
 * Jazz · low energy 20%), instead of its two most common genres and one
 * averaged sound:
 *
 *  1. Group: each sampled track joins a pocket per genre family it carries
 *     (stored descriptor families, else its release genre's), with its
 *     measured energy band as the groove, or its tempo band when energy was not
 *     measured. A pocket's moods are the release moods on at least a third of
 *     its tracks (at most three).
 *  2. Keep: every pocket with at least `PLAYLIST_POCKET_MIN_SHARE` of the
 *     sampled tracks, at most `PLAYLIST_POCKET_MAX` of them. When a family's
 *     tracks are spread over grooves that are each too small, they join one
 *     "any groove" pocket of that family if together they are large enough.
 *  3. Share: each kept pocket gets a share of the candidates in proportion to
 *     its count among the kept pockets.
 *  4. Match: the caller looks for each pocket's family (and groove) and ranks
 *     its candidates by how close they sound to the playlist's own tracks of
 *     that pocket, a little higher when they also share its groove and moods.
 *
 * When no pocket qualifies (a playlist of one-offs), the pattern falls back to
 * the two most common families and the playlist's overall sound, which is what
 * the seed did before. Pure: no database, no model.
 */

export const PLAYLIST_POCKET_MIN_SHARE = 0.1;
export const PLAYLIST_POCKET_MAX = 5;
export const PLAYLIST_POCKET_FALLBACK_FAMILIES = 2;
const POCKET_MOOD_MIN_SHARE = 1 / 3;
const POCKET_MAX_MOODS = 3;
/** Ranking nudges inside one pocket: small next to a cosine, so the sound still leads. */
const GROOVE_BONUS = 0.05;
const MOOD_BONUS = 0.03;
const MAX_MOOD_BONUSES = 2;

export type PocketGroove = { kind: "energy" | "tempo"; band: string };

/** What the seed reads of one playlist track (or one candidate). */
export type PocketTrack = {
  id: string;
  families: readonly string[];
  energyBand?: string | null;
  tempoBand?: string | null;
  moods?: readonly string[] | null;
};

export type PlaylistPocket = {
  /** `family|energy:high`, `family|tempo:fast`, or `family|any`. */
  key: string;
  familyId: string;
  /** Null: any groove of the family. */
  groove: PocketGroove | null;
  /** Lower-cased release moods common in the pocket, most common first. */
  moods: string[];
  /** The sampled playlist tracks in this pocket. */
  trackIds: string[];
  count: number;
  /** This pocket's part of the candidates, over the kept pockets (sums to 1). */
  share: number;
};

export type PlaylistPattern = {
  pockets: PlaylistPocket[];
  /**
   * True when the pockets were kept by share and each is matched to its own
   * sound. False for the fallback (top two families, overall sound) and when
   * the playlist carries no genre at all.
   */
  proportional: boolean;
};

export function grooveOf(track: Pick<PocketTrack, "energyBand" | "tempoBand">): PocketGroove | null {
  if (track.energyBand) return { kind: "energy", band: track.energyBand };
  if (track.tempoBand) return { kind: "tempo", band: track.tempoBand };
  return null;
}

function grooveKey(groove: PocketGroove | null): string {
  return groove ? `${groove.kind}:${groove.band}` : "any";
}

function normalMoods(moods: readonly string[] | null | undefined): string[] {
  return [...new Set((moods ?? []).map((mood) => mood.trim().toLowerCase()).filter(Boolean))];
}

function byCountThenKey<T extends { count: number; key: string }>(a: T, b: T): number {
  return b.count - a.count || a.key.localeCompare(b.key);
}

function pocketOf(
  familyId: string,
  groove: PocketGroove | null,
  members: readonly PocketTrack[],
): Omit<PlaylistPocket, "share"> {
  const moodCounts = new Map<string, number>();
  for (const track of members) {
    for (const mood of normalMoods(track.moods)) moodCounts.set(mood, (moodCounts.get(mood) ?? 0) + 1);
  }
  const moods = [...moodCounts.entries()]
    .filter(([, count]) => count / members.length >= POCKET_MOOD_MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, POCKET_MAX_MOODS)
    .map(([mood]) => mood);
  return {
    key: `${familyId}|${grooveKey(groove)}`,
    familyId,
    groove,
    moods,
    trackIds: members.map((track) => track.id),
    count: members.length,
  };
}

function withShares(pockets: Array<Omit<PlaylistPocket, "share">>): PlaylistPocket[] {
  const total = pockets.reduce((sum, pocket) => sum + pocket.count, 0);
  return pockets.map((pocket) => ({ ...pocket, share: total > 0 ? pocket.count / total : 0 }));
}

/** The pockets to cover for these sampled playlist tracks. */
export function playlistPattern(
  tracks: readonly PocketTrack[],
  options: { minShare?: number; maxPockets?: number; fallbackFamilies?: number } = {},
): PlaylistPattern {
  const minShare = options.minShare ?? PLAYLIST_POCKET_MIN_SHARE;
  const maxPockets = options.maxPockets ?? PLAYLIST_POCKET_MAX;
  const fallbackFamilies = options.fallbackFamilies ?? PLAYLIST_POCKET_FALLBACK_FAMILIES;
  const sampled = tracks.length;
  if (sampled === 0) return { pockets: [], proportional: false };
  const large = (count: number) => count / sampled >= minShare;

  // Every track of each family, and each family's tracks by groove.
  const byFamily = new Map<string, PocketTrack[]>();
  for (const track of tracks) {
    for (const familyId of new Set(track.families)) {
      const list = byFamily.get(familyId) ?? [];
      list.push(track);
      byFamily.set(familyId, list);
    }
  }
  if (byFamily.size === 0) return { pockets: [], proportional: false };

  const kept: Array<Omit<PlaylistPocket, "share">> = [];
  for (const [familyId, members] of byFamily) {
    const byGroove = new Map<string, { groove: PocketGroove | null; members: PocketTrack[] }>();
    for (const track of members) {
      const groove = grooveOf(track);
      const entry = byGroove.get(grooveKey(groove)) ?? { groove, members: [] };
      entry.members.push(track);
      byGroove.set(grooveKey(groove), entry);
    }
    const rest: PocketTrack[] = [];
    for (const { groove, members: grooveMembers } of byGroove.values()) {
      if (groove && large(grooveMembers.length)) kept.push(pocketOf(familyId, groove, grooveMembers));
      else rest.push(...grooveMembers);
    }
    // Grooves too small on their own (or not measured) still count together for their family.
    if (large(rest.length)) kept.push(pocketOf(familyId, null, rest));
  }

  if (kept.length > 0) {
    const chosen = kept.map((pocket) => ({ ...pocket })).sort(byCountThenKey).slice(0, maxPockets);
    return { pockets: withShares(chosen), proportional: true };
  }

  // Nothing large enough: the two most common families, any groove (the seed's old behaviour).
  const families = [...byFamily.entries()]
    .map(([familyId, members]) => pocketOf(familyId, null, members))
    .sort(byCountThenKey)
    .slice(0, fallbackFamilies);
  return { pockets: withShares(families), proportional: false };
}

/** The candidate's groove matches the pocket's (same kind and band). */
export function grooveMatches(pocket: Pick<PlaylistPocket, "groove">, track: Pick<PocketTrack, "energyBand" | "tempoBand">): boolean {
  if (!pocket.groove) return false;
  const band = pocket.groove.kind === "energy" ? track.energyBand : track.tempoBand;
  return Boolean(band) && band === pocket.groove.band;
}

/** A small ranking nudge for a candidate that shares the pocket's groove and moods. */
export function pocketFitBonus(
  pocket: Pick<PlaylistPocket, "groove" | "moods">,
  track: Pick<PocketTrack, "energyBand" | "tempoBand" | "moods">,
): number {
  const moods = new Set(normalMoods(track.moods));
  const sharedMoods = pocket.moods.filter((mood) => moods.has(mood)).length;
  return (grooveMatches(pocket, track) ? GROOVE_BONUS : 0) + Math.min(sharedMoods, MAX_MOOD_BONUSES) * MOOD_BONUS;
}

/** How many of `total` candidates a pocket with `share` asks for: at least `min`. */
export function pocketQuota(share: number, total: number, min = 3): number {
  return Math.max(min, Math.ceil(total * share));
}

/**
 * One list from several, in proportion to each list's share: at every step the
 * list furthest below its share gives its next item (ties go to the larger
 * share, then the earlier list). An exhausted list steps aside, so the others
 * fill the rest; a list with share 0 only gives once the others are empty.
 * Items already given by an earlier list are skipped.
 */
export function interleaveByShare<T>(
  lists: ReadonlyArray<{ share: number; items: ReadonlyArray<T> }>,
  keyOf: (item: T) => string,
): T[] {
  const cursors = lists.map(() => 0);
  const taken = lists.map(() => 0);
  const seen = new Set<string>();
  const out: T[] = [];
  for (;;) {
    let best = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < lists.length; i += 1) {
      while (cursors[i] < lists[i].items.length && seen.has(keyOf(lists[i].items[cursors[i]]))) cursors[i] += 1;
      if (cursors[i] >= lists[i].items.length) continue;
      const ratio = lists[i].share > 0 ? taken[i] / lists[i].share : Infinity;
      const better = best < 0 || ratio < bestRatio || (ratio === bestRatio && lists[i].share > lists[best].share);
      if (better) {
        best = i;
        bestRatio = ratio;
      }
    }
    if (best < 0) return out;
    const item = lists[best].items[cursors[best]];
    cursors[best] += 1;
    taken[best] += 1;
    seen.add(keyOf(item));
    out.push(item);
  }
}
