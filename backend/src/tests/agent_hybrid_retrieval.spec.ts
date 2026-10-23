/**
 * #2242: hybrid retrieval (`hybrid_rrf_v1`). Pure unit tests: the catalog tools
 * and the lookups the policy needs are stubbed; no database. The real SQL of the
 * audio-range source is covered by agent_hybrid_retrieval.integration.spec.ts and
 * the golden set.
 */
import { Logger } from "@nestjs/common";
import {
  DEFAULT_MAX_FUSED_CANDIDATES,
  DEFAULT_RETRIEVAL_TIMEOUT_MS,
  HYBRID_RETRIEVAL_VARIANT,
  hybridRetrievalConfig,
  reciprocalRankFusion,
  RRF_K,
  runSource,
} from "../modules/agents/agent_hybrid_retrieval";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { calibratedSemanticFloor } from "../modules/agents/agent_runtime.config";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";

describe("reciprocalRankFusion", () => {
  it("scores 1 / (k + rank) per list and sums across lists", () => {
    const fused = reciprocalRankFusion([
      { source: "keyword", ids: ["a", "b", "c"] },
      { source: "semantic", ids: ["b", "a", "d"] },
    ]);
    const score = (id: string) => fused.find((entry) => entry.id === id)!.score;
    expect(RRF_K).toBe(60);
    expect(score("a")).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(score("b")).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(score("c")).toBeCloseTo(1 / 63, 12);
    expect(score("d")).toBeCloseTo(1 / 63, 12);
    expect(fused.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
    expect(fused[0].sources).toEqual(["keyword", "semantic"]);
  });

  it("ranks a track two sources agree on above one source's top pick", () => {
    const fused = reciprocalRankFusion([
      { source: "keyword", ids: ["only-keyword", "both"] },
      { source: "semantic", ids: ["both"] },
    ]);
    expect(fused.map((entry) => entry.id)).toEqual(["both", "only-keyword"]);
  });

  it("counts a track once per list and keeps ties in first-seen order", () => {
    const fused = reciprocalRankFusion([
      { source: "keyword", ids: ["x", "x", "y"] },
      { source: "seed", ids: ["z"] },
    ]);
    expect(fused.find((entry) => entry.id === "x")!.score).toBeCloseTo(1 / 61, 12);
    // y is rank 2 in its list (the duplicate is skipped, so rank counts distinct ids)
    expect(fused.find((entry) => entry.id === "y")!.score).toBeCloseTo(1 / 62, 12);
    expect(fused.map((entry) => entry.id)).toEqual(["x", "z", "y"]);
  });
});

describe("hybridRetrievalConfig", () => {
  it("defaults, and reads budgets, timeout and cap from the environment", () => {
    const defaults = hybridRetrievalConfig({});
    expect(defaults.budgets).toEqual({ keyword: 20, semantic: 20, audio_range: 20, lane: 20, seed: 20 });
    expect(defaults.timeoutMs).toBe(DEFAULT_RETRIEVAL_TIMEOUT_MS);
    expect(defaults.maxCandidates).toBe(DEFAULT_MAX_FUSED_CANDIDATES);

    const custom = hybridRetrievalConfig({
      AGENT_RETRIEVAL_BUDGETS: "keyword=8, audio_range=5,bogus=3,seed=abc,lane=999",
      AGENT_RETRIEVAL_TIMEOUT_MS: "250",
      AGENT_RETRIEVAL_MAX_CANDIDATES: "40",
    });
    expect(custom.budgets).toEqual({ keyword: 8, semantic: 20, audio_range: 5, lane: 50, seed: 20 });
    expect(custom.timeoutMs).toBe(250);
    expect(custom.maxCandidates).toBe(40);
  });
});

describe("runSource", () => {
  it("returns the value, or an error outcome without throwing", async () => {
    const ok = await runSource("keyword", async () => 42, Date.now() + 1000);
    expect(ok).toMatchObject({ status: "ok", value: 42 });
    const failed = await runSource("keyword", async () => { throw new Error("boom"); }, Date.now() + 1000);
    expect(failed).toMatchObject({ status: "error", reason: "tool_error" });
    expect(failed.value).toBeUndefined();
  });

  it("cuts off a slow source at the deadline", async () => {
    const startedAt = Date.now();
    const slow = await runSource("semantic", () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 300)), Date.now() + 50);
    expect(slow).toMatchObject({ status: "timeout", reason: "deadline_exceeded" });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("calibratedSemanticFloor", () => {
  const saved = process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
    else process.env.AGENT_SEMANTIC_MIN_SIMILARITY = saved;
  });

  it("trims the tail behind a strong match, and sits lower than the fixed floor behind a weak one", () => {
    delete process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
    expect(calibratedSemanticFloor(0.9)).toBeCloseTo(0.75, 12);
    expect(calibratedSemanticFloor(0.56)).toBeCloseTo(0.5, 12);
    // Nothing above the absolute floor: the best neighbour is below it, so nothing is kept.
    expect(0.45 >= calibratedSemanticFloor(0.45)).toBe(false);
  });

  it("lets AGENT_SEMANTIC_MIN_SIMILARITY override the absolute floor", () => {
    process.env.AGENT_SEMANTIC_MIN_SIMILARITY = "0.7";
    expect(calibratedSemanticFloor(0.72)).toBeCloseTo(0.7, 12);
  });
});

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

type Item = {
  id: string;
  title: string;
  artist?: string;
  hasListing: boolean;
  aiDisclosureLevel?: string;
  semanticScore?: number;
  release: { genre: string; title: string; moods: string[]; artistId: string };
};

function item(id: string, genre = "House", extra: Partial<Item> = {}): Item {
  return {
    id,
    title: id,
    hasListing: false,
    release: { genre, title: `${id} release`, moods: [], artistId: `artist-${id}` },
    ...extra,
  };
}

interface Stubs {
  keyword?: Item[] | (() => Promise<{ items: Item[] }>);
  semantic?: Item[] | (() => Promise<{ items: Item[]; status?: string }>);
  audio?: Item[] | (() => Promise<{ items: Item[] }>);
  seed?: Item[];
}

function build(stubs: Stubs, extras: { policy?: TasteMemoryPolicy } = {}) {
  const asRun = (value: Stubs["keyword"], status?: string) =>
    jest.fn(async () => (typeof value === "function" ? value() : { items: value ?? [], status }));
  const search = asRun(stubs.keyword);
  const semantic = asRun(stubs.semantic, "ok");
  const audio = asRun(stubs.audio);
  const seed = jest.fn(async () => ({ items: stubs.seed ?? [], status: "ok" }));
  const runs: Record<string, jest.Mock> = {
    "catalog.search": search,
    "catalog.semantic_search": semantic,
    "catalog.audio_range": audio,
    "catalog.artist_seed": seed,
  };
  const registry = {
    get: jest.fn((name: string) => ({
      run: runs[name] ?? jest.fn().mockResolvedValue({ ranked: [], status: "unavailable" }),
    })),
  };
  const tasteMemory = extras.policy
    ? {
        getPolicy: jest.fn().mockResolvedValue(extras.policy),
        canUseTasteForSocialMatching: jest.fn().mockResolvedValue(false),
      }
    : undefined;
  return {
    selector: new AgentSelectorService(
      registry as any,
      new DiscoveryRankingService(),
      undefined,
      undefined,
      tasteMemory as any,
    ),
    search, semantic, audio, seed,
  };
}

const hybrid = { retrievalVariant: HYBRID_RETRIEVAL_VARIANT } as const;

describe("AgentSelectorService hybrid retrieval (hybrid_rrf_v1)", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    for (const key of ["AGENT_RETRIEVAL_BUDGETS", "AGENT_RETRIEVAL_TIMEOUT_MS", "AGENT_RETRIEVAL_MAX_CANDIDATES", "DISCOVERY_RANKER_EXPERIMENT"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  it("fuses keyword, semantic and seed candidates and reports each source", async () => {
    const { selector, seed } = build({
      keyword: [item("k1"), item("shared")],
      semantic: [item("shared", "House", { semanticScore: 0.8 }), item("s1", "Zzyzx", { semanticScore: 0.7 })],
      seed: [item("seeded")],
    });
    const result = await selector.select({
      queries: ["House"],
      recentTrackIds: [],
      semanticQuery: "house music",
      seeds: { artists: ["Some Artist"] },
      limit: 10,
      ...hybrid,
    });
    expect([...result.candidates].sort()).toEqual(["k1", "s1", "seeded", "shared"]);
    expect(seed).toHaveBeenCalledWith(expect.objectContaining({ artists: ["Some Artist"], calibratedFloor: true }));
    expect(result.retrieval?.variant).toBe(HYBRID_RETRIEVAL_VARIANT);
    expect(result.retrieval?.sources.map((entry) => [entry.source, entry.status])).toEqual([
      ["keyword", "ok"],
      ["semantic", "ok"],
      ["audio_range", "skipped"],
      ["lane", "skipped"],
      ["seed", "ok"],
    ]);
    expect(result.retrieval?.onlyFrom).toEqual({ keyword: 1, semantic: 1, seed: 1 });
    const shared = result.selected.find((track) => track.id === "shared")!;
    expect(shared.agentRecommendation?.retrievedBy).toEqual(["keyword", "semantic"]);
  });

  it("accepts seedArtists and seeds.artists together, and ignores trackIds seeds until a runner exists", async () => {
    const { selector, seed } = build({ keyword: [item("k1")], seed: [] });
    const result = await selector.select({
      queries: ["House"],
      recentTrackIds: [],
      seedArtists: ["A"],
      seeds: { artists: ["B", "A"], trackIds: ["t1"] },
      ...hybrid,
    });
    expect(seed).toHaveBeenCalledWith(expect.objectContaining({ artists: ["B", "A"] }));
    expect(result.candidates).toEqual(["k1"]);
  });

  it("caps each source at its own budget", async () => {
    process.env.AGENT_RETRIEVAL_BUDGETS = "keyword=3,semantic=2";
    const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => item(`${prefix}${i}`));
    const { selector, search, semantic } = build({ keyword: many("k", 10), semantic: many("s", 10) });
    const result = await selector.select({ queries: ["House"], recentTrackIds: [], semanticQuery: "house", limit: 20, ...hybrid });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
    expect(semantic).toHaveBeenCalledWith(expect.objectContaining({ limit: 2, calibratedFloor: true }));
    expect(result.candidates.sort()).toEqual(["k0", "k1", "k2", "s0", "s1"]);
    expect(result.retrieval?.sources.find((entry) => entry.source === "keyword")?.candidates).toBe(3);
  });

  it("caps the fused list, keeping the best fused ranks", async () => {
    process.env.AGENT_RETRIEVAL_MAX_CANDIDATES = "2";
    const { selector } = build({
      keyword: [item("a"), item("b"), item("c")],
      semantic: [item("c", "House", { semanticScore: 0.9 })],
    });
    const result = await selector.select({ queries: ["House"], recentTrackIds: [], semanticQuery: "house", limit: 5, ...hybrid });
    expect(result.retrieval).toMatchObject({ fused: 2, truncated: 1 });
    expect(result.candidates).toHaveLength(2);
  });

  it("fails open: a failing source removes only its own candidates, logged with a reason code", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { selector } = build({
      keyword: [item("k1")],
      semantic: async () => { throw new Error("secret detail"); },
    });
    const result = await selector.select({ queries: ["House"], recentTrackIds: [], semanticQuery: "house", ...hybrid });
    expect(result.candidates).toEqual(["k1"]);
    expect(result.retrieval?.sources.find((entry) => entry.source === "semantic")).toMatchObject({
      status: "error",
      reason: "tool_error",
      candidates: 0,
    });
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("semantic error: tool_error");
    expect(logged).not.toContain("secret detail");
  });

  it("cuts a slow source off at the retrieval latency budget and keeps the rest", async () => {
    process.env.AGENT_RETRIEVAL_TIMEOUT_MS = "100";
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { selector } = build({
      keyword: [item("k1")],
      semantic: () => new Promise(() => undefined), // never answers
    });
    const startedAt = Date.now();
    const result = await selector.select({ queries: ["House"], recentTrackIds: [], semanticQuery: "house", ...hybrid });
    expect(Date.now() - startedAt).toBeLessThan(1500);
    expect(result.candidates).toEqual(["k1"]);
    expect(result.retrieval?.sources.find((entry) => entry.source === "semantic")).toMatchObject({
      status: "timeout",
      reason: "deadline_exceeded",
    });
  });

  it("throws when every source that ran failed, instead of reporting an unmet request", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { selector } = build({ keyword: async () => { throw new Error("db down"); } });
    await expect(
      selector.select({ queries: ["House"], recentTrackIds: [], ...hybrid }),
    ).rejects.toThrow(/every source failed/);
  });

  it("retrieves by measured audio features when the request names energy or tempo and no genre", async () => {
    const { selector, audio } = build({ keyword: [], audio: [item("quiet", "Ambient")] });
    const result = await selector.select({
      queries: ["Calm"],
      recentTrackIds: [],
      energy: "low",
      tempoBpm: { min: 60, max: 80 },
      allowExplicit: false,
      ...hybrid,
    });
    expect(audio).toHaveBeenCalledWith(
      expect.objectContaining({ energy: "low", tempoBpm: { min: 60, max: 80 }, allowExplicit: false }),
    );
    expect(result.candidates).toEqual(["quiet"]);
    const pick = result.selected[0];
    expect(pick.agentRecommendation?.retrievedBy).toEqual(["audio_range"]);
    expect(pick.agentRecommendation?.explanation).toContain("Found by its measured energy or tempo, not by a tag.");
    expect(result.retrieval?.onlyFrom).toEqual({ audio_range: 1 });
  });

  it("never widens a genre request with audio-range tracks, and an unmet request stays unmet", async () => {
    const { selector, audio } = build({ keyword: [], audio: [item("quiet", "Ambient")] });
    const result = await selector.select({
      queries: ["Gregorian Chant"],
      requestedTerms: ["Gregorian Chant"],
      requestedGenres: ["Gregorian Chant"],
      recentTrackIds: ["played"],
      energy: "low",
      fallback: true,
      ...hybrid,
    });
    expect(audio).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
    expect(result.reason).toBe("no_matching_taste_candidates");
    expect(result.fallback).toBeUndefined();
    expect(result.retrieval?.sources.find((entry) => entry.source === "audio_range")).toMatchObject({
      status: "skipped",
      reason: "not_requested",
    });
  });

  it("does not call the audio-range source when the request has no energy or tempo", async () => {
    const { selector, audio } = build({ keyword: [item("k1")] });
    await selector.select({ queries: ["House"], recentTrackIds: [], ...hybrid });
    expect(audio).not.toHaveBeenCalled();
  });

  it("leaves the six rules, the AI-promotion filter and the diversity cap authoritative after fusion", async () => {
    const policy = {
      settings: { socialMatchingEnabled: false, citySceneDiscoveryEnabled: false, agentPlaybackTrainingEnabled: true, recommendationExplanationPreference: "balanced", resetAt: null },
      hidden: new Map([["genre", new Set(["polka"])]]),
      downranked: new Map(),
      boosted: new Map(),
    } as unknown as TasteMemoryPolicy;
    const sameArtist = (id: string) => item(id, "Ambient", { artist: "Same Act", release: { genre: "Ambient", title: id, moods: [], artistId: "same" } });
    const { selector } = build(
      {
        keyword: [],
        audio: [
          item("hidden", "Polka"),
          item("ai", "Ambient", { aiDisclosureLevel: "ALL" }),
          sameArtist("same1"),
          sameArtist("same2"),
          sameArtist("same3"),
          item("other", "Ambient"),
        ],
      },
      { policy },
    );
    const result = await selector.select({
      userId: "u1",
      queries: [],
      recentTrackIds: [],
      energy: "low",
      limit: 10,
      ...hybrid,
    });
    const picked = result.selected.map((track) => track.id);
    expect(picked).not.toContain("hidden");
    expect(picked).not.toContain("ai");
    expect(picked.filter((id) => id.startsWith("same"))).toHaveLength(2);
    expect(picked).toContain("other");
    expect(result.policy?.dropped.hidden).toBeGreaterThanOrEqual(1);
  });

  it("searches lane terms the keyword source did not, under the lane budget", async () => {
    process.env.AGENT_RETRIEVAL_BUDGETS = "lane=4";
    const { selector, search } = build({ keyword: [item("k1", "Jazz")] });
    await selector.select({
      queries: ["Jazz"],
      recentTrackIds: [],
      limit: 5,
      myMixPlan: {
        lanes: [{
          id: "lane_jazz", label: "Jazz", genreWeights: { Jazz: 3, Bebop: 2 }, moodWeights: { Warm: 1 },
          strength: 1, contexts: {}, energyBand: null, requested: 5, boost: false, addition: false, allocationWeight: 1,
        }],
      },
      ...hybrid,
    });
    const queried = search.mock.calls.map((call) => (call as unknown as [{ query: string; limit: number }])[0]);
    expect(queried.filter((input) => input.query === "Jazz")).toHaveLength(1);
    expect(queried).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: "Bebop", limit: 4 }),
      expect.objectContaining({ query: "Warm", limit: 4 }),
    ]));
  });

  describe("variant selection (#2005)", () => {
    it("uses the default path unless the listener's ranker variant is hybrid_rrf_v1", async () => {
      const { selector, audio } = build({ keyword: [item("k1")], audio: [item("quiet")] });
      delete process.env.DISCOVERY_RANKER_EXPERIMENT;
      const legacy = await selector.select({ userId: "u1", queries: ["House"], recentTrackIds: [], energy: "low" });
      expect(legacy.retrieval).toBeUndefined();
      expect(audio).not.toHaveBeenCalled();

      process.env.DISCOVERY_RANKER_EXPERIMENT = `hybrid_retrieval_1:${HYBRID_RETRIEVAL_VARIANT}=100`;
      const fused = await selector.select({ userId: "u1", queries: ["House"], recentTrackIds: [], energy: "low" });
      expect(fused.retrieval?.variant).toBe(HYBRID_RETRIEVAL_VARIANT);

      process.env.DISCOVERY_RANKER_EXPERIMENT = `hybrid_retrieval_1:${HYBRID_RETRIEVAL_VARIANT}=0`;
      const holdout = await selector.select({ userId: "u1", queries: ["House"], recentTrackIds: [] });
      expect(holdout.retrieval).toBeUndefined();
    });
  });
});
