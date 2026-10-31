import { encodeFunctionData, type Address } from "viem";
import { StemMarketplaceABI } from "../contracts_abi/index";
import { planRelistChunks, type RelistChunk, type RelistItem, type RelistTerms } from "./batchRelist";
import { isListingCancellable, type CancellableListing } from "./listingCancellation";
import type { BatchCall } from "./multiTierListing";
import { isPasskeyDismissal } from "./passkeyDismissal";

/**
 * One-step listing edit (#2480).
 *
 * StemMarketplaceV2 listings are immutable offers, so "edit" means cancel the
 * live listing and list the stem again with the new terms. Both halves travel in
 * ONE batched smart-account UserOperation: the seller confirms once, and because
 * a batch reverts as a whole, a failure leaves the old listing active.
 *
 * Call order: cancel(oldListingId), then (only when the marketplace is not yet
 * approved) setApprovalForAll, then list(). The relist half comes from the batch
 * relist planner (#2030), so the new listing keeps the old listing's license
 * tier and the notify-listing body is the same one a relist sends. cancel() does
 * not emit Listed, so the new listing's ordinal for its token is still 0.
 */

/** Live listings (active or expiring soon) can be edited; the rest are relisted instead. */
export function isListingEditable(listing: CancellableListing): boolean {
  return isListingCancellable(listing);
}

export type ListingEditPlan = {
  /** On-chain id of the listing the edit replaces. */
  cancelledListingId: bigint;
  /** The relist half: a single-listing chunk (its calls hold no cancel). */
  relist: RelistChunk;
  /** Every call of the batched UserOperation, cancel first. */
  calls: BatchCall[];
};

function cancelCall(marketplace: Address, listingId: bigint): BatchCall {
  return {
    to: marketplace,
    data: encodeFunctionData({
      abi: StemMarketplaceABI,
      functionName: "cancel",
      args: [listingId],
    }),
  };
}

export function planListingEdit(input: {
  listingId: bigint;
  item: RelistItem;
  terms: RelistTerms;
  /** True when the marketplace is not yet approved to move the seller's stems. */
  needsApproval: boolean;
  stemNFT: Address;
  marketplace: Address;
}): ListingEditPlan {
  const [relist] = planRelistChunks([input.item], {
    terms: input.terms,
    needsApproval: input.needsApproval,
    stemNFT: input.stemNFT,
    marketplace: input.marketplace,
  });
  return {
    cancelledListingId: input.listingId,
    relist,
    calls: [cancelCall(input.marketplace, input.listingId), ...relist.calls],
  };
}

export type ListingEditFields = {
  pricePerUnit: bigint;
  amount: bigint;
  paymentToken: string;
};

/**
 * Fields the edit changes, as short labels for the dialog. Duration is not
 * compared: every edit starts a fresh listing, so the expiry always restarts.
 */
export function listingEditChanges(current: ListingEditFields, next: ListingEditFields): string[] {
  const changes: string[] = [];
  if (current.pricePerUnit !== next.pricePerUnit) changes.push("price");
  if (current.amount !== next.amount) changes.push("quantity");
  if (current.paymentToken.toLowerCase() !== next.paymentToken.toLowerCase()) changes.push("payment asset");
  return changes;
}

/** Plain-language message for an edit that did not go through; nothing changed on-chain. */
export function describeEditFailure(error: unknown): string {
  const unchanged = "The listing is still active with its current terms.";
  if (isPasskeyDismissal(error)) {
    return `You closed the confirmation, so nothing was sent. ${unchanged}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/user (rejected|denied)|rejected the request/i.test(message)) {
    return `You declined the request, so nothing was sent. ${unchanged}`;
  }
  if (/notseller/i.test(message)) {
    return `This listing was created by a different account, so it cannot be edited from the account you are signed in with. ${unchanged}`;
  }
  const reason = (message || "unknown error").trim().replace(/\.$/, "");
  return `Could not update the listing: ${reason}. Nothing was changed. ${unchanged}`;
}
