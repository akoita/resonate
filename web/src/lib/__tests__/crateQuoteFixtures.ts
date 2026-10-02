import type { CrateQuote, CrateQuoteItem, CrateQuoteLine } from "../crates";

/** Shared builders for the crate quote tests (not a test file). */

export const MARKETPLACE = "0x00000000000000000000000000000000000000b0";
export const BUYER = "0x00000000000000000000000000000000000000c0";
export const USDC = "0x00000000000000000000000000000000000000a0";
export const NOW_MS = Date.parse("2026-10-02T12:00:00.000Z");

export function quoteItem(
  quoteLineId: string,
  overrides: Partial<CrateQuoteItem> = {},
): CrateQuoteItem {
  return {
    quoteLineId,
    stemId: `stem-${quoteLineId}`,
    stemType: "vocals",
    status: "quoted",
    reason: null,
    listingId: "7",
    tokenId: "70",
    paymentToken: USDC,
    symbol: "USDC",
    decimals: 6,
    totalUnits: "2000000",
    total: "2",
    totalUsd: "2",
    artistShareUnits: "1800000",
    platformFeeUnits: "200000",
    receipt: null,
    ...overrides,
  };
}

export function quoteLine(
  trackId: string,
  items: CrateQuoteItem[],
  overrides: Partial<CrateQuoteLine> = {},
): CrateQuoteLine {
  return {
    position: 0,
    trackId,
    title: `Track ${trackId}`,
    artistName: "Nova",
    licenseType: "remix",
    rights: {
      licenseType: "remix",
      standardTerms: true,
      grants: ["Use in derivative works, publish remixes", "Includes personal rights"],
    },
    items,
    ...overrides,
  };
}

export function makeQuote(overrides: Partial<CrateQuote> = {}): CrateQuote {
  const lines = overrides.lines ?? [
    quoteLine("t1", [
      quoteItem("q1", { stemType: "drums", listingId: "11" }),
      quoteItem("q2", { stemType: "vocals", listingId: "12", totalUnits: "3000000", total: "3", totalUsd: "3" }),
    ]),
    quoteLine("t2", [quoteItem("q3", { stemType: "bass", listingId: "13" })], { position: 1 }),
  ];
  return {
    id: "quote-1",
    crateId: "crate-1",
    status: "open",
    chainId: 31337,
    marketplaceAddress: MARKETPLACE,
    buyerAddress: BUYER,
    expiresAt: new Date(NOW_MS + 9 * 60_000 + 41_000).toISOString(),
    transactionHash: null,
    lines,
    totals: [
      { paymentToken: USDC, symbol: "USDC", decimals: 6, totalUnits: "7000000", total: "7", totalUsd: "7" },
    ],
    totalUsd: "7",
    budgetUsd: null,
    overBudget: false,
    ...overrides,
  };
}
