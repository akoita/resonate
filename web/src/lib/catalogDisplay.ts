import {
  getReleaseArtworkUrl,
  type PublicPlaylistSummary,
  type Release,
  type Track,
} from "./api";

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
  trackId: string;
  trackTitle: string;
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
  return mainCredit?.identityStatus !== "ambiguous"
    ? mainCredit?.artistId ?? null
    : null;
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
        trackId: track.id,
        trackTitle: track.title,
        title: stem.title || track.title,
        type: stem.type || "stem",
        artistName: stem.artist || getTrackArtistName(track, release),
        artworkUrl: stem.artworkUrl || getCatalogReleaseArtworkUrl(release),
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
          artistId: credit.identityStatus === "ambiguous"
            ? null
            : credit.artistId || credit.artist?.id || null,
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

/** Cover URL for a public catalog release: the explicit artwork URL, else the
 *  canonical (revisioned) artwork endpoint when the release stores artwork. */
export function getCatalogReleaseArtworkUrl(release: Release): string | undefined {
  return release.artworkUrl
    || (release.artworkMimeType
      ? getReleaseArtworkUrl(release.id, { artworkRevision: release.artworkRevision })
      : undefined);
}

/** `1 release`, `2 releases`, `1 match`/`3 matches` (with an explicit plural). */
export function formatCount(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

/** Compact age of a catalog addition: `5m ago`, `3h ago`, `12d ago`, else a date. */
export function formatCatalogAge(time: number, now: number = Date.now()) {
  if (!time) return "Unknown";
  const diffMs = now - time;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  if (diffMs < 30 * day) return `${Math.round(diffMs / day)}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Release type for display: `single` → `Single`, `ep` → `EP`, missing → `Release`. */
export function formatReleaseType(type?: string | null) {
  const value = (type || "").trim();
  if (!value) return "Release";
  if (value.toLowerCase() === "ep") return "EP";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

const FULL_MIX_STEM_TYPES = new Set(["original", "full", "master"]);
const STEM_TYPE_ORDER = ["full mix", "vocals", "drums", "bass", "piano", "guitar", "other"];

/** Sentence-case label for a stem type; source mixes read as `Full mix`. */
export function formatStemType(type: string) {
  const normalized = type.trim().toLowerCase();
  if (FULL_MIX_STEM_TYPES.has(normalized)) return "Full mix";
  const words = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return "Stem";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function stemTypeRank(label: string) {
  const index = STEM_TYPE_ORDER.indexOf(label.toLowerCase());
  return index === -1 ? STEM_TYPE_ORDER.length : index;
}

/** Order stem types Full mix, Vocals, Drums, Bass, Piano, Guitar, Other, then
 *  unknown types alphabetically; types with the same label appear once. */
export function orderStemTypes(types: string[]) {
  const byLabel = new Map<string, string>();
  for (const type of types) {
    const normalized = type.trim().toLowerCase();
    const label = formatStemType(normalized);
    if (!byLabel.has(label)) byLabel.set(label, normalized);
  }
  return Array.from(byLabel.entries())
    .sort(([left], [right]) => stemTypeRank(left) - stemTypeRank(right) || left.localeCompare(right))
    .map(([, type]) => type);
}

export type CatalogStemTrackGroup = {
  key: string;
  trackId: string;
  releaseId: string;
  trackTitle: string;
  releaseTitle: string;
  artistName: string;
  artworkUrl?: string | null;
  /** Normalized stem types, ordered for display (see `orderStemTypes`). */
  stemTypes: string[];
  stemCount: number;
};

/** One entry per track, preserving the order in which tracks first appear. */
export function groupCatalogStemsByTrack(stems: CatalogStemSummary[]): CatalogStemTrackGroup[] {
  const groups = new Map<string, CatalogStemTrackGroup & { rawTypes: string[] }>();
  for (const stem of stems) {
    const key = `${stem.releaseId}:${stem.trackId}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        trackId: stem.trackId,
        releaseId: stem.releaseId,
        trackTitle: stem.trackTitle,
        releaseTitle: stem.releaseTitle,
        artistName: stem.artistName,
        artworkUrl: stem.artworkUrl,
        stemTypes: [],
        rawTypes: [stem.type],
        stemCount: 1,
      });
      continue;
    }
    existing.stemCount += 1;
    existing.rawTypes.push(stem.type);
    if (!existing.artworkUrl && stem.artworkUrl) existing.artworkUrl = stem.artworkUrl;
  }
  return Array.from(groups.values()).map(({ rawTypes, ...group }) => ({
    ...group,
    stemTypes: orderStemTypes(rawTypes),
  }));
}

/** Most frequent release genres (ties alphabetical), deduped case-insensitively
 *  and keeping the first spelling seen. */
export function topCatalogGenres(releases: Release[], limit: number) {
  const byKey = new Map<string, { label: string; count: number }>();
  for (const release of releases) {
    const label = release.genre?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { label, count: 1 });
  }
  return Array.from(byKey.values())
    .sort((left, right) =>
      right.count - left.count
      || left.label.toLowerCase().localeCompare(right.label.toLowerCase()),
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.label);
}
