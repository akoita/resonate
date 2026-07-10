export function artistProfileHref(artistProfileId: string) {
  return `/artist/${encodeURIComponent(artistProfileId)}`;
}

export function libraryArtistHref(artistName: string) {
  return `/library/artists/${encodeURIComponent(artistName)}`;
}

export function catalogArtistHref(artistName: string) {
  return `/catalog/artists/${encodeURIComponent(artistName)}`;
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
 *   3. nothing — never mis-link a free-text credit to an unrelated profile.
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

  return null;
}
