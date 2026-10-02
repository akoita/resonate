import { describe, expect, it } from "vitest";
import {
  choicesFromQuote,
  crateReasonText,
  formatCountdown,
  formatTokenUnits,
  formatUsdDecimal,
  IncompleteQuoteError,
  isQuoteExpired,
  isWalletCancellation,
  itemPriceText,
  itemSplitText,
  lineRequestsFromChoices,
  overBudgetText,
  purchaseFailureMessage,
  quoteBatchLines,
  quoteBlocker,
  quotedStems,
  receiptRows,
  resolveBuyerAddress,
  stemChoices,
  stemLabel,
  totalsForStems,
  tierChoices,
  withStemToggled,
  withTier,
} from "./crateQuote";
import type { CrateItemDto } from "./crates";
import { BUYER, MARKETPLACE, NOW_MS, USDC, makeQuote, quoteItem, quoteLine } from "./__tests__/crateQuoteFixtures";

describe("crateReasonText", () => {
  it("says something plain for every code the backend can send", () => {
    for (const code of [
      "not_listed",
      "sold_out",
      "expired",
      "own_listing",
      "unverifiable",
      "token_not_supported",
      "simulation_failed",
      "insufficient_balance",
      "listing_changed",
      "deselected",
      "transaction_reverted",
      "transaction_before_quote",
      "not_in_transaction",
    ]) {
      const text = crateReasonText(code);
      expect(text).not.toBe("Not available");
      expect(text).not.toContain("_");
    }
    expect(crateReasonText("sold_out")).toBe("Sold out");
    expect(crateReasonText("something_new")).toBe("Not available");
    expect(crateReasonText(null)).toBe("Not available");
  });
});

describe("money display", () => {
  it("formats token units with the token's own decimals, exactly", () => {
    expect(formatTokenUnits(2_000_000n, "USDC", 6)).toBe("2 USDC");
    expect(formatTokenUnits(1_234_567n, "USDC", 6)).toBe("1.234567 USDC");
    expect(formatTokenUnits(10n ** 18n + 5n * 10n ** 17n, "ETH", 18)).toBe("1.5 ETH");
  });

  it("formats USD strings to cents without floating point", () => {
    expect(formatUsdDecimal("7")).toBe("$7.00");
    expect(formatUsdDecimal("19.995")).toBe("$20.00");
    expect(formatUsdDecimal("1234.5")).toBe("$1,234.50");
    expect(formatUsdDecimal("0.004")).toBe("under $0.01");
    expect(formatUsdDecimal("0")).toBe("$0.00");
    expect(formatUsdDecimal(null)).toBe("price unknown");
    expect(formatUsdDecimal("abc")).toBe("price unknown");
  });

  it("names the budget only when the quote is over it", () => {
    expect(overBudgetText({ overBudget: true, budgetUsd: 20 })).toBe("Over your $20.00 budget");
    expect(overBudgetText({ overBudget: false, budgetUsd: 20 })).toBeNull();
    expect(overBudgetText({ overBudget: true, budgetUsd: null })).toBeNull();
  });

  it("splits an item's price into the artist side and the platform fee", () => {
    const item = quoteItem("q1");
    expect(itemPriceText(item)).toBe("2 USDC");
    expect(itemSplitText(item)).toEqual({ artist: "1.8 USDC", platform: "0.2 USDC" });
    expect(itemPriceText(quoteItem("q1", { totalUnits: null }))).toBeNull();
    expect(itemSplitText(quoteItem("q1", { platformFeeUnits: null }))).toBeNull();
  });
});

describe("expiry", () => {
  const quote = makeQuote();
  it("counts down to the expiry and says Expired after it", () => {
    expect(formatCountdown(quote, NOW_MS)).toBe("9:41");
    expect(formatCountdown(quote, NOW_MS + 9 * 60_000 + 40_500)).toBe("0:01");
    expect(formatCountdown(quote, NOW_MS + 9 * 60_000 + 41_000)).toBe("Expired");
    expect(isQuoteExpired(quote, NOW_MS)).toBe(false);
    expect(isQuoteExpired(quote, NOW_MS + 10 * 60_000)).toBe(true);
  });

  it("treats an unreadable expiry as expired", () => {
    expect(isQuoteExpired({ expiresAt: "soon" }, NOW_MS)).toBe(true);
  });
});

describe("resolveBuyerAddress", () => {
  it("prefers the kernel account, then the smart account, then the sign-in address", () => {
    const a = "0x00000000000000000000000000000000000000a1";
    const b = "0x00000000000000000000000000000000000000b2";
    const c = "0x00000000000000000000000000000000000000c3";
    expect(resolveBuyerAddress({ kernelAddress: a, smartAccountAddress: b, address: c })).toBe(a);
    expect(resolveBuyerAddress({ smartAccountAddress: b, address: c })).toBe(b);
    expect(resolveBuyerAddress({ address: c })).toBe(c);
    expect(resolveBuyerAddress({ address: "not-an-address" })).toBeNull();
    expect(resolveBuyerAddress({})).toBeNull();
  });
});

