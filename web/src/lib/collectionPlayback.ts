import type { LocalTrack } from "./localLibrary";
import type { QueueSource } from "./listeningSession";

/**
 * A collection (playlist, album, release, artist) as the header Play button
 * sees it: the ids of the tracks it plays, and the playlist id when the
 * player records one as the queue's source.
 */
export type PlaybackCollection = {
  trackIds: readonly string[];
  playlistId?: string;
};

type PlayerSnapshot = {
  queue: readonly LocalTrack[];
  currentTrack: LocalTrack | null;
  queueSource: QueueSource;
};

const trackKeys = (track: LocalTrack) =>
  track.catalogTrackId && track.catalogTrackId !== track.id ? [track.id, track.catalogTrackId] : [track.id];

/**
 * True when the player's current queue came from this collection, so its
 * header button should pause or resume instead of starting over.
 *
 * A playlist matches by the source the player recorded when it was started,
 * as long as the current track still belongs to it. Other collections have
 * no recorded source, so they match when the queue holds exactly their
 * tracks (in any order, so shuffle doesn't break the match).
 */
export function isCollectionActive(player: PlayerSnapshot, collection: PlaybackCollection): boolean {
  const { queue, currentTrack, queueSource } = player;
  if (!currentTrack || collection.trackIds.length === 0) return false;
  const ids = new Set(collection.trackIds);
  if (!trackKeys(currentTrack).some((key) => ids.has(key))) return false;

  if (collection.playlistId && queueSource?.playlistId === collection.playlistId) return true;

  if (queue.length !== collection.trackIds.length) return false;
  const remaining = new Map<string, number>();
  for (const id of collection.trackIds) remaining.set(id, (remaining.get(id) ?? 0) + 1);
  for (const track of queue) {
    const key = trackKeys(track).find((candidate) => (remaining.get(candidate) ?? 0) > 0);
    if (!key) return false;
    remaining.set(key, remaining.get(key)! - 1);
  }
  return true;
}
