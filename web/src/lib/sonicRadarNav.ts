import type { DiscoveryJournal } from "./api";

/**
 * Sonic Radar earns its sidebar place once it has something to show: a
 * resonant track, one a save away, or a new release from an artist the
 * listener discovered. Newcomers never land on an empty page from the nav.
 */
export function journalHasDiscoveries(journal: DiscoveryJournal | null | undefined): boolean {
  if (!journal) return false;
  if (journal.headline.resonantDiscoveriesThisWeek > 0 || journal.headline.newArtistsThisWeek > 0) return true;
  if (journal.groups.some((group) => group.items.length > 0)) return true;
  return (journal.pending?.length ?? 0) > 0 || (journal.newFromDiscovered?.length ?? 0) > 0;
}

/** Last answer per account, so the item shows on first paint of the next page load. */
export const SONIC_RADAR_NAV_KEY = "resonate.sidebar.sonicRadar.v1";

export function readStoredHasDiscoveries(account: string | null | undefined): boolean {
  if (!account) return false;
  try {
    const raw = globalThis.sessionStorage?.getItem(SONIC_RADAR_NAV_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as { account?: unknown; has?: unknown };
    return stored.account === account.toLowerCase() && stored.has === true;
  } catch {
    return false;
  }
}

export function storeHasDiscoveries(account: string, has: boolean): void {
  try {
    globalThis.sessionStorage?.setItem(SONIC_RADAR_NAV_KEY, JSON.stringify({ account: account.toLowerCase(), has }));
  } catch {
    // Storage may be unavailable (private window); the next load asks again.
  }
}
