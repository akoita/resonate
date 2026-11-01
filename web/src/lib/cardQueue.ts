import {
  getPublicPlaylistAPI,
  getRelease,
  listArtistReleases,
  listPublishedReleases,
  type Release,
} from "./api";
import { catalogArtistPlaybackTracks } from "./catalogArtistPlayback";
import { getCatalogSortTime } from "./catalogDisplay";
import type { LocalTrack } from "./localLibrary";
import { publicPlaylistTrackToLocal } from "./publicPlaylistTracks";
import { queueableTracks } from "../components/library/trackAvailability";

/**
 * What a card in a grid or rail stands for, as far as the queue is concerned.
 *
 * Cards are queued straight from where they sit: a
 * listener should not have to open a release, or start playing it, just to
 * line it up. Some cards already hold the tracks they stand for (catalog
 * grids load whole releases); others only carry ids (home rails), and their
 * tracks are fetched on demand, only when the listener asks to queue them.
 */
export type CardQueueTarget =
  /** A release whose tracks are already loaded. */
  | { kind: "release"; title: string; release: Release }
  /** One track of a release (home feed and trending tiles). */
  | { kind: "track"; title: string; releaseId: string; trackId: string }
  /** An artist whose releases are already loaded (catalog Artists grid). */
  | { kind: "artist"; title: string; releases: Release[] }
  /** An artist known only by profile id and/or name (Top Artists). */
  | { kind: "artistRef"; title: string; artistId: string | null; name: string }
  /** A public playlist known by id. */
  | { kind: "playlist"; title: string; playlistId: string };

/** Releases fetched for an artist known only by name (matches the catalog artist page). */
const ARTIST_RELEASE_LIMIT = 100;

/** True when the card can say up front that it has nothing to queue. */
export function cardQueueIsEmpty(target: CardQueueTarget): boolean {
  if (target.kind === "release") return !target.release.tracks?.length;
  if (target.kind === "artist") return !target.releases.some((release) => release.tracks?.length);
  return false;
}

/**
 * The playable tracks a card stands for, in listening order. Resolving never
 * touches playback: callers hand the result to the queue.
 */
export async function resolveCardQueueTracks(target: CardQueueTarget): Promise<LocalTrack[]> {
  switch (target.kind) {
    case "release":
      return catalogArtistPlaybackTracks([target.release]);
    case "track": {
      const tracks = catalogArtistPlaybackTracks([await getRelease(target.releaseId)]);
      return tracks.filter((track) => track.id === target.trackId);
    }
    case "artist":
      return dedupeTracks(catalogArtistPlaybackTracks(target.releases));
    case "artistRef": {
      const releases = target.artistId
        ? await listArtistReleases(target.artistId)
        : await listPublishedReleases(ARTIST_RELEASE_LIMIT, target.name);
      return dedupeTracks(catalogArtistPlaybackTracks(newestFirst(releases)));
    }
    case "playlist": {
      const playlist = await getPublicPlaylistAPI(target.playlistId);
      return queueableTracks(playlist?.tracks ?? []).map(publicPlaylistTrackToLocal);
    }
  }
}

/** A track credited twice on one artist (two credits on one release) is queued once. */
function dedupeTracks(tracks: LocalTrack[]): LocalTrack[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function newestFirst(releases: Release[]): Release[] {
  return [...releases].sort((left, right) => getCatalogSortTime(right) - getCatalogSortTime(left));
}
