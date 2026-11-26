import { SEARCH_GROUP_LIMIT, SEARCH_MAX_QUERY_LENGTH, mergeArtistResults, normalizeSearchQuery } from "../modules/search/search.service";

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

describe("mergeArtistResults", () => {
  const profile = { kind: "profile" as const, id: "a1", displayName: "Night Owl", imageUrl: null };

  it("adds credited names after profiles, skipping names a profile already has", () => {
    const merged = mergeArtistResults([profile], ["night owl", " Booba ", null, "", "Booba"], "boo");
    expect(merged).toEqual([profile, { kind: "credit", id: null, displayName: "Booba", imageUrl: null }]);
  });

  it("puts names starting with the query first, then by name", () => {
    const merged = mergeArtistResults([], ["The Night", "Zed Night", "Night B", "Night A"], "night");
    expect(merged.map((artist) => artist.displayName)).toEqual(["Night A", "Night B", "The Night", "Zed Night"]);
  });

  it("keeps the group limit", () => {
    const names = Array.from({ length: SEARCH_GROUP_LIMIT + 3 }, (_, i) => `Name ${i}`);
    expect(mergeArtistResults([profile], names, "name")).toHaveLength(SEARCH_GROUP_LIMIT);
  });
});
