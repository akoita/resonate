import { describe, expect, it, vi } from "vitest";
import {
  buildNotifyListingPayload,
  multiTierEditionHint,
  postNotifyListing,
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

describe("postNotifyListing", () => {
  const payload = { tokenId: "74", sellerAddress: "0xSeller" };

  it("sends the sign-in token and the payload", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(postNotifyListing(payload, "jwt-1", fetchImpl)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/contracts/notify-listing");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("does not call the backend without a token", async () => {
    const fetchImpl = vi.fn();
    await expect(postNotifyListing(payload, null, fetchImpl)).resolves.toEqual({
      ok: false,
      status: null,
      reason: "unauthenticated",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports 401/403 and network failures without throwing", async () => {
    await expect(
      postNotifyListing(payload, "jwt", vi.fn(async () => new Response("", { status: 403 }))),
    ).resolves.toEqual({ ok: false, status: 403, reason: "unauthenticated" });
    await expect(
      postNotifyListing(payload, "jwt", vi.fn(async () => new Response("", { status: 400 }))),
    ).resolves.toEqual({ ok: false, status: 400, reason: "rejected" });
    await expect(
      postNotifyListing(payload, "jwt", vi.fn(async () => {
        throw new Error("offline");
      })),
    ).resolves.toEqual({ ok: false, status: null, reason: "network" });
  });
});
