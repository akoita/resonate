import { describe, expect, it } from "vitest";
import {
  canMoveLine,
  coverageSummary,
  crateErrorCode,
  crateErrorMessage,
  describeTransition,
  filterChips,
  harmonicRelation,
  itemsChanged,
  moveLine,
  patchItemsPayload,
  readCrateCreationNotes,
  removeChip,
  removeLine,
  storeCrateCreationNotes,
  toggleLock,
  transitionFacts,
  withBpmRange,
  type CrateFilters,
  type CrateItemDto,
} from "./crates";

function line(trackId: string, overrides: Partial<CrateItemDto> = {}): CrateItemDto {
  return {
    position: 0,
    locked: false,
    trackId,
    title: `Track ${trackId}`,
    artistId: null,
    artistName: null,
    available: true,
    tempoBpm: 124,
    camelot: "8A",
    energy: 0.5,
    stemTypes: [],
    listedLicenseTypes: [],
    indicativePriceUsd: {},
    linePriceUsd: null,
    verifiedHuman: false,
    aiDisclosureLevel: null,
    transitionToNext: null,
    originalStemId: null,
    stems: [],
    licenseOptions: [],
    ...overrides,
  };
}

function crate(ids: string, locked = ""): CrateItemDto[] {
  return ids.split("").map((id, position) => line(id, { position, locked: locked.includes(id) }));
}

const order = (items: CrateItemDto[]) => items.map((item) => item.trackId).join("");

const baseFilters: CrateFilters = {
  count: 8,
  bpm: null,
  keys: [],
  includeCamelotNeighbors: false,
  energy: null,
  requiredStems: [],
  licenseType: null,
  maxTotalUsd: null,
  maxPerItemUsd: null,
  verifiedHumanOnly: false,
  allowFullyAi: false,
  genres: [],
  moods: [],
};

describe("moveLine", () => {
  it("moves an unlocked line and renumbers positions", () => {
    const next = moveLine(crate("abcd"), 0, 2);
    expect(order(next)).toBe("bcad");
    expect(next.map((item) => item.position)).toEqual([0, 1, 2, 3]);
  });

  it("refuses to move a locked line", () => {
    const items = crate("abcd", "b");
    expect(moveLine(items, 1, 2)).toBe(items);
    expect(canMoveLine(items, 1, 1)).toBe(false);
  });

  it("never displaces locked lines from their positions", () => {
    const items = crate("abcde", "b");
    // Moving "a" down one step jumps over the locked "b".
    const down = moveLine(items, 0, 1);
    expect(order(down)).toBe("cbade");
    expect(down[1].trackId).toBe("b");
    expect(down[1].position).toBe(1);
    // Moving "e" up one step swaps it with "d".
    const up = moveLine(items, 4, 3);
    expect(order(up)).toBe("abced");
    // Dragging across several slots keeps every locked line where it was.
    const far = moveLine(crate("abcdef", "bd"), 0, 5);
    expect(order(far)).toBe("cbedfa");
    expect(far[1].trackId).toBe("b");
    expect(far[3].trackId).toBe("d");
  });

  it("does nothing when no free slot lies in that direction", () => {
    const items = crate("abc", "bc");
    expect(moveLine(items, 0, 1)).toBe(items);
    expect(canMoveLine(items, 0, 1)).toBe(false);
  });

  it("ignores out-of-range and same-slot moves", () => {
    const items = crate("abc");
    expect(moveLine(items, 0, 0)).toBe(items);
    expect(moveLine(items, 0, -1)).toBe(items);
    expect(moveLine(items, 2, 3)).toBe(items);
    expect(canMoveLine(items, 0, -1)).toBe(false);
    expect(canMoveLine(items, 2, 1)).toBe(false);
    expect(canMoveLine(items, 1, 1)).toBe(true);
  });
});

describe("toggleLock, removeLine and patch payload", () => {
  it("toggles one line's lock without touching others", () => {
    const locked = toggleLock(crate("abc"), "b");
    expect(locked.map((item) => item.locked)).toEqual([false, true, false]);
    expect(toggleLock(locked, "b").map((item) => item.locked)).toEqual([false, false, false]);
  });

  it("removes a line and renumbers", () => {
    const next = removeLine(crate("abc"), "b");
    expect(order(next)).toBe("ac");
    expect(next.map((item) => item.position)).toEqual([0, 1]);
  });

  it("sends the full new order with lock state and no extra fields", () => {
    expect(patchItemsPayload(crate("abc", "b"))).toEqual([
      { trackId: "a", locked: false },
      { trackId: "b", locked: true },
      { trackId: "c", locked: false },
    ]);
  });

  it("detects order, lock and membership changes", () => {
    const saved = crate("abc");
    expect(itemsChanged(saved, crate("abc"))).toBe(false);
    expect(itemsChanged(saved, crate("acb"))).toBe(true);
    expect(itemsChanged(saved, crate("ab"))).toBe(true);
    expect(itemsChanged(saved, toggleLock(saved, "a"))).toBe(true);
  });
});

