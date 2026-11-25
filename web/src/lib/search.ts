/**
 * Top-bar search (#2671): one request for artists, releases, tracks and
 * public playlists, flattened into one keyboard order for the results panel.
 */
import { API_BASE, ApiRequestError, getReleaseArtworkUrl } from "./api";

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 250;

export type SearchArtist = { id: string; displayName: string; imageUrl: string | null };
export type SearchRelease = {
  id: string;
  title: string;
  type: string;
  artistName: string;
  hasArtwork: boolean;
  artworkRevision: number;
};
export type SearchTrack = {
  id: string;
  title: string;
  artistName: string;
  releaseId: string;
  releaseTitle: string;
  hasArtwork: boolean;
  artworkRevision: number;
};
export type SearchPlaylist = {
  id: string;
  name: string;
  ownerDisplayName: string | null;
  playableTrackCount: number;
};
export type SearchResults = {
  query: string;
  artists: SearchArtist[];
  releases: SearchRelease[];
  tracks: SearchTrack[];
  playlists: SearchPlaylist[];
};

export type SearchGroupKey = "artists" | "releases" | "tracks" | "playlists";

export const SEARCH_GROUP_LABELS: Record<SearchGroupKey, string> = {
  artists: "Artists",
  releases: "Releases",
  tracks: "Tracks",
  playlists: "Playlists",
};

/** One row in the results panel. */
export type SearchOption = {
  /** Unique within one result set; used for the option's DOM id. */
  key: string;
  group: SearchGroupKey;
  label: string;
  detail: string;
  href: string;
  imageUrl: string | null;
};

export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function shouldSearch(raw: string): boolean {
  return normalizeQuery(raw).length >= SEARCH_MIN_QUERY_LENGTH;
}

function releaseTypeLabel(type: string): string {
  if (type === "ep") return "EP";
  if (!type) return "Release";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Group order is the reading order: artists, releases, tracks, playlists. */
export function toSearchOptions(results: SearchResults): Array<{ group: SearchGroupKey; options: SearchOption[] }> {
  const artwork = (releaseId: string, hasArtwork: boolean, artworkRevision: number) =>
    hasArtwork ? getReleaseArtworkUrl(releaseId, { artworkRevision }) : null;
  const groups: Array<{ group: SearchGroupKey; options: SearchOption[] }> = [
    {
      group: "artists",
      options: results.artists.map((artist) => ({
        key: `artist-${artist.id}`,
        group: "artists",
        label: artist.displayName,
        detail: "Artist",
        href: `/artist/${encodeURIComponent(artist.id)}`,
        imageUrl: artist.imageUrl,
      })),
    },
    {
      group: "releases",
      options: results.releases.map((release) => ({
        key: `release-${release.id}`,
        group: "releases",
        label: release.title,
        detail: `${releaseTypeLabel(release.type)} · ${release.artistName}`,
        href: `/release/${encodeURIComponent(release.id)}`,
        imageUrl: artwork(release.id, release.hasArtwork, release.artworkRevision),
      })),
    },
    {
      group: "tracks",
      options: results.tracks.map((track) => ({
        key: `track-${track.id}`,
        group: "tracks",
        label: track.title,
        detail: `${track.artistName} · ${track.releaseTitle}`,
        href: `/release/${encodeURIComponent(track.releaseId)}`,
        imageUrl: artwork(track.releaseId, track.hasArtwork, track.artworkRevision),
      })),
    },
    {
      group: "playlists",
      options: results.playlists.map((playlist) => ({
        key: `playlist-${playlist.id}`,
        group: "playlists",
        label: playlist.name,
        detail: [playlist.ownerDisplayName, plural(playlist.playableTrackCount, "track")].filter(Boolean).join(" · "),
        href: `/playlist/${encodeURIComponent(playlist.id)}`,
        imageUrl: null,
      })),
    },
  ];
  return groups.filter((entry) => entry.options.length > 0);
}

/** Next option index for an arrow key, wrapping at both ends; -1 means none. */
export function moveActive(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

export async function searchEverything(query: string, signal?: AbortSignal): Promise<SearchResults> {
  const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(normalizeQuery(query))}`, { signal });
  if (!response.ok) {
    throw new ApiRequestError("Search failed", response.status, null);
  }
  return (await response.json()) as SearchResults;
}
