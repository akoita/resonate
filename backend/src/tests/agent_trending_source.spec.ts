/**
 * #2246: trending as a capped hybrid retrieval source. Pure unit tests: the
 * catalog tools are stubbed, no database. The real serving-table read and the
 * request-first behaviour over Postgres are in
 * agent_trending_source.integration.spec.ts.
 */
import {
  capSourceShare,
  HYBRID_RETRIEVAL_VARIANT,
  hybridRetrievalConfig,
  type FusedEntry,
  type RetrievalSource,
} from "../modules/agents/agent_hybrid_retrieval";
import { shapePickNote } from "../modules/agents/agent_pick_notes";
import { requestScopeFor } from "../modules/agents/agent_session_request";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import {
  admitTrendingTrack,
  TRENDING_MAX_FAMILIES,
  trendingFamiliesFor,
} from "../modules/agents/agent_trending_source";
import { isTrendingExplanation, trendingExplanation } from "../modules/recommendations/discovery-explanations";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const entry = (id: string, ...sources: RetrievalSource[]): FusedEntry => ({ id, score: 1, sources });
const ids = (entries: readonly FusedEntry[]) => entries.map((e) => e.id);

describe("capSourceShare (the 20% cap)", () => {
  it("keeps trending-only finds to at most a fifth of the kept list, best first", () => {
    const fused = [
      ...Array.from({ length: 8 }, (_, i) => entry(`k${i}`, "keyword")),
      ...Array.from({ length: 6 }, (_, i) => entry(`t${i}`, "trending")),
    ];
    const { kept, capped } = capSourceShare(fused, "trending", 20, 150);
    // 8 others -> at most 2 trending-only: 2 / (8 + 2) = 20%.
    expect(ids(kept).filter((id) => id.startsWith("t"))).toEqual(["t0", "t1"]);
    expect(kept).toHaveLength(10);
    expect(capped).toBe(4);
  });

  it("never counts or cuts a track another source also returned", () => {
    const fused = [entry("both", "keyword", "trending"), entry("k1", "keyword"), entry("t1", "trending")];
    const { kept, capped } = capSourceShare(fused, "trending", 20, 150);
    expect(ids(kept)).toEqual(["both", "k1"]);
    expect(capped).toBe(1);
  });

  it("keeps the fused order, and holds the share when the list is cut at the maximum", () => {
    const fused = [
      entry("t0", "trending"),
      ...Array.from({ length: 30 }, (_, i) => entry(`k${i}`, "keyword")),
      ...Array.from({ length: 30 }, (_, i) => entry(`t${i + 1}`, "trending")),
    ];
    const { kept } = capSourceShare(fused, "trending", 20, 10);
    expect(kept).toHaveLength(10);
    expect(ids(kept).filter((id) => id.startsWith("t")).length).toBeLessThanOrEqual(2);
    expect(ids(kept)[0]).toBe("t0");
  });

  it("adds nothing when nothing else was found, or when the cap is 0", () => {
    expect(capSourceShare([entry("t0", "trending")], "trending", 20, 150).kept).toEqual([]);
    expect(capSourceShare([entry("k0", "keyword"), entry("t0", "trending")], "trending", 0, 150).kept).toHaveLength(1);
  });

  it("changes nothing without a trending-only entry (only the maximum applies)", () => {
    const fused = Array.from({ length: 5 }, (_, i) => entry(`k${i}`, "keyword"));
    expect(capSourceShare(fused, "trending", 20, 3)).toEqual({ kept: fused.slice(0, 3), capped: 0 });
  });

  it("reads the share from the environment: default 20, 0 = off, clamped to 50, invalid = default", () => {
    expect(hybridRetrievalConfig({}).trendingMaxSharePercent).toBe(20);
    expect(hybridRetrievalConfig({ AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT: "0" }).trendingMaxSharePercent).toBe(0);
    expect(hybridRetrievalConfig({ AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT: "90" }).trendingMaxSharePercent).toBe(50);
    expect(hybridRetrievalConfig({ AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT: "lots" }).trendingMaxSharePercent).toBe(20);
    expect(hybridRetrievalConfig({ AGENT_RETRIEVAL_BUDGETS: "trending=5" }).budgets.trending).toBe(5);
  });
});

