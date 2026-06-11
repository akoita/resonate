import { describe, expect, it } from "vitest";
import {
  applyPurchaseToListings,
  POST_PURCHASE_ELIGIBILITY_DELAYS_MS,
  postPurchaseNotice,
} from "./postPurchase";

describe("POST_PURCHASE_ELIGIBILITY_DELAYS_MS (#1173)", () => {
  it("backs off and covers a realistic indexer-backfill window", () => {
    const total = POST_PURCHASE_ELIGIBILITY_DELAYS_MS.reduce((a, b) => a + b, 0);
    // Registration was observed to take ~10 minutes during a backfill; the
    // schedule must cover several minutes, not just an optimistic refetch.
    expect(total).toBeGreaterThanOrEqual(5 * 60_000);
    for (let i = 1; i < POST_PURCHASE_ELIGIBILITY_DELAYS_MS.length; i++) {
      expect(POST_PURCHASE_ELIGIBILITY_DELAYS_MS[i]).toBeGreaterThanOrEqual(
        POST_PURCHASE_ELIGIBILITY_DELAYS_MS[i - 1],
      );
    }
  });
});

describe("postPurchaseNotice", () => {
  it("is honest about timing in both phases", () => {
    expect(postPurchaseNotice("polling")).toContain("can take a few minutes");
    expect(postPurchaseNotice("exhausted")).toContain("still settling");
  });
});

describe("applyPurchaseToListings (#1173)", () => {
  const listings = [
    { listingId: "93", amount: "1", licenseType: "remix" },
    { listingId: "82", amount: "3", licenseType: "personal" },
  ];

  it("removes a listing the purchase exhausted", () => {
    const next = applyPurchaseToListings(listings, {
      listingId: 93n,
      amount: 1n,
    });
    expect(next.map((l) => l.listingId)).toEqual(["82"]);
  });

  it("decrements a partially consumed listing", () => {
    const next = applyPurchaseToListings(listings, {
      listingId: 82n,
      amount: 2n,
    });
    expect(next.find((l) => l.listingId === "82")?.amount).toBe("1");
    expect(next).toHaveLength(2);
  });

  it("leaves unrelated listings untouched and handles unknown ids", () => {
    const next = applyPurchaseToListings(listings, {
      listingId: 999n,
      amount: 1n,
    });
    expect(next).toEqual(listings);
  });

  it("drops rows with malformed amounts rather than reselling them", () => {
    const next = applyPurchaseToListings(
      [{ listingId: "7", amount: "not-a-number" }],
      { listingId: 7n, amount: 1n },
    );
    expect(next).toEqual([]);
  });
});
