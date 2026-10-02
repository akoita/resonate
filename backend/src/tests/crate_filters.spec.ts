/**
 * Crate Digger filter defaults, vocabulary and sanitization (#1962) — pure
 * unit tests. Sanitization is the trust boundary for client-edited chips and
 * model output, so most cases feed it hostile input.
 */
import {
  canonicalCrateGenre,
  canonicalCrateMood,
  crateGenreMatches,
  crateMoodMatches,
  defaultCrateFilters,
  sanitizeCrateFilters,
} from "../modules/crates/crate_filters";
import {
  CRATE_DEFAULT_COUNT,
  CRATE_MAX_COUNT,
  CRATE_MIN_COUNT,
} from "../modules/crates/crate.types";

describe("defaultCrateFilters", () => {
  it("is open everywhere, with neighbours on and AI off", () => {
    expect(defaultCrateFilters()).toEqual({
      count: CRATE_DEFAULT_COUNT,
      bpm: null,
      keys: [],
      includeCamelotNeighbors: true,
      energy: null,
      requiredStems: [],
      licenseType: null,
      maxTotalUsd: null,
      maxPerItemUsd: null,
      verifiedHumanOnly: false,
      allowFullyAi: false,
      genres: [],
      moods: [],
    });
  });

  it("returns a fresh object each time", () => {
    const a = defaultCrateFilters();
    a.keys.push("8A");
    expect(defaultCrateFilters().keys).toEqual([]);
  });
});

