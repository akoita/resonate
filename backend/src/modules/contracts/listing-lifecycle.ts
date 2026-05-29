export const LISTING_EXPIRING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ListingLifecycleStatus =
  | "active"
  | "expiring_soon"
  | "expired"
  | "sold"
  | "cancelled"
  | "stale";

export type ListingLifecycleInput = {
  status: string;
  amount: bigint;
  expiresAt: Date;
  soldAt?: Date | null;
  cancelledAt?: Date | null;
};

export function deriveListingLifecycleStatus(
  listing: ListingLifecycleInput,
  now = new Date(),
): ListingLifecycleStatus {
  const status = listing.status.toLowerCase();
  if (status === "sold" || listing.soldAt || listing.amount <= 0n) return "sold";
  if (status === "cancelled" || listing.cancelledAt) return "cancelled";
  if (status === "stale") return "stale";
  if (status === "expired" || listing.expiresAt <= now) return "expired";

  const expiringSoonAt = new Date(now.getTime() + LISTING_EXPIRING_SOON_WINDOW_MS);
  if (listing.expiresAt <= expiringSoonAt) return "expiring_soon";

  return "active";
}

export function isPubliclyPurchasableListing(
  listing: ListingLifecycleInput,
  now = new Date(),
) {
  return (
    listing.status.toLowerCase() === "active" &&
    listing.amount > 0n &&
    listing.expiresAt > now
  );
}
