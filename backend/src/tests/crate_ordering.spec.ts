/**
 * Crate Digger set-path ordering (#1962) — pure unit tests.
 */
import {
  HARMONIC_POINTS,
  orderCrateAsSetPath,
  transitionFacts,
} from "../modules/crates/crate_ordering";
import type { CrateCandidateFacts } from "../modules/crates/crate.types";

function entry(
  trackId: string,
  overrides: Partial<CrateCandidateFacts> = {},
  score = 0.5,
) {
  const facts: CrateCandidateFacts = {
    trackId,
    artistId: null,
    genre: "House",
    moods: [],
    aiDisclosureLevel: null,
    tempoBpm: 124,
    camelot: "8A",
    energy: 0.5,
    stemTypes: [],
    listedLicenseTypes: [],
    indicativePriceUsd: {},
    verifiedHuman: true,
    ...overrides,
  };
  return { facts, score };
}
const ids = (lines: Array<{ facts: CrateCandidateFacts }>) => lines.map((line) => line.facts.trackId);

describe("transitionFacts", () => {
  it("reports harmonic relation and signed deltas from a to b", () => {
    expect(
      transitionFacts(
        { camelot: "8A", tempoBpm: 124, energy: 0.5 },
        { camelot: "9A", tempoBpm: 126.5, energy: 0.65 },
      ),
    ).toEqual({ harmonic: "neighbor", bpmDelta: 2.5, energyDelta: 0.15 });
    expect(
      transitionFacts(
        { camelot: "8A", tempoBpm: 128, energy: 0.8 },
        { camelot: "3B", tempoBpm: 124, energy: 0.5 },
      ),
    ).toEqual({ harmonic: "clash", bpmDelta: -4, energyDelta: -0.3 });
  });

  it("is null where either side is unknown", () => {
    expect(
      transitionFacts(
        { camelot: null, tempoBpm: null, energy: null },
        { camelot: "8A", tempoBpm: 124, energy: 0.5 },
      ),
    ).toEqual({ harmonic: "unknown", bpmDelta: null, energyDelta: null });
  });

  it("rounds away float noise", () => {
    const result = transitionFacts(
      { camelot: "8A", tempoBpm: 0.1, energy: 0.1 },
      { camelot: "8A", tempoBpm: 0.3, energy: 0.3 },
    );
    expect(result.bpmDelta).toBe(0.2);
    expect(result.energyDelta).toBe(0.2);
    expect(result.harmonic).toBe("same");
  });
});

describe("HARMONIC_POINTS", () => {
  it("ranks same > neighbor > unknown > clash", () => {
    expect(HARMONIC_POINTS).toEqual({ same: 3, neighbor: 2, unknown: 1, clash: 0 });
  });
});

