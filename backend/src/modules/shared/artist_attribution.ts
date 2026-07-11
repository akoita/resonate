/**
 * Canonical credited-artist name resolution (#1492).
 *
 * TWO DISTINCT CONCEPTS — do not conflate them:
 *
 *   1. The ARTIST-MANAGER ACCOUNT (`Artist` row) that uploaded/owns a release.
 *      Its `displayName` is the account label (e.g. "Bouba", "proof") — often a
 *      manager, label, or uploader handle, NOT the name fans should see credited.
 *
 *   2. The CREDITED ARTIST — the real artist a track/release is BY. It lives in
 *      main-role `ReleaseArtistCredit` rows, then the free-text `primaryArtist`,
 *      and (as a scalar override) on the track itself (`Track.artist`).
 *
 * Public/discovery surfaces must display and rank concept #2, never falling back
 * to concept #1's account label unless nothing better exists. Surfaces kept
 * regressing into showing the uploader account's `Artist.displayName` where the
 * credited release artist belongs — so the resolution rule lives HERE, once, and
 * every serializer routes through it instead of re-inlining `a || b || c`.
 *
 * Resolution order (first non-empty wins):
 *   trackArtist → joined main-role credits → primaryArtist → accountDisplayName
 *   → null.
 *
 * The frontend counterpart is `getArtistName` in web/src/lib/catalogDisplay.ts;
 * keep the two rules in step. Phase B (#1492) replaces the interim
 * credited-name string identity used by the Home "Top Artists" rail with a
 * stable credited-artist id.
 */

/** Main credit roles that name the artist a release is BY (not features/guests). */
export const MAIN_ARTIST_CREDIT_ROLES = new Set(["main", "primary"]);

/** Trim + collapse internal whitespace; empty/nullish → "". */
export function normalizeCreditName(value?: string | null): string {
  return (value || "").trim().replace(/\s+/g, " ");
}

export interface ResolveCreditedArtistInput {
  /** `Track.artist` scalar override, when a serializer has the track in hand. */
  trackArtist?: string | null;
  /** `ReleaseArtistCredit` rows; only main-role ones name the credited artist. */
  credits?: Array<{ role: string; displayName: string }> | null;
  /** Release free-text `primaryArtist`. */
  primaryArtist?: string | null;
  /** The uploader/manager account label — last resort ONLY. */
  accountDisplayName?: string | null;
}

/**
 * Resolve the credited artist name to display/rank for a track or release.
 * Returns `null` when nothing credits an artist — callers apply their own
 * "Unknown Artist" fallback so this stays composable.
 */
export function resolveCreditedArtistName(
  input: ResolveCreditedArtistInput,
): string | null {
  const trackArtist = normalizeCreditName(input.trackArtist);
  if (trackArtist) return trackArtist;

  const mainCredits = (input.credits || [])
    .filter((credit) => MAIN_ARTIST_CREDIT_ROLES.has(credit.role.toLowerCase()))
    .map((credit) => normalizeCreditName(credit.displayName))
    .filter(Boolean);
  if (mainCredits.length) return mainCredits.join(", ");

  const primaryArtist = normalizeCreditName(input.primaryArtist);
  if (primaryArtist) return primaryArtist;

  const accountDisplayName = normalizeCreditName(input.accountDisplayName);
  if (accountDisplayName) return accountDisplayName;

  return null;
}
