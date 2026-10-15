import { encodeFunctionData, type Address } from "viem";
import { StemMarketplaceABI, StemNFTABI } from "../contracts_abi/index";
import type { LicenseType } from "../components/marketplace/LicenseTypeSelector";
import {
  TIER_ORDER,
  buildTierNotifyPayload,
  type BatchCall,
  type NotifyTierEntry,
} from "./multiTierListing";

/**
 * Batch relist planner (#2030).
 *
 * Relisting several stems from the Listing Manager sends one batched
 * transaction (one confirmation) per chunk of up to RELIST_CHUNK_SIZE
 * listings instead of one per stem. Every relisted listing keeps its own
 * license tier; price, quantity, payment asset and duration are the shared
 * terms from the relist dialog.
 *
 * Calls in a chunk: at most one marketplace approval (first chunk only, and
 * only when the marketplace is not approved yet), then one list() per
 * listing. Listings are grouped by token, and within a token ordered
 * personal → remix → commercial, so each listing's `ordinal` (its position
 * among that token's list() calls in the transaction) is deterministic. The
 * backend matches each license tier to its on-chain listing by that ordinal.
 *
 * A token's tiers always travel in the same chunk. A chunk never holds two
 * listings of the same token under the same tier (the backend keys listing
 * intents by transaction, token, seller and tier), so a second relist of the
 * same token and tier goes to a later chunk.
 */

export const RELIST_CHUNK_SIZE = 10;

export type RelistItem = {
  /** Stable id of the listing being relisted (for UI bookkeeping). */
  key: string;
  tokenId: bigint;
  licenseType: LicenseType;
  /** Human label, e.g. the stem title or "Token #12". */
  label: string;
  stemId?: string | null;
};

export type RelistTerms = {
  amount: bigint;
  pricePerUnit: bigint;
  paymentToken: Address;
  durationSeconds: bigint;
};

export type RelistChunkListing = RelistItem & {
  /** Position among this token's list() calls in the chunk's transaction. */
  ordinal: number;
};

export type RelistTokenGroup = {
  tokenId: bigint;
  stemId?: string | null;
  listings: RelistChunkListing[];
};

export type RelistChunk = {
  /** 0-based chunk index. */
  index: number;
  includeApproval: boolean;
  groups: RelistTokenGroup[];
  /** Listings in call order (same order as the list() calls). */
  listings: RelistChunkListing[];
  calls: BatchCall[];
};

/** Map a stored listing license to a tier; unknown values fall back to personal, like the backend. */
export function normalizeRelistLicense(value: string | null | undefined): LicenseType {
  return TIER_ORDER.includes(value as LicenseType) ? (value as LicenseType) : "personal";
}

/**
 * Split the selection into per-token groups with at most one listing per
 * tier. Round 0 of every token comes first (in selection order), then any
 * repeat tiers of the same token in later rounds.
 */
function buildTokenGroups(items: RelistItem[]): RelistTokenGroup[] {
  const tokenOrder: string[] = [];
  const byToken = new Map<string, Map<LicenseType, RelistItem[]>>();
  for (const item of items) {
    const tokenKey = item.tokenId.toString();
    let byTier = byToken.get(tokenKey);
    if (!byTier) {
      byTier = new Map();
      byToken.set(tokenKey, byTier);
      tokenOrder.push(tokenKey);
    }
    const bucket = byTier.get(item.licenseType) ?? [];
    bucket.push(item);
    byTier.set(item.licenseType, bucket);
  }

  const rounds: RelistTokenGroup[][] = [];
  for (const tokenKey of tokenOrder) {
    const byTier = byToken.get(tokenKey)!;
    const roundCount = Math.max(...[...byTier.values()].map((bucket) => bucket.length));
    for (let round = 0; round < roundCount; round += 1) {
      const roundItems = TIER_ORDER.flatMap((tier) => {
        const item = byTier.get(tier)?.[round];
        return item ? [item] : [];
      });
      const listings = roundItems.map((item, ordinal) => ({ ...item, ordinal }));
      (rounds[round] ??= []).push({
        tokenId: BigInt(tokenKey),
        stemId: listings.find((listing) => listing.stemId)?.stemId ?? null,
        listings,
      });
    }
  }
  return rounds.flat();
}

function approvalCall(stemNFT: Address, marketplace: Address): BatchCall {
  return {
    to: stemNFT,
    data: encodeFunctionData({
      abi: StemNFTABI,
      functionName: "setApprovalForAll",
      args: [marketplace, true],
    }),
  };
}

