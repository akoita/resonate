import type { LicenseType } from "../components/marketplace/LicenseTypeSelector";

/**
 * Seller-side license tier helpers (#1141). License tier is an off-chain
 * listing attribute: the chain's list() carries no license type, and the
 * indexer stamps StemListing.licenseType from the listing intent recorded by
 * POST /metadata/notify-listing. These helpers keep that payload and the
 * per-tier price prefill pure and testable.
 */

export type StemTierPricing = {
  remixLicenseUsd?: number | null;
  commercialLicenseUsd?: number | null;
};

/**
 * Default USD prefill when the seller picks a tier. Personal returns null:
 * the edition price is the seller's call and has no catalog default. Remix
 * and commercial fall back to the platform defaults used by StemPricing.
 */
export function tierDefaultPriceUsd(
  pricing: StemTierPricing | null,
  tier: LicenseType,
): number | null {
  if (tier === "remix") {
    return pricing?.remixLicenseUsd ?? 5;
  }
  if (tier === "commercial") {
    return pricing?.commercialLicenseUsd ?? 25;
  }
  return null;
}

export type NotifyListingInput = {
  tokenId: bigint;
  chainId: number;
  seller: string;
  priceUnits: bigint;
  amount: bigint;
  paymentToken: string;
  durationSeconds: bigint;
  transactionHash: string;
  licenseType: LicenseType;
  stemId?: string | null;
};

/**
 * Payload for POST /api/contracts/notify-listing (send it with
 * postNotifyListing, which adds the sign-in token). The backend upserts a
 * StemListingIntent keyed by (transactionHash, tokenId); the indexer then
 * stamps the listing's licenseType from it.
 */
export function buildNotifyListingPayload(
  input: NotifyListingInput,
): Record<string, string | number> {
  return {
    tokenId: input.tokenId.toString(),
    chainId: input.chainId,
    seller: input.seller,
    // The address sending the list() calls; the backend requires it and
    // checks it against the signed-in caller (#2041).
    sellerAddress: input.seller,
    price: input.priceUnits.toString(),
    amount: input.amount.toString(),
    paymentToken: input.paymentToken,
    licenseType: input.licenseType,
    durationSeconds: input.durationSeconds.toString(),
    transactionHash: input.transactionHash,
    ...(input.stemId ? { stemId: input.stemId } : {}),
  };
}

/**
 * One active listing consumes the listed editions, so offering several
 * license tiers at once needs several editions of the token.
 */
export function multiTierEditionHint(input: {
  balance: bigint;
  tier: LicenseType;
}): string | null {
  if (input.tier === "personal" || input.balance > 1n) {
    return null;
  }
  return "You own a single edition: listing it under this license uses your only unit, so you cannot offer other license tiers at the same time. Mint more editions to sell several tiers.";
}

/** Shown when the listing exists on-chain but its intent was not recorded. */
export const NOTIFY_LISTING_DELAYED_MESSAGE =
  "Your listing is on the marketplace. Its license tier may take a moment to show while the marketplace catches up.";

export type NotifyListingResult =
  | { ok: true }
  | { ok: false; status: number | null; reason: "unauthenticated" | "rejected" | "network" };

/**
 * POST a listing intent to /api/contracts/notify-listing with the user's
 * sign-in token. The backend requires sign-in, so without a token nothing is
 * sent. Never throws: the on-chain listing already succeeded and the indexer
 * still records it, so callers only show a non-blocking notice on failure.
 */
export async function postNotifyListing(
  payload: Record<string, unknown>,
  token: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<NotifyListingResult> {
  if (!token) {
    return { ok: false, status: null, reason: "unauthenticated" };
  }
  try {
    const res = await fetchImpl("/api/contracts/notify-listing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      status: res.status,
      reason: res.status === 401 || res.status === 403 ? "unauthenticated" : "rejected",
    };
  } catch {
    return { ok: false, status: null, reason: "network" };
  }
}
