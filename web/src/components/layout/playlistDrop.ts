/*
 * Dropping tracks onto a playlist — shared by the playlist panel and the
 * library's playlist cards. The payload/effect/toast decisions are pure and
 * unit-tested; `applyPlaylistDrop` performs the store writes.
 */
import { getTrack } from "../../lib/localLibrary";
import {
  addTrackToPlaylist,
  addTracksByCriteria,
  addTracksToPlaylist,
  getPlaylist,
  type Playlist,
} from "../../lib/playlistStore";

/**
 * The `dropEffect` a playlist drop target must advertise during `dragover`.
 *
 * A browser silently refuses a drop whose `dropEffect` is not allowed by the
 * source's `effectAllowed`. Library, catalog and release rows drag with
 * `effectAllowed = "copy"`; only a playlist's own track rows drag with
 * `"move"` (reorder). Advertising `"move"` for everything broke dropping
 * library tracks onto an expanded playlist, so: copy whenever the source allows
 * it, move only for a move-only (internal reorder) drag.
 */
export function playlistDropEffect(
  effectAllowed: DataTransfer["effectAllowed"] | undefined | null,
): "copy" | "move" {
  switch (effectAllowed) {
    case "move":
    case "linkMove":
      return "move";
    default:
      return "copy";
  }
}

export type PlaylistDropRequest =
  | { kind: "reorder"; playlistId: string; index: number }
  | { kind: "tracks"; trackIds: string[]; title?: string }
  | { kind: "criteria"; criteria: { album?: string; artist?: string }; title: string };

type TrackLike = { id?: unknown; title?: unknown };

function trackIdsOf(tracks: unknown): string[] {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .map((track: TrackLike) => (typeof track?.id === "string" ? track.id : null))
    .filter((id): id is string => Boolean(id));
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Normalize every drag payload shape the app produces (library tracks, a
 * multi-selection, album and artist cards, release tracks/selections, playlist
 * reorder) into one request. Returns null for anything unrecognised.
 */
export function parsePlaylistDropPayload(raw: string | null | undefined): PlaylistDropRequest | null {
  if (!raw) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (data.type) {
    case "reorder-track":
      return typeof data.playlistId === "string" && typeof data.index === "number"
        ? { kind: "reorder", playlistId: data.playlistId, index: data.index }
        : null;
    case "track":
      return typeof data.id === "string"
        ? { kind: "tracks", trackIds: [data.id], title: text(data.title) }
        : null;
    case "release-track": {
      const track = data.track as TrackLike | undefined;
      return typeof track?.id === "string"
        ? { kind: "tracks", trackIds: [track.id], title: text(track.title) ?? text(data.title) }
        : null;
    }
    case "album":
    case "release-selection":
    case "release-album": {
      const trackIds = trackIdsOf(data.tracks);
      if (trackIds.length > 0) {
        return {
          kind: "tracks",
          trackIds,
          title: trackIds.length === 1 ? undefined : text(data.name) ?? text(data.title),
        };
      }
      // Legacy album payloads without a track list resolve from the library.
      const album = text(data.name);
      return data.type === "album" && album
        ? { kind: "criteria", criteria: { album, artist: text(data.artist) }, title: album }
        : null;
    }
    case "artist": {
      const artist = text(data.name);
      return artist ? { kind: "criteria", criteria: { artist }, title: artist } : null;
    }
    default:
      return null;
  }
}

/** Toast copy for a finished drop, given how many tracks were actually new. */
export function playlistDropToast(
  playlistName: string,
  requested: number,
  added: number,
  title?: string,
): { type: "success" | "info"; title: string; message: string } {
  if (added === 0) {
    return {
      type: "info",
      title: "Already in playlist",
      message: requested === 1 && title
        ? `"${title}" is already in ${playlistName}.`
        : `Those tracks are already in ${playlistName}.`,
    };
  }
  const skipped = Math.max(0, requested - added);
  const what = added === 1 && title && requested === 1 ? `"${title}"` : `${added} track${added === 1 ? "" : "s"}`;
  return {
    type: "success",
    title: added > 1 ? "Tracks Added" : "Track Added",
    message: `Added ${what} to ${playlistName}${skipped > 0 ? ` (${skipped} already there)` : ""}.`,
  };
}

export type PlaylistAddRequest = Exclude<PlaylistDropRequest, { kind: "reorder" }>;

export type PlaylistDropOutcome =
  | { ok: false }
  | { ok: true; playlist: Playlist; requested: number; added: number; title?: string };

/**
 * Add a dropped request to a playlist. `ok: false` means nothing could be
 * written (the playlist is missing from this device's store) and must be
 * reported as a failure, never as "added". `added` counts tracks that were
 * actually new — duplicates are skipped by the store.
 */
export async function applyPlaylistDrop(
  playlistId: string,
  request: PlaylistAddRequest,
  index?: number,
): Promise<PlaylistDropOutcome> {
  const before = await getPlaylist(playlistId);
  if (!before) return { ok: false };

  let result: Playlist | null;
  let requested: number;
  let title: string | undefined;
  if (request.kind === "tracks") {
    requested = request.trackIds.length;
    title = request.title;
    if (requested === 1) {
      if (!title) title = (await getTrack(request.trackIds[0]))?.title;
      result = await addTrackToPlaylist(playlistId, request.trackIds[0], index);
    } else {
      result = await addTracksToPlaylist(playlistId, request.trackIds, index);
    }
  } else {
    title = request.title;
    result = await addTracksByCriteria(playlistId, request.criteria);
    requested = result ? Math.max(0, result.trackIds.length - before.trackIds.length) : 0;
  }

  if (!result) return { ok: false };
  const added = Math.max(0, result.trackIds.length - before.trackIds.length);
  return { ok: true, playlist: result, requested, added, title };
}
