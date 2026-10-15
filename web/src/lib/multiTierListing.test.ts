import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { StemMarketplaceABI, StemNFTABI } from "../contracts_abi/index";
import {
  buildListLastMintTierCalls,
  buildListTiersCalls,
  buildTierNotifyPayload,
  committedEditionsForPlan,
  describeTierPlan,
  initialTierDrafts,
  listingIdsFromReceipt,
  orderTiers,
  planTierListings,
  resolveListingPriceCapUnits,
  validateTierDrafts,
  type ListTiersPlan,
  type TierListingInput,
} from "./multiTierListing";
import type { PaymentAsset } from "./payments";

const USDC = {
  assetId: "usdc",
  symbol: "USDC",
  name: "Circle USDC",
  decimals: 6,
  kind: "stablecoin",
  chainId: 31337,
  tokenAddress: "0x" + "1".repeat(40),
} as unknown as PaymentAsset;

const STEM_NFT = getAddress("0x" + "a".repeat(40)) as Address;
const MARKETPLACE = getAddress("0x" + "b".repeat(40)) as Address;
const PAYMENT = getAddress("0x" + "c".repeat(40)) as Address;
const SELLER = getAddress("0x" + "d".repeat(40)) as Address;

const tier = (
  licenseType: TierListingInput["licenseType"],
  pricePerUnit: bigint,
  amount: bigint,
): TierListingInput => ({ licenseType, pricePerUnit, amount });

function expectPlan(result: ReturnType<typeof planTierListings>): ListTiersPlan {
  if (!result.ok) throw new Error(`expected a plan, got ${result.reason}`);
  return result;
}