function listCall(marketplace: Address, tokenId: bigint, terms: RelistTerms): BatchCall {
  return {
    to: marketplace,
    data: encodeFunctionData({
      abi: StemMarketplaceABI,
      functionName: "list",
      args: [tokenId, terms.amount, terms.pricePerUnit, terms.paymentToken, terms.durationSeconds],
    }),
  };
}

export function planRelistChunks(
  items: RelistItem[],
  options: {
    terms: RelistTerms;
    /** True when the marketplace is not yet approved to move the seller's stems. */
    needsApproval: boolean;
    stemNFT: Address;
    marketplace: Address;
    chunkSize?: number;
  },
): RelistChunk[] {
  const chunkSize = Math.max(TIER_ORDER.length, options.chunkSize ?? RELIST_CHUNK_SIZE);
  const packed: RelistTokenGroup[][] = [];
  let current: RelistTokenGroup[] = [];
  let currentSize = 0;
  for (const group of buildTokenGroups(items)) {
    const tokenAlreadyInChunk = current.some((existing) => existing.tokenId === group.tokenId);
    if (current.length > 0 && (currentSize + group.listings.length > chunkSize || tokenAlreadyInChunk)) {
      packed.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(group);
    currentSize += group.listings.length;
  }
  if (current.length > 0) packed.push(current);

  return packed.map((groups, index) => {
    const includeApproval = options.needsApproval && index === 0;
    const listings = groups.flatMap((group) => group.listings);
    const calls: BatchCall[] = [
      ...(includeApproval ? [approvalCall(options.stemNFT, options.marketplace)] : []),
      ...listings.map((listing) => listCall(options.marketplace, listing.tokenId, options.terms)),
    ];
    return { index, includeApproval, groups, listings, calls };
  });
}

/**
 * notify-listing bodies for a sent chunk: one per token. A token relisted
 * under one tier gets the single-tier body; several tiers of one token get a
 * `tiers` array with ordinals (and listing ids when one was read per tier).
 * All bodies share the chunk's transaction hash.
 */
export function buildRelistNotifyPayloads(
  chunk: RelistChunk,
  input: {
    terms: RelistTerms;
    chainId: number;
    seller: string;
    transactionHash: string;
    /** Listed ids per token (key: tokenId string), in log order. */
    listingIdsByToken?: Map<string, bigint[]>;
  },
): Array<Record<string, string | number | NotifyTierEntry[]>> {
  return chunk.groups.map((group) =>
    buildTierNotifyPayload({
      tokenId: group.tokenId,
      chainId: input.chainId,
      seller: input.seller,
      paymentToken: input.terms.paymentToken,
      durationSeconds: input.terms.durationSeconds,
      transactionHash: input.transactionHash,
      stemId: group.stemId,
      tiers: group.listings.map((listing) => ({
        licenseType: listing.licenseType,
        pricePerUnit: input.terms.pricePerUnit,
        amount: input.terms.amount,
        ordinal: listing.ordinal,
      })),
      listingIds: input.listingIdsByToken?.get(group.tokenId.toString()),
    }),
  );
}

/** Plain-language summary of a failed relist chunk. */
export function describeRelistFailure(input: {
  chunkIndex: number;
  chunkCount: number;
  failedLabels: string[];
  succeededLabels: string[];
  /** Stems in later groups that were never sent. */
  notSentLabels?: string[];
  reason: string;
  /** Stem the preflight check identified as failing, when known. */
  failingLabel?: string | null;
}): string {
  const group = input.chunkCount > 1 ? `Group ${input.chunkIndex + 1} of ${input.chunkCount}` : "The relist";
  const failingNote = input.failingLabel ? ` ${input.failingLabel} could not be listed.` : "";
  const reason = input.reason.trim().replace(/\.$/, "");
  const lines = [
    `${group} failed:${failingNote} ${reason}.`,
    `None of these stems were relisted: ${input.failedLabels.join(", ")}.`,
  ];
  if (input.succeededLabels.length > 0) {
    lines.push(`Already relisted in earlier groups: ${input.succeededLabels.join(", ")}.`);
  }
  if (input.notSentLabels && input.notSentLabels.length > 0) {
    lines.push(`Not sent yet: ${input.notSentLabels.join(", ")}.`);
  }
  return lines.join(" ");
}
