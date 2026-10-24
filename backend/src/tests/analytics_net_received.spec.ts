/**
 * #2172: the net-received report, per sale and per asset. Pure: the settlement
 * records are plain inputs here; the database join is covered in
 * artist_net_received.integration.spec.ts.
 */
import {
  buildArtistNetReceived,
  type NetReceivedSaleInput,
} from "../modules/analytics/analytics_net_received";

const ARTIST = "0x" + "a".repeat(40);
const COLLECTOR = "0x" + "c".repeat(40);
const OTHER_CREATOR = "0x" + "d".repeat(40);
const USDC = "0x" + "1".repeat(40);
const addresses = new Set([ARTIST]);

function sale(overrides: Partial<NetReceivedSaleInput> = {}): NetReceivedSaleInput {
  return {
    settlementKey: "commerce.settled:marketplace:31337:0xabc:1",
    purchasedAt: new Date("2026-10-20T10:00:00.000Z"),
    trackId: "track-1",
    trackTitle: "Groove",
    paymentToken: USDC,
    paymentAssetId: "local:usdc",
    symbol: "USDC",
    decimals: 6,
    pricingStrategy: "usd_pegged",
    totalPaid: "10000000", // 10 USDC
    sellerAddress: ARTIST,
    royaltyRecipient: ARTIST,
    split: { protocolFee: "1000000", royalty: "500000", seller: "8500000" },
    ...overrides,
  };
}

