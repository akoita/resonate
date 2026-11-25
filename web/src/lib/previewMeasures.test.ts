import { describe, expect, it } from "vitest";
import { formatCount, formatHours, formatShare, weekLabel } from "./previewMeasures";

describe("preview measures formatting (#2670)", () => {
  it("shows hidden counts and shares in words", () => {
    expect(formatCount(null)).toBe("fewer than five");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234)).toBe("1,234");
    expect(formatShare(null)).toBe("not shown (small group)");
    expect(formatShare(83.3)).toBe("83.3%");
  });

  it("formats answer times and week labels", () => {
    expect(formatHours(null)).toMatch(/fewer than five/);
    expect(formatHours(0.5)).toBe("under an hour");
    expect(formatHours(6)).toBe("6 hours");
    expect(formatHours(72)).toBe("3 days");
    expect(weekLabel("2031-03-03T00:00:00.000Z")).toBe("3 Mar");
  });
});
