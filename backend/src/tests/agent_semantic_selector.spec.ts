/**
 * #2088: semantic retrieval in the selector and the session description built
 * for it. Pure unit tests: the catalog tools are stubbed, no database.
 */
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { buildSemanticSessionQuery } from "../modules/agents/deterministic_recommendation.adapter";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const item = (id: string, genre: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  hasListing: false,
  release: { genre, title: `${id} release`, moods: [] as string[], artistId: `artist-${id}` },
  ...extra,
});

function selectorWith(options: {
  keyword?: ReturnType<typeof item>[];
  semantic?: ReturnType<typeof item>[];
  semanticThrows?: boolean;
}) {
  const searchRun = jest.fn(async (input: { query?: string }) => ({
    items: (options.keyword ?? []).filter(
      (track) => !input.query || track.release.genre.toLowerCase().includes(input.query.toLowerCase()),
    ),
  }));
  const semanticRun = jest.fn(async () => {
    if (options.semanticThrows) throw new Error("boom");
    return { items: options.semantic ?? [], status: "ok" };
  });
  const tools = {
    get: jest.fn((name: string) => {
      if (name === "catalog.semantic_search") return { run: semanticRun };
      if (name === "catalog.search") return { run: searchRun };
      return { run: jest.fn().mockResolvedValue({ ranked: [], status: "unavailable" }) };
    }),
  };
  return {
    selector: new AgentSelectorService(tools as any, new DiscoveryRankingService()),
    semanticRun,
    searchRun,
  };
}

describe("AgentSelectorService semantic retrieval (#2088)", () => {
  it("adds catalog-wide semantic candidates a keyword search never returns", async () => {
    const { selector, semanticRun } = selectorWith({
      keyword: [item("keyword", "World")],
      semantic: [item("semantic", "Zzyzx", { semanticScore: 0.8 })],
    });
    const result = await selector.select({
      queries: ["World"],
      recentTrackIds: ["played"],
      allowExplicit: false,
      limit: 5,
      semanticQuery: "World music",
    });
    expect([...result.candidates].sort()).toEqual(["keyword", "semantic"]);
    expect(semanticRun).toHaveBeenCalledWith({
      query: "World music",
      limit: 20,
      allowExplicit: false,
      excludeTrackIds: ["played"],
    });
    const semantic = result.selected.find((track) => track.id === "semantic") as any;
    expect(semantic.agentRecommendation.matchedQueries).toEqual([]);
    expect(semantic.agentRecommendation.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "semantic_similarity", weight: 10 })]),
    );
  });

  it("does not call the semantic tool without a semantic query", async () => {
    const { selector, semanticRun } = selectorWith({ keyword: [item("a", "House")] });
    await selector.select({ queries: ["House"], recentTrackIds: [] });
    expect(semanticRun).not.toHaveBeenCalled();
  });

  it("drops semantic candidates that are fully AI-generated", async () => {
    const { selector } = selectorWith({
      keyword: [item("keyword", "World")],
      semantic: [item("ai", "Zzyzx", { aiDisclosureLevel: "ALL", semanticScore: 0.9 })],
    });
    const result = await selector.select({
      queries: ["World"],
      recentTrackIds: [],
      semanticQuery: "World music",
    });
    expect(result.candidates).toEqual(["keyword"]);
  });

  it("keeps the keyword candidates when semantic retrieval fails", async () => {
    const { selector } = selectorWith({ keyword: [item("keyword", "World")], semanticThrows: true });
    const result = await selector.select({
      queries: ["World"],
      recentTrackIds: [],
      semanticQuery: "World music",
    });
    expect(result.candidates).toEqual(["keyword"]);
  });

  it("still reports nothing matched when neither keyword nor semantic search finds anything", async () => {
    const { selector } = selectorWith({});
    const result = await selector.select({
      queries: ["World"],
      recentTrackIds: ["played"],
      fallback: true,
      semanticQuery: "World music",
    });
    expect(result.candidates).toEqual([]);
    expect(result.reason).toBe("no_matching_taste_candidates");
    expect(result.fallback).toBeUndefined();
  });
});

describe("buildSemanticSessionQuery (#2088)", () => {
  it("is undefined unless the session asked for something itself", () => {
    expect(buildSemanticSessionQuery({ genres: ["Pop"], energy: "high" })).toBeUndefined();
    expect(buildSemanticSessionQuery({})).toBeUndefined();
  });

  it("describes the session's genres, related styles, mood and energy", () => {
    const query = buildSemanticSessionQuery({
      genres: ["Pop", "Techno"],
      sessionGenres: ["World", "Musiques du monde"],
      mood: "Warm",
      moods: ["Warm", "Upbeat"],
      energy: "high",
      sessionIntentName: "Sunday Market",
    });
    expect(query).toMatch(/^Sunday Market\. Genres: World, Musiques du monde, plus related styles: /);
    expect(query).toContain("african");
    expect(query).toContain("Mood: Warm, Upbeat.");
    expect(query).toContain("Energy: high.");
    expect(query).not.toContain("Techno");
    const related = query!.match(/plus related styles: ([^.]*)\./)![1].split(", ");
    expect(related.length).toBeLessThanOrEqual(8);
  });

  it("omits empty parts", () => {
    expect(buildSemanticSessionQuery({ mood: "Calm" })).toBe("Mood: Calm.");
    expect(buildSemanticSessionQuery({ sessionGenres: ["Zzyzx"] })).toBe("Genres: Zzyzx.");
    expect(buildSemanticSessionQuery({ sessionIntent: "focus" })).toBe("focus.");
  });
});