describe("buildArtistNetReceived", () => {
  it("a first sale by the artist nets the gross minus the platform fee (the royalty comes back to them)", () => {
    const report = buildArtistNetReceived([sale()], addresses);
    expect(report.finalizedSales).toBe(1);
    expect(report.pendingSales).toBe(0);
    const [only] = report.recentSales;
    expect(only.status).toBe("final");
    expect(only.grossAmountUnits).toBe("10000000");
    expect(only.platformFeeUnits).toBe("1000000");
    expect(only.netAmountUnits).toBe("9000000"); // 8.5 seller + 0.5 royalty
    expect(only.otherPartiesUnits).toBe("0");
    expect(report.totals).toEqual({ grossFinalizedUsd: 10, netUsd: 9, pendingGrossUsd: 0 });
    // The parts reconcile: net + platform fee + other parties = gross of the final sales.
    const [asset] = report.byAsset;
    expect(BigInt(asset.netAmountUnits) + BigInt(asset.platformFeeUnits) + BigInt(asset.otherPartiesUnits)).toBe(
      BigInt(asset.grossFinalizedUnits),
    );
  });

  it("a collector resale pays the artist only the royalty", () => {
    const report = buildArtistNetReceived([sale({ sellerAddress: COLLECTOR })], addresses);
    const [only] = report.recentSales;
    expect(only.netAmountUnits).toBe("500000");
    expect(only.otherPartiesUnits).toBe("8500000"); // the collector's proceeds
    expect(report.totals.netUsd).toBe(0.5);
  });

  it("royalty paid to another creator is not the artist's", () => {
    const report = buildArtistNetReceived([sale({ royaltyRecipient: OTHER_CREATOR })], addresses);
    const [only] = report.recentSales;
    expect(only.netAmountUnits).toBe("8500000");
    expect(only.otherPartiesUnits).toBe("500000");
  });

  it("a sale with no royalty and no royalty recipient is seller proceeds only", () => {
    const report = buildArtistNetReceived(
      [sale({ royaltyRecipient: null, split: { protocolFee: "1000000", royalty: "0", seller: "9000000" } })],
      addresses,
    );
    expect(report.recentSales[0].netAmountUnits).toBe("9000000");
  });

  it("a sale whose split is not final is pending: never zero, never the gross, and kept out of net", () => {
    const report = buildArtistNetReceived([sale(), sale({ settlementKey: "k2", split: null })], addresses);
    expect(report.saleCount).toBe(2);
    expect(report.finalizedSales).toBe(1);
    expect(report.pendingSales).toBe(1);
    const pending = report.recentSales.find((entry) => entry.settlementKey === "k2")!;
    expect(pending.status).toBe("pending");
    expect(pending.netAmountUnits).toBeUndefined();
    expect(pending.netUsd).toBeUndefined();
    expect(pending.grossAmountUnits).toBe("10000000");
    // The pending gross is reported apart, not folded into the net or the final gross.
    expect(report.totals).toEqual({ grossFinalizedUsd: 10, netUsd: 9, pendingGrossUsd: 10 });
    const [asset] = report.byAsset;
    expect(asset.pendingSales).toBe(1);
    expect(asset.pendingGrossUnits).toBe("10000000");
    expect(asset.grossFinalizedUnits).toBe("10000000");
    expect(asset.netAmountUnits).toBe("9000000");
  });

  it("only pending sales leave the net at zero sales, not a zero figure presented as received", () => {
    const report = buildArtistNetReceived([sale({ split: null })], addresses);
    expect(report.finalizedSales).toBe(0);
    expect(report.pendingSales).toBe(1);
    expect(report.recentSales[0].status).toBe("pending");
  });

  it("without any known artist address the sale is pending, not zero", () => {
    const report = buildArtistNetReceived([sale()], new Set());
    expect(report.pendingSales).toBe(1);
    expect(report.recentSales[0].status).toBe("pending");
  });

  it("native-token sales are reported in their own units and carry no invented USD", () => {
    const report = buildArtistNetReceived(
      [
        sale({
          paymentToken: "0x0000000000000000000000000000000000000000",
          paymentAssetId: "local:eth",
          symbol: "ETH",
          decimals: 18,
          pricingStrategy: "fixed_test_price",
          totalPaid: "1000000000000000000",
          split: { protocolFee: "100000000000000000", royalty: "0", seller: "900000000000000000" },
          royaltyRecipient: null,
        }),
      ],
      addresses,
    );
    const [asset] = report.byAsset;
    expect(asset.netAmount).toBe("0.9");
    expect(asset.netUsd).toBeNull();
    expect(report.recentSales[0].netUsd).toBeNull();
    expect(report.totals.netUsd).toBe(0);
  });

  it("keeps assets apart and limits the listed sales but not the totals", () => {
    const many = Array.from({ length: 30 }, (_, index) => sale({ settlementKey: `k${index}` }));
    const report = buildArtistNetReceived(many, addresses, { recentLimit: 5 });
    expect(report.recentSales).toHaveLength(5);
    expect(report.saleCount).toBe(30);
    expect(report.totals.netUsd).toBe(270);
    expect(report.byAsset).toHaveLength(1);
  });

  it("says x402 is reported as entitled net, apart from the on-chain net", () => {
    const report = buildArtistNetReceived([], addresses);
    expect(report.coverage.marketplace).toBe(true);
    expect(report.coverage.x402).toBe("entitled_only");
    expect(report.coverage.x402Note).toMatch(/payout address/);
    expect(report.coverage.x402Note).toMatch(/entitled net/);
    expect(report.saleCount).toBe(0);
    expect(report.entitled.saleCount).toBe(0);
  });

  it("never adds x402 entitled net to the on-chain net", () => {
    const report = buildArtistNetReceived([sale()], addresses, {
      x402Sales: [
        {
          settlementKey: "commerce.settled:x402:s1",
          occurredAt: new Date("2026-10-21T10:00:00.000Z"),
          paymentRail: "facilitator",
          resourceKind: "stem",
          trackId: "track-1",
          trackTitle: "Groove",
          paymentToken: USDC,
          paymentAssetId: "local:usdc",
          symbol: "USDC",
          decimals: 6,
          grossUnits: "50000",
          quote: { feeBps: 1500, platformFeeUnits: "7500", netToSellerUnits: "42500" },
        },
      ],
    });
    expect(report.totals.netUsd).toBe(9);
    expect(report.entitled.totals.entitledNetUsd).toBe(0.0425);
    expect(report.saleCount).toBe(1);
  });
});
