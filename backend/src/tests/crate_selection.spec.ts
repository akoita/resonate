/**
 * Crate Digger filter evaluation, selection and coverage (#1962) — pure unit
 * tests. Unknown facts must never satisfy a filter.
 */
import {
  activeCrateFilterKeys,
  computeCoverage,
  failedFilters,
  isExcludedAsFullyAi,
  linePriceUsd,
  selectCrateLines,
  selectCrateLinesWithStats,
} from "../modules/crates/crate_selection";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import type {
  CrateCandidateFacts,
  CrateFilters,
} from "../modules/crates/crate.types";

let sequence = 0;
function facts(overrides: Partial<CrateCandidateFacts> = {}): CrateCandidateFacts {
  sequence += 1;
  return {
    trackId: `track-${sequence}`,
    artistId: `artist-${sequence}`,
    genre: "House",
    moods: ["Club"],
    aiDisclosureLevel: null,
    tempoBpm: 124,
    camelot: "8A",
    energy: 0.7,
    stemTypes: ["vocals", "drums", "bass"],
    listedLicenseTypes: ["personal", "remix"],
    indicativePriceUsd: { personal: 2, remix: 5, commercial: 12 },
    verifiedHuman: true,
    ...overrides,
  };
}
function filters(overrides: Partial<CrateFilters> = {}): CrateFilters {
  return { ...defaultCrateFilters(), ...overrides };
}
const line = (overrides: Partial<CrateCandidateFacts> = {}) => ({ facts: facts(overrides) });

