import { createHash } from "crypto";
import { resolveCreditedArtistName } from "../shared/artist_attribution";

/** The descriptive metadata a track embedding is computed from. */
export interface TrackEmbeddingSource {
  title: string;
  /** `Track.artist` credited-artist override. */
  artist?: string | null;
  release?: {
    title?: string | null;
    genre?: string | null;
    moods?: string[] | null;
    primaryArtist?: string | null;
    featuredArtists?: string | null;
    artist?: { displayName?: string | null } | null;
    artistCredits?: Array<{ role: string; displayName: string }> | null;
  } | null;
}

function clean(value?: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Stable text a track is embedded from: title, credited artist, featured
 * artists, release title (when it adds information), genre and moods. Pure and
 * deterministic: the same metadata always yields the same string, so the
 * content hash only changes when the descriptive metadata does. No listener,
 * play or commercial data is included.
 */
export function trackEmbeddingText(track: TrackEmbeddingSource): string {
  const release = track.release ?? null;
  const title = clean(track.title);
  const artist = resolveCreditedArtistName({
    trackArtist: track.artist,
    credits: release?.artistCredits,
    primaryArtist: release?.primaryArtist,
    accountDisplayName: release?.artist?.displayName,
  });
  const featured = clean(release?.featuredArtists);
  const releaseTitle = clean(release?.title);
  const genre = clean(release?.genre);
  const moods = [
    ...new Set(
      (release?.moods ?? []).map((mood) => clean(mood).toLowerCase()).filter(Boolean),
    ),
  ].sort();

  const lines = [`Title: ${title}`];
  if (artist) lines.push(`Artist: ${artist}`);
  if (featured) lines.push(`Featured artists: ${featured}`);
  if (releaseTitle && releaseTitle.toLowerCase() !== title.toLowerCase()) {
    lines.push(`Release: ${releaseTitle}`);
  }
  if (genre) lines.push(`Genre: ${genre}`);
  if (moods.length) lines.push(`Moods: ${moods.join(", ")}`);
  return lines.join("\n");
}

/** sha256 over the embedding model id and text; changes with either. */
export function trackEmbeddingContentHash(text: string, model: string): string {
  return createHash("sha256").update(`${model}\n${text}`).digest("hex");
}