describe("filter chips", () => {
  const filters: CrateFilters = {
    ...baseFilters,
    bpm: { min: 120, max: 126 },
    keys: ["8A", "9A"],
    includeCamelotNeighbors: true,
    energy: { min: 0.6, max: null },
    requiredStems: ["vocals"],
    licenseType: "remix",
    maxPerItemUsd: 20,
    verifiedHumanOnly: true,
    genres: ["house"],
    moods: ["dark"],
  };

  it("labels every active filter", () => {
    const labels = filterChips(filters).map((chip) => chip.label);
    expect(labels).toEqual([
      "120-126 BPM",
      "Key 8A",
      "Key 9A",
      "Neighboring keys included",
      "Energy 60+%",
      "Has vocals stem",
      "Remix license",
      "Up to $20.00 per line",
      "Verified human artists only",
      "House",
      "Dark mood",
    ]);
  });

  it("shows no chips for an unfiltered crate", () => {
    expect(filterChips(baseFilters)).toEqual([]);
  });

  it("removes a chip without mutating the original", () => {
    const next = removeChip(filters, "bpm");
    expect(next.bpm).toBeNull();
    expect(filters.bpm).toEqual({ min: 120, max: 126 });
    expect(removeChip(filters, "stem:vocals").requiredStems).toEqual([]);
    expect(removeChip(filters, "genre:house").genres).toEqual([]);
    expect(removeChip(filters, "mood:dark").moods).toEqual([]);
    expect(removeChip(filters, "licenseType").licenseType).toBeNull();
    expect(removeChip(filters, "maxPerItemUsd").maxPerItemUsd).toBeNull();
    expect(removeChip(filters, "verifiedHumanOnly").verifiedHumanOnly).toBe(false);
    expect(removeChip(filters, "energy").energy).toBeNull();
    expect(removeChip(filters, "nonsense")).toBe(filters);
  });

  it("turns neighbors off when the last key is removed", () => {
    const one = removeChip(filters, "key:8A");
    expect(one.keys).toEqual(["9A"]);
    expect(one.includeCamelotNeighbors).toBe(true);
    const none = removeChip(one, "key:9A");
    expect(none.keys).toEqual([]);
    expect(none.includeCamelotNeighbors).toBe(false);
  });

  it("sets or clears the BPM range", () => {
    expect(withBpmRange(baseFilters, 100, null).bpm).toEqual({ min: 100, max: null });
    expect(withBpmRange(filters, null, null).bpm).toBeNull();
  });
});

describe("coverageSummary", () => {
  it("says how many were found and what held lines back", () => {
    const summary = coverageSummary({
      requested: 8,
      found: 3,
      gaps: [
        { filter: "bpm", wouldAdd: 2 },
        { filter: "requiredStems", wouldAdd: 1 },
        { filter: "genres", wouldAdd: 0 },
      ],
    });
    expect(summary.headline).toBe("3 of 8 found");
    expect(summary.complete).toBe(false);
    expect(summary.gaps).toEqual(["BPM range held back 2", "Required stems held back 1"]);
  });

  it("reports a full crate with no gaps", () => {
    const summary = coverageSummary({ requested: 8, found: 8, gaps: [] });
    expect(summary).toEqual({ headline: "8 of 8 found", complete: true, gaps: [] });
  });
});

describe("transition facts", () => {
  it("relates keys on the Camelot wheel", () => {
    expect(harmonicRelation("8A", "8A")).toBe("same");
    expect(harmonicRelation("8A", "8B")).toBe("neighbor");
    expect(harmonicRelation("8A", "9A")).toBe("neighbor");
    expect(harmonicRelation("12A", "1A")).toBe("neighbor");
    expect(harmonicRelation("8A", "3B")).toBe("clash");
    expect(harmonicRelation("8A", null)).toBe("unknown");
    expect(harmonicRelation("nope", "8A")).toBe("unknown");
  });

  it("derives deltas and describes them", () => {
    const facts = transitionFacts(
      { camelot: "8A", tempoBpm: 124, energy: 0.5 },
      { camelot: "9A", tempoBpm: 126.4, energy: 0.62 },
    );
    expect(facts).toEqual({ harmonic: "neighbor", bpmDelta: 2.4, energyDelta: 0.12 });
    expect(describeTransition(facts)).toBe("Neighboring key, +2.4 BPM, energy +12%");
    expect(
      describeTransition(
        transitionFacts(
          { camelot: null, tempoBpm: null, energy: null },
          { camelot: "8A", tempoBpm: 120, energy: 0.4 },
        ),
      ),
    ).toBe("Key unknown");
  });
});

describe("creation notes handoff", () => {
  function memoryStore() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  }

  it("round-trips coverage and unparsed phrases by crate id", () => {
    const store = memoryStore();
    storeCrateCreationNotes(
      "c1",
      {
        coverage: { requested: 8, found: 3, gaps: [{ filter: "bpm", wouldAdd: 2 }] },
        request: { id: "r1", source: "text", parserStrategy: "deterministic", unparsed: ["spicy"] },
      },
      store,
    );
    expect(readCrateCreationNotes("c1", store)?.unparsed).toEqual(["spicy"]);
    expect(readCrateCreationNotes("c2", store)).toBeNull();
  });

  it("is safe without storage", () => {
    expect(readCrateCreationNotes("c1", null)).toBeNull();
  });
});

describe("error helpers", () => {
  it("reads the backend code and message", () => {
    const error = { message: "API 403", status: 403, details: { code: "pro_required", message: "x" } };
    expect(crateErrorCode(error)).toBe("pro_required");
    expect(crateErrorMessage(error, "fallback")).toBe("This needs Crate Digger Pro.");
    expect(crateErrorMessage({ details: { message: "Too long" } }, "fallback")).toBe("Too long");
    expect(crateErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