describe("failedFilters", () => {
  it("fails nothing for open filters, whatever the facts", () => {
    expect(failedFilters(facts(), filters())).toEqual([]);
    expect(
      failedFilters(
        facts({ tempoBpm: null, camelot: null, energy: null, genre: null, moods: [] }),
        filters(),
      ),
    ).toEqual([]);
  });

  describe("bpm", () => {
    const f = filters({ bpm: { min: 122, max: 126 } });
    it("passes inside the range, inclusive of both ends", () => {
      expect(failedFilters(facts({ tempoBpm: 124 }), f)).toEqual([]);
      expect(failedFilters(facts({ tempoBpm: 122 }), f)).toEqual([]);
      expect(failedFilters(facts({ tempoBpm: 126 }), f)).toEqual([]);
    });
    it("fails outside the range", () => {
      expect(failedFilters(facts({ tempoBpm: 121.9 }), f)).toEqual(["bpm"]);
      expect(failedFilters(facts({ tempoBpm: 126.1 }), f)).toEqual(["bpm"]);
    });
    it("fails an unknown tempo", () => {
      expect(failedFilters(facts({ tempoBpm: null }), f)).toEqual(["bpm"]);
      expect(failedFilters(facts({ tempoBpm: NaN }), f)).toEqual(["bpm"]);
    });
    it("honours an open side", () => {
      expect(failedFilters(facts({ tempoBpm: 200 }), filters({ bpm: { min: 120, max: null } }))).toEqual([]);
      expect(failedFilters(facts({ tempoBpm: 100 }), filters({ bpm: { min: null, max: 130 } }))).toEqual([]);
      expect(failedFilters(facts({ tempoBpm: 140 }), filters({ bpm: { min: null, max: 130 } }))).toEqual(["bpm"]);
    });
    it("treats a range with both sides open as inactive", () => {
      expect(failedFilters(facts({ tempoBpm: null }), filters({ bpm: { min: null, max: null } }))).toEqual([]);
    });
  });

  describe("keys", () => {
    it("accepts the requested key and, by default, its neighbours", () => {
      const f = filters({ keys: ["8A"] });
      for (const camelot of ["8A", "8B", "7A", "9A"]) {
        expect(failedFilters(facts({ camelot }), f)).toEqual([]);
      }
      for (const camelot of ["9B", "1A", "3B"]) {
        expect(failedFilters(facts({ camelot }), f)).toEqual(["keys"]);
      }
    });
    it("wraps around the wheel", () => {
      const f = filters({ keys: ["12A"] });
      expect(failedFilters(facts({ camelot: "1A" }), f)).toEqual([]);
      expect(failedFilters(facts({ camelot: "11A" }), f)).toEqual([]);
    });
    it("accepts only the exact key with neighbours off", () => {
      const f = filters({ keys: ["8A"], includeCamelotNeighbors: false });
      expect(failedFilters(facts({ camelot: "8A" }), f)).toEqual([]);
      expect(failedFilters(facts({ camelot: "9A" }), f)).toEqual(["keys"]);
    });
    it("accepts any of several keys", () => {
      const f = filters({ keys: ["8A", "3B"], includeCamelotNeighbors: false });
      expect(failedFilters(facts({ camelot: "3B" }), f)).toEqual([]);
    });
    it("fails an unknown or malformed key", () => {
      const f = filters({ keys: ["8A"] });
      expect(failedFilters(facts({ camelot: null }), f)).toEqual(["keys"]);
      expect(failedFilters(facts({ camelot: "A minor" }), f)).toEqual(["keys"]);
    });
    it("reads a stored code in any case or padding", () => {
      expect(failedFilters(facts({ camelot: "08a" }), filters({ keys: ["8A"], includeCamelotNeighbors: false }))).toEqual([]);
    });
  });

  describe("energy", () => {
    const f = filters({ energy: { min: 0.65, max: 1 } });
    it("passes inside and fails outside or unknown", () => {
      expect(failedFilters(facts({ energy: 0.65 }), f)).toEqual([]);
      expect(failedFilters(facts({ energy: 1 }), f)).toEqual([]);
      expect(failedFilters(facts({ energy: 0.64 }), f)).toEqual(["energy"]);
      expect(failedFilters(facts({ energy: null }), f)).toEqual(["energy"]);
    });
  });

  describe("requiredStems", () => {
    it("needs every requested stem", () => {
      const f = filters({ requiredStems: ["vocals", "drums"] });
      expect(failedFilters(facts({ stemTypes: ["vocals", "drums", "bass"] }), f)).toEqual([]);
      expect(failedFilters(facts({ stemTypes: ["vocals", "bass"] }), f)).toEqual(["requiredStems"]);
      expect(failedFilters(facts({ stemTypes: [] }), f)).toEqual(["requiredStems"]);
    });
    it("compares case-insensitively", () => {
      expect(failedFilters(facts({ stemTypes: ["Vocals"] }), filters({ requiredStems: ["vocals"] }))).toEqual([]);
    });
  });

  describe("licenseType", () => {
    it("passes when the tier is listed", () => {
      expect(
        failedFilters(
          facts({ listedLicenseTypes: ["remix"], indicativePriceUsd: {} }),
          filters({ licenseType: "remix" }),
        ),
      ).toEqual([]);
    });
    it("passes when the tier is priced but not listed", () => {
      expect(
        failedFilters(
          facts({ listedLicenseTypes: [], indicativePriceUsd: { remix: 5 } }),
          filters({ licenseType: "remix" }),
        ),
      ).toEqual([]);
    });
    it("fails when the tier is neither listed nor priced", () => {
      expect(
        failedFilters(
          facts({ listedLicenseTypes: ["personal"], indicativePriceUsd: { personal: 2 } }),
          filters({ licenseType: "sync" }),
        ),
      ).toEqual(["licenseType"]);
    });
    it("reads listed tiers case-insensitively", () => {
      expect(
        failedFilters(facts({ listedLicenseTypes: ["REMIX"], indicativePriceUsd: {} }), filters({ licenseType: "remix" })),
      ).toEqual([]);
    });
  });

  describe("maxPerItemUsd", () => {
    it("uses the cheapest known tier when no tier is requested", () => {
      const f = filters({ maxPerItemUsd: 2 });
      expect(failedFilters(facts({ indicativePriceUsd: { personal: 2, remix: 5 } }), f)).toEqual([]);
      expect(failedFilters(facts({ indicativePriceUsd: { remix: 5 } }), f)).toEqual(["maxPerItemUsd"]);
    });
    it("uses the requested tier's price", () => {
      const f = filters({ maxPerItemUsd: 5, licenseType: "remix" });
      expect(failedFilters(facts({ indicativePriceUsd: { personal: 1, remix: 5 } }), f)).toEqual([]);
      expect(failedFilters(facts({ indicativePriceUsd: { personal: 1, remix: 5.01 } }), f)).toEqual([
        "maxPerItemUsd",
      ]);
    });
    it("fails an unknown price: it cannot be shown to fit", () => {
      const f = filters({ maxPerItemUsd: 100 });
      expect(failedFilters(facts({ indicativePriceUsd: {} }), f)).toEqual(["maxPerItemUsd"]);
      expect(
        failedFilters(facts({ indicativePriceUsd: { personal: 1 } }), filters({ maxPerItemUsd: 100, licenseType: "sync" })),
      ).toEqual(expect.arrayContaining(["maxPerItemUsd", "licenseType"]));
    });
    it("allows a free tier under a zero limit", () => {
      expect(failedFilters(facts({ indicativePriceUsd: { personal: 0 } }), filters({ maxPerItemUsd: 0 }))).toEqual([]);
    });
    it("ignores non-finite or negative prices", () => {
      expect(
        failedFilters(facts({ indicativePriceUsd: { personal: NaN, remix: -3 } }), filters({ maxPerItemUsd: 100 })),
      ).toEqual(["maxPerItemUsd"]);
    });
  });

  describe("verifiedHumanOnly", () => {
    it("requires a verified human artist", () => {
      const f = filters({ verifiedHumanOnly: true });
      expect(failedFilters(facts({ verifiedHuman: true }), f)).toEqual([]);
      expect(failedFilters(facts({ verifiedHuman: false }), f)).toEqual(["verifiedHumanOnly"]);
    });
    it("does not care when off", () => {
      expect(failedFilters(facts({ verifiedHuman: false }), filters())).toEqual([]);
    });
  });

  describe("genres and moods", () => {
    it("matches the release genre case-insensitively, including sub-genres", () => {
      const f = filters({ genres: ["House"] });
      expect(failedFilters(facts({ genre: "house" }), f)).toEqual([]);
      expect(failedFilters(facts({ genre: "Afro House" }), f)).toEqual([]);
      expect(failedFilters(facts({ genre: "Techno" }), f)).toEqual(["genres"]);
      expect(failedFilters(facts({ genre: null }), f)).toEqual(["genres"]);
    });
    it("matches any of several genres", () => {
      expect(failedFilters(facts({ genre: "Techno" }), filters({ genres: ["House", "Techno"] }))).toEqual([]);
    });
    it("matches any mood overlap", () => {
      const f = filters({ moods: ["Dark", "Club"] });
      expect(failedFilters(facts({ moods: ["club"] }), f)).toEqual([]);
      expect(failedFilters(facts({ moods: ["Zen"] }), f)).toEqual(["moods"]);
      expect(failedFilters(facts({ moods: [] }), f)).toEqual(["moods"]);
    });
  });

  it("reports several failures in filter-key order", () => {
    const failed = failedFilters(
      facts({ tempoBpm: 100, camelot: "3B", energy: 0.1, verifiedHuman: false, genre: "Jazz", moods: [] }),
      filters({
        bpm: { min: 120, max: 130 },
        keys: ["8A"],
        energy: { min: 0.5, max: 1 },
        verifiedHumanOnly: true,
        genres: ["House"],
        moods: ["Club"],
      }),
    );
    expect(failed).toEqual(["bpm", "keys", "energy", "verifiedHumanOnly", "genres", "moods"]);
  });

  it("never evaluates maxTotalUsd per candidate", () => {
    expect(failedFilters(facts({ indicativePriceUsd: { personal: 999 } }), filters({ maxTotalUsd: 1 }))).toEqual([]);
  });

  it("is pure: same facts, same answer, nothing mutated", () => {
    const f = filters({ bpm: { min: 120, max: 130 }, keys: ["8A"] });
    const candidate = facts({ tempoBpm: 100 });
    const snapshot = JSON.stringify(candidate);
    expect(failedFilters(candidate, f)).toEqual(failedFilters(candidate, f));
    expect(JSON.stringify(candidate)).toBe(snapshot);
  });
});

