import { guard, guardedShare, median, resolvePeriod, weekBuckets } from "../modules/preview_measures/preview_measures.service";

describe("preview measures helpers (#2670)", () => {
  it("hides counts from 1 to 4", () => {
    expect(guard(0)).toBe(0);
    expect(guard(1)).toBeNull();
    expect(guard(4)).toBeNull();
    expect(guard(5)).toBe(5);
  });

  it("gives a share only on a base of five or more, and never reveals a hidden part", () => {
    expect(guardedShare(5, 6)).toBe(83.3);
    expect(guardedShare(0, 5)).toBe(0);
    expect(guardedShare(2, 10)).toBeNull();
    expect(guardedShare(4, 4)).toBeNull();
  });

  it("finds the median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("checks the period and splits it into weeks", () => {
    const now = new Date("2026-12-10T00:00:00Z");
    const fallback = resolvePeriod(undefined, undefined, now);
    expect(fallback.to).toEqual(now);
    expect(fallback.from).toEqual(new Date("2026-11-12T00:00:00Z"));
    expect(() => resolvePeriod("nope")).toThrow("Use dates like");
    expect(() => resolvePeriod("2026-12-02", "2026-12-01")).toThrow("before the end date");
    expect(() => resolvePeriod("2026-01-01", "2026-12-01")).toThrow("at most 92 days");
    const weeks = weekBuckets({ from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-17T00:00:00Z") });
    expect(weeks.map((w) => w.end.toISOString())).toEqual([
      "2026-11-08T00:00:00.000Z",
      "2026-11-15T00:00:00.000Z",
      "2026-11-17T00:00:00.000Z",
    ]);
  });
});