describe("trendingFamiliesFor", () => {
  const taste = { Afrobeats: 5, "Hip Hop": 3, Techno: 1 };

  it("with no request uses the listener's top families, most liked first, at most two", () => {
    const families = trendingFamiliesFor({ genreWeights: taste });
    expect(families.length).toBeLessThanOrEqual(TRENDING_MAX_FAMILIES);
    expect(families.length).toBeGreaterThan(0);
    // Afrobeats belongs to the world, african and afrobeats families, which outrank hip-hop.
    expect(families.map((family) => family.id)).not.toContain("techno");
  });

  it("has no families without a positive taste: catalog popularity alone is not the listener's taste", () => {
    expect(trendingFamiliesFor({})).toEqual([]);
    expect(trendingFamiliesFor({ genreWeights: { Jazz: -2 } })).toEqual([]);
  });

  it("with a request that names genres uses the families those genres name, not the taste", () => {
    const scope = requestScopeFor({ sessionGenres: ["World"] })!;
    const families = trendingFamiliesFor({ scope, genreWeights: { Techno: 9 } });
    expect(families.map((family) => family.label)).toContain("World");
    expect(families.map((family) => family.id)).not.toContain("techno");
  });

  it("has none for a seed-only request: the seed steers it", () => {
    const scope = requestScopeFor({ artists: ["Nadia Okoro"] })!;
    expect(trendingFamiliesFor({ scope, genreWeights: taste })).toEqual([]);
  });

  it("falls back to the taste families for a mood-only request, and skips a family the listener hid", () => {
    const scope = requestScopeFor({ mood: "Focus" })!;
    expect(trendingFamiliesFor({ scope, genreWeights: taste }).length).toBeGreaterThan(0);
    expect(trendingFamiliesFor({ genreWeights: taste, isHidden: () => true })).toEqual([]);
  });
});

describe("admitTrendingTrack (tiers A and B only for a request)", () => {
  const worldTrack = { release: { genre: "African", moods: [] }, descriptor: { families: ["world", "african"] } };
  const rockTrack = { release: { genre: "Hard Rock", moods: [] }, descriptor: { families: ["rock"] } };

  it("admits any track when the session asked for nothing", () => {
    expect(admitTrendingTrack(undefined, rockTrack)).toBe(true);
  });

  it("admits a track that matches a genre request, and never one outside it (tier C)", () => {
    const scope = requestScopeFor({ sessionGenres: ["World"] })!;
    expect(admitTrendingTrack(scope, worldTrack)).toBe(true);
    expect(admitTrendingTrack(scope, rockTrack)).toBe(false);
    // Allowing similar sounds does not let trending in: padding is the keyword path's job.
    expect(admitTrendingTrack(requestScopeFor({ sessionGenres: ["World"], fillSimilar: true })!, rockTrack)).toBe(false);
  });

  it("admits a track that misses a soft filter (tier B) but never a seed-only request's trending", () => {
    const scope = requestScopeFor({ sessionGenres: ["World"], energy: "high" })!;
    expect(admitTrendingTrack(scope, { ...worldTrack, descriptor: { families: ["world"], energyBand: "low" } })).toBe(true);
    expect(admitTrendingTrack(requestScopeFor({ artists: ["Nadia Okoro"] })!, worldTrack)).toBe(false);
  });
});

describe("the trending sentence", () => {
  it("is 'Trending in <family> this week', accepted by the pick-note vocabulary only for a known family", () => {
    expect(trendingExplanation("World")).toBe("Trending in World this week");
    expect(isTrendingExplanation("Trending in World this week")).toBe(true);
    expect(isTrendingExplanation("Trending in Somebody's Playlist this week")).toBe(false);
    const note = shapePickNote(
      { explanation: ["Trending in World this week", "Trending in anything I like this week", "Catalog candidate"] },
      "rules",
    );
    expect(note.explanation).toEqual(["Trending in World this week"]);
  });
});

// ---------------------------------------------------------------------------
// The selector, with stubbed tools
// ---------------------------------------------------------------------------

type Item = {
  id: string;
  title: string;
  hasListing: boolean;
  trendingFamily?: string;
  release: { genre: string; title: string; moods: string[]; artistId: string };
  descriptor?: { families: string[] };
};

function item(id: string, genre: string, families: string[] = [], extra: Partial<Item> = {}): Item {
  return {
    id,
    title: id,
    hasListing: false,
    release: { genre, title: `${id} release`, moods: [], artistId: `artist-${id}` },
    descriptor: { families },
    ...extra,
  };
}

function build(options: { keyword?: Item[]; trending?: Item[] | "unavailable" | "error" }) {
  const trending = jest.fn(async () => {
    if (options.trending === "error") throw new Error("serving tables down");
    if (options.trending === "unavailable") return { items: [], status: "unavailable" };
    return { items: options.trending ?? [], status: "ok" };
  });
  const runs: Record<string, jest.Mock> = {
    "catalog.search": jest.fn(async () => ({ items: options.keyword ?? [] })),
    "catalog.trending": trending,
  };
  const registry = {
    get: jest.fn((name: string) => ({
      run: runs[name] ?? jest.fn().mockResolvedValue({ items: [], status: "unavailable" }),
    })),
  };
  return {
    selector: new AgentSelectorService(registry as any, new DiscoveryRankingService()),
    trending,
  };
}

