import {
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { StemMarketplaceABI, StemNFTABI } from "../contracts_abi/index";
import type { LicenseType } from "../components/marketplace/LicenseTypeSelector";
import {
  buildNotifyListingPayload,
  tierDefaultPriceUsd,
  type StemTierPricing,
} from "./listingTiers";
import {
  listingAssetDecimals,
  parseListingPriceUnits,
  type MarketplaceListingAsset,
} from "./listingPricing";
import { resolveStakeSafeListingPriceUnits } from "./stakeSafeListingPrice";
import type { ReleaseContentProtectionData, TrustTier } from "./api";

/**
 * Multi-tier listing planner (#2041).
 *
 * An artist can offer one stem under several license tiers at once. The
 * marketplace's list() carries no license type and does not reserve balance
 * (buy() re-checks the seller's balance), so each tier is its own on-chain
 * listing and the seller must hold enough editions to fill every one of them.
 *
 * Shortfall rule: the editions free to list are the seller's balance minus
 * the editions already offered in the seller's active listings of the same
 * token (never below zero). When the tiers ask for more than that, the plan
 * mints exactly the difference with StemNFT.mintMore in the same batch. Only
 * the stem's creator can mint more; anyone else gets a blocking error instead
 * of a listing that could never be filled.
 *
 * Calls are ordered approval → mintMore → one list() per tier, with tiers in
 * the stable order personal, remix, commercial. A tier's `ordinal` is its
 * position among this token's list() calls in that transaction, which is how
 * the backend matches each license tier to its on-chain listing.
 */

export const TIER_ORDER: readonly LicenseType[] = ["personal", "remix", "commercial"];

export const TIER_LABELS: Record<LicenseType, string> = {
  personal: "Personal",
  remix: "Remix",
  commercial: "Commercial",
};

export type TierListingInput = {
  licenseType: LicenseType;
  /** Price per edition in the listing asset's smallest units. */
  pricePerUnit: bigint;
  /** Editions offered under this tier. */
  amount: bigint;
};

export type PlannedTierListing = TierListingInput & { ordinal: number };

export type TierPlanError = {
  ok: false;
  reason:
    | "no_tiers"
    | "too_many_tiers"
    | "duplicate_tier"
    | "invalid_price"
    | "invalid_amount"
    | "mint_not_allowed";
  message: string;
};

export type OrderedTiersResult =
  | { ok: true; tiers: PlannedTierListing[]; totalAmount: bigint }
  | TierPlanError;

/** Validate the chosen tiers and assign ordinals in the stable tier order. */
export function orderTiers(tiers: TierListingInput[]): OrderedTiersResult {
  if (tiers.length === 0) {
    return { ok: false, reason: "no_tiers", message: "Choose at least one license tier." };
  }
  if (tiers.length > TIER_ORDER.length) {
    return { ok: false, reason: "too_many_tiers", message: "Choose at most three license tiers." };
  }
  const seen = new Set<LicenseType>();
  for (const tier of tiers) {
    if (!TIER_ORDER.includes(tier.licenseType) || seen.has(tier.licenseType)) {
      return {
        ok: false,
        reason: "duplicate_tier",
        message: "Each license tier can be listed only once per confirmation.",
      };
    }
    seen.add(tier.licenseType);
    if (tier.pricePerUnit <= 0n) {
      return {
        ok: false,
        reason: "invalid_price",
        message: `${TIER_LABELS[tier.licenseType]} price must be greater than zero.`,
      };
    }
    if (tier.amount < 1n) {
      return {
        ok: false,
        reason: "invalid_amount",
        message: `${TIER_LABELS[tier.licenseType]} needs at least one edition.`,
      };
    }
  }
  const ordered = [...tiers].sort(
    (a, b) => TIER_ORDER.indexOf(a.licenseType) - TIER_ORDER.indexOf(b.licenseType),
  );
  return {
    ok: true,
    tiers: ordered.map((tier, ordinal) => ({ ...tier, ordinal })),
    totalAmount: ordered.reduce((sum, tier) => sum + tier.amount, 0n),
  };
}

export type ListTiersPlanInput = {
  tiers: TierListingInput[];
  /** Seller's current balance of the token. */
  balance: bigint;
  /** Editions already offered in the seller's active listings of the token. */
  committedAmount?: bigint;
  /** Whether the seller may mint more editions (only the stem's creator can). */
  canMintMore: boolean;
  /**
   * Include setApprovalForAll for the marketplace. Defaults to true, matching
   * today's listing flows (the call is idempotent).
   */
  includeApproval?: boolean;
};

export type ListTiersPlan = {
  ok: true;
  tiers: PlannedTierListing[];
  totalAmount: bigint;
  /** Editions free to list before minting: balance − committed, floored at 0. */
  availableAmount: bigint;
  /** Editions to mint with mintMore in the same batch (0 = none). */
  mintAmount: bigint;
  includeApproval: boolean;
};

export function planTierListings(input: ListTiersPlanInput): ListTiersPlan | TierPlanError {
  const ordered = orderTiers(input.tiers);
  if (!ordered.ok) return ordered;
  const committed = input.committedAmount && input.committedAmount > 0n ? input.committedAmount : 0n;
  const availableAmount = input.balance > committed ? input.balance - committed : 0n;
  const mintAmount = ordered.totalAmount > availableAmount ? ordered.totalAmount - availableAmount : 0n;
  if (mintAmount > 0n && !input.canMintMore) {
    const committedNote = committed > 0n ? ` (${committed} already in your active listings)` : "";
    return {
      ok: false,
      reason: "mint_not_allowed",
      message: `You have ${availableAmount} edition${availableAmount === 1n ? "" : "s"} free to list${committedNote}, but these tiers need ${ordered.totalAmount}. Only the stem's creator can mint more, so lower the edition counts.`,
    };
  }
  return {
    ok: true,
    tiers: ordered.tiers,
    totalAmount: ordered.totalAmount,
    availableAmount,
    mintAmount,
    includeApproval: input.includeApproval ?? true,
  };
}

export type BatchCall = {
  to: Address;
  data: Hex | ((sender: Address) => Hex);
  value?: bigint;
};

/**
 * Encode a ready plan as an ordered call list for one batched UserOperation.
 * mintMore mints to the sending smart account, resolved at send time.
 */
export function buildListTiersCalls(
  plan: ListTiersPlan,
  params: {
    tokenId: bigint;
    paymentToken: Address;
    durationSeconds: bigint;
    stemNFT: Address;
    marketplace: Address;
  },
): BatchCall[] {
  const calls: BatchCall[] = [];
  if (plan.includeApproval) {
    calls.push({
      to: params.stemNFT,
      data: encodeFunctionData({
        abi: StemNFTABI,
        functionName: "setApprovalForAll",
        args: [params.marketplace, true],
      }),
    });
  }
  if (plan.mintAmount > 0n) {
    const mintAmount = plan.mintAmount;
    calls.push({
      to: params.stemNFT,
      data: (sender: Address) =>
        encodeFunctionData({
          abi: StemNFTABI,
          functionName: "mintMore",
          args: [sender, params.tokenId, mintAmount],
        }),
    });
  }
  for (const tier of plan.tiers) {
    calls.push({
      to: params.marketplace,
      data: encodeFunctionData({
        abi: StemMarketplaceABI,
        functionName: "list",
        args: [
          params.tokenId,
          tier.amount,
          tier.pricePerUnit,
          params.paymentToken,
          params.durationSeconds,
        ],
      }),
    });
  }
  return calls;
}

/**
 * List-after-mint calls for one freshly minted stem: one listLastMint per
 * tier, in ordinal order. The mint itself must create `totalAmount` editions.
 * listLastMint resolves the token minted earlier in the same transaction, so
 * several tier listings can follow one mint; the release protection root is
 * registered idempotently on each call.
 */
export function buildListLastMintTierCalls(
  tiers: PlannedTierListing[],
  params: {
    paymentToken: Address;
    durationSeconds: bigint;
    releaseProtectionId: bigint;
    marketplace: Address;
  },
): BatchCall[] {
  return tiers.map((tier) => ({
    to: params.marketplace,
    data: encodeFunctionData({
      abi: StemMarketplaceABI,
      functionName: "listLastMint",
      args: [
        tier.amount,
        tier.pricePerUnit,
        params.paymentToken,
        params.durationSeconds,
        params.releaseProtectionId,
      ],
    }),
  }));
}

export type ReceiptLog = {
  address?: string;
  data: Hex;
  topics: readonly Hex[] | Hex[];
};

/**
 * Listing ids created for `tokenId` in a transaction, in log order. Logs
 * from other contracts or events are ignored.
 */
export function listingIdsFromReceipt(
  logs: readonly ReceiptLog[],
  tokenId: bigint,
  marketplaceAddress?: string,
): bigint[] {
  const ids: bigint[] = [];
  const marketplace = marketplaceAddress?.toLowerCase();
  for (const log of logs) {
    if (marketplace && log.address && log.address.toLowerCase() !== marketplace) continue;
    try {
      const decoded = decodeEventLog({
        abi: StemMarketplaceABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "Listed" && decoded.args.tokenId === tokenId) {
        ids.push(decoded.args.listingId);
      }
    } catch {
      // Not a marketplace Listed event.
    }
  }
  return ids;
}

export type TierNotifyInput = {
  tokenId: bigint;
  chainId: number;
  seller: string;
  paymentToken: string;
  durationSeconds: bigint;
  transactionHash: string;
  stemId?: string | null;
  tiers: PlannedTierListing[];
  /** This token's Listed ids in log order; attached only when one per tier. */
  listingIds?: bigint[];
};

export type NotifyTierEntry = {
  licenseType: LicenseType;
  pricePerUnit: string;
  amount: string;
  ordinal: number;
  listingId?: string;
};

/**
 * Body for POST /api/contracts/notify-listing. One tier keeps the
 * single-tier body; several tiers add a `tiers` array (the top-level fields
 * mirror ordinal 0 so older readers still record the first tier).
 */
export function buildTierNotifyPayload(
  input: TierNotifyInput,
): Record<string, string | number | NotifyTierEntry[]> {
  const [first] = input.tiers;
  if (!first) {
    throw new Error("At least one tier is required");
  }
  const base = buildNotifyListingPayload({
    tokenId: input.tokenId,
    chainId: input.chainId,
    seller: input.seller,
    priceUnits: first.pricePerUnit,
    amount: first.amount,
    paymentToken: input.paymentToken,
    durationSeconds: input.durationSeconds,
    transactionHash: input.transactionHash,
    licenseType: first.licenseType,
    stemId: input.stemId,
  });
  if (input.tiers.length === 1) {
    return base;
  }
  const ids =
    input.listingIds && input.listingIds.length === input.tiers.length
      ? input.listingIds
      : null;
  return {
    ...base,
    tiers: input.tiers.map((tier) => ({
      licenseType: tier.licenseType,
      pricePerUnit: tier.pricePerUnit.toString(),
      amount: tier.amount.toString(),
      ordinal: tier.ordinal,
      ...(ids ? { listingId: ids[tier.ordinal].toString() } : {}),
    })),
  };
}

/** One plain-language line describing what the confirmation will do. */
export function describeTierPlan(input: {
  tierCount: number;
  totalAmount: bigint;
  mintAmount: bigint;
  mode: "list" | "mint";
}): string {
  const tiers = `${input.tierCount} license tier${input.tierCount === 1 ? "" : "s"}`;
  const editions = (n: bigint) => `${n} edition${n === 1n ? "" : "s"}`;
  if (input.mode === "mint") {
    return `Mints ${editions(input.totalAmount)} and lists ${tiers} in one confirmation.`;
  }
  if (input.mintAmount > 0n) {
    return `Lists ${tiers} (${editions(input.totalAmount)}); mints ${input.mintAmount} more edition${input.mintAmount === 1n ? "" : "s"} to cover them, in one confirmation.`;
  }
  return `Lists ${tiers} (${editions(input.totalAmount)}) in one confirmation.`;
}

// ---------------------------------------------------------------------------
// Tier picker form state (shared by the list and mint flows)
// ---------------------------------------------------------------------------

export type TierDraft = { selected: boolean; price: string; amount: string };
export type TierDrafts = Record<LicenseType, TierDraft>;
export type TierDraftErrors = Partial<Record<LicenseType, { price?: string; amount?: string }>>;

/** Format asset units as a plain decimal string for a price input. */
export function formatPriceInput(units: bigint, asset: MarketplaceListingAsset): string {
  return formatUnits(units, listingAssetDecimals(asset));
}

/**
 * Initial picker state. Personal (or `initialTier`) is selected; prices are
 * prefilled from the stem's catalog pricing when the listing asset is
 * USD-denominated, otherwise from the personal price. Prefills never exceed
 * `maxPriceUnits` when a price cap applies.
 */
export function initialTierDrafts(input: {
  personalPrice: string;
  asset: MarketplaceListingAsset;
  pricing?: StemTierPricing | null;
  initialTier?: LicenseType;
  maxPriceUnits?: bigint | null;
}): TierDrafts {
  const usd = (input.asset?.symbol ?? "ETH").toUpperCase().includes("USD");
  const capped = (price: string): string => {
    if (input.maxPriceUnits == null) return price;
    try {
      const units = parseListingPriceUnits({ price, asset: input.asset });
      return units > input.maxPriceUnits ? formatPriceInput(input.maxPriceUnits, input.asset) : price;
    } catch {
      return price;
    }
  };
  const priceFor = (tier: LicenseType): string => {
    const defaultUsd = tierDefaultPriceUsd(input.pricing ?? null, tier);
    return capped(usd && defaultUsd != null ? String(defaultUsd) : input.personalPrice);
  };
  const initial = input.initialTier ?? "personal";
  return {
    personal: { selected: initial === "personal", price: capped(input.personalPrice), amount: "1" },
    remix: { selected: initial === "remix", price: priceFor("remix"), amount: "1" },
    commercial: { selected: initial === "commercial", price: priceFor("commercial"), amount: "1" },
  };
}

export type ValidatedTierDrafts = {
  tiers: TierListingInput[];
  errors: TierDraftErrors;
  /** Form-level problem, e.g. nothing selected. */
  formError: string | null;
  valid: boolean;
};

/** Inline validation: price > 0 (and within the cap), whole edition count ≥ 1. */
export function validateTierDrafts(
  drafts: TierDrafts,
  options: { asset: MarketplaceListingAsset; maxPriceUnits?: bigint | null; maxPriceLabel?: string },
): ValidatedTierDrafts {
  const tiers: TierListingInput[] = [];
  const errors: TierDraftErrors = {};
  for (const tier of TIER_ORDER) {
    const draft = drafts[tier];
    if (!draft.selected) continue;
    const tierErrors: { price?: string; amount?: string } = {};
    let priceUnits = 0n;
    try {
      priceUnits = parseListingPriceUnits({ price: draft.price.trim() || "0", asset: options.asset });
    } catch {
      priceUnits = -1n;
    }
    if (priceUnits < 0n) {
      tierErrors.price = "Enter a valid price.";
    } else if (priceUnits === 0n) {
      tierErrors.price = "Price must be greater than zero.";
    } else if (options.maxPriceUnits != null && priceUnits > options.maxPriceUnits) {
      tierErrors.price = `Price is above this stem's current limit${options.maxPriceLabel ? ` of ${options.maxPriceLabel}` : ""}.`;
    }
    const amountText = draft.amount.trim();
    if (!/^\d+$/.test(amountText) || BigInt(amountText) < 1n) {
      tierErrors.amount = "At least 1 edition.";
    }
    if (tierErrors.price || tierErrors.amount) {
      errors[tier] = tierErrors;
      continue;
    }
    tiers.push({ licenseType: tier, pricePerUnit: priceUnits, amount: BigInt(amountText) });
  }
  const anySelected = TIER_ORDER.some((tier) => drafts[tier].selected);
  const formError = anySelected ? null : "Choose at least one license tier.";
  return {
    tiers,
    errors,
    formError,
    valid: anySelected && Object.keys(errors).length === 0,
  };
}

type PriceCapInput = {
  asset: MarketplaceListingAsset;
  releaseProtection?: Pick<ReleaseContentProtectionData, "active" | "stakeAmount" | "staked"> | null;
  trustTier?: Pick<TrustTier, "maxListingPriceWei" | "maxListingPriceUncapped" | "maxPriceMultiplier"> | null;
};

const UNCAPPED_SENTINEL_WEI = 10n ** 36n;

/**
 * Per-edition price limit in listing-asset units for a stem's release (stake
 * cap or trust-tier cap), or null when uncapped. Mirrors the cap the mint
 * flows already apply to their single listing price.
 */
export function resolveListingPriceCapUnits(input: PriceCapInput): bigint | null {
  const sentinelUnits = parseListingPriceUnits({
    price: formatUnits(UNCAPPED_SENTINEL_WEI, 18),
    asset: input.asset,
  });
  const resolved = resolveStakeSafeListingPriceUnits(input, UNCAPPED_SENTINEL_WEI);
  return resolved < sentinelUnits ? resolved : null;
}

/**
 * Editions to treat as already committed to the seller's active listings.
 * When those listings couldn't be read and several tiers are being listed,
 * every edition counts as committed, so the plan mints what the tiers need (or
 * refuses for a non-creator) and never creates a listing that can't be filled.
 * A single tier keeps the one-listing behaviour it always had (#2041).
 */
export function committedEditionsForPlan(input: {
  status: "loading" | "ok" | "unknown";
  amount?: bigint;
  balance: bigint;
  tierCount: number;
}): bigint {
  if (input.status === "ok") return input.amount ?? 0n;
  if (input.status === "unknown" && input.tierCount > 1) return input.balance;
  return 0n;
}
