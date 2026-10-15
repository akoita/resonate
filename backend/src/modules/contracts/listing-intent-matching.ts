import type { Logger } from "@nestjs/common";
import type { LicenseType } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ZERO_PAYMENT_TOKEN } from "../payments/payment-asset-metadata";

/**
 * Per-tier listing intents (#2041).
 *
 * An artist can list one stem under several license tiers in ONE transaction
 * (a batched UserOperation with one StemMarketplaceV2.list() per tier). The
 * on-chain Listed event carries no license, so the backend correlates each
 * Listed log with the StemListingIntent the client posted to notify-listing.
 *
 * Matching rule for one listing (transactionHash, tokenId, listingId), over the
 * intents stored for (transactionHash, tokenId):
 *   (a) the intent whose listingId equals the listing's listingId;
 *   (b) when the ordinal is known and EVERY intent carries a logOrdinal, the
 *       intent whose logOrdinal equals the listing's ordinal (unless that intent
 *       is pinned to a different listingId);
 *   (c) exactly one intent, not pinned to a different listingId -> it (legacy
 *       single-tier body);
 *   (d) otherwise no match; callers keep their default and log a warning.
 *
 * Trust: an intent only applies to a listing when its sellerAddress equals the
 * on-chain seller (rows written before #2041 have a null seller and still
 * apply). Chain values win: intents never override an indexed listing's price,
 * amount or seller — they only supply the license tier, the stem link, and the
 * payment asset of a native-token fallback row (the Listed event carries no
 * payment token, so the indexer stamps the zero address).
 *
 * The ordinal of a listing is its 0-based rank among the same seller's Listed
 * logs for the token in the transaction. StemMarketplaceV2 allocates listing ids with
 * `++listingId`, so log order and listing-id order coincide inside one
 * transaction; the rank is computed by listing id over every sibling the
 * backend knows about (raw `Listed` ContractEvent rows plus indexed
 * StemListing rows). The indexer persists each raw log before it publishes the
 * typed event and walks a receipt in log order, so every lower sibling is
 * already known when a listing is handled, whatever order the asynchronous
 * handlers then run in.
 */

export interface MatchableListingIntent {
  licenseType: LicenseType;
  sellerAddress: string | null;
  logOrdinal: number | null;
  listingId: bigint | null;
}

export type ListingIntentMatchRule = "listingId" | "ordinal" | "single";

export interface ListingIntentMatch<T> {
  intent: T | null;
  rule: ListingIntentMatchRule | null;
}

export function matchListingIntent<T extends MatchableListingIntent>(
  intents: T[],
  listing: { listingId: bigint; ordinal: number | null },
): ListingIntentMatch<T> {
  if (intents.length === 0) return { intent: null, rule: null };

  const byListingId = intents.filter((intent) => intent.listingId === listing.listingId);
  if (byListingId.length === 1) return { intent: byListingId[0], rule: "listingId" };

  const pinnedElsewhere = (intent: T) =>
    intent.listingId !== null && intent.listingId !== listing.listingId;

  if (
    listing.ordinal !== null &&
    intents.every((intent) => intent.logOrdinal !== null)
  ) {
    const byOrdinal = intents.filter((intent) => intent.logOrdinal === listing.ordinal);
    if (byOrdinal.length === 1 && !pinnedElsewhere(byOrdinal[0])) {
      return { intent: byOrdinal[0], rule: "ordinal" };
    }
  }

  if (intents.length === 1 && !pinnedElsewhere(intents[0])) {
    return { intent: intents[0], rule: "single" };
  }

  return { intent: null, rule: null };
}

/**
 * Intents that may apply to a listing sold by `sellerAddress`: the same seller
 * (case-insensitive), or a pre-#2041 row with no recorded seller.
 */
export function intentsForSeller<T extends { sellerAddress: string | null }>(
  intents: T[],
  sellerAddress: string,
): { applicable: T[]; foreign: number } {
  const seller = sellerAddress.toLowerCase();
  const applicable = intents.filter(
    (intent) => !intent.sellerAddress || intent.sellerAddress.toLowerCase() === seller,
  );
  return { applicable, foreign: intents.length - applicable.length };
}

/** 0-based rank of `listingId` among the token's listing ids in the tx. */
export function listingOrdinal(listingId: bigint, siblingListingIds: Iterable<bigint>): number {
  let ordinal = 0;
  for (const sibling of new Set(siblingListingIds)) {
    if (sibling < listingId) ordinal += 1;
  }
  return ordinal;
}

