import { describe, expect, it } from "vitest";
import {
  asCancelledListing,
  describeCancelFailure,
  isListingCancellable,
  markListingsCancelled,
  reconcileCancelledListings,
  type CancellableListing,
} from "./listingCancellation";

function listing(overrides: Partial<CancellableListing> = {}): CancellableListing {
  return {
    id: "row-1",
    listingId: "11",
    status: "active",
    lifecycleStatus: "active",
    amount: "3",
    relistable: false,
    ...overrides,
  };
}

describe("isListingCancellable", () => {
  it("allows live listings: active and expiring soon", () => {
    expect(isListingCancellable(listing())).toBe(true);
    expect(isListingCancellable(listing({ lifecycleStatus: "expiring_soon" }))).toBe(true);
  });

  it("refuses expired, sold, cancelled and stale listings", () => {
    expect(isListingCancellable(listing({ lifecycleStatus: "expired" }))).toBe(false);
    expect(isListingCancellable(listing({ status: "sold", lifecycleStatus: "sold" }))).toBe(false);
    expect(isListingCancellable(listing({ status: "cancelled", lifecycleStatus: "cancelled" }))).toBe(false);
    expect(isListingCancellable(listing({ lifecycleStatus: "stale" }))).toBe(false);
    expect(isListingCancellable(listing({ status: "expired", lifecycleStatus: "active" }))).toBe(false);
  });
});

describe("asCancelledListing", () => {
  it("flips the row to cancelled and relistable when editions remain", () => {
    expect(asCancelledListing(listing())).toMatchObject({
      status: "cancelled",
      lifecycleStatus: "cancelled",
      relistable: true,
    });
  });

  it("is not relistable with no editions left or an unreadable amount", () => {
    expect(asCancelledListing(listing({ amount: "0" })).relistable).toBe(false);
    expect(asCancelledListing(listing({ amount: "n/a" })).relistable).toBe(false);
  });
});

describe("markListingsCancelled", () => {
  it("only touches the given rows", () => {
    const rows = [listing(), listing({ id: "row-2", listingId: "12" })];
    const next = markListingsCancelled(rows, new Set(["row-2"]));
    expect(next[0]).toBe(rows[0]);
    expect(next[1].lifecycleStatus).toBe("cancelled");
  });
});

describe("reconcileCancelledListings", () => {
  it("keeps the overlay while the indexer still reports the row active", () => {
    const { listings, stillPending } = reconcileCancelledListings([listing()], new Set(["row-1"]));
    expect(listings[0].lifecycleStatus).toBe("cancelled");
    expect([...stillPending]).toEqual(["row-1"]);
  });

  it("drops the pending id once the indexer reports the cancellation", () => {
    const indexed = listing({ status: "cancelled", lifecycleStatus: "cancelled", relistable: true });
    const { listings, stillPending } = reconcileCancelledListings([indexed], new Set(["row-1"]));
    expect(listings[0]).toBe(indexed);
    expect(stillPending.size).toBe(0);
  });

  it("keeps ids pending for rows outside the current response", () => {
    const other = listing({ id: "row-9" });
    const { listings, stillPending } = reconcileCancelledListings([other], new Set(["row-1"]));
    expect(listings[0]).toBe(other);
    expect([...stillPending]).toEqual(["row-1"]);
  });
});

describe("describeCancelFailure", () => {
  it("treats a dismissed passkey prompt as nothing sent", () => {
    const error = new Error("The operation either timed out or was not allowed.");
    error.name = "NotAllowedError";
    expect(describeCancelFailure(error)).toMatch(/nothing was sent/);
  });

  it("explains a listing owned by another account", () => {
    expect(describeCancelFailure(new Error("execution reverted: NotSeller()"))).toMatch(/different account/);
  });

  it("falls back to the underlying reason", () => {
    expect(describeCancelFailure(new Error("bundler unavailable"))).toBe(
      "Could not cancel the listing: bundler unavailable. The listing is still active.",
    );
  });
});
