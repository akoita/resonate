import {
  DeterministicRecommendationAdapter,
  deterministicSelectorInput,
} from "../modules/agents/deterministic_recommendation.adapter";

describe("deterministicSelectorInput (#2094)", () => {
  const input = {
    userId: "u1",
    recentTrackIds: ["t1", "t2"],
    limit: 7,
    preferences: {
      genres: ["House", "Soul"],
      sessionGenres: ["Soul"],
      mood: "Calm",
      moods: ["Dreamy"],
      energy: "low" as const,
      allowExplicit: false,
      sessionIntent: "focus",
      queueStyle: "Slow burn",
      tempoBpm: { min: 90, max: 110 },
      learnedGenreWeights: { House: 2 },
    },
  };

  it("builds the listening-session request the rule-based adapter sends", () => {
    const selectorInput = deterministicSelectorInput(input);
    expect(selectorInput).toEqual({
      userId: "u1",
      queries: ["House", "Soul", "Calm", "Dreamy"],
      recentTrackIds: ["t1", "t2"],
      allowExplicit: false,
      useEmbeddings: true,
      limit: 7,
      energy: "low",
      learnedGenreWeights: { House: 2 },
      sessionIntent: "focus",
      mood: "Calm",
      queueStyle: "Slow burn",
      tempoBpm: { min: 90, max: 110 },
      fallback: true,
      requestedTerms: ["Soul", "Calm", "Dreamy"],
      semanticQuery: expect.stringContaining("Genres: Soul"),
      myMixPlan: undefined,
    });
  });

  it("is exactly what recommend() passes to the selector", async () => {
    const selector = {
      select: jest
        .fn()
        .mockResolvedValue({ candidates: [], selected: [], rejected: [], reason: "x" }),
    };
    await new DeterministicRecommendationAdapter(selector as any).recommend({
      sessionId: "s1",
      ...input,
    });
    expect(selector.select).toHaveBeenCalledWith(deterministicSelectorInput(input));
  });

  it("sends no embeddings query when the session asked for nothing", () => {
    const selectorInput = deterministicSelectorInput({
      userId: "u1",
      recentTrackIds: [],
      limit: 5,
      preferences: {},
    });
    expect(selectorInput.queries).toEqual([]);
    expect(selectorInput.useEmbeddings).toBe(false);
    expect(selectorInput.semanticQuery).toBeUndefined();
  });
});
