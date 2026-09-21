import {
  getReleaseArtworkUrl,
  getReleaseTrackStreamUrl,
  type Release,
} from "./api";
import type { LocalTrack } from "./localLibrary";

export function catalogArtistPlaybackTracks(releases: Release[]): LocalTrack[] {
  return releases.flatMap((release) =>
    (release.tracks || []).map((track) => ({
      id: track.id,
      title: track.title,
      artist:
        track.artist?.trim() ||
        release.primaryArtist?.trim() ||
        release.artist?.displayName?.trim() ||
        null,
      albumArtist: release.primaryArtist || release.artist?.displayName || null,
      album: release.title,
      year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
      genre: release.genre || null,
      duration: track.stems?.[0]?.durationSeconds ?? null,
      createdAt: track.createdAt,
      catalogTrackId: track.id,
      releaseId: release.id,
      remoteUrl: getReleaseTrackStreamUrl(release.id, track.id),
      remoteArtworkUrl:
        release.artworkUrl ||
        (release.artworkMimeType
          ? getReleaseArtworkUrl(release.id, { artworkRevision: release.artworkRevision })
          : undefined),
      source: "remote" as const,
    })),
  );
}