describe("orderTiers", () => {
  it("orders tiers personal → remix → commercial and assigns ordinals", () => {
    const result = orderTiers([
      tier("commercial", 25n, 1n),
      tier("personal", 1n, 2n),
      tier("remix", 5n, 1n),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tiers.map((t) => [t.licenseType, t.ordinal])).toEqual([
      ["personal", 0],
      ["remix", 1],
      ["commercial", 2],
    ]);
    expect(result.totalAmount).toBe(4n);
  });

  it("rejects empty, duplicate, zero-price and zero-edition tiers", () => {
    expect(orderTiers([])).toMatchObject({ ok: false, reason: "no_tiers" });
    expect(orderTiers([tier("remix", 5n, 1n), tier("remix", 6n, 1n)])).toMatchObject({
      ok: false,
      reason: "duplicate_tier",
    });
    expect(orderTiers([tier("remix", 0n, 1n)])).toMatchObject({ ok: false, reason: "invalid_price" });
    expect(orderTiers([tier("remix", 5n, 0n)])).toMatchObject({ ok: false, reason: "invalid_amount" });
  });
});

describe("planTierListings", () => {
  it("mints nothing when the free balance covers every tier", () => {
    const plan = expectPlan(
      planTierListings({
        tiers: [tier("personal", 1n, 1n), tier("remix", 5n, 1n)],
        balance: 3n,
        canMintMore: false,
      }),
    );
    expect(plan.mintAmount).toBe(0n);
    expect(plan.availableAmount).toBe(3n);
    expect(plan.includeApproval).toBe(true);
  });

  it("mints exactly the shortfall: total − (balance − committed)", () => {
    const plan = expectPlan(
      planTierListings({
        tiers: [tier("personal", 1n, 2n), tier("remix", 5n, 1n), tier("commercial", 25n, 1n)],
        balance: 3n,
        committedAmount: 1n,
        canMintMore: true,
      }),
    );
    expect(plan.totalAmount).toBe(4n);
    expect(plan.availableAmount).toBe(2n);
    expect(plan.mintAmount).toBe(2n);
  });

  it("floors the free balance at zero when listings already exceed it", () => {
    const plan = expectPlan(
      planTierListings({
        tiers: [tier("remix", 5n, 1n)],
        balance: 1n,
        committedAmount: 3n,
        canMintMore: true,
      }),
    );
    expect(plan.availableAmount).toBe(0n);
    expect(plan.mintAmount).toBe(1n);
  });

  it("never plans an unfillable listing for a seller who cannot mint", () => {
    const result = planTierListings({
      tiers: [tier("personal", 1n, 1n), tier("remix", 5n, 1n)],
      balance: 1n,
      canMintMore: false,
    });
    expect(result).toMatchObject({ ok: false, reason: "mint_not_allowed" });
    if (!result.ok) {
      expect(result.message).toContain("1 edition free to list");
      expect(result.message).toContain("need 2");
    }
  });

  it("can skip the approval call", () => {
    const plan = expectPlan(
      planTierListings({
        tiers: [tier("personal", 1n, 1n)],
        balance: 1n,
        canMintMore: false,
        includeApproval: false,
      }),
    );
    expect(plan.includeApproval).toBe(false);
  });
});

describe("buildListTiersCalls", () => {
  const params = {
    tokenId: 74n,
    paymentToken: PAYMENT,
    durationSeconds: 604800n,
    stemNFT: STEM_NFT,
    marketplace: MARKETPLACE,
  };

  it("orders approval → mintMore → one list() per tier", () => {
    const plan = expectPlan(
      planTierListings({
        tiers: [tier("commercial", 25_000_000n, 1n), tier("personal", 10_000n, 1n)],
        balance: 1n,
        canMintMore: true,
      }),
    );
    const calls = buildListTiersCalls(plan, params);
    expect(calls.map((c) => c.to)).toEqual([STEM_NFT, STEM_NFT, MARKETPLACE, MARKETPLACE]);

    const approve = decodeFunctionData({ abi: StemNFTABI, data: calls[0].data as Hex });
    expect(approve.functionName).toBe("setApprovalForAll");
    expect(approve.args).toEqual([MARKETPLACE, true]);

    expect(typeof calls[1].data).toBe("function");
    const mint = decodeFunctionData({
      abi: StemNFTABI,
      data: (calls[1].data as (sender: Address) => Hex)(SELLER),
    });
    expect(mint.functionName).toBe("mintMore");
    expect(mint.args).toEqual([SELLER, 74n, 1n]);

    const lists = calls.slice(2).map((c) => decodeFunctionData({ abi: StemMarketplaceABI, data: c.data as Hex }));
    expect(lists.map((l) => l.functionName)).toEqual(["list", "list"]);
    expect(lists[0].args).toEqual([74n, 1n, 10_000n, PAYMENT, 604800n]);
    expect(lists[1].args).toEqual([74n, 1n, 25_000_000n, PAYMENT, 604800n]);
  });

  it("omits mintMore when no editions are missing", () => {
    const plan = expectPlan(
      planTierListings({ tiers: [tier("remix", 5n, 1n)], balance: 2n, canMintMore: true }),
    );
    const calls = buildListTiersCalls(plan, params);
    expect(calls).toHaveLength(2);
  });
});

describe("buildListLastMintTierCalls", () => {
  it("lists each tier after a mint with its own amount and price", () => {
    const ordered = orderTiers([tier("remix", 5n, 2n), tier("personal", 1n, 1n)]);
    if (!ordered.ok) throw new Error("expected tiers");
    const calls = buildListLastMintTierCalls(ordered.tiers, {
      paymentToken: PAYMENT,
      durationSeconds: 60n,
      releaseProtectionId: 9n,
      marketplace: MARKETPLACE,
    });
    const decoded = calls.map((c) => decodeFunctionData({ abi: StemMarketplaceABI, data: c.data as Hex }));
    expect(decoded.map((d) => d.functionName)).toEqual(["listLastMint", "listLastMint"]);
    expect(decoded[0].args).toEqual([1n, 1n, PAYMENT, 60n, 9n]);
    expect(decoded[1].args).toEqual([2n, 5n, PAYMENT, 60n, 9n]);
  });
});

function listedLog(listingId: bigint, tokenId: bigint, address: string = MARKETPLACE) {
  return {
    address,
    topics: encodeEventTopics({
      abi: StemMarketplaceABI,
      eventName: "Listed",
      args: { listingId, seller: SELLER },
    }) as Hex[],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [tokenId, 1n, 5n],
    ),
  };
}