const hybrid = { retrievalVariant: HYBRID_RETRIEVAL_VARIANT } as const;
const trendingReport = (result: Awaited<ReturnType<AgentSelectorService["select"]>>) =>
  result.retrieval?.sources.find((source) => source.source === "trending");

describe("AgentSelectorService trending source (hybrid_rrf_v1)", () => {
  it("asks for the listener's top families with no request, caps what only trending found, and explains it", async () => {
    const keyword = Array.from({ length: 8 }, (_, i) => item(`k${i}`, "Afrobeats", ["afrobeats"]));
    const trending = Array.from({ length: 6 }, (_, i) => item(`t${i}`, "African", ["african"], { trendingFamily: "World" }));
    const { selector, trending: run } = build({ keyword, trending });
    const result = await selector.select({
      queries: ["Afrobeats"],
      recentTrackIds: [],
      learnedGenreWeights: { Afrobeats: 5 },
      limit: 20,
      ...hybrid,
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ families: expect.any(Array), limit: 20 }));
    const fromTrending = result.candidates.filter((id) => id.startsWith("t"));
    // 8 other candidates: at most 2 trending-only (a fifth of the 10 kept).
    expect(fromTrending).toHaveLength(2);
    expect(result.retrieval?.capped).toEqual({ trending: 4 });
    expect(trendingReport(result)).toMatchObject({ status: "ok", candidates: 6 });
    const picked = result.selected.find((track) => track.id.startsWith("t"));
    expect(picked?.agentRecommendation?.retrievedBy).toEqual(["trending"]);
    expect(picked?.agentRecommendation?.explanation).toContain("Trending in World this week");
    expect(picked?.agentRecommendation?.explanation).not.toContain("Catalog candidate");
  });

  it("for a request session never brings in a track outside the request, even when similar sounds are allowed", async () => {
    const keyword = ["w1", "w2", "w3", "w4"].map((id) => item(id, "African", ["world"]));
    const trending = [
      item("rock1", "Hard Rock", ["rock"], { trendingFamily: "World" }),
      item("w5", "African", ["african", "world"], { trendingFamily: "World" }),
    ];
    for (const fillSimilar of [false, true]) {
      const { selector } = build({ keyword, trending });
      const result = await selector.select({
        queries: ["World"],
        recentTrackIds: [],
        requestedGenres: ["World"],
        requestScope: requestScopeFor({ sessionGenres: ["World"], fillSimilar })!,
        limit: 10,
        ...hybrid,
      });
      expect(result.candidates).not.toContain("rock1");
      expect(result.selected.map((track) => track.id)).not.toContain("rock1");
      // Every request match is still picked; the on-request trending track only adds to them.
      expect(result.selected.map((track) => track.id)).toEqual(expect.arrayContaining(["w1", "w2", "w3", "w4"]));
      expect(result.selected.map((track) => track.id)).toContain("w5");
      expect(result.selected.find((track) => track.id === "w5")?.requestTier).toMatch(/^[AB]$/);
    }
  });

  it("shows nothing on low data: an empty serving read, an unavailable source or an error adds no candidates", async () => {
    const keyword = [item("k1", "Afrobeats", ["afrobeats"])];
    for (const trending of [[], "unavailable", "error"] as const) {
      const { selector } = build({ keyword, trending: trending as never });
      const result = await selector.select({
        queries: ["Afrobeats"],
        recentTrackIds: [],
        learnedGenreWeights: { Afrobeats: 5 },
        ...hybrid,
      });
      expect(result.candidates).toEqual(["k1"]);
      expect(result.selected[0].agentRecommendation?.explanation.join(" ")).not.toContain("Trending");
    }
  });

  it("does not run for a listener with no taste and no request, or with the cap set to 0", async () => {
    const { selector, trending } = build({ keyword: [item("k1", "House")], trending: [item("t1", "House")] });
    const result = await selector.select({ queries: ["House"], recentTrackIds: [], ...hybrid });
    expect(trending).not.toHaveBeenCalled();
    expect(trendingReport(result)).toMatchObject({ status: "skipped" });

    process.env.AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT = "0";
    try {
      await selector.select({ queries: ["House"], recentTrackIds: [], learnedGenreWeights: { House: 5 }, ...hybrid });
      expect(trending).not.toHaveBeenCalled();
    } finally {
      delete process.env.AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT;
    }
  });

  it("does not run on the default retrieval path (the source is hybrid-only)", async () => {
    const { selector, trending } = build({ keyword: [item("k1", "Afrobeats")], trending: [item("t1", "African")] });
    await selector.select({ queries: ["Afrobeats"], recentTrackIds: [], learnedGenreWeights: { Afrobeats: 5 }, retrievalVariant: "default" });
    expect(trending).not.toHaveBeenCalled();
  });
});
