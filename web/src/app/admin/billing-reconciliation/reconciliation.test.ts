import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../../lib/api";
import {
  csvFileName,
  currentUtcMonth,
  formatCreditCents,
  formatMoneyMinor,
  formatMonthLabel,
  formatUtcDate,
  formatUtcTimestamp,
  humanizeCode,
  jsonFileName,
  previousUtcMonth,
  reconciliationErrorMessage,
  reconciliationMonthOptions,
  shiftMonth,
  shortenReference,
} from "./reconciliation";

describe("reconciliation month helpers (#2497)", () => {
  it("defaults to the previous UTC month, across a year boundary", () => {
    expect(previousUtcMonth(new Date("2026-10-31T23:59:59Z"))).toBe("2026-09");
    expect(previousUtcMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2025-12");
    expect(currentUtcMonth(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    // Late on the 31st in UTC-8 is already November in UTC.
    expect(previousUtcMonth(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10");
  });

  it("shifts months in both directions", () => {
    expect(shiftMonth("2026-03", -3)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-05", -24)).toBe("2024-05");
  });

  it("offers the current month first, flagged in progress, and never a future month", () => {
    const options = reconciliationMonthOptions(new Date("2026-10-15T10:00:00Z"), 14);
    expect(options).toHaveLength(14);
    expect(options[0]).toEqual({ value: "2026-10", label: "October 2026 (in progress)", inProgress: true });
    expect(options[1]).toEqual({ value: "2026-09", label: "September 2026", inProgress: false });
    expect(options[13].value).toBe("2025-09");
    expect(options.filter((option) => option.inProgress)).toHaveLength(1);
    expect(options.every((option) => option.value <= "2026-10")).toBe(true);
    expect(new Set(options.map((option) => option.value)).size).toBe(14);
  });

  it("labels months and leaves odd values as they are", () => {
    expect(formatMonthLabel("2026-01")).toBe("January 2026");
    expect(formatMonthLabel("nope")).toBe("nope");
  });
});

describe("reconciliation formatting (#2497)", () => {
  it("formats minor units by currency", () => {
    expect(formatMoneyMinor(123456, "usd")).toBe("$1,234.56");
    expect(formatMoneyMinor(-250, "USD")).toBe("-$2.50");
    expect(formatMoneyMinor(1999, "eur")).toBe("€19.99");
    // JPY has no minor unit: 500 is 500 yen, not 5.00.
    expect(formatMoneyMinor(500, "jpy")).toBe("¥500");
    expect(formatMoneyMinor(0, "USD")).toBe("$0.00");
  });

  it("shows an unknown currency code next to the number", () => {
    expect(formatMoneyMinor(1050, "??")).toBe("10.50 ??");
  });

  it("formats credit cents as dollars", () => {
    expect(formatCreditCents(1250)).toBe("$12.50");
    expect(formatCreditCents(0)).toBe("$0.00");
  });

  it("shortens long ids and keeps short ones", () => {
    expect(shortenReference("cs_test_a1B2c3D4e5F6g7H8")).toBe("cs_test_…g7H8");
    expect(shortenReference("pack_small")).toBe("pack_small");
  });

  it("formats timestamps in UTC and tolerates missing or unreadable values", () => {
    expect(formatUtcTimestamp("2026-09-04T12:30:45.000Z")).toBe("2026-09-04 12:30 UTC");
    expect(formatUtcDate("2026-09-04T12:30:45.000Z")).toBe("2026-09-04");
    expect(formatUtcTimestamp(null)).toBe("—");
    expect(formatUtcDate(undefined)).toBe("—");
    expect(formatUtcTimestamp("not a date")).toBe("not a date");
  });

  it("turns codes into words", () => {
    expect(humanizeCode("top_up_refund")).toBe("top up refund");
    expect(humanizeCode("spend:generation")).toBe("spend generation");
    expect(humanizeCode(null)).toBe("—");
  });

  it("names download files by month and section", () => {
    expect(csvFileName("2026-09", "needs_review")).toBe("billing-reconciliation-2026-09-needs_review.csv");
    expect(jsonFileName("2026-09")).toBe("billing-reconciliation-2026-09.json");
  });
});

describe("reconciliationErrorMessage (#2497)", () => {
  it("explains a refusal and each 400 code", () => {
    expect(reconciliationErrorMessage(new ApiRequestError("API 403", 403, undefined))).toMatch(/operators and administrators/);
    expect(reconciliationErrorMessage(new ApiRequestError("API 400", 400, { code: "invalid_month" }))).toMatch(/not a valid month/);
    expect(reconciliationErrorMessage(new ApiRequestError("API 400", 400, { code: "month_in_future" }))).toMatch(/has not started/);
    expect(reconciliationErrorMessage(new ApiRequestError("API 400", 400, { code: "section_required" }))).toMatch(/section/);
  });

  it("falls back to the error's own message, then a generic one", () => {
    expect(reconciliationErrorMessage(new ApiRequestError("API 500: boom", 500, undefined))).toBe("API 500: boom");
    expect(reconciliationErrorMessage(new ApiRequestError("API 400: odd", 400, { code: "unknown" }))).toBe("API 400: odd");
    expect(reconciliationErrorMessage("nope")).toBe("Something went wrong. Please try again.");
  });
});
