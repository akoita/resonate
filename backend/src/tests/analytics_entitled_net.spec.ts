/**
 * #2344: the artist's entitled net from x402 sales. Pure: settlement records are
 * plain inputs; the database join is covered in analytics_entitled_net.integration.spec.ts.
 */
import {
  buildArtistEntitledNet,
  readRecordedQuote,
  type EntitledNetSaleInput,
} from "../modules/analytics/analytics_entitled_net";
import { quoteEntitledNet } from "../modules/x402/x402.quote";
import { buildStemX402Receipt } from "../modules/x402/x402.receipt";

const USDC = "0x" + "1".repeat(40);

function sale(overrides: Partial<EntitledNetSaleInput> = {}): EntitledNetSaleInput {
  return {
    settlementKey: "commerce.settled:x402:s1",
    occurredAt: new Date("2026-10-20T10:00:00.000Z"),
    paymentRail: "facilitator",
    resourceKind: "stem",
    trackId: "track-1",
    trackTitle: "Groove",
    paymentToken: USDC,
    paymentAssetId: "x402:usdc",
    symbol: "USDC",
    decimals: 6,
    grossUnits: "50000", // 0.05 USDC
    quote: { feeBps: 1500, platformFeeUnits: "7500", netToSellerUnits: "42500" },
    ...overrides,
  };
}

describe("quoteEntitledNet", () => {
  it("takes the fee at the license rate, floored, and leaves the rest to the seller", () => {
    expect(quoteEntitledNet("50000", 1500)).toEqual({
      feeBps: 1500,
      platformFeeUnits: "7500",
      netToSellerUnits: "42500",
    });
    // 1 unit at 15%: floor(0.15) = 0, so the seller keeps it (as the contract rounds).
    expect(quoteEntitledNet("1", 1500)).toEqual({ feeBps: 1500, platformFeeUnits: "0", netToSellerUnits: "1" });
    expect(quoteEntitledNet("5000000", 1000)!.netToSellerUnits).toBe("4500000");
  });

  it("refuses an impossible rate or amount instead of inventing a quote", () => {
    expect(quoteEntitledNet("50000", 10_001)).toBeNull();
    expect(quoteEntitledNet("50000", -1)).toBeNull();
    expect(quoteEntitledNet("5.5", 1500)).toBeNull();
  });

  it("is recorded on the receipt at settlement time, and absent when no rate is given", () => {
    const base = {
      stemId: "stem-1",
      stemType: "vocals",
      stemTitle: null,
      trackTitle: null,
      artist: null,
      releaseTitle: null,
      hasNft: false,
      tokenId: null,
      amountUsd: 0.05,
      network: "eip155:84532",
      payTo: "0x" + "9".repeat(40),
      resource: "/api/stems/stem-1/x402",
      quoteUrl: "/api/stems/stem-1/x402/info",
      mimeType: "audio/mpeg",
      contentLength: 0,
      eventTransactionHash: "x402:test",
    };
    expect(buildStemX402Receipt({ ...base, feeBps: 1500 }).payment.quote).toEqual({
      feeBps: 1500,
      platformFeeUnits: "7500",
      netToSellerUnits: "42500",
    });
    expect(buildStemX402Receipt(base).payment.quote).toBeUndefined();
  });
});

describe("readRecordedQuote", () => {
  it("accepts a quote whose parts add up to the gross", () => {
    expect(readRecordedQuote({ feeBps: 1500, platformFeeUnits: "7500", netToSellerUnits: "42500" }, "50000")).not.toBeNull();
  });

  it("rejects a missing, malformed or inconsistent quote", () => {
    expect(readRecordedQuote(null, "50000")).toBeNull();
    expect(readRecordedQuote({}, "50000")).toBeNull();
    expect(readRecordedQuote({ feeBps: 1500, platformFeeUnits: "7500", netToSellerUnits: "42501" }, "50000")).toBeNull();
    expect(readRecordedQuote({ feeBps: "1500", platformFeeUnits: "7500", netToSellerUnits: "42500" }, "50000")).toBeNull();
    expect(readRecordedQuote({ feeBps: 1500, platformFeeUnits: "-1", netToSellerUnits: "50001" }, "50000")).toBeNull();
  });
});

describe("buildArtistEntitledNet", () => {
  it("reports the quoted net per sale and per asset, with exact USD for the stablecoin", () => {
    const report = buildArtistEntitledNet([sale(), sale({ settlementKey: "commerce.settled:x402:s2" })]);
    expect(report.basis).toBe("quoted_net_to_seller");
    expect(report.note).toMatch(/entitle/i);
    expect(report.quotedSales).toBe(2);
    expect(report.unquotedSales).toBe(0);
    const [first] = report.recentSales;
    expect(first.status).toBe("quoted");
    expect(first.entitledNetUnits).toBe("42500");
    expect(first.platformFeeUnits).toBe("7500");
    expect(first.entitledNetAmount).toBe("0.0425");
    expect(first.entitledNetUsd).toBe(0.0425);
    expect(first.feeBps).toBe(1500);
    expect(report.totals).toEqual({ grossQuotedUsd: 0.1, entitledNetUsd: 0.085 });
    const [asset] = report.byAsset;
    // fee + entitled net = the gross of the quoted sales
    expect(BigInt(asset.platformFeeUnits) + BigInt(asset.entitledNetUnits)).toBe(BigInt(asset.grossQuotedUnits));
  });

  it("counts a sale with no recorded quote apart, with no net and no reconstructed rate", () => {
    const report = buildArtistEntitledNet([sale(), sale({ settlementKey: "s-old", quote: null })]);
    expect(report.saleCount).toBe(2);
    expect(report.quotedSales).toBe(1);
    expect(report.unquotedSales).toBe(1);
    const old = report.recentSales.find((entry) => entry.settlementKey === "s-old")!;
    expect(old.status).toBe("unquoted");
    expect(old.entitledNetUnits).toBeUndefined();
    expect(old.entitledNetUsd).toBeUndefined();
    expect(old.grossUsd).toBe(0.05);
    expect(report.totals.entitledNetUsd).toBe(0.0425);
    expect(report.byAsset[0].unquotedGrossUnits).toBe("50000");
  });

  it("never invents USD for a non-stablecoin asset", () => {
    const report = buildArtistEntitledNet([
      sale({
        symbol: "ETH",
        decimals: 18,
        paymentToken: "0x" + "0".repeat(40),
        paymentAssetId: "local:eth",
        grossUnits: "1000000000000000000",
        quote: { feeBps: 1000, platformFeeUnits: "100000000000000000", netToSellerUnits: "900000000000000000" },
      }),
    ]);
    const [only] = report.recentSales;
    expect(only.entitledNetAmount).toBe("0.9");
    expect(only.entitledNetUsd).toBeNull();
    expect(report.totals).toEqual({ grossQuotedUsd: 0, entitledNetUsd: 0 });
  });

  it("limits the listed sales but sums them all", () => {
    const many = Array.from({ length: 30 }, (_, index) => sale({ settlementKey: `s${index}` }));
    const report = buildArtistEntitledNet(many, { recentLimit: 5 });
    expect(report.recentSales).toHaveLength(5);
    expect(report.saleCount).toBe(30);
    expect(report.totals.entitledNetUsd).toBe(1.275);
  });
});
