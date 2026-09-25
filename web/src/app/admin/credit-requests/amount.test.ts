import { describe, expect, it } from "vitest";
import { MAX_GRANT_CENTS, QUICK_GRANT_CENTS, formatUsdCents, parseDollarsToCents } from "./amount";

describe("parseDollarsToCents", () => {
  it("converts dollar amounts to integer cents without float drift", () => {
    expect(parseDollarsToCents("5")).toEqual({ ok: true, cents: 500 });
    expect(parseDollarsToCents("5.5")).toEqual({ ok: true, cents: 550 });
    expect(parseDollarsToCents("12.50")).toEqual({ ok: true, cents: 1250 });
    expect(parseDollarsToCents("0.29")).toEqual({ ok: true, cents: 29 });
    expect(parseDollarsToCents("1.13")).toEqual({ ok: true, cents: 113 });
    expect(parseDollarsToCents(" $7.05 ")).toEqual({ ok: true, cents: 705 });
    expect(parseDollarsToCents("007")).toEqual({ ok: true, cents: 700 });
  });

  it("accepts the $0.01 and $100,000.00 bounds", () => {
    expect(parseDollarsToCents("0.01")).toEqual({ ok: true, cents: 1 });
    expect(parseDollarsToCents("100000")).toEqual({ ok: true, cents: MAX_GRANT_CENTS });
    expect(parseDollarsToCents("100000.00")).toEqual({ ok: true, cents: MAX_GRANT_CENTS });
  });

  it("rejects amounts outside the grant range", () => {
    for (const input of ["0", "0.00", "100000.01", "1000000", "99999999999999999999"]) {
      const result = parseDollarsToCents(input);
      expect(result.ok, input).toBe(false);
      if (!result.ok) expect(result.error).toContain("between $0.01 and $100,000.00");
    }
  });

  it("rejects empty and malformed input", () => {
    expect(parseDollarsToCents("   ")).toEqual({ ok: false, error: "Enter an amount to grant." });
    for (const input of ["abc", "-5", "1.234", "1,50", "1,000", "5.", ".5", "1e3", "$"]) {
      expect(parseDollarsToCents(input).ok, input).toBe(false);
    }
  });
});

describe("formatUsdCents", () => {
  it("formats cents as US dollars", () => {
    expect(formatUsdCents(500)).toBe("$5.00");
    expect(formatUsdCents(1)).toBe("$0.01");
    expect(formatUsdCents(MAX_GRANT_CENTS)).toBe("$100,000.00");
    expect(QUICK_GRANT_CENTS.map(formatUsdCents)).toEqual(["$1.00", "$5.00", "$10.00"]);
  });
});
