export function artistProfileHref(artistProfileId: string) {
  return `/artist/${encodeURIComponent(artistProfileId)}`;
}

export function libraryArtistHref(artistName: string) {
  return `/library/artists/${encodeURIComponent(artistName)}`;
}

export function catalogArtistHref(artistName: string) {
  return `/catalog/artists/${encodeURIComponent(artistName)}`;
}

export function publicReleaseHref(releaseId: string) {
  return `/release/${encodeURIComponent(releaseId)}`;
}

export function libraryArtistsHref() {
  return "/library?tab=artists";
}

export function libraryAlbumsHref() {
  return "/library?tab=albums";
}

export function libraryAlbumHref(
  albumName: string,
  artistName: string,
  releaseId?: string | null,
) {
  const search = new URLSearchParams({
    tab: "albums",
    album: albumName,
    albumArtist: artistName,
  });
  if (releaseId) search.set("release", releaseId);
  return `/library?${search.toString()}`;
}

export function sharedLibraryReleaseId(
  tracks: Array<{ releaseId?: string | null }>,
): string | null {
  if (tracks.length === 0 || tracks.some((track) => !track.releaseId)) return null;
  const releaseIds = new Set(tracks.map((track) => track.releaseId));
  return releaseIds.size === 1 ? Array.from(releaseIds)[0] || null : null;
}

export function libraryArtistCatalogHref(
  artistName: string,
  tracks: Array<{ creditedArtistId?: string | null }>,
) {
  if (tracks.length > 0 && tracks.every((track) => Boolean(track.creditedArtistId))) {
    const artistIds = new Set(tracks.map((track) => track.creditedArtistId));
    if (artistIds.size === 1) {
      return artistProfileHref(Array.from(artistIds)[0]!);
    }
  }
  return catalogArtistHref(artistName);
}

export function legacyArtistAliasSearchName(alias: string) {
  return alias
    .trim()
    .replace(/^sample-artist-/i, "")
    .replace(/[-_]+/g, " ");
}

export function playerArtistHref(track: {
  artist?: string | null;
  catalogTrackId?: string | null;
  releaseId?: string | null;
}) {
  const artistName = track.artist?.trim();
  if (!artistName) return null;
  return track.catalogTrackId || track.releaseId
    ? catalogArtistHref(artistName)
    : libraryArtistHref(artistName);
}

export function legacyArtistAliasDestination(
  alias: string,
  artists: Array<{ name: string; artistId: string | null }>,
) {
  const normalizedAlias = alias.trim().toLowerCase();
  const slugAlias = normalizedAlias.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const aliasKeys = new Set([
    normalizedAlias,
    slugAlias,
    slugAlias.replace(/^sample-artist-/, ""),
  ]);
  const matches = artists.filter(
    (artist) => {
      const normalizedName = artist.name.trim().toLowerCase();
      const slugName = normalizedName.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return aliasKeys.has(normalizedName) || aliasKeys.has(slugName);
    },
  );
  if (matches.length === 0) return null;

  const profileIds = [...new Set(
    matches.map((artist) => artist.artistId).filter((id): id is string => Boolean(id)),
  )];
  return profileIds.length === 1
    ? artistProfileHref(profileIds[0])
    : catalogArtistHref(alias);
}

/**
 * The release's OWN backing artist profile — i.e. the uploader/owner profile,
 * which is NOT necessarily the credited primary artist (an uploader/manager can
 * publish a release credited to a different artist). Do NOT use this to link a
 * *displayed* artist name — that mis-links the artist's name to the uploader's
 * profile (the #1419 regression). Use `artistCreditHref` for any shown name.
 * Kept only for internal owner-match resolution below.
 */
export function releaseArtistProfileHref(input: {
  artist?: { id?: string | null } | null;
  artistId?: string | null;
}) {
  const profileId = input.artist?.id || input.artistId;
  return profileId ? artistProfileHref(profileId) : null;
}

/**
 * Resolve a *displayed* artist-credit name on a release to the correct profile
 * href (#1419). A release's shown name — the header primary artist, a per-track
 * credit, or the home hero "By …" — is free text that can differ from the
 * release's OWNER profile: an uploader/manager may publish a release credited to
 * another artist, so `release.artist.id` is the uploader, not the artist. We
 * link only to an id we can trust for THIS name:
 *   1. the release's own artist profile, when the name matches its displayName
 *      (the release really is by the owner artist); else
 *   2. a matching `artistCredits[]` row (covers the primary + featured artists);
 *      else
 *   3. the public catalog-credit route — never fabricate a profile id for
 *      free-text or unclaimed credits.
 */
export function artistCreditHref(
  displayedName: string | null | undefined,
  release: {
    artist?: { id?: string | null; displayName?: string | null } | null;
    artistId?: string | null;
    artistCredits?: Array<{ artistId: string; displayName: string }> | null;
  },
): string | null {
  const name = displayedName?.trim().toLowerCase();
  if (!name) return null;

  const ownerName = release.artist?.displayName?.trim().toLowerCase();
  const ownerHref = releaseArtistProfileHref(release);
  if (ownerHref && ownerName && name === ownerName) {
    return ownerHref;
  }

  const credit = release.artistCredits?.find(
    (c) => c.displayName?.trim().toLowerCase() === name,
  );
  if (credit?.artistId) {
    return artistProfileHref(credit.artistId);
  }

  return catalogArtistHref(displayedName!.trim());
}
