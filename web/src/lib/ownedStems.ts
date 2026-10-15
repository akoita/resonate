/**
 * Library › Stems helpers (#2042): license tiers on owned stems, the tier
 * filter, and the "remix several stems together" grouping. Pure, so the
 * library page stays thin and the rules are testable.
 *
 * The server decides which tier a holder owns (the best one across every
 * purchase of the stem); these helpers only merge, filter and group what it
 * returns. Remix rights are still checked by the eligibility service before
 * Remix Studio opens.
 */

/** Where a buyer finds the stems they bought: Library › Stems. */
export const PURCHASED_STEMS_HREF = "/library?tab=stems";

/** Standard license tiers, lowest first. */
export const STEM_LICENSE_TIERS = ["personal", "remix", "commercial"] as const;
export type StemLicenseTier = (typeof STEM_LICENSE_TIERS)[number];

/** How the wallet holds a stem: bought it, or only lists it for sale. */
export type StemHolding = "purchased" | "listed";

export function isStemLicenseTier(value: unknown): value is StemLicenseTier {
  return typeof value === "string" && (STEM_LICENSE_TIERS as readonly string[]).includes(value);
}

function tierRank(tier: StemLicenseTier | null | undefined): number {
  return tier ? STEM_LICENSE_TIERS.indexOf(tier) : -1;
}

/** The higher of two tiers; null only when both are missing. */
export function higherLicenseTier(
  a: StemLicenseTier | null | undefined,
  b: StemLicenseTier | null | undefined,
): StemLicenseTier | null {
  const best = tierRank(a) >= tierRank(b) ? a : b;
  return best ?? null;
}

/** Remix and commercial licenses both include remixing. */
export function isRemixReadyTier(tier: StemLicenseTier | null | undefined): boolean {
  return tier === "remix" || tier === "commercial";
}

export const STEM_LICENSE_LABELS: Record<StemLicenseTier, string> = {
  personal: "Personal",
  remix: "Remix",
  commercial: "Commercial",
};

/** The shape of one stem in the collection response that the merge needs. */
export type CollectionStemLicenseFields = {
  licenseType?: string | null;
  holding?: StemHolding | null;
  activeListingId?: string | null;
};

/**
 * Merges the same stem returned for two of the user's addresses (the sign-in
 * wallet and the smart account): the higher license wins, a purchase beats a
 * listing, and an active listing is kept from either side.
 */
export function mergeCollectionStem<T extends CollectionStemLicenseFields>(
  existing: T | undefined,
  incoming: T,
): T {
  if (!existing) return incoming;
  const existingTier = isStemLicenseTier(existing.licenseType) ? existing.licenseType : null;
  const incomingTier = isStemLicenseTier(incoming.licenseType) ? incoming.licenseType : null;
  const holding: StemHolding | null | undefined =
    existing.holding === "purchased" || incoming.holding === "purchased"
      ? "purchased"
      : (incoming.holding ?? existing.holding);
  return {
    ...existing,
    ...incoming,
    licenseType: higherLicenseTier(existingTier, incomingTier),
    holding,
    activeListingId: incoming.activeListingId ?? existing.activeListingId,
  };
}

/**
 * Loads the signed-in user's collection for each of their addresses (the
 * sign-in wallet and the smart account) and merges the results.
 *
 * The collection API is owner-only (#2139): it needs the user's token and only
 * answers for the caller's own addresses. Without a token nothing is fetched.
 * A refused (401/403) or failed request counts as "no stems" for that address
 * rather than an error, and nothing about the address is logged.
 */
export async function fetchOwnedCollectionStems<
  T extends CollectionStemLicenseFields & { id: string },
>(input: {
  addresses: ReadonlyArray<string | null | undefined>;
  token: string | null | undefined;
  fetchImpl?: typeof fetch;
}): Promise<T[]> {
  const { token } = input;
  if (!token) return [];
  const fetchImpl = input.fetchImpl ?? fetch;
  const seen = new Set<string>();
  const addresses = input.addresses.filter((addr): addr is string => {
    if (!addr) return false;
    const key = addr.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const merged = new Map<string, T>();
  await Promise.all(
    addresses.map(async (addr) => {
      try {
        const response = await fetchImpl(`/api/metadata/collection/${encodeURIComponent(addr)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const data = (await response.json()) as { stems?: T[] };
        for (const stem of data.stems ?? []) {
          // The same stem can come back for the sign-in wallet and the smart
          // account: keep the higher license and the purchase over a listing.
          merged.set(stem.id, mergeCollectionStem(merged.get(stem.id), stem));
        }
      } catch {
        console.error("Failed to load part of your stem collection");
      }
    }),
  );
  return Array.from(merged.values());
}

/** Library › Stems filter chips. */
export type StemLicenseFilter = "all" | "remix_ready" | "personal";

export const STEM_LICENSE_FILTERS: ReadonlyArray<{ value: StemLicenseFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "remix_ready", label: "Remix-ready" },
  { value: "personal", label: "Personal" },
];

/** Whether a stem shows under a filter. Listed-only stems only show under All. */
export function matchesStemLicenseFilter(
  stem: { licenseType?: StemLicenseTier | null },
  filter: StemLicenseFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "remix_ready") return isRemixReadyTier(stem.licenseType);
  return stem.licenseType === "personal";
}

export type RemixReadyStemGroup = {
  sourceTrackId: string;
  sourceTrackTitle: string | null;
  stemIds: string[];
};

/**
 * Source tracks where the holder can remix two or more stems together: one
 * Remix Studio session can load them all at once. Order follows the first
 * appearance of each track in `stems`, so it matches the list below it.
 */
export function groupRemixReadyStemsBySourceTrack(
  stems: ReadonlyArray<{
    id: string;
    sourceTrackId?: string | null;
    sourceTrackTitle?: string | null;
    licenseType?: StemLicenseTier | null;
  }>,
): RemixReadyStemGroup[] {
  const groups = new Map<string, RemixReadyStemGroup>();
  for (const stem of stems) {
    if (!stem.sourceTrackId || !isRemixReadyTier(stem.licenseType)) continue;
    const group = groups.get(stem.sourceTrackId) ?? {
      sourceTrackId: stem.sourceTrackId,
      sourceTrackTitle: stem.sourceTrackTitle ?? null,
      stemIds: [],
    };
    if (!group.sourceTrackTitle && stem.sourceTrackTitle) {
      group.sourceTrackTitle = stem.sourceTrackTitle;
    }
    if (!group.stemIds.includes(stem.id)) group.stemIds.push(stem.id);
    groups.set(stem.sourceTrackId, group);
  }
  return Array.from(groups.values()).filter((group) => group.stemIds.length >= 2);
}
