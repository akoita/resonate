import {
  binaryRelevance,
  meanOverRankable,
  ndcgAtK,
  recallAtK,
} from "../modules/recommendations/rankingMetrics";

describe("recallAtK", () => {
  it("is the share of relevant ids found in the first k entries", () => {
    const ranked = ["a", "b", "c", "d", "e"];
    expect(recallAtK(ranked, ["b", "e", "z"], 3)).toBeCloseTo(1 / 3);
    expect(recallAtK(ranked, new Set(["b", "e", "z"]), 5)).toBeCloseTo(2 / 3);
    expect(recallAtK(ranked, ["a", "b"], 2)).toBe(1);
  });

  it("scores the whole list when k exceeds its length", () => {
    expect(recallAtK(["a", "b"], ["a", "b"], 50)).toBe(1);
  });

  it("returns 0 for an empty relevant set, an empty list or a non-positive k", () => {
    expect(recallAtK(["a"], [], 10)).toBe(0);
    expect(recallAtK([], ["a"], 10)).toBe(0);
    expect(recallAtK(["a"], ["a"], 0)).toBe(0);
    expect(recallAtK(["a"], ["a"], Number.NaN)).toBe(0);
  });

  it("counts a repeated id once, at its first position", () => {
    expect(recallAtK(["x", "x", "a"], ["a"], 2)).toBe(1);
    expect(recallAtK(["x", "x", "a"], ["a"], 1)).toBe(0);
  });
});

describe("ndcgAtK", () => {
  it("is 1 for the ideal binary ordering", () => {
    expect(ndcgAtK(["a", "b", "x"], binaryRelevance(["a", "b"]), 3)).toBeCloseTo(1);
  });

  it("matches a hand-computed binary value", () => {
    // relevant {a, c}; ranked [x, a, c]: DCG = 1/log2(3) + 1/log2(4); IDCG = 1 + 1/log2(3)
    const dcg = 1 / Math.log2(3) + 1 / Math.log2(4);
    const idcg = 1 + 1 / Math.log2(3);
    expect(ndcgAtK(["x", "a", "c"], binaryRelevance(["a", "c"]), 3)).toBeCloseTo(dcg / idcg, 10);
  });

  it("supports graded relevance from a map or a record", () => {
    // gains a=3, b=1: ranked [b, a]: DCG = 1 + 3/log2(3); IDCG = 3 + 1/log2(3)
    const dcg = 1 + 3 / Math.log2(3);
    const idcg = 3 + 1 / Math.log2(3);
    const expected = dcg / idcg;
    expect(
      ndcgAtK(["b", "a"], new Map([["a", 3], ["b", 1]]), 2),
    ).toBeCloseTo(expected, 10);
    expect(ndcgAtK(["b", "a"], { a: 3, b: 1 }, 2)).toBeCloseTo(expected, 10);
  });

  it("normalizes against the ideal of ALL relevant ids, truncated to k", () => {
    // Only one slot: ideal is the best single gain (3), ranked gain is 1.
    expect(ndcgAtK(["b"], { a: 3, b: 1, c: 2 }, 1)).toBeCloseTo(1 / 3, 10);
  });

  it("returns 0 with no relevant ids; k larger than the list is fine", () => {
    expect(ndcgAtK(["a"], {}, 10)).toBe(0);
    expect(ndcgAtK(["a"], { a: 1 }, 100)).toBe(1);
    expect(ndcgAtK(["a"], { a: 1 }, 0)).toBe(0);
  });

  it("ignores non-positive or non-finite gains", () => {
    expect(ndcgAtK(["a", "b"], { a: -2, b: 1 }, 2)).toBeCloseTo(1 / Math.log2(3), 10);
    expect(ndcgAtK(["a"], { a: Number.NaN }, 2)).toBe(0);
  });
});

describe("meanOverRankable", () => {
  it("skips null entries and returns null when nothing was rankable", () => {
    expect(meanOverRankable([1, null, 0])).toBe(0.5);
    expect(meanOverRankable([null, null])).toBeNull();
    expect(meanOverRankable([])).toBeNull();
  });
});