describe("orderCrateAsSetPath", () => {
  it("returns an empty or single list as is, as a new array", () => {
    expect(orderCrateAsSetPath([])).toEqual([]);
    const one = [entry("a")];
    const result = orderCrateAsSetPath(one);
    expect(result).toEqual(one);
    expect(result).not.toBe(one);
  });

  it("starts at the lowest-energy line", () => {
    const lines = [
      entry("peak", { energy: 0.9 }),
      entry("warm", { energy: 0.2 }),
      entry("mid", { energy: 0.5 }),
    ];
    expect(ids(orderCrateAsSetPath(lines))[0]).toBe("warm");
  });

  it("breaks a starting tie by score, then track id", () => {
    const byScore = [entry("a", { energy: 0.3 }, 0.2), entry("b", { energy: 0.3 }, 0.9)];
    expect(ids(orderCrateAsSetPath(byScore))[0]).toBe("b");
    const byId = [entry("z", { energy: 0.3 }, 0.5), entry("m", { energy: 0.3 }, 0.5)];
    expect(ids(orderCrateAsSetPath(byId))[0]).toBe("m");
  });

  it("treats an unknown energy as the median of the known ones", () => {
    const lines = [
      entry("low", { energy: 0.2 }),
      entry("unknown", { energy: null }),
      entry("high", { energy: 0.8 }),
    ];
    // Median is 0.5: the unknown track sits between the two.
    expect(ids(orderCrateAsSetPath(lines))).toEqual(["low", "unknown", "high"]);
  });

  it("builds energy upward when keys and tempo are equal", () => {
    const lines = [
      entry("e9", { energy: 0.9 }),
      entry("e3", { energy: 0.3 }),
      entry("e6", { energy: 0.6 }),
      entry("e1", { energy: 0.1 }),
    ];
    expect(ids(orderCrateAsSetPath(lines))).toEqual(["e1", "e3", "e6", "e9"]);
  });

  it("prefers harmonic neighbours over clashes at similar energy", () => {
    const lines = [
      entry("start", { energy: 0.2, camelot: "8A" }),
      entry("clash", { energy: 0.25, camelot: "3B" }),
      entry("neighbor", { energy: 0.3, camelot: "9A" }),
    ];
    expect(ids(orderCrateAsSetPath(lines))).toEqual(["start", "neighbor", "clash"]);
  });

  it("prefers the same key over a neighbour", () => {
    const lines = [
      entry("start", { energy: 0.1, camelot: "8A" }),
      entry("neighbor", { energy: 0.12, camelot: "9A" }),
      entry("same", { energy: 0.12, camelot: "8A" }),
    ];
    expect(ids(orderCrateAsSetPath(lines))[1]).toBe("same");
  });

  it("prefers a close tempo", () => {
    const lines = [
      entry("start", { energy: 0.1, tempoBpm: 124 }),
      entry("far", { energy: 0.11, tempoBpm: 140 }),
      entry("near", { energy: 0.11, tempoBpm: 125 }),
    ];
    expect(ids(orderCrateAsSetPath(lines))).toEqual(["start", "near", "far"]);
  });

  it("is neutral about an unknown tempo: between a close and a far tempo", () => {
    const lines = [
      entry("start", { energy: 0.05, tempoBpm: 124 }),
      entry("far", { energy: 0.1, tempoBpm: 140 }),
      entry("unknown", { energy: 0.1, tempoBpm: null }),
      entry("near", { energy: 0.1, tempoBpm: 125 }),
    ];
    const order = ids(orderCrateAsSetPath(lines));
    expect(order.indexOf("near")).toBeLessThan(order.indexOf("unknown"));
    expect(order.indexOf("unknown")).toBeLessThan(order.indexOf("far"));
  });

  it("avoids an energy drop when the alternative is harmonically equal", () => {
    const lines = [
      entry("start", { energy: 0.5, camelot: "8A" }),
      entry("drop", { energy: 0.1, camelot: "8A" }),
      entry("rise", { energy: 0.55, camelot: "8A" }),
    ];
    // "drop" has the lowest energy, so it opens the set; the point of the test
    // is the next step from a mid-energy line.
    expect(ids(orderCrateAsSetPath(lines))).toEqual(["drop", "start", "rise"]);
    const second = orderCrateAsSetPath([
      entry("a", { energy: 0.4 }),
      entry("down", { energy: 0.39 }),
      entry("up", { energy: 0.41 }),
    ]);
    expect(ids(second)).toEqual(["down", "a", "up"]);
  });

  it("uses rank score as a small tiebreak between otherwise equal lines", () => {
    const lines = [
      entry("start", { energy: 0.1 }, 0.5),
      entry("low-score", { energy: 0.5 }, 0.1),
      entry("high-score", { energy: 0.5 }, 0.9),
    ];
    expect(ids(orderCrateAsSetPath(lines))).toEqual(["start", "high-score", "low-score"]);
  });

  it("does not let a high score beat a harmonic clash", () => {
    const lines = [
      entry("start", { energy: 0.05, camelot: "8A" }, 0.5),
      entry("clash-star", { energy: 0.1, camelot: "3B" }, 1),
      entry("friendly", { energy: 0.1, camelot: "8B" }, 0),
    ];
    expect(ids(orderCrateAsSetPath(lines))[1]).toBe("friendly");
  });

  it("is a permutation: never adds or drops a line", () => {
    const lines = Array.from({ length: 15 }, (_, i) =>
      entry(`t${i}`, { energy: (i * 7 % 10) / 10, camelot: `${(i % 12) + 1}${i % 2 ? "A" : "B"}`, tempoBpm: 120 + (i % 5) }, i / 15),
    );
    const ordered = orderCrateAsSetPath(lines);
    expect(ids(ordered).sort()).toEqual(ids(lines).sort());
    expect(ordered).toHaveLength(lines.length);
  });

  it("is deterministic and independent of input order when ties are fully broken", () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      entry(`t${String(i).padStart(2, "0")}`, {
        energy: ((i * 3) % 11) / 11,
        camelot: `${(i * 5 % 12) + 1}${i % 3 ? "A" : "B"}`,
        tempoBpm: 118 + ((i * 7) % 13),
      }, ((i * 5) % 12) / 12 + i / 1000),
    );
    const first = ids(orderCrateAsSetPath(lines));
    expect(ids(orderCrateAsSetPath(lines))).toEqual(first);
    expect(ids(orderCrateAsSetPath([...lines].reverse()))).toEqual(first);
  });

  it("is stable for identical lines: ties keep a fixed order by track id", () => {
    const lines = ["c", "a", "b"].map((id) => entry(id, {}, 0.5));
    expect(ids(orderCrateAsSetPath(lines))).toEqual(["a", "b", "c"]);
    expect(ids(orderCrateAsSetPath([...lines].reverse()))).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input or its lines", () => {
    const lines = [entry("b", { energy: 0.9 }), entry("a", { energy: 0.1 })];
    const snapshot = JSON.stringify(lines);
    const ordered = orderCrateAsSetPath(lines);
    expect(JSON.stringify(lines)).toBe(snapshot);
    expect(ordered[0]).toBe(lines[1]);
  });

  it("keeps extra fields on each line", () => {
    const lines = [{ ...entry("a", { energy: 0.9 }), reason: "x" }, { ...entry("b", { energy: 0.1 }), reason: "y" }];
    expect(orderCrateAsSetPath(lines).map((line) => line.reason)).toEqual(["y", "x"]);
  });

  it("copes with unknown everything and non-finite scores", () => {
    const blank = { tempoBpm: null, camelot: null, energy: null };
    const lines = [
      entry("b", blank, NaN),
      entry("a", blank, Infinity),
      entry("c", blank, 0),
    ];
    const ordered = orderCrateAsSetPath(lines);
    expect(ordered).toHaveLength(3);
    expect(new Set(ids(ordered)).size).toBe(3);
  });
});