describe("listingIdsFromReceipt", () => {
  it("returns this token's listing ids in log order", () => {
    const logs = [
      { address: STEM_NFT, topics: ["0x" + "0".repeat(64)] as Hex[], data: "0x" as Hex },
      listedLog(11n, 74n),
      listedLog(12n, 99n),
      listedLog(13n, 74n),
    ];
    expect(listingIdsFromReceipt(logs, 74n, MARKETPLACE)).toEqual([11n, 13n]);
    expect(listingIdsFromReceipt(logs, 99n)).toEqual([12n]);
  });

  it("ignores Listed events from another contract", () => {
    const logs = [listedLog(11n, 74n, STEM_NFT)];
    expect(listingIdsFromReceipt(logs, 74n, MARKETPLACE)).toEqual([]);
  });
});

describe("buildTierNotifyPayload", () => {
  const base = {
    tokenId: 74n,
    chainId: 31337,
    seller: "0xSeller",
    paymentToken: "0xToken",
    durationSeconds: 604800n,
    transactionHash: "0xHash",
    stemId: "stem-1",
  };

  it("keeps the single-tier body for one tier", () => {
    const ordered = orderTiers([tier("remix", 5_000_000n, 1n)]);
    if (!ordered.ok) throw new Error("expected tiers");
    expect(buildTierNotifyPayload({ ...base, tiers: ordered.tiers, listingIds: [7n] })).toEqual({
      tokenId: "74",
      chainId: 31337,
      seller: "0xSeller",
      sellerAddress: "0xSeller",
      price: "5000000",
      amount: "1",
      paymentToken: "0xToken",
      licenseType: "remix",
      durationSeconds: "604800",
      transactionHash: "0xHash",
      stemId: "stem-1",
    });
  });

  it("adds tiers with ordinals and listing ids when one id per tier is known", () => {
    const ordered = orderTiers([tier("commercial", 25n, 1n), tier("personal", 1n, 2n)]);
    if (!ordered.ok) throw new Error("expected tiers");
    const payload = buildTierNotifyPayload({ ...base, tiers: ordered.tiers, listingIds: [40n, 41n] });
    expect(payload.sellerAddress).toBe("0xSeller");
    expect(payload.licenseType).toBe("personal");
    expect(payload.price).toBe("1");
    expect(payload.amount).toBe("2");
    expect(payload.tiers).toEqual([
      { licenseType: "personal", pricePerUnit: "1", amount: "2", ordinal: 0, listingId: "40" },
      { licenseType: "commercial", pricePerUnit: "25", amount: "1", ordinal: 1, listingId: "41" },
    ]);
  });

  it("omits listing ids when the receipt did not yield one per tier", () => {
    const ordered = orderTiers([tier("personal", 1n, 1n), tier("remix", 5n, 1n)]);
    if (!ordered.ok) throw new Error("expected tiers");
    const payload = buildTierNotifyPayload({ ...base, tiers: ordered.tiers, listingIds: [40n] });
    expect(payload.tiers).toEqual([
      { licenseType: "personal", pricePerUnit: "1", amount: "1", ordinal: 0 },
      { licenseType: "remix", pricePerUnit: "5", amount: "1", ordinal: 1 },
    ]);
  });
});

describe("describeTierPlan", () => {
  it("states tiers, editions and minting in plain words", () => {
    expect(describeTierPlan({ tierCount: 2, totalAmount: 2n, mintAmount: 1n, mode: "list" })).toBe(
      "Lists 2 license tiers (2 editions); mints 1 more edition to cover them, in one confirmation.",
    );
    expect(describeTierPlan({ tierCount: 1, totalAmount: 1n, mintAmount: 0n, mode: "list" })).toBe(
      "Lists 1 license tier (1 edition) in one confirmation.",
    );
    expect(describeTierPlan({ tierCount: 3, totalAmount: 3n, mintAmount: 3n, mode: "mint" })).toBe(
      "Mints 3 editions and lists 3 license tiers in one confirmation.",
    );
  });
});

