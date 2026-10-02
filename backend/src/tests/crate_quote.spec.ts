import {
  aggregateQuoteTotals,
  chooseQuoteStemTypes,
  chooseQuoteTier,
  classifyChainListing,
  CRATE_QUOTE_FALLBACK_TIER,
  CRATE_QUOTE_TTL_MS,
  isTransactionHash,
  matchReceipts,
  pickListing,
  scaledToUsd,
  settlementStatus,
  sumUsd,
  usdToScaled,
  type DecorateUnits,
  type QuoteListingCandidate,
} from "../modules/crates/crate_quote";
import type { MarketplaceSoldLog } from "../modules/crates/crate_marketplace_reader";

const BUYER = "0x" + "b".repeat(40);
const SELLER = "0x" + "5".repeat(40);

function candidate(overrides: Partial<QuoteListingCandidate> = {}): QuoteListingCandidate {
  return {
    id: "l1",
    licenseType: "personal",
    pricePerUnitUnits: 1_000_000n,
    canonicalUsd: "1",
    listedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

function sold(overrides: Partial<MarketplaceSoldLog> = {}): MarketplaceSoldLog {
  return { listingId: 1n, buyer: BUYER, amount: 1n, totalPaid: 1_000_000n, logIndex: 0, ...overrides };
}

describe("crate quote constants", () => {
  it("keeps a quote open for ten minutes", () => {
    expect(CRATE_QUOTE_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe("pickListing", () => {
  it("takes the lowest canonical USD", () => {
    const picked = pickListing([
      candidate({ id: "a", canonicalUsd: "2" }),
      candidate({ id: "b", canonicalUsd: "0.5" }),
      candidate({ id: "c", canonicalUsd: "1" }),
    ]);
    expect(picked?.id).toBe("b");
  });

  it("breaks a USD tie with the newest listing", () => {
    const picked = pickListing([
      candidate({ id: "old", listedAt: new Date("2026-09-01T00:00:00Z") }),
      candidate({ id: "new", listedAt: new Date("2026-10-01T00:00:00Z") }),
    ]);
    expect(picked?.id).toBe("new");
  });

  it("prefers a known USD price over an unknown one, then falls back to raw units", () => {
    expect(
      pickListing([
        candidate({ id: "unknown", canonicalUsd: null, pricePerUnitUnits: 1n }),
        candidate({ id: "known", canonicalUsd: "9" }),
      ])?.id,
    ).toBe("known");
    expect(
      pickListing([
        candidate({ id: "big", canonicalUsd: null, pricePerUnitUnits: 500n }),
        candidate({ id: "small", canonicalUsd: null, pricePerUnitUnits: 5n }),
      ])?.id,
    ).toBe("small");
  });

  it("returns null for no candidates", () => {
    expect(pickListing([])).toBeNull();
  });

  it("compares USD as decimals, not as text", () => {
    expect(
      pickListing([
        candidate({ id: "ten", canonicalUsd: "10" }),
        candidate({ id: "nine", canonicalUsd: "9.5" }),
      ])?.id,
    ).toBe("nine");
  });
});

describe("chooseQuoteTier", () => {
  const listings = [
    candidate({ id: "p", licenseType: "personal", canonicalUsd: "1" }),
    candidate({ id: "r", licenseType: "remix", canonicalUsd: "8" }),
    candidate({ id: "c", licenseType: "commercial", canonicalUsd: "20" }),
  ];

  it("uses the line's tier first, then the crate's license filter", () => {
    expect(
      chooseQuoteTier({ lineLicenseType: "commercial", filterLicenseType: "remix", listings }),
    ).toBe("commercial");
    expect(chooseQuoteTier({ lineLicenseType: null, filterLicenseType: "remix", listings })).toBe(
      "remix",
    );
  });

  it("falls back to the cheapest tier with an active listing", () => {
    expect(chooseQuoteTier({ listings })).toBe("personal");
    expect(
      chooseQuoteTier({
        listings: [
          candidate({ id: "r", licenseType: "remix", canonicalUsd: "3" }),
          candidate({ id: "c", licenseType: "commercial", canonicalUsd: "20" }),
        ],
      }),
    ).toBe("remix");
  });

  it("breaks a USD tie in license tier order", () => {
    expect(
      chooseQuoteTier({
        listings: [
          candidate({ id: "c", licenseType: "commercial", canonicalUsd: "5" }),
          candidate({ id: "r", licenseType: "remix", canonicalUsd: "5" }),
        ],
      }),
    ).toBe("remix");
  });

  it("compares the cheapest listing of each tier", () => {
    expect(
      chooseQuoteTier({
        listings: [
          candidate({ id: "r1", licenseType: "remix", canonicalUsd: "9" }),
          candidate({ id: "r2", licenseType: "remix", canonicalUsd: "2" }),
          candidate({ id: "p", licenseType: "personal", canonicalUsd: "4" }),
        ],
      }),
    ).toBe("remix");
  });

  it("uses the fallback tier when nothing is listed", () => {
    expect(chooseQuoteTier({ listings: [] })).toBe(CRATE_QUOTE_FALLBACK_TIER);
  });
});

describe("chooseQuoteStemTypes", () => {
  it("prefers the line's stems, then the crate's required stems, then every listed stem", () => {
    expect(
      chooseQuoteStemTypes({
        lineStemTypes: ["vocals"],
        filterRequiredStems: ["drums"],
        listedAtTier: ["bass", "drums"],
        trackStemTypes: ["bass", "drums", "vocals"],
      }),
    ).toEqual(["vocals"]);
    expect(
      chooseQuoteStemTypes({
        lineStemTypes: null,
        filterRequiredStems: ["drums", "bass"],
        listedAtTier: ["vocals"],
        trackStemTypes: ["bass", "drums", "vocals"],
      }),
    ).toEqual(["bass", "drums"]);
    expect(
      chooseQuoteStemTypes({
        lineStemTypes: [],
        filterRequiredStems: [],
        listedAtTier: ["vocals", "bass", "vocals"],
        trackStemTypes: ["bass", "drums", "vocals"],
      }),
    ).toEqual(["bass", "vocals"]);
    // Nothing listed at the tier: report every stem of the track (as not listed).
    expect(
      chooseQuoteStemTypes({
        lineStemTypes: null,
        filterRequiredStems: [],
        listedAtTier: [],
        trackStemTypes: ["vocals", "bass"],
      }),
    ).toEqual(["bass", "vocals"]);
  });
});

describe("classifyChainListing", () => {
  const base = { buyerAddress: BUYER, nowSeconds: 1_000 };
  const live = { seller: SELLER, amount: 3n, expiry: 2_000 };

  it("accepts a live listing", () => {
    expect(classifyChainListing({ ...base, listing: live })).toBeNull();
  });

  it("is sold out when the seller is zero (deleted) or nothing is left", () => {
    expect(
      classifyChainListing({
        ...base,
        listing: { seller: "0x" + "0".repeat(40), amount: 0n, expiry: 0 },
      }),
    ).toBe("sold_out");
    expect(classifyChainListing({ ...base, listing: { ...live, amount: 0n } })).toBe("sold_out");
  });

  it("is expired only after the expiry second, like the contract", () => {
    expect(classifyChainListing({ ...base, nowSeconds: 2_000, listing: live })).toBeNull();
    expect(classifyChainListing({ ...base, nowSeconds: 2_001, listing: live })).toBe("expired");
  });

  it("refuses the seller buying their own listing, ignoring case", () => {
    expect(
      classifyChainListing({
        ...base,
        buyerAddress: SELLER.toUpperCase().replace("0X", "0x"),
        listing: live,
      }),
    ).toBe("own_listing");
  });

  it("reports sold out before expired before own listing", () => {
    expect(
      classifyChainListing({
        buyerAddress: SELLER,
        nowSeconds: 9_999,
        listing: { seller: SELLER, amount: 0n, expiry: 1 },
      }),
    ).toBe("sold_out");
    expect(
      classifyChainListing({
        buyerAddress: SELLER,
        nowSeconds: 9_999,
        listing: { seller: SELLER, amount: 1n, expiry: 1 },
      }),
    ).toBe("expired");
  });
});

describe("USD arithmetic", () => {
  it("round-trips decimal strings exactly", () => {
    expect(scaledToUsd(usdToScaled("0.1"))).toBe("0.1");
    expect(scaledToUsd(usdToScaled("12.345678901234"))).toBe("12.345678901234");
    expect(scaledToUsd(usdToScaled("3"))).toBe("3");
  });

  it("adds without floating point drift", () => {
    expect(sumUsd(["0.1", "0.2"])).toBe("0.3");
    expect(sumUsd(["0.1", null])).toBeNull();
    expect(sumUsd([])).toBe("0");
  });
});

describe("aggregateQuoteTotals", () => {
  const decorate: DecorateUnits = (token, units) => {
    if (token === "usdc") {
      return {
        symbol: "USDC",
        decimals: 6,
        total: (Number(units) / 1e6).toString(),
        totalUsd: (Number(units) / 1e6).toString(),
      };
    }
    return { symbol: "MYSTERY", decimals: 18, total: units, totalUsd: null };
  };

  it("sums per payment token in bigint units and in USD", () => {
    const result = aggregateQuoteTotals(
      [
        { paymentToken: "usdc", totalUnits: 1_500_000n },
        { paymentToken: "usdc", totalUnits: 2_500_000n },
      ],
      10,
      decorate,
    );
    expect(result.totals).toEqual([
      { paymentToken: "usdc", symbol: "USDC", decimals: 6, totalUnits: "4000000", total: "4", totalUsd: "4" },
    ]);
    expect(result.totalUsd).toBe("4");
    expect(result.budgetUsd).toBe(10);
    expect(result.overBudget).toBe(false);
  });

  it("keeps tokens apart and reports an unknown total USD as null, never over budget", () => {
    const result = aggregateQuoteTotals(
      [
        { paymentToken: "usdc", totalUnits: 1_000_000n },
        { paymentToken: "mystery", totalUnits: 5n },
      ],
      0.5,
      decorate,
    );
    expect(result.totals.map((total) => total.paymentToken)).toEqual(["mystery", "usdc"]);
    expect(result.totalUsd).toBeNull();
    expect(result.overBudget).toBe(false);
  });

  it("flags a known total above the budget", () => {
    const result = aggregateQuoteTotals(
      [{ paymentToken: "usdc", totalUnits: 3_000_000n }],
      2.5,
      decorate,
    );
    expect(result.overBudget).toBe(true);
  });

  it("has no budget and a zero total for no items", () => {
    const result = aggregateQuoteTotals([], null, decorate);
    expect(result).toEqual({ totals: [], totalUsd: "0", budgetUsd: null, overBudget: false });
  });
});

describe("matchReceipts", () => {
  it("matches lines to the buyer's logs by listing and amount, in line order", () => {
    const { matched, unmatched } = matchReceipts(
      [
        { id: "a", listingId: 1n, amount: 1n },
        { id: "b", listingId: 2n, amount: 1n },
      ],
      [sold({ listingId: 2n, logIndex: 7 }), sold({ listingId: 1n, logIndex: 3 })],
      BUYER,
    );
    expect(matched.map((entry) => [entry.lineId, entry.log.logIndex])).toEqual([
      ["a", 3],
      ["b", 7],
    ]);
    expect(unmatched).toEqual([]);
  });

  it("ignores logs of another buyer, whatever the case", () => {
    const { matched, unmatched } = matchReceipts(
      [{ id: "a", listingId: 1n, amount: 1n }],
      [sold({ buyer: "0x" + "c".repeat(40) })],
      BUYER.toUpperCase().replace("0X", "0x"),
    );
    expect(matched).toEqual([]);
    expect(unmatched).toEqual(["a"]);
  });

  it("uses each log once: two lines for one listing and one log settle one", () => {
    const { matched, unmatched } = matchReceipts(
      [
        { id: "first", listingId: 1n, amount: 1n },
        { id: "second", listingId: 1n, amount: 1n },
      ],
      [sold({ listingId: 1n, logIndex: 4 })],
      BUYER,
    );
    expect(matched.map((entry) => entry.lineId)).toEqual(["first"]);
    expect(unmatched).toEqual(["second"]);
  });

  it("requires the amount to match", () => {
    const { matched, unmatched } = matchReceipts(
      [{ id: "a", listingId: 1n, amount: 1n }],
      [sold({ amount: 2n })],
      BUYER,
    );
    expect(matched).toEqual([]);
    expect(unmatched).toEqual(["a"]);
  });
});

describe("settlementStatus", () => {
  it("is settled, partial or failed by how many quoted lines settled", () => {
    expect(settlementStatus(3, 3)).toBe("settled");
    expect(settlementStatus(1, 3)).toBe("partial");
    expect(settlementStatus(0, 3)).toBe("failed");
    expect(settlementStatus(0, 0)).toBe("failed");
  });
});

describe("isTransactionHash", () => {
  it("accepts only 0x plus 64 hex characters", () => {
    expect(isTransactionHash("0x" + "ab".repeat(32))).toBe(true);
    expect(isTransactionHash("0x" + "AB".repeat(32))).toBe(true);
    expect(isTransactionHash("0x" + "ab".repeat(31))).toBe(false);
    expect(isTransactionHash("ab".repeat(32))).toBe(false);
    expect(isTransactionHash(42)).toBe(false);
  });
});
