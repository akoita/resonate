import { describe, expect, it } from "vitest";
import type { ArtistNetReceivedReport, ArtistNetReceivedSale } from "./api";
import {
  PENDING_NET_LABEL,
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
    coverage: { marketplace: true, x402: false, x402Reason: "x402 reason" },
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
    expect(netReceivedNote(report)).toContain("x402 sales are not included");
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
    expect(netReceivedHeadline(ready({ saleCount: 0, finalizedSales: 0, pendingSales: 0, recentSales: [] }))).toBe("No sales yet");
    const unavailable: ArtistNetReceivedReport = { status: "unavailable", reason: "Net received is temporarily unavailable." };
    expect(netReceivedHeadline(unavailable)).toBe("Unavailable");
    expect(netReceivedDetail(unavailable)).toBe("Net received is temporarily unavailable.");
    expect(netReceivedHeadline(undefined)).toBeNull();
  });
});