describe("tier picker drafts", () => {
  it("prefills catalog USD prices for a stablecoin listing asset", () => {
    const drafts = initialTierDrafts({
      personalPrice: "0.5",
      asset: USDC,
      pricing: { remixLicenseUsd: 8, commercialLicenseUsd: null },
    });
    expect(drafts.personal).toEqual({ selected: true, price: "0.5", amount: "1" });
    expect(drafts.remix).toEqual({ selected: false, price: "8", amount: "1" });
    expect(drafts.commercial.price).toBe("25");
  });

  it("falls back to the personal price for a non-USD asset and respects a cap", () => {
    const drafts = initialTierDrafts({ personalPrice: "0.01", asset: null, initialTier: "remix" });
    expect(drafts.remix).toEqual({ selected: true, price: "0.01", amount: "1" });
    expect(drafts.personal.selected).toBe(false);

    const capped = initialTierDrafts({ personalPrice: "1", asset: USDC, maxPriceUnits: 2_000_000n });
    expect(capped.remix.price).toBe("2");
    expect(capped.commercial.price).toBe("2");
    expect(capped.personal.price).toBe("1");
  });

  it("validates price, edition count and the price cap inline", () => {
    const drafts = initialTierDrafts({ personalPrice: "1", asset: USDC });
    drafts.remix = { selected: true, price: "0", amount: "1" };
    drafts.commercial = { selected: true, price: "30", amount: "0" };
    const result = validateTierDrafts(drafts, { asset: USDC, maxPriceUnits: 20_000_000n, maxPriceLabel: "20 USDC" });
    expect(result.valid).toBe(false);
    expect(result.errors.remix?.price).toBe("Price must be greater than zero.");
    expect(result.errors.commercial?.price).toContain("20 USDC");
    expect(result.errors.commercial?.amount).toBe("At least 1 edition.");
    expect(result.tiers).toEqual([{ licenseType: "personal", pricePerUnit: 1_000_000n, amount: 1n }]);
  });

  it("requires at least one tier", () => {
    const drafts = initialTierDrafts({ personalPrice: "1", asset: USDC });
    drafts.personal = { ...drafts.personal, selected: false };
    const result = validateTierDrafts(drafts, { asset: USDC });
    expect(result.valid).toBe(false);
    expect(result.formError).toBe("Choose at least one license tier.");
  });

  it("rejects fractional edition counts", () => {
    const drafts = initialTierDrafts({ personalPrice: "1", asset: USDC });
    drafts.personal = { ...drafts.personal, amount: "1.5" };
    expect(validateTierDrafts(drafts, { asset: USDC }).errors.personal?.amount).toBe("At least 1 edition.");
  });
});

describe("resolveListingPriceCapUnits", () => {
  it("is null without a cap and the stake cap when protection is active", () => {
    expect(resolveListingPriceCapUnits({ asset: USDC })).toBeNull();
    expect(
      resolveListingPriceCapUnits({
        asset: USDC,
        releaseProtection: { active: true, staked: true, stakeAmount: "1000000" },
        trustTier: { maxPriceMultiplier: 10, maxListingPriceWei: null, maxListingPriceUncapped: false },
      }),
    ).toBe(10_000_000n);
  });
});

describe("committedEditionsForPlan (#2041)", () => {
  it("uses the known committed amount", () => {
    expect(committedEditionsForPlan({ status: "ok", amount: 2n, balance: 5n, tierCount: 3 })).toBe(2n);
  });
  it("treats every edition as committed when listings are unreadable and several tiers are listed", () => {
    expect(committedEditionsForPlan({ status: "unknown", balance: 4n, tierCount: 2 })).toBe(4n);
  });
  it("keeps a single tier's old behaviour when listings are unreadable", () => {
    expect(committedEditionsForPlan({ status: "unknown", balance: 4n, tierCount: 1 })).toBe(0n);
  });
  it("counts nothing while loading", () => {
    expect(committedEditionsForPlan({ status: "loading", balance: 4n, tierCount: 2 })).toBe(0n);
  });
});
