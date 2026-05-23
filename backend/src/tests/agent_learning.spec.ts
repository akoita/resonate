import {
  computeAgentTasteProfileFromSignals,
  AGENT_SIGNAL_WEIGHTS,
} from "../modules/agents/agent_learning.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";

describe("agent learning loop", () => {
  it("weights purchase and playlist signals above lightweight accepts", () => {
    const profile = computeAgentTasteProfileFromSignals([
      { trackId: "track-1", action: "accept", genre: "Lo-fi" },
      { trackId: "track-2", action: "add_to_playlist", genre: "Lo-fi" },
      { trackId: "track-3", action: "purchase", genre: "Deep House" },
      { trackId: "track-4", action: "skip", genre: "Noise" },
    ]);

    expect(AGENT_SIGNAL_WEIGHTS.purchase).toBe(5);
    expect(profile.signals).toBe(4);
    expect(profile.positiveSignals).toBe(3);
    expect(profile.negativeSignals).toBe(1);
    expect(profile.favoredGenres[0]).toBe("Deep House");
    expect(profile.genreWeights["Lo-fi"]).toBe(4);
    expect(profile.genreWeights.Noise).toBe(-1);
    expect(profile.score).toBeGreaterThan(30);
  });

  it("falls back to user-selected vibes until enough signals exist", () => {
    const profile = computeAgentTasteProfileFromSignals([], ["Focus", "Ambient"]);

    expect(profile.score).toBe(0);
    expect(profile.tier).toBe("New");
    expect(profile.genresExplored).toEqual(["Focus", "Ambient"]);
    expect(profile.favoredGenres).toEqual([]);
  });

  it("scores listed tracks and learned genres in selector ranking", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "jazz", title: "Jazz Track", hasListing: false, release: { genre: "Jazz" } },
          { id: "house", title: "House Track", hasListing: false, release: { genre: "Deep House" } },
          { id: "listed", title: "Listed Track", hasListing: true, release: { genre: "Ambient" } },
        ],
      }),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any);

    const result = await selector.select({
      queries: ["music"],
      recentTrackIds: [],
      learnedGenreWeights: { "Deep House": 10, Jazz: 1 },
      limit: 3,
    });

    expect(result.selected.map((track: any) => track.id)).toEqual(["house", "listed", "jazz"]);
    expect(result.selected[0]?.agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "learned_preference" }),
      ]),
    );
  });

  it("blends precomputed BigQuery taste scores into selector ranking", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "ambient", title: "Ambient Track", hasListing: false, release: { genre: "Ambient" } },
          { id: "techno", title: "Techno Track", hasListing: false, release: { genre: "Techno" } },
        ],
      }),
    };
    const bigQueryTasteSignals = {
      scoreTracks: jest.fn().mockResolvedValue(new Map([
        ["techno", {
          trackId: "techno",
          score: 0.9,
          confidence: 0.8,
          explanation: "strong collaborative taste fit",
          modelVersion: "bqml-mf-v1",
        }],
      ])),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any, undefined, bigQueryTasteSignals as any);

    const result = await selector.select({
      userId: "user-1",
      queries: ["music"],
      recentTrackIds: [],
      limit: 2,
    });

    expect(bigQueryTasteSignals.scoreTracks).toHaveBeenCalledWith({
      userId: "user-1",
      trackIds: ["ambient", "techno"],
    });
    expect(result.selected.map((track: any) => track.id)).toEqual(["techno", "ambient"]);
    expect(result.selected[0]?.agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "bigquery_taste_score",
          weight: 18,
          reason: "strong collaborative taste fit",
        }),
      ]),
    );
    expect(result.selected[0]?.agentRecommendation?.trace).toEqual({
      bigQueryTasteScore: expect.objectContaining({
        trackId: "techno",
        modelVersion: "bqml-mf-v1",
      }),
    });
  });

  it("expands common taste vocabulary without falling back to unrelated catalog items", async () => {
    const tool = {
      run: jest.fn().mockImplementation(async (input: { query: string }) => ({
        items: input.query === "rap"
          ? [{ id: "rap-track", title: "Rap Track", hasListing: false, release: { genre: "Rap" } }]
          : [],
      })),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any);

    const result = await selector.select({
      queries: ["Hip Hop"],
      recentTrackIds: [],
      limit: 3,
    });

    expect(tool.run).toHaveBeenCalledWith(expect.objectContaining({ query: "Hip Hop" }));
    expect(tool.run).toHaveBeenCalledWith(expect.objectContaining({ query: "rap" }));
    expect(result.selected.map((track: any) => track.id)).toEqual(["rap-track"]);
    expect(result.selected[0]?.agentRecommendation?.explanation).toContain("Nearby vibe match");
  });

  it("returns no selections when original and expanded taste queries miss", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({ items: [] }),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any);

    const result = await selector.select({
      queries: ["Reggaeton"],
      recentTrackIds: [],
      limit: 3,
    });

    expect(result.selected).toEqual([]);
  });

  it("excludes recently played tracks instead of falling back to duplicates", async () => {
    const tool = {
      run: jest.fn().mockResolvedValue({
        items: [
          { id: "recent", title: "Recent Track", hasListing: true, release: { genre: "Techno" } },
        ],
      }),
    };
    const selector = new AgentSelectorService({
      get: jest.fn().mockReturnValue(tool),
    } as any);

    const result = await selector.select({
      queries: ["Techno"],
      recentTrackIds: ["recent"],
      limit: 3,
    });

    expect(result.selected).toEqual([]);
    expect(result.rejected).toEqual([{ trackId: "recent", reason: "recently_played" }]);
  });
});