describe("isExcludedAsFullyAi", () => {
  it("excludes aiDisclosureLevel ALL unless the request allows it", () => {
    expect(isExcludedAsFullyAi(facts({ aiDisclosureLevel: "ALL" }), filters())).toBe(true);
    expect(isExcludedAsFullyAi(facts({ aiDisclosureLevel: "all" }), filters())).toBe(true);
    expect(isExcludedAsFullyAi(facts({ aiDisclosureLevel: " All " }), filters())).toBe(true);
    expect(isExcludedAsFullyAi(facts({ aiDisclosureLevel: "ALL" }), filters({ allowFullyAi: true }))).toBe(false);
  });
  it("does not exclude partly-AI, none or unknown", () => {
    for (const level of ["PARTIAL", "NONE", "ASSISTED", "", null]) {
      expect(isExcludedAsFullyAi(facts({ aiDisclosureLevel: level }), filters())).toBe(false);
    }
  });
  it("is not a failed-filter key", () => {
    expect(failedFilters(facts({ aiDisclosureLevel: "ALL" }), filters())).toEqual([]);
  });
});

describe("linePriceUsd", () => {
  it("is the requested tier's price", () => {
    expect(linePriceUsd(facts({ indicativePriceUsd: { personal: 2, remix: 5 } }), filters({ licenseType: "remix" }))).toBe(5);
  });
  it("is null when the requested tier has no price", () => {
    expect(linePriceUsd(facts({ indicativePriceUsd: { personal: 2 } }), filters({ licenseType: "remix" }))).toBeNull();
  });
  it("is the cheapest known tier when none is requested", () => {
    expect(linePriceUsd(facts({ indicativePriceUsd: { commercial: 12, remix: 5, personal: 7 } }), filters())).toBe(5);
  });
  it("is null with no known price", () => {
    expect(linePriceUsd(facts({ indicativePriceUsd: {} }), filters())).toBeNull();
  });
});

