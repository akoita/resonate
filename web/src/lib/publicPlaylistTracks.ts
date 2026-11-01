import { API_BASE, type PublicPlaylistTrack } from "./api";
import type { LocalTrack } from "./localLibrary";

/** Map a resolved public playlist track into the player's LocalTrack shape. */
export function publicPlaylistTrackToLocal(t: PublicPlaylistTrack): LocalTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    albumArtist: null,
    album: t.album,
    year: null,
    genre: null,
    duration: t.duration,
    createdAt: new Date().toISOString(),
    catalogTrackId: t.catalogTrackId,
    releaseId: t.releaseId,
    remoteUrl: t.streamPath ? `${API_BASE}${t.streamPath}` : undefined,
    remoteArtworkUrl: t.artworkPath ? `${API_BASE}${t.artworkPath}` : undefined,
    source: "remote",
  };
}