describe("sanitizeCrateFilters", () => {
  it("accepts a fully valid filter set unchanged", () => {
    const input = {
      count: 12,
      bpm: { min: 122, max: 124 },
      keys: ["8A", "9A"],
      includeCamelotNeighbors: false,
      energy: { min: 0.65, max: 1 },
      requiredStems: ["vocals", "drums"],
      licenseType: "remix",
      maxTotalUsd: 20,
      maxPerItemUsd: 5,
      verifiedHumanOnly: true,
      allowFullyAi: true,
      genres: ["House"],
      moods: ["Club"],
    };
    expect(sanitizeCrateFilters(input)).toEqual({ filters: input, errors: [] });
  });

  it("returns the defaults for an empty object", () => {
    expect(sanitizeCrateFilters({})).toEqual({ filters: defaultCrateFilters(), errors: [] });
  });

  it.each([null, undefined, 7, "x", [], true])("returns the defaults for non-object %j", (raw) => {
    expect(sanitizeCrateFilters(raw)).toEqual({
      filters: defaultCrateFilters(),
      errors: ["invalid_filters"],
    });
  });

  it("ignores unknown keys and never copies them", () => {
    const { filters, errors } = sanitizeCrateFilters({
      count: 3,
      __proto__: { polluted: true },
      isAdmin: true,
      sql: "'; drop table",
    });
    expect(errors).toEqual([]);
    expect(Object.keys(filters).sort()).toEqual(Object.keys(defaultCrateFilters()).sort());
    expect((filters as unknown as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  describe("count", () => {
    it.each([
      [0, CRATE_MIN_COUNT],
      [-5, CRATE_MIN_COUNT],
      [1, 1],
      [8, 8],
      [25, CRATE_MAX_COUNT],
      [26, CRATE_MAX_COUNT],
      [1e9, CRATE_MAX_COUNT],
      [7.6, 8],
    ])("clamps %j to %j", (count, expected) => {
      expect(sanitizeCrateFilters({ count }).filters.count).toBe(expected);
    });

    it.each([NaN, Infinity, "8", {}, [], true])("falls back to the default for %j", (count) => {
      const result = sanitizeCrateFilters({ count });
      expect(result.filters.count).toBe(CRATE_DEFAULT_COUNT);
      expect(result.errors).toEqual(["invalid_count"]);
    });
  });

  describe("ranges", () => {
    it("clamps bpm to 30..300 and energy to 0..1", () => {
      const { filters } = sanitizeCrateFilters({
        bpm: { min: 5, max: 900 },
        energy: { min: -1, max: 4 },
      });
      expect(filters.bpm).toEqual({ min: 30, max: 300 });
      expect(filters.energy).toEqual({ min: 0, max: 1 });
    });

    it("swaps min and max when reversed", () => {
      expect(sanitizeCrateFilters({ bpm: { min: 130, max: 120 } }).filters.bpm).toEqual({
        min: 120,
        max: 130,
      });
      expect(sanitizeCrateFilters({ energy: { min: 0.9, max: 0.2 } }).filters.energy).toEqual({
        min: 0.2,
        max: 0.9,
      });
    });

    it("keeps an open side open", () => {
      expect(sanitizeCrateFilters({ bpm: { min: 120, max: null } }).filters.bpm).toEqual({
        min: 120,
        max: null,
      });
      expect(sanitizeCrateFilters({ bpm: { max: 128 } }).filters.bpm).toEqual({ min: null, max: 128 });
    });

    it("is null when both sides are open", () => {
      expect(sanitizeCrateFilters({ bpm: { min: null, max: null } }).filters.bpm).toBeNull();
      expect(sanitizeCrateFilters({ energy: {} }).filters.energy).toBeNull();
      expect(sanitizeCrateFilters({ bpm: null }).filters.bpm).toBeNull();
    });

    it("drops non-finite and non-numeric bounds with a fixed code", () => {
      const result = sanitizeCrateFilters({
        bpm: { min: NaN, max: "128" },
        energy: { min: Infinity, max: 0.5 },
      });
      expect(result.filters.bpm).toBeNull();
      expect(result.filters.energy).toEqual({ min: null, max: 0.5 });
      expect(result.errors.sort()).toEqual(["invalid_bpm", "invalid_energy"]);
    });

    it("rejects a range that is not an object", () => {
      const result = sanitizeCrateFilters({ bpm: [120, 130], energy: "high" });
      expect(result.filters.bpm).toBeNull();
      expect(result.filters.energy).toBeNull();
      expect(result.errors.sort()).toEqual(["invalid_bpm", "invalid_energy"]);
    });
  });

  describe("keys", () => {
    it("normalizes to Camelot codes, de-duplicates and keeps first-mention order", () => {
      const { filters, errors } = sanitizeCrateFilters({
        keys: ["A minor", "8a", "9A", "C major", "08A"],
      });
      expect(filters.keys).toEqual(["8A", "9A", "8B"]);
      expect(errors).toEqual([]);
    });

    it("drops invalid keys without echoing them", () => {
      const result = sanitizeCrateFilters({ keys: ["8A", "<script>alert(1)</script>", 7, null, "13A"] });
      expect(result.filters.keys).toEqual(["8A"]);
      expect(result.errors).toEqual(["invalid_key"]);
      expect(JSON.stringify(result.errors)).not.toContain("script");
    });

    it("keeps at most six", () => {
      const result = sanitizeCrateFilters({
        keys: ["1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A"],
      });
      expect(result.filters.keys).toEqual(["1A", "2A", "3A", "4A", "5A", "6A"]);
      expect(result.errors).toEqual(["too_many_keys"]);
    });

    it("rejects a non-array", () => {
      const result = sanitizeCrateFilters({ keys: "8A" });
      expect(result.filters.keys).toEqual([]);
      expect(result.errors).toEqual(["invalid_key"]);
    });
  });

  describe("requiredStems", () => {
    it("keeps only stem types, in canonical order, de-duplicated", () => {
      const { filters, errors } = sanitizeCrateFilters({
        requiredStems: ["drums", "vocals", "drums", "piano"],
      });
      expect(filters.requiredStems).toEqual(["vocals", "drums", "piano"]);
      expect(errors).toEqual([]);
    });

    it("maps acapella and friends", () => {
      const { filters } = sanitizeCrateFilters({
        requiredStems: ["Acapella", "a cappella", "vocal", "drum", "Guitars"],
      });
      expect(filters.requiredStems).toEqual(["vocals", "drums", "guitar"]);
    });

    it("drops unknown stems with a fixed code", () => {
      const result = sanitizeCrateFilters({ requiredStems: ["vocals", "original", "kazoo", 3] });
      expect(result.filters.requiredStems).toEqual(["vocals"]);
      expect(result.errors).toEqual(["invalid_stem"]);
    });
  });

  describe("licenseType", () => {
    it("accepts a license tier, case-insensitively", () => {
      expect(sanitizeCrateFilters({ licenseType: "Remix" }).filters.licenseType).toBe("remix");
    });

    it.each(["exclusive", "", 3, {}, "remix; drop"])("drops %j", (licenseType) => {
      const result = sanitizeCrateFilters({ licenseType });
      expect(result.filters.licenseType).toBeNull();
      expect(result.errors).toEqual(["invalid_license_type"]);
    });

    it("treats null as open without an error", () => {
      expect(sanitizeCrateFilters({ licenseType: null })).toEqual({
        filters: defaultCrateFilters(),
        errors: [],
      });
    });
  });

  describe("prices", () => {
    it("accepts 0..10000 and rounds to cents", () => {
      const { filters } = sanitizeCrateFilters({ maxTotalUsd: 0, maxPerItemUsd: 4.999 });
      expect(filters.maxTotalUsd).toBe(0);
      expect(filters.maxPerItemUsd).toBe(5);
      expect(sanitizeCrateFilters({ maxTotalUsd: 10_000 }).filters.maxTotalUsd).toBe(10_000);
    });

    it.each([-1, 10_001, NaN, Infinity, "20", {}, true])("drops %j", (value) => {
      const result = sanitizeCrateFilters({ maxTotalUsd: value, maxPerItemUsd: value });
      expect(result.filters.maxTotalUsd).toBeNull();
      expect(result.filters.maxPerItemUsd).toBeNull();
      expect(result.errors.sort()).toEqual(["invalid_max_per_item_usd", "invalid_max_total_usd"]);
    });
  });

  describe("booleans", () => {
    it("are strict", () => {
      const result = sanitizeCrateFilters({
        verifiedHumanOnly: "true",
        allowFullyAi: 1,
        includeCamelotNeighbors: "no",
      });
      expect(result.filters.verifiedHumanOnly).toBe(false);
      expect(result.filters.allowFullyAi).toBe(false);
      expect(result.filters.includeCamelotNeighbors).toBe(true);
      expect(result.errors.sort()).toEqual([
        "invalid_allow_fully_ai",
        "invalid_include_camelot_neighbors",
        "invalid_verified_human_only",
      ]);
    });
  });

  describe("genres and moods", () => {
    it("canonicalizes through the taste-edit vocabulary and aliases", () => {
      const { filters, errors } = sanitizeCrateFilters({
        genres: ["house", "dnb", "hip hop", "House", "Deep House"],
        moods: ["club", "late-night", "Warm"],
      });
      expect(filters.genres).toEqual(["House", "Drum & Bass", "Hip-Hop", "Deep House"]);
      expect(filters.moods).toEqual(["Club", "Late Night", "Warm"]);
      expect(errors).toEqual([]);
    });

    it("drops anything outside the vocabulary", () => {
      const result = sanitizeCrateFilters({
        genres: ["Afro House", "Made Up", "Jazz", 3],
        moods: ["Chill", "Dark"],
      });
      expect(result.filters.genres).toEqual(["Jazz"]);
      expect(result.filters.moods).toEqual(["Dark"]);
      expect(result.errors.sort()).toEqual(["invalid_genre", "invalid_mood"]);
    });

    it("keeps at most five of each", () => {
      const result = sanitizeCrateFilters({
        genres: ["Jazz", "Blues", "Rock", "Pop", "Funk", "Soul", "Folk"],
        moods: ["Focus", "Hype", "Dark", "Zen", "Club", "Warm", "Late Night"],
      });
      expect(result.filters.genres).toHaveLength(5);
      expect(result.filters.moods).toHaveLength(5);
      expect(result.errors.sort()).toEqual(["too_many_genres", "too_many_moods"]);
    });
  });

  it("is idempotent", () => {
    const first = sanitizeCrateFilters({
      count: 99,
      bpm: { min: 130, max: 120 },
      keys: ["A minor"],
      requiredStems: ["acapella"],
      genres: ["dnb"],
    }).filters;
    expect(sanitizeCrateFilters(first)).toEqual({ filters: first, errors: [] });
  });

  it("never reports the same code twice", () => {
    const result = sanitizeCrateFilters({ keys: ["x", "y", "z"], requiredStems: ["a", "b"] });
    expect(result.errors).toEqual(["invalid_key", "invalid_stem"]);
  });
});

describe("vocabulary helpers", () => {
  it("canonicalizes genres and moods", () => {
    expect(canonicalCrateGenre("drum and bass")).toBe("Drum & Bass");
    expect(canonicalCrateGenre("LO FI")).toBe("Lo-Fi");
    expect(canonicalCrateGenre("Afro House")).toBeUndefined();
    expect(canonicalCrateMood("late night")).toBe("Late Night");
    expect(canonicalCrateMood("chill")).toBeUndefined();
  });

  describe("crateGenreMatches", () => {
    it("matches case-insensitively and through aliases", () => {
      expect(crateGenreMatches("house", ["House"])).toBe(true);
      expect(crateGenreMatches("dnb", ["Drum & Bass"])).toBe(true);
      expect(crateGenreMatches("Hip Hop", ["Hip-Hop"])).toBe(true);
    });

    it("accepts a sub-genre of the requested genre, but not the reverse", () => {
      expect(crateGenreMatches("Afro House", ["House"])).toBe(true);
      expect(crateGenreMatches("Deep House", ["House"])).toBe(true);
      expect(crateGenreMatches("House", ["Deep House"])).toBe(false);
    });

    it("matches whole words only", () => {
      expect(crateGenreMatches("Trap", ["Rap"])).toBe(false);
      expect(crateGenreMatches("Warehouse", ["House"])).toBe(false);
    });

    it("matches any of several, and fails closed on missing genre", () => {
      expect(crateGenreMatches("Techno", ["House", "Techno"])).toBe(true);
      expect(crateGenreMatches(null, ["House"])).toBe(false);
      expect(crateGenreMatches("", ["House"])).toBe(false);
      expect(crateGenreMatches("Jazz", ["House"])).toBe(false);
    });
  });

  describe("crateMoodMatches", () => {
    it("matches any overlap, case-insensitively", () => {
      expect(crateMoodMatches(["club", "dark"], ["Dark"])).toBe(true);
      expect(crateMoodMatches(["late-night"], ["Late Night"])).toBe(true);
      expect(crateMoodMatches(["zen"], ["Dark"])).toBe(false);
      expect(crateMoodMatches([], ["Dark"])).toBe(false);
    });
  });
});
