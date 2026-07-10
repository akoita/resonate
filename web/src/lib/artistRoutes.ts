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
 * "Id present -> always link" rule (#1419): whenever a surface already has a
 * genuine profile id for the artist being displayed (e.g. a release's own
 * `artist`, or a release-level `artistCredits[]` entry), it should link with
 * this helper rather than gating on a free-text name match. The name-match
 * heuristic in `releaseArtistCreditHref` exists only for surfaces that show a
 * free-text credit string with no reliable id backing it, where a mismatch
 * would otherwise send the user to the wrong artist's profile.
 */
export function releaseArtistProfileHref(input: {
  artist?: { id?: string | null } | null;
  artistId?: string | null;
}) {
  const profileId = input.artist?.id || input.artistId;
  return profileId ? artistProfileHref(profileId) : null;
}

export function releaseArtistCreditHref(input: {
  artist?: { id?: string | null; displayName?: string | null } | null;
  artistId?: string | null;
  primaryArtist?: string | null;
}) {
  const profileHref = releaseArtistProfileHref(input);
  if (!profileHref) return null;

  const profileName = input.artist?.displayName?.trim().toLowerCase();
  const primaryCredit = input.primaryArtist?.trim().toLowerCase();

  if (!primaryCredit || (profileName && primaryCredit === profileName)) {
    return profileHref;
  }

  return null;
}

/**
 * Per-track artist credit link (#1419). A track's displayed artist credit is
 * free text (`track.artist`, falling back to the release's primary artist),
 * so it carries no id of its own — linking it blindly risks sending the user
 * to an unrelated profile. Instead we only link when the credit's name
 * matches a *known, id-backed* credit on the release: the release's own
 * artist, or one of its `artistCredits[]` rows (which covers featured
 * artists too). Anything else stays plain text.
 */
export function trackArtistCreditHref(
  trackArtistName: string | null | undefined,
  release: {
    artist?: { id?: string | null; displayName?: string | null } | null;
    artistId?: string | null;
    artistCredits?: Array<{ artistId: string; displayName: string }> | null;
  },
): string | null {
  const name = trackArtistName?.trim().toLowerCase();
  if (!name) return null;

  const mainHref = releaseArtistProfileHref(release);
  const mainName = release.artist?.displayName?.trim().toLowerCase();
  if (mainHref && mainName && name === mainName) {
    return mainHref;
  }

  const credit = release.artistCredits?.find(
    (c) => c.displayName?.trim().toLowerCase() === name,
  );
  if (credit?.artistId) {
    return artistProfileHref(credit.artistId);
  }

  return null;
}
