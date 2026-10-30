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
      // #2316: the learned "House" orders tracks but is not searched for a session that asks for Soul.
      queries: ["Soul", "Calm", "Dreamy"],
      tasteQueries: ["House"],
      recentTrackIds: ["t1", "t2"],
      requestScope: {
        gated: true,
        softGated: false,
        seeded: false,
        fillSimilar: false,
        request: { genres: ["Soul"], moods: ["Calm", "Dreamy"], energy: "low", bpm: { min: 90, max: 110 } },
      },
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
      requestedGenres: ["Soul"],
      requestedTerms: ["Soul", "Calm", "Dreamy"],
      semanticQuery: expect.stringContaining("Genres: Soul"),
      myMixPlan: undefined,
    });
  });

  it("asks the selector for new artists only when the session is a New artists session (#2249)", () => {
    expect(deterministicSelectorInput(input)).not.toHaveProperty("newArtistsOnly");
    expect(
      deterministicSelectorInput({ ...input, preferences: { ...input.preferences, newArtists: false } }),
    ).not.toHaveProperty("newArtistsOnly");
    expect(
      deterministicSelectorInput({ ...input, preferences: { ...input.preferences, newArtists: true } }),
    ).toMatchObject({ newArtistsOnly: true });
  });

  it("passes the Discovery level to the selector, and ignores anything it does not know (#2327)", () => {
    expect(deterministicSelectorInput(input)).not.toHaveProperty("discovery");
    for (const discovery of ["familiar", "mixed", "new"] as const) {
      expect(
        deterministicSelectorInput({ ...input, preferences: { ...input.preferences, discovery } }),
      ).toMatchObject({ discovery });
    }
    expect(
      deterministicSelectorInput({ ...input, preferences: { ...input.preferences, discovery: "wild" as never } }),
    ).not.toHaveProperty("discovery");
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
    // The live session rides along so its own signals can steer the pick (#2247).
    expect(selector.select).toHaveBeenCalledWith(deterministicSelectorInput({ sessionId: "s1", ...input }));
    expect(deterministicSelectorInput(input)).not.toHaveProperty("sessionId");
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
