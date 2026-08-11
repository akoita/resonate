import { describe, expect, it } from "vitest";
import { getX402TransferParams, parseX402StemQuote } from "./x402StemQuote";

const PAYOUT = "0x46213007a5e229d789f74b408625dda265e00c28";
const OPTIONS = { expectedSymbol: "USDC", decimals: 6, payoutAddress: PAYOUT };

function quote(overrides: Record<string, unknown> = {}) {
  return {
    price: { currency: "USDC", amount: "10.25", usd: 10.25 },
    licenseOptions: [
      {
        key: "personal",
        price: { currency: "USDC", amount: "10.25" },
        breakdown: {
          feeBps: 1000,
          platformFee: { currency: "USDC", amount: "1.025", usd: 1.025 },
        },
      },
      {
        key: "remix",
        price: { currency: "USDC", amount: "20" },
        breakdown: {
          feeBps: 1000,
          platformFee: { currency: "USDC", amount: "2", usd: 2 },
        },
      },
    ],
    x402: { payTo: PAYOUT, scheme: "exact" },
    ...overrides,
  };
}

describe("parseX402StemQuote", () => {
  it("returns the backend-authored total, included fee, units, and destination", () => {
    expect(parseX402StemQuote(quote(), OPTIONS)).toEqual({
      totalAmount: "10.25",
      totalCurrency: "USDC",
      amountUsd: 10.25,
      amountUnits: "10250000",
      payTo: PAYOUT,
      platformFee: { amount: "1.025", currency: "USDC", feeBps: 1000 },
    });
  });

  it("accepts an explicitly zero platform fee", () => {
    const raw = quote();
    const personal = raw.licenseOptions[0]!;
    personal.breakdown.feeBps = 0;
    personal.breakdown.platformFee.amount = "0";
    expect(parseX402StemQuote(raw, OPTIONS).platformFee.amount).toBe("0");
  });

  it("rejects missing and duplicate personal options", () => {
    expect(() => parseX402StemQuote(quote({ licenseOptions: [] }), OPTIONS)).toThrow("exactly one personal");
    const personal = quote().licenseOptions[0]!;
    expect(() => parseX402StemQuote(quote({ licenseOptions: [personal, personal] }), OPTIONS)).toThrow("exactly one personal");
  });

  it("selects personal by key rather than array position", () => {
    const raw = quote();
    raw.licenseOptions.reverse();
    expect(parseX402StemQuote(raw, OPTIONS).totalAmount).toBe("10.25");
  });

  it("rejects unsupported or inconsistent currencies and personal prices", () => {
    expect(() => parseX402StemQuote(quote({
      price: { currency: "DAI", amount: "10.25", usd: 10.25 },
    }), OPTIONS)).toThrow("configured payment asset");
    const raw = quote();
    raw.licenseOptions[0]!.price.currency = "DAI";
    expect(() => parseX402StemQuote(raw, OPTIONS)).toThrow("configured payment asset");
    const mismatch = quote();
    mismatch.licenseOptions[0]!.price.amount = "10.24";
    expect(() => parseX402StemQuote(mismatch, OPTIONS)).toThrow("do not match");
  });

  it.each(["-1", "1e2", "NaN", "1.1234567"])("rejects malformed amount %s", (amount) => {
    expect(() => parseX402StemQuote(quote({
      price: { currency: "USDC", amount, usd: 10.25 },
    }), OPTIONS)).toThrow("Invalid x402 quote");
  });

  it("rejects a zero personal total", () => {
    const raw = quote({ price: { currency: "USDC", amount: "0", usd: 0 } });
    raw.licenseOptions[0]!.price.amount = "0";
    expect(() => parseX402StemQuote(raw, OPTIONS)).toThrow("greater than zero");
  });

  it("rejects a non-finite USD amount", () => {
    expect(() => parseX402StemQuote(quote({
      price: { currency: "USDC", amount: "10.25", usd: Infinity },
    }), OPTIONS)).toThrow("finite non-negative");
  });

  it("rejects fee values above total and malformed fee decimals", () => {
    const excessive = quote();
    excessive.licenseOptions[0]!.breakdown.platformFee.amount = "10.250001";
    expect(() => parseX402StemQuote(excessive, OPTIONS)).toThrow("exceeds the total");
    const exponent = quote();
    exponent.licenseOptions[0]!.breakdown.platformFee.amount = "1e0";
    expect(() => parseX402StemQuote(exponent, OPTIONS)).toThrow("plain non-negative decimal");
    const negative = quote();
    negative.licenseOptions[0]!.breakdown.platformFee.amount = "-1";
    expect(() => parseX402StemQuote(negative, OPTIONS)).toThrow("plain non-negative decimal");
    const precision = quote();
    precision.licenseOptions[0]!.breakdown.platformFee.amount = "0.1234567";
    expect(() => parseX402StemQuote(precision, OPTIONS)).toThrow("decimal precision");
    const currency = quote();
    currency.licenseOptions[0]!.breakdown.platformFee.currency = "DAI";
    expect(() => parseX402StemQuote(currency, OPTIONS)).toThrow("configured payment asset");
  });

  it("rejects malformed fee basis points", () => {
    for (const feeBps of [-1, 10_001, 1.5, Number.NaN]) {
      const raw = quote();
      raw.licenseOptions[0]!.breakdown.feeBps = feeBps;
      expect(() => parseX402StemQuote(raw, OPTIONS)).toThrow("feeBps");
    }
  });

  it("rejects a platform fee that does not match the quoted basis-point rate", () => {
    const raw = quote();
    raw.licenseOptions[0]!.breakdown.platformFee.amount = "1";
    expect(() => parseX402StemQuote(raw, OPTIONS)).toThrow("does not match the quoted fee rate");
  });

  it("requires the exact payment scheme", () => {
    expect(() => parseX402StemQuote(quote({
      x402: { payTo: PAYOUT, scheme: "upto" },
    }), OPTIONS)).toThrow("payment scheme must be exact");
  });

  it("rejects malformed or mismatched destinations", () => {
    expect(() => parseX402StemQuote(quote({ x402: { payTo: "not-an-address", scheme: "exact" } }), OPTIONS)).toThrow("malformed");
    expect(() => parseX402StemQuote(quote({
      x402: { payTo: "0x0000000000000000000000000000000000000000", scheme: "exact" },
    }), OPTIONS)).toThrow("malformed");
    expect(() => parseX402StemQuote(quote({
      x402: { payTo: "0x1111111111111111111111111111111111111111", scheme: "exact" },
    }), OPTIONS)).toThrow("does not match public configuration");
  });

  it("does not let platform fee changes alter wallet transfer parameters", () => {
    const first = parseX402StemQuote(quote(), OPTIONS);
    const changedFee = quote();
    changedFee.licenseOptions[0]!.breakdown.feeBps = 500;
    changedFee.licenseOptions[0]!.breakdown.platformFee.amount = "0.5125";
    const second = parseX402StemQuote(changedFee, OPTIONS);
    expect(getX402TransferParams(second)).toEqual(getX402TransferParams(first));
    expect(getX402TransferParams(first)).toEqual({ amountUnits: "10250000", payTo: PAYOUT });
  });
});