describe("activeCrateFilterKeys", () => {
  it("lists only the constraining filters, in key order", () => {
    expect(activeCrateFilterKeys(filters())).toEqual([]);
    expect(
      activeCrateFilterKeys(
        filters({
          moods: ["Club"],
          maxTotalUsd: 20,
          bpm: { min: null, max: 130 },
          energy: { min: null, max: null },
          verifiedHumanOnly: true,
        }),
      ),
    ).toEqual(["bpm", "maxTotalUsd", "verifiedHumanOnly", "moods"]);
  });
});

describe("selectCrateLines", () => {
  const priced = (price: number, id: string) => ({
    id,
    facts: facts({ indicativePriceUsd: { personal: price } }),
  });

  it("takes lines in rank order up to count", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, facts: facts() }));
    const selected = selectCrateLines(lines, filters({ count: 3 }));
    expect(selected.map((l) => l.id)).toEqual(["l0", "l1", "l2"]);
  });

  it("returns fewer when fewer pass, and nothing for nothing", () => {
    const lines = [line(), line()];
    expect(selectCrateLines(lines, filters({ count: 8 }))).toHaveLength(2);
    expect(selectCrateLines([], filters())).toEqual([]);
  });

  it("ignores prices when no budget is set", () => {
    const lines = [priced(500, "a"), { id: "b", facts: facts({ indicativePriceUsd: {} }) }];
    expect(selectCrateLines(lines, filters({ count: 8 })).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("skips a line that would break the budget and keeps scanning", () => {
    const lines = [priced(8, "a"), priced(9, "b"), priced(2, "c"), priced(1, "d")];
    const { lines: selected, budgetSkipped } = selectCrateLinesWithStats(lines, filters({ count: 8, maxTotalUsd: 11 }));
    // 8 fits, 9 would make 17, 2 makes 10, 1 makes 11 (exactly the budget).
    expect(selected.map((l) => l.id)).toEqual(["a", "c", "d"]);
    expect(budgetSkipped).toBe(1);
  });

  it("allows a total exactly equal to the budget", () => {
    const lines = [priced(5, "a"), priced(5, "b"), priced(5, "c")];
    expect(selectCrateLines(lines, filters({ count: 8, maxTotalUsd: 10 })).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("skips a line with no known price while a budget is set", () => {
    const lines = [{ id: "unpriced", facts: facts({ indicativePriceUsd: {} }) }, priced(3, "a")];
    const { lines: selected, budgetSkipped } = selectCrateLinesWithStats(lines, filters({ maxTotalUsd: 100 }));
    expect(selected.map((l) => l.id)).toEqual(["a"]);
    expect(budgetSkipped).toBe(1);
  });

  it("prices each line by the requested tier", () => {
    const lines = [
      { id: "a", facts: facts({ indicativePriceUsd: { personal: 1, remix: 9 } }) },
      { id: "b", facts: facts({ indicativePriceUsd: { personal: 1, remix: 2 } }) },
    ];
    const selected = selectCrateLines(lines, filters({ licenseType: "remix", maxTotalUsd: 10 }));
    expect(selected.map((l) => l.id)).toEqual(["a"]);
  });

  it("does not drift on repeated cents", () => {
    const lines = Array.from({ length: 10 }, (_, i) => priced(0.1, `p${i}`));
    expect(selectCrateLines(lines, filters({ count: 10, maxTotalUsd: 1 }))).toHaveLength(10);
    expect(selectCrateLines(lines, filters({ count: 10, maxTotalUsd: 0.99 }))).toHaveLength(9);
  });

  it("stops scanning at count: later lines are not budget skips", () => {
    const lines = [priced(1, "a"), priced(99, "b"), priced(99, "c")];
    const { lines: selected, budgetSkipped } = selectCrateLinesWithStats(lines, filters({ count: 1, maxTotalUsd: 5 }));
    expect(selected).toHaveLength(1);
    expect(budgetSkipped).toBe(0);
  });

  it("is deterministic and does not mutate its input", () => {
    const lines = [priced(3, "a"), priced(4, "b"), priced(5, "c")];
    const copy = [...lines];
    const f = filters({ maxTotalUsd: 8 });
    expect(selectCrateLines(lines, f)).toEqual(selectCrateLines(lines, f));
    expect(lines).toEqual(copy);
  });
});

describe("computeCoverage", () => {
  it("reports a full crate with no gaps", () => {
    const all = [facts({ tempoBpm: 100 })];
    expect(computeCoverage(all, 3, filters({ count: 3, bpm: { min: 120, max: 130 } }))).toEqual({
      requested: 3,
      found: 3,
      gaps: [],
    });
    expect(computeCoverage(all, 5, filters({ count: 3 })).gaps).toEqual([]);
  });

  it("says 0 of N honestly for an empty catalog", () => {
    expect(computeCoverage([], 0, filters({ count: 8, bpm: { min: 120, max: 130 } }))).toEqual({
      requested: 8,
      found: 0,
      gaps: [],
    });
  });

  it("counts candidates that fail only that filter, capped at the missing count", () => {
    const f = filters({ count: 4, bpm: { min: 120, max: 130 }, keys: ["8A"], includeCamelotNeighbors: false });
    const all = [
      facts({ tempoBpm: 124, camelot: "8A" }), // passes (selected)
      facts({ tempoBpm: 100, camelot: "8A" }), // fails only bpm
      facts({ tempoBpm: 101, camelot: "8A" }), // fails only bpm
      facts({ tempoBpm: 124, camelot: "3B" }), // fails only keys
      facts({ tempoBpm: 100, camelot: "3B" }), // fails both: counts for neither
    ];
    expect(computeCoverage(all, 1, f)).toEqual({
      requested: 4,
      found: 1,
      gaps: [
        { filter: "bpm", wouldAdd: 2 },
        { filter: "keys", wouldAdd: 1 },
      ],
    });
  });

  it("caps wouldAdd at how many lines are missing", () => {
    const f = filters({ count: 3, bpm: { min: 120, max: 130 } });
    const all = Array.from({ length: 10 }, () => facts({ tempoBpm: 90 }));
    expect(computeCoverage(all, 2, f).gaps).toEqual([{ filter: "bpm", wouldAdd: 1 }]);
  });

  it("omits zero entries and filters that are not active", () => {
    const f = filters({ count: 4, bpm: { min: 120, max: 130 }, verifiedHumanOnly: true });
    const all = [facts({ tempoBpm: 100, verifiedHuman: true })];
    expect(computeCoverage(all, 0, f).gaps).toEqual([{ filter: "bpm", wouldAdd: 1 }]);
  });

  it("sorts largest first, ties in filter-key order", () => {
    const f = filters({ count: 8, genres: ["House"], moods: ["Club"], verifiedHumanOnly: true });
    const all = [
      facts({ genre: "Jazz" }),
      facts({ moods: ["Zen"] }),
      facts({ moods: ["Zen"] }),
      facts({ verifiedHuman: false }),
      facts({ verifiedHuman: false }),
      facts({ verifiedHuman: false }),
    ];
    expect(computeCoverage(all, 0, f).gaps).toEqual([
      { filter: "verifiedHumanOnly", wouldAdd: 3 },
      { filter: "moods", wouldAdd: 2 },
      { filter: "genres", wouldAdd: 1 },
    ]);
    const tied = computeCoverage([facts({ genre: "Jazz" }), facts({ moods: ["Zen"] })], 0, f).gaps;
    expect(tied).toEqual([
      { filter: "genres", wouldAdd: 1 },
      { filter: "moods", wouldAdd: 1 },
    ]);
  });

  it("never counts fully AI recordings the request excludes", () => {
    const f = filters({ count: 4, bpm: { min: 120, max: 130 } });
    const all = [facts({ tempoBpm: 100, aiDisclosureLevel: "ALL" }), facts({ tempoBpm: 100 })];
    expect(computeCoverage(all, 0, f).gaps).toEqual([{ filter: "bpm", wouldAdd: 1 }]);
    expect(computeCoverage(all, 0, { ...f, allowFullyAi: true }).gaps).toEqual([{ filter: "bpm", wouldAdd: 2 }]);
  });

  it("reports maxTotalUsd only when the budget really skipped lines", () => {
    const f = filters({ count: 4, maxTotalUsd: 5 });
    const all = [facts(), facts(), facts()];
    expect(computeCoverage(all, 1, f).gaps).toEqual([]);
    expect(computeCoverage(all, 1, f, 2).gaps).toEqual([{ filter: "maxTotalUsd", wouldAdd: 2 }]);
    expect(computeCoverage(all, 1, f, 10).gaps).toEqual([{ filter: "maxTotalUsd", wouldAdd: 3 }]);
    // No budget set: skipped lines (there are none) never produce a gap.
    expect(computeCoverage(all, 1, filters({ count: 4 }), 2).gaps).toEqual([]);
  });

  it("works end to end with selection", () => {
    const f = filters({ count: 4, maxTotalUsd: 10, bpm: { min: 120, max: 130 } });
    const candidates = [
      facts({ trackId: "ok-1", indicativePriceUsd: { personal: 6 } }),
      facts({ trackId: "ok-2", indicativePriceUsd: { personal: 6 } }),
      facts({ trackId: "ok-3", indicativePriceUsd: { personal: 3 } }),
      facts({ trackId: "slow", tempoBpm: 90 }),
    ];
    const passing = candidates.filter((c) => failedFilters(c, f).length === 0).map((c) => ({ facts: c }));
    const { lines, budgetSkipped } = selectCrateLinesWithStats(passing, f);
    expect(lines.map((l) => l.facts.trackId)).toEqual(["ok-1", "ok-3"]);
    expect(computeCoverage(candidates, lines.length, f, budgetSkipped)).toEqual({
      requested: 4,
      found: 2,
      gaps: [
        { filter: "bpm", wouldAdd: 1 },
        { filter: "maxTotalUsd", wouldAdd: 1 },
      ],
    });
  });
});
