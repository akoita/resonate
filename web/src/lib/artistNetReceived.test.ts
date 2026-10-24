import { describe, expect, it } from "vitest";
import type { ArtistEntitledNet, ArtistEntitledNetSale, ArtistNetReceivedReport, ArtistNetReceivedSale } from "./api";
import {
  ENTITLED_BADGE,
  PENDING_NET_LABEL,
  UNQUOTED_NET_LABEL,
  entitledNetDetail,
  entitledNetHeadline,
  entitledNetNote,
  entitledNetOf,
  entitledSaleFeeLabel,
  entitledSaleGrossLabel,
  entitledSaleNetLabel,
  netReceivedDetail,
  netReceivedHeadline,
  netReceivedNote,
  saleGrossLabel,
  saleNetLabel,
  salePlatformFeeLabel,
} from "./artistNetReceived";

const finalSale: ArtistNetReceivedSale = {
  settlementKey: "k1",
  occurredAt: "2026-10-20T10:00:00.000Z",
  trackId: "t1",
  trackTitle: "Groove",
  symbol: "USDC",
  decimals: 6,
  grossAmountUnits: "10000000",
  grossAmount: "10",
  grossUsd: 10,
  status: "final",
  platformFeeUnits: "1000000",
  otherPartiesUnits: "0",
  netAmountUnits: "9000000",
  netAmount: "9",
  netUsd: 9,
};
const pendingSale: ArtistNetReceivedSale = {
  settlementKey: "k2",
  occurredAt: "2026-10-21T10:00:00.000Z",
  trackId: "t1",
  trackTitle: "Groove",
  symbol: "USDC",
  decimals: 6,
  grossAmountUnits: "4000000",
  grossAmount: "4",
  grossUsd: 4,
  status: "pending",
};

function ready(overrides: Partial<Extract<ArtistNetReceivedReport, { status: "ready" }>> = {}): ArtistNetReceivedReport {
  return {
    status: "ready",
    basis: "net_after_fee_and_split",
    coverage: { marketplace: true, x402: "entitled_only", x402Note: "x402 note" },
    saleCount: 2,
    finalizedSales: 1,
    pendingSales: 1,
    totals: { grossFinalizedUsd: 10, netUsd: 9, pendingGrossUsd: 4 },
    byAsset: [],
    recentSales: [finalSale, pendingSale],
    truncated: false,
    ...overrides,
  };
}

describe("artist net received wording (#2172)", () => {
  it("shows a final sale's net beside its gross", () => {
    expect(saleGrossLabel(finalSale)).toBe("$10.00");
    expect(saleNetLabel(finalSale)).toBe("$9.00");
    expect(salePlatformFeeLabel(finalSale)).toBe("1 USDC");
  });

  it("labels a pending sale Pending: never $0 and never the gross", () => {
    expect(saleNetLabel(pendingSale)).toBe(PENDING_NET_LABEL);
    expect(saleNetLabel(pendingSale)).not.toContain("$0");
    expect(saleNetLabel(pendingSale)).not.toBe(saleGrossLabel(pendingSale));
    expect(salePlatformFeeLabel(pendingSale)).toBeNull();
  });

  it("uses the asset's own amount when there is no USD value", () => {
    const eth: ArtistNetReceivedSale = {
      ...finalSale,
      symbol: "ETH",
      decimals: 18,
      grossUsd: null,
      grossAmount: "1",
      netUsd: null,
      netAmount: "0.9",
      platformFeeUnits: "100000000000000000",
    };
    expect(saleGrossLabel(eth)).toBe("1 ETH");
    expect(saleNetLabel(eth)).toBe("0.9 ETH");
    expect(salePlatformFeeLabel(eth)).toBe("0.1 ETH");
  });

  it("the headline counts only final sales and names the pending ones", () => {
    const report = ready();
    expect(netReceivedHeadline(report)).toBe("$9.00");
    expect(netReceivedDetail(report)).toBe("1 of 2 marketplace sales counted, 1 pending");
    expect(netReceivedNote(report)).toContain("1 sale is pending");
    expect(netReceivedNote(report)).toContain("x402 sales are not included here");
    expect(netReceivedNote(report)).toContain("entitled net");
  });

  it("only pending sales read Pending, not $0", () => {
    const report = ready({ finalizedSales: 0, pendingSales: 2, totals: { grossFinalizedUsd: 0, netUsd: 0, pendingGrossUsd: 14 } });
    expect(netReceivedHeadline(report)).toBe(PENDING_NET_LABEL);
  });

  it("falls back to the asset's own net when the net is not in USD", () => {
    const report = ready({
      totals: { grossFinalizedUsd: 0, netUsd: 0, pendingGrossUsd: 0 },
      byAsset: [
        {
          paymentToken: "0x0", assetId: null, symbol: "ETH", decimals: 18, sales: 1, finalizedSales: 1, pendingSales: 0,
          grossFinalizedUnits: "1", grossFinalizedAmount: "1", platformFeeUnits: "0", otherPartiesUnits: "0",
          netAmountUnits: "1", netAmount: "0.9", grossFinalizedUsd: null, netUsd: null, pendingGrossUnits: "0", pendingGrossAmount: "0",
        },
      ],
    });
    expect(netReceivedHeadline(report)).toBe("0.9 ETH");
  });

  it("says so when there are no sales or the report is unavailable", () => {
    expect(netReceivedHeadline(ready({ saleCount: 0, finalizedSales: 0, pendingSales: 0, recentSales: [] }))).toBe("No marketplace sales");
    const unavailable: ArtistNetReceivedReport = { status: "unavailable", reason: "Net received is temporarily unavailable." };
    expect(netReceivedHeadline(unavailable)).toBe("Unavailable");
    expect(netReceivedDetail(unavailable)).toBe("Net received is temporarily unavailable.");
    expect(netReceivedHeadline(undefined)).toBeNull();
  });
});