export interface TokenListingSibling {
  listingId: bigint;
  sellerAddress: string;
}

/**
 * Every Listed log the backend knows for this token in the transaction: raw
 * `Listed` ContractEvent rows (persisted by the indexer before it publishes)
 * plus already-indexed StemListing rows. Seller addresses are lowercased.
 */
export async function loadTokenListingSiblings(params: {
  transactionHash: string;
  tokenId: bigint;
  chainId: number;
}): Promise<TokenListingSibling[]> {
  const [rawEvents, listings] = await Promise.all([
    prisma.contractEvent.findMany({
      where: {
        transactionHash: params.transactionHash,
        chainId: params.chainId,
        eventName: "Listed",
      },
      select: { args: true },
    }),
    prisma.stemListing.findMany({
      where: {
        transactionHash: params.transactionHash,
        tokenId: params.tokenId,
        chainId: params.chainId,
      },
      select: { listingId: true, sellerAddress: true },
    }),
  ]);

  const byId = new Map<bigint, string>();
  const tokenIdText = params.tokenId.toString();
  for (const event of rawEvents) {
    const args = event.args as { tokenId?: unknown; listingId?: unknown; seller?: unknown } | null;
    if (!args || String(args.tokenId) !== tokenIdText) continue;
    try {
      byId.set(BigInt(String(args.listingId)), String(args.seller ?? "").toLowerCase());
    } catch {
      // Malformed raw args cannot contribute to the ordering.
    }
  }
  for (const listing of listings) byId.set(listing.listingId, listing.sellerAddress.toLowerCase());
  return [...byId.entries()].map(([listingId, sellerAddress]) => ({ listingId, sellerAddress }));
}

/** Ordinal of a listing among the same seller's Listed logs for the token. */
export function sellerListingOrdinal(
  listingId: bigint,
  sellerAddress: string,
  siblings: TokenListingSibling[],
): number {
  const seller = sellerAddress.toLowerCase();
  return listingOrdinal(
    listingId,
    siblings.filter((sibling) => sibling.sellerAddress === seller).map((sibling) => sibling.listingId),
  );
}

/**
 * Apply the stored per-tier intents to listings of (transactionHash, tokenId)
 * that the indexer already stored — the Listed event can be indexed before the
 * client's notify-listing call arrives. Only the license tier, the stem link
 * and a native fallback row's payment asset are taken from the intent.
 */
export async function reconcileIndexedListingsWithIntents(params: {
  transactionHash: string;
  tokenId: bigint;
  chainId: number;
  logger?: Pick<Logger, "warn">;
}): Promise<{ updated: number; unmatched: number }> {
  const [listings, intents] = await Promise.all([
    prisma.stemListing.findMany({
      where: {
        transactionHash: params.transactionHash,
        tokenId: params.tokenId,
        chainId: params.chainId,
      },
      select: { id: true, listingId: true, sellerAddress: true, paymentToken: true },
    }),
    prisma.stemListingIntent.findMany({
      where: { transactionHash: params.transactionHash, tokenId: params.tokenId },
    }),
  ]);
  if (listings.length === 0 || intents.length === 0) return { updated: 0, unmatched: 0 };

  const siblings = await loadTokenListingSiblings(params);
  let updated = 0;
  let unmatched = 0;
  for (const listing of listings) {
    const { applicable, foreign } = intentsForSeller(intents, listing.sellerAddress);
    if (foreign > 0) {
      params.logger?.warn(
        `Ignoring ${foreign} listing intent(s) from another seller for listingId=${listing.listingId} ` +
          `tokenId=${params.tokenId} tx=${params.transactionHash}`,
      );
    }
    const { intent } = matchListingIntent(applicable, {
      listingId: listing.listingId,
      ordinal: sellerListingOrdinal(listing.listingId, listing.sellerAddress, siblings),
    });
    if (!intent) {
      unmatched += 1;
      params.logger?.warn(
        `No unambiguous listing intent for listingId=${listing.listingId} ` +
          `tokenId=${params.tokenId} tx=${params.transactionHash}; leaving its license tier unchanged`,
      );
      continue;
    }
    const isNativeFallback = listing.paymentToken.toLowerCase() === ZERO_PAYMENT_TOKEN;
    await prisma.stemListing.update({
      where: { id: listing.id },
      data: {
        licenseType: intent.licenseType,
        stemId: intent.stemId ?? undefined,
        paymentToken: isNativeFallback && intent.paymentToken ? intent.paymentToken : undefined,
      },
    });
    updated += 1;
  }
  return { updated, unmatched };
}
