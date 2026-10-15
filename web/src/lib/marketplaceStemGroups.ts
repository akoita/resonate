import type { LicenseType } from "../components/marketplace/LicenseTypeSelector";
import { TIER_ORDER } from "./multiTierListing";

/**
 * One marketplace card per stem (#2041). A stem listed under several license
 * tiers has one active listing per tier; browse groups them so the card shows
 * the stem once with a chip per available tier.
 */

export type GroupableListing = {
  listingId: string;
  price: string;
  paymentToken?: string;
  licenseType?: LicenseType;
  tierListings?: Partial<Record<LicenseType, string>> | null;
  stem: { id: string } | null;
};

export type StemListingGroup<T extends GroupableListing> = {
  /** Stem id, or the listing id for listings without catalog metadata. */
  key: string;
  /** Listing that represents the card: the first tier in tier order. */
  primary: T;
  /** The listing offered for each available tier. */
  tiers: Partial<Record<LicenseType, T>>;
  /** Tier → listing id, for the buy modal's tier switch. */
  tierListingIds: Partial<Record<LicenseType, string>>;
};

function isCheaper(candidate: GroupableListing, current: GroupableListing): boolean {
  // Prices are only comparable in the same payment asset.
  if ((candidate.paymentToken ?? "").toLowerCase() !== (current.paymentToken ?? "").toLowerCase()) {
    return false;
  }
  try {
    return BigInt(candidate.price) < BigInt(current.price);
  } catch {
    return false;
  }
}

/**
 * Group listings by stem, keeping first-seen order. When several listings
 * offer the same tier (e.g. different sellers), the cheapest in the same
 * payment asset represents it; otherwise the first one seen.
 */
export function groupListingsByStem<T extends GroupableListing>(listings: T[]): StemListingGroup<T>[] {
  const order: string[] = [];
  const members = new Map<string, T[]>();
  for (const listing of listings) {
    const key = listing.stem?.id ?? `listing:${listing.listingId}`;
    const existing = members.get(key);
    if (existing) {
      existing.push(listing);
    } else {
      members.set(key, [listing]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const group = members.get(key) ?? [];
    const tiers: Partial<Record<LicenseType, T>> = {};
    for (const listing of group) {
      const tier = listing.licenseType ?? "personal";
      const current = tiers[tier];
      if (!current || isCheaper(listing, current)) {
        tiers[tier] = listing;
      }
    }
    const tierListingIds: Partial<Record<LicenseType, string>> = {};
    // Backend-provided sibling tiers first, then the listings on this page.
    for (const listing of group) {
      Object.assign(tierListingIds, listing.tierListings ?? {});
    }
    for (const tier of TIER_ORDER) {
      const listing = tiers[tier];
      if (listing) tierListingIds[tier] = listing.listingId;
    }
    const primaryTier = TIER_ORDER.find((tier) => tiers[tier]) ?? "personal";
    return {
      key,
      primary: tiers[primaryTier] ?? group[0],
      tiers,
      tierListingIds,
    };
  });
}

/** Tiers available on a group's card, in tier order. */
export function groupTierOrder<T extends GroupableListing>(
  group: Pick<StemListingGroup<T>, "tiers">,
): LicenseType[] {
  return TIER_ORDER.filter((tier) => Boolean(group.tiers[tier]));
}
