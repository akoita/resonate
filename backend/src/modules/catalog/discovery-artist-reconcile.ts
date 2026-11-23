import type {
  DiscoveryArtistEngagementRow,
  DiscoveryTrackPopularityRow,
} from "./discovery-popularity-export.service";

/**
 * Reconcile the warehouse artist mart with the track mart through the
 * CURRENT catalog credits.
 *
 * The warehouse attributes listens to artists from ids stamped on analytics
 * events. When a stamp is missing or out of date for a track, its artist can
 * drop out of Top Artists while the track still charts in Trending, and the
 * gap can open or close from one hourly snapshot to the next. Trending is keyed
 * by track and is not affected.
 *
 * Every charting track therefore also contributes, through its current
 * non-ambiguous credits, a derived artist row: summed score, plays, saves and
 * purchases, and the largest single-track audience as a lower bound of the
 * artist's distinct listeners. Each metric takes the larger of the warehouse
 * value and the derived value. With correct attribution the warehouse row
 * already covers every charting track, so the result equals the warehouse row;
 * with broken attribution the derived row keeps the artist ranked.
 *
 * Warehouse rows for artist ids that no current credit names (an old duplicate
 * profile, for example) are dropped, so a stale id never ranks beside the
 * current one.
 */
export function reconcileArtistEngagement(
  artistRows: DiscoveryArtistEngagementRow[],
  trackRows: DiscoveryTrackPopularityRow[],
  creditedArtistIdsByTrack: ReadonlyMap<string, readonly string[]>,
  currentlyCreditedArtistIds: ReadonlySet<string>,
): DiscoveryArtistEngagementRow[] {
  const key = (row: { window: string; genre: string; artistId: string }) =>
    `${row.window}\u0000${row.genre}\u0000${row.artistId}`;

  const derived = new Map<string, DiscoveryArtistEngagementRow>();
  for (const track of trackRows) {
    for (const artistId of new Set(creditedArtistIdsByTrack.get(track.trackId) ?? [])) {
      const id = { window: track.window, genre: track.genre, artistId };
      const existing = derived.get(key(id));
      if (!existing) {
        derived.set(key(id), {
          ...id,
          score: track.score,
          plays: track.plays,
          uniqueListeners: track.uniqueListeners,
          saves: track.saves,
          purchases: track.purchases,
          computedAt: track.computedAt,
        });
        continue;
      }
      existing.score += track.score;
      existing.plays += track.plays;
      existing.saves += track.saves;
      existing.purchases += track.purchases;
      existing.uniqueListeners = Math.max(existing.uniqueListeners, track.uniqueListeners);
      if (track.computedAt < existing.computedAt) existing.computedAt = track.computedAt;
    }
  }

  const merged = new Map<string, DiscoveryArtistEngagementRow>();
  for (const row of artistRows) {
    if (!currentlyCreditedArtistIds.has(row.artistId)) continue;
    merged.set(key(row), { ...row });
  }
  for (const [rowKey, row] of derived) {
    const warehouse = merged.get(rowKey);
    if (!warehouse) {
      merged.set(rowKey, row);
      continue;
    }
    merged.set(rowKey, {
      ...warehouse,
      score: Math.max(warehouse.score, row.score),
      plays: Math.max(warehouse.plays, row.plays),
      uniqueListeners: Math.max(warehouse.uniqueListeners, row.uniqueListeners),
      saves: Math.max(warehouse.saves, row.saves),
      purchases: Math.max(warehouse.purchases, row.purchases),
    });
  }

  return [...merged.values()].sort((left, right) =>
    left.window.localeCompare(right.window) ||
    left.genre.localeCompare(right.genre) ||
    left.artistId.localeCompare(right.artistId),
  );
}
