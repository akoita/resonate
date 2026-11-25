import { SEARCH_MAX_QUERY_LENGTH, normalizeSearchQuery } from "../modules/search/search.service";

describe("normalizeSearchQuery (#2671)", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeSearchQuery("  night \n  drive ")).toBe("night drive");
  });

  it("cuts long input instead of refusing it", () => {
    expect(normalizeSearchQuery("a".repeat(500))).toHaveLength(SEARCH_MAX_QUERY_LENGTH);
  });

  it("treats anything but a string as empty", () => {
    expect(normalizeSearchQuery(undefined)).toBe("");
    expect(normalizeSearchQuery(["night", "drive"])).toBe("");
  });
});
