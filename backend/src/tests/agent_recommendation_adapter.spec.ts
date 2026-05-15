import {
  AgentRecommendationService,
  resolveAgentRecommendationStrategy,
} from "../modules/agents/agent_recommendation.service";
import {
  buildAgentRecommendationQueries,
  DeterministicRecommendationAdapter,
} from "../modules/agents/deterministic_recommendation.adapter";

describe("agent recommendation adapters", () => {
  const originalStrategy = process.env.AGENT_RECOMMENDATION_STRATEGY;

  afterEach(() => {
    if (originalStrategy === undefined) {
      delete process.env.AGENT_RECOMMENDATION_STRATEGY;
    } else {
      process.env.AGENT_RECOMMENDATION_STRATEGY = originalStrategy;
    }
    jest.restoreAllMocks();
  });

  it("defaults recommendation strategy to deterministic", () => {
    delete process.env.AGENT_RECOMMENDATION_STRATEGY;

    expect(resolveAgentRecommendationStrategy()).toBe("deterministic");
    expect(resolveAgentRecommendationStrategy("deterministic")).toBe("deterministic");
    expect(resolveAgentRecommendationStrategy("unknown-model")).toBe("deterministic");
  });

  it("builds bounded taste queries from genres and mood", () => {
    expect(buildAgentRecommendationQueries({
      genres: ["Hip Hop", "Trap"],
      mood: "Focus",
    })).toEqual(["Hip Hop", "Trap", "Focus"]);

    expect(buildAgentRecommendationQueries({
      genres: ["Focus"],
      mood: "Focus",
    })).toEqual(["Focus"]);
  });

  it("routes deterministic recommendation requests through the selector contract", async () => {
    const selector = {
      select: jest.fn().mockResolvedValue({
        candidates: ["track-1", "track-2"],
        selected: [
          {
            id: "track-1",
            title: "Track 1",
            agentRecommendation: {
              score: 54,
              matchedQueries: ["Hip Hop"],
              explanation: ["Selected vibe match"],
              signals: [{ label: "taste_match", weight: 40, reason: "matches selected taste Hip Hop" }],
            },
          },
        ],
        rejected: [{ trackId: "track-2", reason: "recently_played" }],
        reason: "ranked_shortlist",
      }),
    };
    const adapter = new DeterministicRecommendationAdapter(selector as any);

    const result = await adapter.recommend({
      sessionId: "session-1",
      userId: "user-1",
      recentTrackIds: ["track-2"],
      budgetRemainingUsd: 1,
      preferences: {
        genres: ["Hip Hop"],
        mood: "Focus",
        energy: "medium",
        learnedGenreWeights: { "Hip Hop": 3 },
        allowExplicit: true,
      },
      limit: 5,
    });

    expect(selector.select).toHaveBeenCalledWith({
      queries: ["Hip Hop", "Focus"],
      recentTrackIds: ["track-2"],
      allowExplicit: true,
      useEmbeddings: true,
      limit: 5,
      energy: "medium",
      learnedGenreWeights: { "Hip Hop": 3 },
    });
    expect(result).toEqual(expect.objectContaining({
      strategy: "deterministic",
      candidates: ["track-1", "track-2"],
      rejected: [{ trackId: "track-2", reason: "recently_played" }],
      reason: "ranked_shortlist",
    }));
    expect(result.selected[0]?.agentRecommendation?.score).toBe(54);
  });

  it("uses deterministic adapter for configured and unknown strategies", async () => {
    process.env.AGENT_RECOMMENDATION_STRATEGY = "future-specialized-model";
    const adapter = {
      recommend: jest.fn().mockResolvedValue({
        strategy: "deterministic",
        candidates: [],
        selected: [],
        rejected: [],
        reason: "no_matching_taste_candidates",
      }),
    };

    const service = new AgentRecommendationService(adapter as any);
    const result = await service.recommend({
      sessionId: "session-1",
      userId: "user-1",
      recentTrackIds: [],
      budgetRemainingUsd: 1,
      preferences: { genres: ["Reggaeton"] },
      limit: 3,
    });

    expect(adapter.recommend).toHaveBeenCalledTimes(1);
    expect(result.reason).toBe("no_matching_taste_candidates");
  });
});