describe("x402 entitled net wording (#2344)", () => {
  const quoted: ArtistEntitledNetSale = {
    settlementKey: "x1",
    occurredAt: "2026-10-20T10:00:00.000Z",
    paymentRail: "facilitator",
    resourceKind: "stem",
    trackId: "t1",
    trackTitle: "Groove",
    symbol: "USDC",
    decimals: 6,
    grossAmountUnits: "5000000",
    grossAmount: "5",
    grossUsd: 5,
    status: "quoted",
    feeBps: 1000,
    platformFeeUnits: "500000",
    entitledNetUnits: "4500000",
    entitledNetAmount: "4.5",
    entitledNetUsd: 4.5,
  };
  const unquoted: ArtistEntitledNetSale = {
    ...quoted,
    settlementKey: "x2",
    status: "unquoted",
    feeBps: undefined,
    platformFeeUnits: undefined,
    entitledNetUnits: undefined,
    entitledNetAmount: undefined,
    entitledNetUsd: undefined,
  };
  const entitled: ArtistEntitledNet = {
    basis: "quoted_net_to_seller",
    note: "What your x402 sales entitle you to.",
    saleCount: 2,
    quotedSales: 1,
    unquotedSales: 1,
    totals: { grossQuotedUsd: 5, entitledNetUsd: 4.5 },
    byAsset: [],
    recentSales: [quoted, unquoted],
    truncated: false,
  };

  it("labels the figure as entitled, never as received", () => {
    expect(ENTITLED_BADGE).toContain("Entitled");
    expect(entitledNetHeadline(entitled)).toBe("$4.50");
    expect(entitledNetNote(entitled)).toContain(ENTITLED_BADGE);
    expect(entitledNetDetail(entitled)).toBe("1 of 2 x402 sales counted, 1 without a recorded quote");
  });

  it("shows a quoted sale's entitled net beside its gross", () => {
    expect(entitledSaleGrossLabel(quoted)).toBe("$5.00");
    expect(entitledSaleNetLabel(quoted)).toBe("$4.50");
    expect(entitledSaleFeeLabel(quoted)).toBe("0.5 USDC");
  });

  it("an unquoted sale reads Not recorded: never $0 and never the gross", () => {
    expect(entitledSaleNetLabel(unquoted)).toBe(UNQUOTED_NET_LABEL);
    expect(entitledSaleNetLabel(unquoted)).not.toContain("$0");
    expect(entitledSaleNetLabel(unquoted)).not.toBe(entitledSaleGrossLabel(unquoted));
    expect(entitledSaleFeeLabel(unquoted)).toBeNull();
  });

  it("uses the asset's own amount when the entitled net has no USD value", () => {
    const eth: ArtistEntitledNetSale = { ...quoted, symbol: "ETH", decimals: 18, grossUsd: null, grossAmount: "1", entitledNetUsd: null, entitledNetAmount: "0.9", platformFeeUnits: "100000000000000000" };
    expect(entitledSaleGrossLabel(eth)).toBe("1 ETH");
    expect(entitledSaleNetLabel(eth)).toBe("0.9 ETH");
    expect(entitledSaleFeeLabel(eth)).toBe("0.1 ETH");
  });

  it("only appears when there are x402 sales, and only from a ready report", () => {
    const report = (e?: ArtistEntitledNet): ArtistNetReceivedReport => ({
      status: "ready",
      basis: "net_after_fee_and_split",
      coverage: { marketplace: true, x402: "entitled_only", x402Note: "x402 note" },
      saleCount: 0,
      finalizedSales: 0,
      pendingSales: 0,
      totals: { grossFinalizedUsd: 0, netUsd: 0, pendingGrossUsd: 0 },
      byAsset: [],
      recentSales: [],
      truncated: false,
      entitled: e,
    });
    expect(entitledNetOf(report(entitled))).toBe(entitled);
    expect(entitledNetOf(report({ ...entitled, saleCount: 0, quotedSales: 0, unquotedSales: 0, recentSales: [] }))).toBeNull();
    expect(entitledNetOf(report(undefined))).toBeNull();
    expect(entitledNetOf({ status: "unavailable", reason: "x" })).toBeNull();
    expect(entitledNetOf(undefined)).toBeNull();
  });

  it("with only unquoted sales the headline says Not recorded", () => {
    expect(entitledNetHeadline({ ...entitled, quotedSales: 0, unquotedSales: 2, totals: { grossQuotedUsd: 0, entitledNetUsd: 0 } })).toBe(UNQUOTED_NET_LABEL);
  });
});
