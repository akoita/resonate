import {
  getReleaseTrackStreamUrl,
  getStemPreviewUrl,
  type Release,
  type Track,
} from "./api";
import { getTrackArtistName } from "./catalogDisplay";
import type { LocalTrack } from "./localLibrary";

/**
 * Catalog release → library tracks, as used by the catalog card actions
 * ("Add to playlist", "Save to library") on `/catalog` and the home catalog
 * snapshot, and by the home page's recommendation/vibe helpers.
 *
 * Mixer stems (anything but the original/master) point at their public preview
 * and are never encrypted; the original/master keeps its stored URI and
 * encryption metadata.
 */
export function mapReleaseToLocalTracks(release: Release): LocalTrack[] {
  return (release.tracks ?? []).map((track) => ({
    id: track.id,
    title: track.title,
    artist: getTrackArtistName(track, release),
    albumArtist: null,
    album: release.title,
    year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
    genre: release.genre || null,
    duration: getTrackDuration(track),
    createdAt: track.createdAt ? new Date(track.createdAt).toISOString() : release.createdAt,
    catalogTrackId: track.id,
    artistId: release.artist?.id || release.artistId,
    releaseId: release.id,
    aiDisclosure: track.aiDisclosure,
    remoteUrl: getReleaseTrackStreamUrl(release.id, track.id),
    remoteArtworkUrl: release.artworkUrl || undefined,
    source: "remote",
    stems: track.stems?.map((stem) => ({
      id: stem.id,
      type: stem.type,
      uri: isMixerStem(stem.type) ? getStemPreviewUrl(stem.id) : stem.uri,
      durationSeconds: stem.durationSeconds,
      isEncrypted: isMixerStem(stem.type) ? false : stem.isEncrypted,
      encryptionMetadata: isMixerStem(stem.type) ? null : stem.encryptionMetadata,
    })),
  }));
}

function getTrackDuration(track: Track) {
  return track.stems?.[0]?.durationSeconds ?? null;
}

export function isMixerStem(type?: string | null) {
  const normalized = type?.trim().toLowerCase();
  return !!normalized && normalized !== "original" && normalized !== "master";
}
