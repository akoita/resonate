export function artistProfileHref(artistProfileId: string) {
  return `/artist/${encodeURIComponent(artistProfileId)}`;
}

export function libraryArtistHref(artistName: string) {
  return `/library/artists/${encodeURIComponent(artistName)}`;
}

export function catalogArtistHref(artistName: string) {
  return `/catalog/artists/${encodeURIComponent(artistName)}`;
}

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
