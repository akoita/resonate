import { describe, expect, it } from "vitest";
import {
  buildNotifyListingPayload,
  multiTierEditionHint,
  tierDefaultPriceUsd,
} from "./listingTiers";

describe("tierDefaultPriceUsd", () => {
  it("uses the stem's catalog pricing for remix and commercial tiers", () => {
    const pricing = { remixLicenseUsd: 8, commercialLicenseUsd: 40 };
    expect(tierDefaultPriceUsd(pricing, "remix")).toBe(8);
    expect(tierDefaultPriceUsd(pricing, "commercial")).toBe(40);
  });

  it("falls back to platform defaults when pricing is missing", () => {
    expect(tierDefaultPriceUsd(null, "remix")).toBe(5);
    expect(tierDefaultPriceUsd(null, "commercial")).toBe(25);
    expect(tierDefaultPriceUsd({ remixLicenseUsd: null }, "remix")).toBe(5);
  });

  it("never prefills the personal edition price", () => {
    expect(tierDefaultPriceUsd({ remixLicenseUsd: 8 }, "personal")).toBeNull();
    expect(tierDefaultPriceUsd(null, "personal")).toBeNull();
  });
});

describe("buildNotifyListingPayload", () => {
  it("serializes bigints and carries the chosen license tier", () => {
    const payload = buildNotifyListingPayload({
      tokenId: 74n,
      chainId: 31337,
      seller: "0xSeller",
      priceUnits: 5_000_000n,
      amount: 1n,
      paymentToken: "0xToken",
      durationSeconds: 604800n,
      transactionHash: "0xHash",
      licenseType: "remix",
      stemId: "stem-1",
    });
    expect(payload).toEqual({
      tokenId: "74",
      chainId: 31337,
      seller: "0xSeller",
      price: "5000000",
      amount: "1",
      paymentToken: "0xToken",
      licenseType: "remix",
      durationSeconds: "604800",
      transactionHash: "0xHash",
      stemId: "stem-1",
    });
  });

  it("omits stemId when the catalog id is unknown", () => {
    const payload = buildNotifyListingPayload({
      tokenId: 74n,
      chainId: 31337,
      seller: "0xSeller",
      priceUnits: 1n,
      amount: 1n,
      paymentToken: "0xToken",
      durationSeconds: 60n,
      transactionHash: "0xHash",
      licenseType: "personal",
      stemId: null,
    });
    expect(payload).not.toHaveProperty("stemId");
  });
});

describe("multiTierEditionHint", () => {
  it("warns single-edition sellers choosing a non-personal tier", () => {
    expect(
      multiTierEditionHint({ balance: 1n, tier: "remix" }),
    ).toContain("single edition");
    expect(
      multiTierEditionHint({ balance: 1n, tier: "commercial" }),
    ).toContain("single edition");
  });

  it("stays quiet for personal listings or multi-edition balances", () => {
    expect(multiTierEditionHint({ balance: 1n, tier: "personal" })).toBeNull();
    expect(multiTierEditionHint({ balance: 3n, tier: "remix" })).toBeNull();
  });
});
