import type { PublicPlaylistSummary, Release, Track } from "./api";

const MAIN_ARTIST_CREDIT_ROLES = new Set(["main", "primary"]);

export type CatalogArtistSummary = {
  key: string;
  name: string;
  artistId: string | null;
  releaseCount: number;
  stemCount: number;
  latestRelease?: Release;
  latestAt: number;
  genres: Set<string>;
};

export type CatalogStemSummary = {
  id: string;
  releaseId: string;
  releaseTitle: string;
  title: string;
  type: string;
  artistName: string;
  artworkUrl?: string | null;
  createdAt: string;
};

export function getArtistName(release: Release) {
  const mainCredits = getMainArtistCredits(release);
  if (mainCredits.length > 0) {
    return mainCredits.map((credit) => credit.displayName).join(", ");
  }
  return release.primaryArtist || release.artist?.displayName || "Unknown Artist";
}

export function getArtistProfileName(release: Release) {
  return release.artist?.displayName || release.primaryArtist || "Unknown Artist";
}

export function normalizeArtistName(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

export function getMainArtistCredits(release: Release) {
  return (release.artistCredits || [])
    .filter((credit) => MAIN_ARTIST_CREDIT_ROLES.has(credit.role.toLowerCase()))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName));
}

export function normalizeArtistCreditValue(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/^[\s._-]*\d+[\s._-]+/, "")
    .replace(/[\s._-]+/g, " ");
}

export function getReleaseCreditProfileId(release: Release) {
  const mainCredit = getMainArtistCredits(release)[0];
  if (mainCredit?.artistId) return mainCredit.artistId;

  const primaryArtist = normalizeArtistName(release.primaryArtist);
  const profileName = normalizeArtistName(release.artist?.displayName);
  if (!release.artist?.id) return null;
  return !primaryArtist || primaryArtist === profileName ? release.artist.id : null;
}

export function getTrackArtistName(track: Track, release: Release) {
  const trackArtist = track.artist?.trim();
  const releaseArtist = getArtistName(release);
  if (!trackArtist) return releaseArtist;

  if (normalizeArtistCreditValue(trackArtist) === normalizeArtistCreditValue(track.title)) {
    return releaseArtist;
  }

  return trackArtist;
}

export function getCatalogSortTime(release: Release) {
  const raw = release.createdAt || release.releaseDate;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function flattenCatalogStems(releases: Release[]): CatalogStemSummary[] {
  return releases.flatMap((release) =>
    (release.tracks ?? []).flatMap((track) =>
      (track.stems ?? []).map((stem) => ({
        id: stem.id,
        releaseId: release.id,
        releaseTitle: release.title,
        title: stem.title || track.title,
        type: stem.type || "stem",
        artistName: stem.artist || getTrackArtistName(track, release),
        artworkUrl: stem.artworkUrl || release.artworkUrl,
        createdAt: track.createdAt || release.createdAt,
      })),
    ),
  );
}

/** Filter public playlists for catalog search (by name and owner display name). */
export function filterPublicPlaylists(
  playlists: PublicPlaylistSummary[],
  search: string,
): PublicPlaylistSummary[] {
  if (!search) return playlists;
  return playlists.filter((playlist) =>
    [playlist.name, playlist.ownerDisplayName].some((value) =>
      value?.toLowerCase().includes(search),
    ),
  );
}

export function summarizeCreditedArtists(releases: Release[]): CatalogArtistSummary[] {
  return summarizeArtists(releases, (release) => {
    const credits = getMainArtistCredits(release);
    return credits.length > 0
      ? credits.map((credit) => ({
          name: credit.displayName,
          artistId: credit.artistId || credit.artist?.id || null,
        }))
      : [{
          name: getArtistName(release),
          artistId: getReleaseCreditProfileId(release),
        }];
  });
}

export function summarizeManagedArtists(releases: Release[]): CatalogArtistSummary[] {
  return summarizeArtists(releases, (release) => [{
    name: getArtistProfileName(release),
    artistId: release.artist?.id || release.artistId || null,
  }]);
}

function summarizeArtists(
  releases: Release[],
  getCredits: (release: Release) => Array<{ name: string; artistId: string | null }>,
) {
  const byArtist = new Map<string, CatalogArtistSummary>();

  for (const release of releases) {
    const credits = getCredits(release);
    const stemCount = release.tracks?.reduce(
      (sum, track) => sum + (track.stems?.length ?? 0),
      0,
    ) ?? 0;
    const latestAt = getCatalogSortTime(release);

    for (const credit of credits) {
      const name = credit.name || "Unknown Artist";
      const artistId = credit.artistId;
      const key = artistId || normalizeArtistName(name) || release.id;
      const existing = byArtist.get(key);

      if (!existing) {
        byArtist.set(key, {
          key,
          name,
          artistId,
          releaseCount: 1,
          stemCount,
          latestRelease: release,
          latestAt,
          genres: new Set(release.genre ? [release.genre] : []),
        });
        continue;
      }

      existing.releaseCount += 1;
      existing.stemCount += stemCount;
      if (release.genre) existing.genres.add(release.genre);
      if (!existing.artistId && artistId) existing.artistId = artistId;
      if (latestAt > existing.latestAt) {
        existing.latestAt = latestAt;
        existing.latestRelease = release;
      }
    }
  }

  return Array.from(byArtist.values()).sort((a, b) => b.latestAt - a.latestAt);
}
