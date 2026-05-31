import { deriveListingLifecycleStatus, isPubliclyPurchasableListing } from "../modules/contracts/listing-lifecycle";

describe("listing lifecycle", () => {
  // Keep the clock injected so these date-based expectations are not tied to
  // the day the test suite runs.
  const now = new Date("2026-05-29T10:00:00.000Z");

  it("derives active, expiring, and expired lifecycle states from status and expiry", () => {
    expect(deriveListingLifecycleStatus({
      status: "active",
      amount: 1n,
      expiresAt: new Date("2026-06-02T10:00:00.000Z"),
    }, now)).toBe("active");

    expect(deriveListingLifecycleStatus({
      status: "active",
      amount: 1n,
      expiresAt: new Date("2026-05-30T09:00:00.000Z"),
    }, now)).toBe("expiring_soon");

    expect(deriveListingLifecycleStatus({
      status: "active",
      amount: 1n,
      expiresAt: new Date("2026-05-29T09:00:00.000Z"),
    }, now)).toBe("expired");
  });

  it("keeps terminal sold and cancelled states ahead of derived expiry", () => {
    expect(deriveListingLifecycleStatus({
      status: "sold",
      amount: 0n,
      expiresAt: new Date("2026-06-02T10:00:00.000Z"),
    }, now)).toBe("sold");

    expect(deriveListingLifecycleStatus({
      status: "cancelled",
      amount: 1n,
      expiresAt: new Date("2026-06-02T10:00:00.000Z"),
    }, now)).toBe("cancelled");
  });

  it("requires active status, positive amount, and future expiry for public purchase", () => {
    expect(isPubliclyPurchasableListing({
      status: "active",
      amount: 1n,
      expiresAt: new Date("2026-06-02T10:00:00.000Z"),
    }, now)).toBe(true);

    expect(isPubliclyPurchasableListing({
      status: "expired",
      amount: 1n,
      expiresAt: new Date("2026-06-02T10:00:00.000Z"),
    }, now)).toBe(false);
  });
});
