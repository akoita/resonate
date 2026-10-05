import { sameSessionFilters, sessionFilterSummary } from "../modules/agents/agent_session_filters";

describe("sessionFilterSummary (#2096)", () => {
  it("returns empty lists and the explicit flag for empty input", () => {
    expect(sessionFilterSummary({ allowExplicit: false })).toEqual({ genres: [], moods: [], explicit: false });
    expect(sessionFilterSummary({ allowExplicit: true })).toEqual({ genres: [], moods: [], explicit: true });
  });

  it("keeps the preset name, trimmed and bounded", () => {
    expect(sessionFilterSummary({ sessionIntentName: "  Deep focus  ", allowExplicit: false }).presetName).toBe(
      "Deep focus",
    );
    const long = sessionFilterSummary({ sessionIntentName: "x".repeat(200), allowExplicit: false });
    expect(long.presetName).toHaveLength(60);
    expect(sessionFilterSummary({ sessionIntentName: "   ", allowExplicit: false }).presetName).toBeUndefined();
  });

  it("dedupes genres case-insensitively, drops oversized terms, and caps at eight", () => {
    const summary = sessionFilterSummary({
      sessionGenres: [" Hip Hop ", "hip hop", "HIP HOP", "x".repeat(41), "", "g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"],
      allowExplicit: false,
    });
    expect(summary.genres).toEqual(["Hip Hop", "g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
  });

  it("uses request moods, else the single mood, with the same bounds", () => {
    expect(sessionFilterSummary({ moods: ["dark", "Dark", "calm"], mood: "happy", allowExplicit: false }).moods).toEqual([
      "dark",
      "calm",
    ]);
    expect(sessionFilterSummary({ mood: "happy", allowExplicit: false }).moods).toEqual(["happy"]);
    expect(sessionFilterSummary({ moods: [], mood: "happy", allowExplicit: false }).moods).toEqual(["happy"]);
  });

  it("drops an invalid energy and keeps a valid one", () => {
    expect(sessionFilterSummary({ energy: "extreme", allowExplicit: false })).not.toHaveProperty("energy");
    expect(sessionFilterSummary({ energy: "high", allowExplicit: false }).energy).toBe("high");
  });

  it("keeps finite tempo bounds and drops the rest", () => {
    expect(sessionFilterSummary({ tempoBpm: { min: 90, max: 110 }, allowExplicit: false }).tempoBpm).toEqual({
      min: 90,
      max: 110,
    });
    expect(sessionFilterSummary({ tempoBpm: { min: 90, max: Number.NaN }, allowExplicit: false }).tempoBpm).toEqual({
      min: 90,
      max: null,
    });
    expect(
      sessionFilterSummary({ tempoBpm: { min: Number.POSITIVE_INFINITY, max: null }, allowExplicit: false }),
    ).not.toHaveProperty("tempoBpm");
  });

  it("flags My Mix without leaking lane ids or labels", () => {
    const summary = sessionFilterSummary({
      myMix: { lanes: [{ id: "lane-secret-1", label: "My private lane" }] },
      allowExplicit: false,
    });
    expect(summary.myMix).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("lane-secret-1");
    expect(JSON.stringify(summary)).not.toContain("private");
    expect(sessionFilterSummary({ myMix: null, allowExplicit: false })).not.toHaveProperty("myMix");
    expect(sessionFilterSummary({ allowExplicit: false })).not.toHaveProperty("myMix");
  });
});

describe("sameSessionFilters", () => {
  it("ignores key order and compares values", () => {
    const filters = sessionFilterSummary({ sessionGenres: ["jazz"], energy: "low", allowExplicit: true });
    expect(sameSessionFilters({ explicit: true, energy: "low", moods: [], genres: ["jazz"] }, filters)).toBe(true);
    expect(sameSessionFilters({ explicit: false, energy: "low", moods: [], genres: ["jazz"] }, filters)).toBe(false);
    expect(sameSessionFilters(null, filters)).toBe(false);
  });
});
