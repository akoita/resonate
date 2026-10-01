import {
  evaluateRanker,
  heldOutRelevance,
  learnGenreWeights,
  popularityRanker,
  seededRandomRanker,
  splitSignalsByTime,
  type TrainingSignal,
} from "../modules/recommendations/discovery_offline_eval";

const t = (day: number) => new Date(Date.UTC(2026, 8, day));
const sig = (userId: string, trackId: string, weight: number, day: number): TrainingSignal => ({
  userId,
  trackId,
  weight,
  occurredAt: t(day),
});

describe("splitSignalsByTime", () => {
  it("holds out the latest positive tracks and keeps earlier signals as train", () => {
    const [split] = splitSignalsByTime(
      [
        sig("u", "a", 2, 1),
        sig("u", "b", -1.5, 2),
        sig("u", "c", 3, 3),
        sig("u", "d", 1, 4),
        sig("u", "e", 2, 5),
      ],
      0.4,
    );
    // positives a, c, d, e -> ceil(4 * 0.4) = 2 held out (d, e)
    expect(split.heldOut.map((s) => s.trackId)).toEqual(["d", "e"]);
    expect(split.train.map((s) => s.trackId)).toEqual(["a", "b", "c"]);
  });

  it("always keeps at least one train and one held-out track, and drops thin listeners", () => {
    const splits = splitSignalsByTime(
      [sig("u1", "a", 1, 1), sig("u1", "b", 1, 2), sig("thin", "a", 1, 1), sig("neg", "a", -1, 1), sig("neg", "b", -1, 2)],
      0.99,
    );
    expect(splits.map((s) => s.userId)).toEqual(["u1"]);
    expect(splits[0].heldOut.map((s) => s.trackId)).toEqual(["b"]);
    expect(splits[0].train.map((s) => s.trackId)).toEqual(["a"]);
  });
});

describe("heldOutRelevance and learnGenreWeights", () => {
  it("sums positive weights per track", () => {
    expect(heldOutRelevance([sig("u", "a", 2, 1), sig("u", "a", 3, 2), sig("u", "b", -1, 3)])).toEqual(
      new Map([["a", 5]]),
    );
  });

  it("learns signed genre weights clipped to the ranker's scale", () => {
    const genres = new Map<string, string | null>([["a", "House"], ["b", "House"], ["c", "Rock"], ["d", null]]);
    const weights = learnGenreWeights(
      [sig("u", "a", 5, 1), sig("u", "b", 8, 2), sig("u", "c", -1.5, 3), sig("u", "d", 3, 4)],
      genres,
    );
    expect(weights).toEqual({ House: 9, Rock: -1.5 });
  });
});

describe("evaluateRanker", () => {
  const candidates = ["a", "b", "c", "d", "e"].map((id) => ({ id, genre: null }));

  it("scores a ranker that puts the held-out track first at 1, and a worse one lower", async () => {
    const splits = splitSignalsByTime([sig("u", "a", 2, 1), sig("u", "b", 2, 2)], 0.5);
    // train = a, held-out = b, candidates exclude a
    const best = await evaluateRanker({
      splits,
      candidates,
      ranker: async () => ["b", "c", "d", "e"],
      options: { k: 2 },
    });
    expect(best).toEqual({ recallAtK: 1, ndcgAtK: 1, evaluatedUsers: 1 });

    const worst = await evaluateRanker({
      splits,
      candidates,
      ranker: async () => ["c", "d", "e", "b"],
      options: { k: 2 },
    });
    expect(worst.recallAtK).toBe(0);
    expect(worst.ndcgAtK).toBe(0);
  });

  it("never offers train tracks, skips users whose held-out tracks are outside the pool", async () => {
    const splits = splitSignalsByTime(
      [sig("u", "a", 2, 1), sig("u", "b", 2, 2), sig("v", "a", 2, 1), sig("v", "zzz", 2, 2)],
      0.5,
    );
    const seen: string[][] = [];
    const metrics = await evaluateRanker({
      splits,
      candidates,
      ranker: async ({ candidates: pool }) => {
        seen.push(pool.map((c) => c.id));
        return pool.map((c) => c.id);
      },
    });
    expect(seen.every((ids) => !ids.includes("a"))).toBe(true);
    expect(metrics.evaluatedUsers).toBe(1);
  });

  it("returns null metrics when nothing is rankable", async () => {
    const metrics = await evaluateRanker({ splits: [], candidates, ranker: async () => [] });
    expect(metrics).toEqual({ recallAtK: null, ndcgAtK: null, evaluatedUsers: 0 });
  });

  it("popularity baseline beats the seeded random floor on a popularity-driven sample", async () => {
    // Everyone's held-out track is the globally popular one.
    const signals: TrainingSignal[] = [];
    for (let user = 0; user < 40; user += 1) {
      signals.push(sig(`u${user}`, "seed", 1, 1), sig(`u${user}`, "hit", 2, 5));
    }
    // Make "hit" popular in the train history of dedicated listeners.
    for (let user = 0; user < 30; user += 1) {
      signals.push(sig(`p${user}`, "hit", 3, 1), sig(`p${user}`, "filler", 1, 5));
    }
    const pool = ["seed", "hit", "filler", "x1", "x2", "x3", "x4", "x5", "x6", "x7"].map((id) => ({ id, genre: null }));
    const splits = splitSignalsByTime(signals, 0.5);
    const popular = await evaluateRanker({ splits, candidates: pool, ranker: popularityRanker(splits), options: { k: 1 } });
    const random = await evaluateRanker({ splits, candidates: pool, ranker: seededRandomRanker(7), options: { k: 1 } });
    expect(popular.recallAtK!).toBeGreaterThan(random.recallAtK!);
  });

  it("seeded random ranking is deterministic", async () => {
    const ranker = seededRandomRanker(3);
    const input = { userId: "u", candidates, trainSignals: [], learnedGenreWeights: {} };
    expect(await ranker(input)).toEqual(await ranker(input));
  });
});
