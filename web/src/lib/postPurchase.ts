import type { BuyModalPurchase } from "../components/marketplace/BuyModal";

/**
 * Post-purchase eligibility settling (#1173). A wallet purchase is proven by
 * the indexed StemPurchase row, which lags the transaction — by seconds
 * normally, by minutes when the indexer is backfilling (observed live:
 * an 8-day backfill made registration take ~10 minutes). The page keeps
 * checking on a backoff schedule and tells the truth while it settles.
 */
export const POST_PURCHASE_ELIGIBILITY_DELAYS_MS: readonly number[] = [
  4_000, 8_000, 15_000, 30_000, 60_000, 120_000, 240_000,
];

export type PostPurchaseSettling = {
  phase: "polling" | "exhausted";
};

export function postPurchaseNotice(phase: PostPurchaseSettling["phase"]): string {
  return phase === "polling"
    ? "License confirmed — finalizing your remix access… this can take a few minutes."
    : "Purchase confirmed on-chain; registration is still settling. Check back soon.";
}

type ListingLike = {
  listingId: string;
  amount: string;
};

/**
 * Optimistic inventory update: the bought quantity comes off the listing
 * immediately, and an exhausted listing disappears — the page must not keep
 * selling what the buyer just consumed while the indexer catches up.
 */
export function applyPurchaseToListings<T extends ListingLike>(
  listings: T[],
  purchase: Pick<BuyModalPurchase, "listingId" | "amount">,
): T[] {
  const boughtId = purchase.listingId.toString();
  const result: T[] = [];
  for (const listing of listings) {
    if (listing.listingId !== boughtId) {
      result.push(listing);
      continue;
    }
    let remaining: bigint;
    try {
      remaining = BigInt(listing.amount) - purchase.amount;
    } catch {
      // Malformed amount: drop the row rather than keep selling it.
      continue;
    }
    if (remaining > 0n) {
      result.push({ ...listing, amount: remaining.toString() });
    }
  }
  return result;
}
