import { describe, expect, it } from "vitest";
import { formatCents, formatResetIn, formatWindow } from "./usage";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

describe("formatResetIn", () => {
  it("returns an em dash when there is no active window", () => {
    expect(formatResetIn(null, NOW)).toBe("—");
  });

  it("returns an em dash for an unparseable timestamp", () => {
    expect(formatResetIn("not-a-date", NOW)).toBe("—");
  });

  it("says resets now when the window has already lapsed", () => {
    expect(formatResetIn("2026-07-10T11:59:00.000Z", NOW)).toBe("resets now");
  });

  it("renders minutes under an hour", () => {
    expect(formatResetIn("2026-07-10T12:42:00.000Z", NOW)).toBe("resets in 42 min");
  });

  it("renders hours and minutes over an hour", () => {
    expect(formatResetIn("2026-07-10T14:05:00.000Z", NOW)).toBe("resets in 2h 5min");
  });

  it("renders whole hours without a minute part", () => {
    expect(formatResetIn("2026-07-10T15:00:00.000Z", NOW)).toBe("resets in 3h");
  });

  it("renders days beyond 24h", () => {
    expect(formatResetIn("2026-07-12T13:00:00.000Z", NOW)).toBe("resets in 2d 1h");
  });
});

describe("formatWindow", () => {
  it("names common windows", () => {
    expect(formatWindow(3600)).toBe("hour");
    expect(formatWindow(86_400)).toBe("day");
    expect(formatWindow(1800)).toBe("30 min");
    expect(formatWindow(21_600)).toBe("6 h");
    expect(formatWindow(172_800)).toBe("2 days");
  });

  it("falls back for an invalid window", () => {
    expect(formatWindow(0)).toBe("window");
    expect(formatWindow(NaN)).toBe("window");
  });
});

describe("formatCents", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(10)).toBe("$0.10");
    expect(formatCents(125)).toBe("$1.25");
    expect(formatCents(-5)).toBe("−$0.05");
    expect(formatCents(NaN)).toBe("—");
  });
});
