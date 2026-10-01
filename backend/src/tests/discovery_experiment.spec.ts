import {
  assignDiscoveryVariant,
  BASELINE_VARIANT,
  discoveryBucket,
  discoveryVariantForUser,
  parseDiscoveryExperiment,
} from "../modules/recommendations/discovery_experiment";

describe("parseDiscoveryExperiment", () => {
  it("parses key:variant=pct,variant=pct", () => {
    expect(parseDiscoveryExperiment("ranker_v2:candidate=10, holdout=5")).toEqual({
      key: "ranker_v2",
      variants: [
        { name: "candidate", percent: 10 },
        { name: "holdout", percent: 5 },
      ],
    });
  });

  it.each([
    undefined,
    "",
    "   ",
    "nokey",
    ":a=10",
    "k:",
    "k:a",
    "k:a=",
    "k:a=abc",
    "k:a=-5",
    "k:a=101",
    "k:a=60,b=50",
    "k:a=10,a=10",
    "k:baseline=10",
    "K!:a=10",
    "k:a=10=5",
    '{"key":"k"}',
  ])("treats %p as no experiment", (raw) => {
    expect(parseDiscoveryExperiment(raw as string | undefined)).toBeNull();
  });
});

describe("assignDiscoveryVariant", () => {
  const config = parseDiscoveryExperiment("exp:candidate=20,holdout=10");

  it("is deterministic per user and key", () => {
    const first = assignDiscoveryVariant("user-1", config);
    expect(assignDiscoveryVariant("user-1", config)).toEqual(first);
    expect(discoveryBucket("exp", "user-1")).toBe(discoveryBucket("exp", "user-1"));
    expect(first.experimentKey).toBe("exp");
  });

  it("keeps every bucket in [0, 100) and allocates close to the configured shares", () => {
    const counts: Record<string, number> = { candidate: 0, holdout: 0, baseline: 0 };
    const total = 20000;
    for (let index = 0; index < total; index += 1) {
      const bucket = discoveryBucket("exp", `user-${index}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
      counts[assignDiscoveryVariant(`user-${index}`, config).rankerVariant] += 1;
    }
    expect(counts.candidate / total).toBeGreaterThan(0.18);
    expect(counts.candidate / total).toBeLessThan(0.22);
    expect(counts.holdout / total).toBeGreaterThan(0.08);
    expect(counts.holdout / total).toBeLessThan(0.12);
    expect(counts.baseline / total).toBeGreaterThan(0.68);
    expect(counts.baseline / total).toBeLessThan(0.72);
  });

  it("reshuffles users when the experiment key changes", () => {
    const moved = Array.from({ length: 200 }, (_, index) => `user-${index}`).filter(
      (id) => discoveryBucket("exp", id) !== discoveryBucket("other", id),
    );
    expect(moved.length).toBeGreaterThan(100);
  });

  it("puts everyone in baseline with no experiment key when unconfigured", () => {
    expect(assignDiscoveryVariant("user-1", null)).toEqual({
      rankerVariant: BASELINE_VARIANT,
      experimentKey: null,
    });
  });

  it("gives an unknown listener baseline without throwing", () => {
    expect(assignDiscoveryVariant(undefined, config).rankerVariant).toBe(BASELINE_VARIANT);
  });

  it("sends 0% and 100% variants to nobody and everybody", () => {
    const none = parseDiscoveryExperiment("x:a=0");
    const all = parseDiscoveryExperiment("x:a=100");
    for (let index = 0; index < 50; index += 1) {
      expect(assignDiscoveryVariant(`u${index}`, none).rankerVariant).toBe(BASELINE_VARIANT);
      expect(assignDiscoveryVariant(`u${index}`, all).rankerVariant).toBe("a");
    }
  });
});

describe("discoveryVariantForUser", () => {
  it("reads DISCOVERY_RANKER_EXPERIMENT and falls back to baseline on bad config", () => {
    expect(discoveryVariantForUser("u1", {})).toEqual({
      rankerVariant: BASELINE_VARIANT,
      experimentKey: null,
    });
    expect(discoveryVariantForUser("u1", { DISCOVERY_RANKER_EXPERIMENT: "garbage" })).toEqual({
      rankerVariant: BASELINE_VARIANT,
      experimentKey: null,
    });
    expect(discoveryVariantForUser("u1", { DISCOVERY_RANKER_EXPERIMENT: "x:a=100" })).toEqual({
      rankerVariant: "a",
      experimentKey: "x",
    });
  });
});
