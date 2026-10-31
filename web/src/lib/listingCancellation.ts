import { isPasskeyDismissal } from "./passkeyDismissal";

/**
 * Manual listing cancellation (#284).
 *
 * The owner view (`/artist/listings`) cancels a live listing with
 * `StemMarketplaceV2.cancel(listingId)`. The UI flips the row to `cancelled` as
 * soon as the cancel transaction confirms; the indexer's `Cancelled` event
 * (backend `contract.listing_cancelled`) later persists the same state. Until the
 * owner-listings API reports the row as cancelled, every reload keeps the
 * confirmed-cancelled overlay so the row never flickers back to `active`.
 */

/** The listing fields cancellation needs; the owner-view row type satisfies it. */
export type CancellableListing = {
  id: string;
  listingId: string;
  status: string;
  lifecycleStatus: string;
  amount: string;
  relistable?: boolean;
};

const LIVE_LIFECYCLE_STATES = new Set(["active", "expiring_soon"]);

/**
 * True when the owner can still cancel the listing on-chain: it is stored as
 * active and has not expired. Expired, sold, cancelled and stale rows have no
 * cancel action (an expired listing already cannot be bought).
 */
export function isListingCancellable(listing: CancellableListing): boolean {
  return listing.status === "active" && LIVE_LIFECYCLE_STATES.has(listing.lifecycleStatus);
}

function hasRemainingEditions(amount: string): boolean {
  try {
    return BigInt(amount) > 0n;
  } catch {
    return false;
  }
}

/** The row as it looks once its cancel transaction has confirmed. */
export function asCancelledListing<T extends CancellableListing>(listing: T): T {
  return {
    ...listing,
    status: "cancelled",
    lifecycleStatus: "cancelled",
    // Mirrors the owner API: a cancelled listing with editions left is relistable.
    relistable: hasRemainingEditions(listing.amount),
  };
}

/** Marks the rows whose ids are given as cancelled; other rows are untouched. */
export function markListingsCancelled<T extends CancellableListing>(
  listings: T[],
  ids: ReadonlySet<string>,
): T[] {
  return listings.map((listing) => (ids.has(listing.id) ? asCancelledListing(listing) : listing));
}

/**
 * Reconciles freshly loaded owner listings with cancellations confirmed on-chain
 * but not yet indexed. Rows the API already reports as cancelled leave the
 * pending set; rows it still reports as live keep the cancelled overlay. Rows
 * absent from the response (another filter, another page) stay pending.
 */
export function reconcileCancelledListings<T extends CancellableListing>(
  serverListings: T[],
  confirmedCancelledIds: ReadonlySet<string>,
): { listings: T[]; stillPending: Set<string> } {
  const stillPending = new Set(confirmedCancelledIds);
  const listings = serverListings.map((listing) => {
    if (!confirmedCancelledIds.has(listing.id)) return listing;
    if (listing.status !== "active") {
      stillPending.delete(listing.id);
      return listing;
    }
    return asCancelledListing(listing);
  });
  return { listings, stillPending };
}

/** Plain-language message for a cancel that did not go through. */
export function describeCancelFailure(error: unknown): string {
  if (isPasskeyDismissal(error)) {
    return "You closed the confirmation, so nothing was sent. The listing is still active.";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/user (rejected|denied)|rejected the request/i.test(message)) {
    return "You declined the request, so nothing was sent. The listing is still active.";
  }
  if (/notseller/i.test(message)) {
    return "This listing was created by a different account, so it cannot be cancelled from the account you are signed in with. The listing is still active.";
  }
  return `Could not cancel the listing: ${message || "unknown error"}. The listing is still active.`;
}