describe("wallet failures", () => {
  it("tells a cancelled prompt apart from other failures", () => {
    expect(isWalletCancellation(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe(true);
    expect(isWalletCancellation(new Error("User rejected the request"))).toBe(true);
    expect(isWalletCancellation(new Error("bundler timed out"))).toBe(false);
    expect(purchaseFailureMessage(new Error("User rejected the request"))).toMatch(/Nothing was charged/);
    // Anything else may have happened after the network accepted it: no promise.
    expect(purchaseFailureMessage(new Error("bundler timed out"))).not.toMatch(/^Nothing was charged/);
    expect(purchaseFailureMessage(new Error("bundler timed out"))).toMatch(/wallet activity/);
  });
});

describe("reading a quote", () => {
  it("lists the stems still on offer in quote order, skipping dropped ones", () => {
    const quote = makeQuote({
      lines: [
        quoteLine("t1", [
          quoteItem("q1", { stemType: "bass" }),
          quoteItem("q2", { stemType: "drums", status: "dropped", reason: "sold_out" }),
        ]),
        quoteLine("t2", [quoteItem("q3", { stemType: "vocals" })], { position: 1 }),
      ],
    });
    expect(quotedStems(quote).map(({ item }) => item.quoteLineId)).toEqual(["q1", "q3"]);
  });

  it("turns quoted stems into batch lines with bigint units", () => {
    const lines = quoteBatchLines(
      makeQuote({
        lines: [
          quoteLine("t1", [
            quoteItem("q1", { listingId: "11", totalUnits: "9007199254740993" }),
            quoteItem("q2", { listingId: "12", totalUnits: "5", paymentToken: "0x0000000000000000000000000000000000000000" }),
          ]),
        ],
      }),
    );
    expect(lines).toEqual([
      { quoteLineId: "q1", listingId: 11n, amount: 1n, paymentToken: USDC, totalUnits: 9_007_199_254_740_993n },
      {
        quoteLineId: "q2",
        listingId: 12n,
        amount: 1n,
        paymentToken: "0x0000000000000000000000000000000000000000",
        totalUnits: 5n,
      },
    ]);
  });

  it("refuses a quote with a quoted stem that has no price or listing", () => {
    for (const broken of [
      { listingId: null },
      { totalUnits: null },
      { totalUnits: "0" },
      { totalUnits: "1.5" },
      { paymentToken: null },
      { paymentToken: "usdc" },
    ]) {
      const quote = makeQuote({ lines: [quoteLine("t1", [quoteItem("q1", broken)])] });
      expect(() => quoteBatchLines(quote)).toThrow(IncompleteQuoteError);
    }
  });
});

describe("quoteBlocker", () => {
  const base = { chainId: 31337, marketplaceAddress: MARKETPLACE, buyerAddress: BUYER, nowMs: NOW_MS };

  it("lets an open, unexpired quote for this buyer, network and marketplace through", () => {
    expect(quoteBlocker({ quote: makeQuote(), ...base })).toBeNull();
    // Addresses compare without regard to case.
    expect(
      quoteBlocker({
        quote: makeQuote({ buyerAddress: BUYER.toUpperCase().replace("0X", "0x") }),
        ...base,
      }),
    ).toBeNull();
  });

  it("blocks everything else", () => {
    expect(quoteBlocker({ quote: makeQuote({ status: "submitted" }), ...base })).toBe("not_open");
    expect(quoteBlocker({ quote: makeQuote({ status: "settled" }), ...base })).toBe("not_open");
    expect(quoteBlocker({ quote: makeQuote(), ...base, nowMs: NOW_MS + 11 * 60_000 })).toBe("expired");
    expect(quoteBlocker({ quote: makeQuote(), ...base, buyerAddress: "0x00000000000000000000000000000000000000d9" })).toBe(
      "wallet_changed",
    );
    expect(quoteBlocker({ quote: makeQuote(), ...base, buyerAddress: null })).toBe("wallet_changed");
    expect(quoteBlocker({ quote: makeQuote(), ...base, chainId: 1 })).toBe("wrong_network");
    expect(
      quoteBlocker({ quote: makeQuote(), ...base, marketplaceAddress: "0x00000000000000000000000000000000000000f1" }),
    ).toBe("wrong_marketplace");
    expect(quoteBlocker({ quote: makeQuote(), ...base, marketplaceAddress: null })).toBe("wrong_marketplace");
    expect(
      quoteBlocker({
        quote: makeQuote({ lines: [quoteLine("t1", [quoteItem("q1", { status: "dropped", reason: "sold_out" })])] }),
        ...base,
      }),
    ).toBe("nothing_to_buy");
    expect(
      quoteBlocker({ quote: makeQuote({ lines: [quoteLine("t1", [quoteItem("q1", { totalUnits: null })])] }), ...base }),
    ).toBe("incomplete");
  });
});

describe("tier and stem choices", () => {
  const quote = makeQuote();

  it("starts from what the quote holds", () => {
    const choices = choicesFromQuote(quote);
    expect(choices.get("t1")).toEqual({ licenseType: "remix", stemTypes: ["vocals", "drums"] });
    expect(choices.get("t2")).toEqual({ licenseType: "remix", stemTypes: ["bass"] });
  });

  it("re-quotes every line with its tier and stems, never just the changed one", () => {
    const changed = withTier(choicesFromQuote(quote), "t2", "personal");
    expect(lineRequestsFromChoices(quote, changed)).toEqual([
      { trackId: "t1", licenseType: "remix", stemTypes: ["vocals", "drums"] },
      { trackId: "t2", licenseType: "personal", stemTypes: ["bass"] },
    ]);
  });

  it("switches a stem on and off, but never the last one off", () => {
    let choices = choicesFromQuote(quote);
    choices = withStemToggled(choices, "t1", "drums");
    expect(choices.get("t1")?.stemTypes).toEqual(["vocals"]);
    choices = withStemToggled(choices, "t1", "vocals");
    expect(choices.get("t1")?.stemTypes).toEqual(["vocals"]);
    choices = withStemToggled(choices, "t1", "bass");
    expect(choices.get("t1")?.stemTypes).toEqual(["vocals", "bass"]);
  });

  it("offers the listed tiers plus the quoted one, and the track's own stems", () => {
    const crateItem = {
      licenseOptions: [
        { licenseType: "personal", listed: true, indicativePriceUsd: 1, standardTerms: true, grants: [] },
        { licenseType: "remix", listed: false, indicativePriceUsd: 2, standardTerms: true, grants: [] },
        { licenseType: "commercial", listed: true, indicativePriceUsd: 3, standardTerms: true, grants: [] },
      ],
      stems: [
        { type: "vocals", qualityScore: null },
        { type: "piano", qualityScore: null },
      ],
    } as unknown as CrateItemDto;
    expect(tierChoices(crateItem, "remix")).toEqual(["personal", "remix", "commercial"]);
    expect(tierChoices(undefined, "remix")).toEqual(["remix"]);
    expect(stemChoices(crateItem, quote.lines[0])).toEqual(["vocals", "drums", "piano"]);
  });
});

describe("receipts", () => {
  it("shows settled, failed and left-out stems with a plain reason and the transaction", () => {
    const hash = `0x${"ab".repeat(32)}`;
    const quote = makeQuote({
      status: "partial",
      transactionHash: hash,
      lines: [
        quoteLine("t1", [
          quoteItem("q1", {
            status: "settled",
            stemType: "drums",
            receipt: { transactionHash: hash, logIndex: 3, totalPaidUnits: "2000000", purchaseId: "p1" },
          }),
          quoteItem("q2", { status: "dropped", reason: "listing_changed", stemType: "vocals" }),
          quoteItem("q3", { status: "failed", reason: "not_in_transaction", stemType: "bass" }),
          quoteItem("q4", { status: "quoted", stemType: "piano" }),
        ]),
      ],
    });
    expect(receiptRows(quote)).toEqual([
      expect.objectContaining({ quoteLineId: "q1", outcome: "settled", reason: null, transactionHash: hash, price: "2 USDC" }),
      expect.objectContaining({ quoteLineId: "q2", outcome: "dropped", reason: "Left out: the listing changed" }),
      expect.objectContaining({ quoteLineId: "q3", outcome: "failed", reason: "Not part of the purchase" }),
    ]);
  });
});

describe("stem labels and totals", () => {
  it("finds a stem's track and sums chosen stems per token with bigint units", () => {
    const quote = makeQuote();
    expect(stemLabel(quote, "q2")).toMatchObject({ trackTitle: "Track t1", stemType: "vocals" });
    expect(stemLabel(quote, "nope")).toBeNull();
    expect(totalsForStems(quote, ["q1", "q3"])).toEqual(["4 USDC"]);
    expect(totalsForStems(quote, ["q1", "q2", "q3"])).toEqual(["7 USDC"]);
    expect(totalsForStems(quote, [])).toEqual([]);
  });

  it("keeps different payment tokens apart", () => {
    const quote = makeQuote({
      lines: [
        quoteLine("t1", [
          quoteItem("q1", { totalUnits: "1500000000000000000", symbol: "ETH", decimals: 18, paymentToken: "0x0000000000000000000000000000000000000000" }),
          quoteItem("q2", { totalUnits: "2000000" }),
        ]),
      ],
    });
    expect(totalsForStems(quote, ["q1", "q2"])).toEqual(["1.5 ETH", "2 USDC"]);
  });
});
