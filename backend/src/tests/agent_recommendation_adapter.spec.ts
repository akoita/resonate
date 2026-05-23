const mockGenerateContent = jest.fn();

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
  SchemaType: {
    OBJECT: "object",
    ARRAY: "array",
    STRING: "string",
    NUMBER: "number",
    INTEGER: "integer",
  },
}));

import {
  AgentRecommendationService,
  resolveAgentRecommendationStrategy,
} from "../modules/agents/agent_recommendation.service";
import {
  buildAgentRecommendationQueries,
  DeterministicRecommendationAdapter,
} from "../modules/agents/deterministic_recommendation.adapter";
import { ModelAssistedRecommendationAdapter } from "../modules/agents/model_assisted_recommendation.adapter";

describe("agent recommendation adapters", () => {
  const originalStrategy = process.env.AGENT_RECOMMENDATION_STRATEGY;

  afterEach(() => {
    if (originalStrategy === undefined) {
      delete process.env.AGENT_RECOMMENDATION_STRATEGY;
    } else {
      process.env.AGENT_RECOMMENDATION_STRATEGY = originalStrategy;
    }
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.AGENT_RECOMMENDATION_MODEL;
    delete process.env.AGENT_RECOMMENDATION_MIN_CONFIDENCE;
    mockGenerateContent.mockReset();
    jest.restoreAllMocks();
  });

  it("defaults recommendation strategy to deterministic", () => {
    delete process.env.AGENT_RECOMMENDATION_STRATEGY;

    expect(resolveAgentRecommendationStrategy()).toBe("deterministic");
    expect(resolveAgentRecommendationStrategy("deterministic")).toBe("deterministic");
    expect(resolveAgentRecommendationStrategy("model-assisted")).toBe("model-assisted");
    expect(resolveAgentRecommendationStrategy("model_assisted")).toBe("model-assisted");
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
      userId: "user-1",
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

  it("uses deterministic adapter for unknown strategies", async () => {
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

  it("uses model-assisted structured ranking when configured", async () => {
    process.env.AGENT_RECOMMENDATION_STRATEGY = "model-assisted";
    process.env.GOOGLE_AI_API_KEY = "test-key";
    process.env.AGENT_RECOMMENDATION_MODEL = "test-ranking-model";
    const deterministic = {
      recommend: jest.fn().mockResolvedValue({
        strategy: "deterministic",
        candidates: ["rap-track", "ambient-track"],
        selected: [
          {
            id: "rap-track",
            title: "Metro Cipher",
            hasListing: true,
            release: { genre: "Rap", title: "Metro" },
            agentRecommendation: {
              score: 38,
              matchedQueries: ["rap"],
              explanation: ["Nearby vibe match"],
              signals: [{ label: "expanded_taste_match", weight: 28, reason: "matches nearby taste rap" }],
            },
          },
          {
            id: "ambient-track",
            title: "Cloud Drift",
            hasListing: true,
            release: { genre: "Ambient", title: "Drift" },
            agentRecommendation: {
              score: 14,
              matchedQueries: [],
              explanation: ["Catalog candidate"],
              signals: [{ label: "listed", weight: 14, reason: "has active stem listing" }],
            },
          },
        ],
        rejected: [],
        reason: "ranked_shortlist",
      }),
    };
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: "Rap candidate is semantically close to the hip hop taste profile.",
          decisions: [
            {
              trackId: "rap-track",
              action: "select",
              relevance: "semantic",
              confidence: 0.91,
              rank: 1,
              explanation: "Rap cadence and listed stems match the Hip Hop session.",
            },
            {
              trackId: "ambient-track",
              action: "reject",
              relevance: "none",
              confidence: 0.2,
              rank: 2,
              rejectionReason: "taste_mismatch",
            },
          ],
        }),
      },
    });

    const service = new AgentRecommendationService(
      deterministic as any,
      new ModelAssistedRecommendationAdapter(deterministic as any),
    );
    const result = await service.recommend({
      sessionId: "session-1",
      userId: "user-1",
      recentTrackIds: [],
      budgetRemainingUsd: 1,
      preferences: { genres: ["Hip Hop"], mood: "Focus" },
      limit: 1,
    });

    expect(result.strategy).toBe("model-assisted");
    expect(result.reason).toBe("model_ranked_shortlist");
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].id).toBe("rap-track");
    expect(result.selected[0].agentRecommendation?.explanation).toEqual([
      "Rap cadence and listed stems match the Hip Hop session.",
    ]);
    expect(result.selected[0].agentRecommendation?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "model_semantic_rank" }),
      ]),
    );
    expect(result.rejected).toEqual([{ trackId: "ambient-track", reason: "taste_mismatch" }]);
    expect(result.trace).toEqual(expect.objectContaining({
      strategy: "model-assisted",
      model: "test-ranking-model",
    }));
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("keeps strict no-match when model rejects unrelated candidates", async () => {
    process.env.GOOGLE_AI_API_KEY = "test-key";
    const deterministic = {
      recommend: jest.fn().mockResolvedValue({
        strategy: "deterministic",
        candidates: ["ambient-track", "pop-track"],
        selected: [
          { id: "ambient-track", title: "Cloud Drift", hasListing: true, release: { genre: "Ambient" } },
          { id: "pop-track", title: "Bright Hook", hasListing: true, release: { genre: "Pop" } },
        ],
        rejected: [],
        reason: "ranked_shortlist",
      }),
    };
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: "No candidate matches the reggaeton taste profile.",
          decisions: [
            {
              trackId: "ambient-track",
              action: "reject",
              relevance: "none",
              confidence: 0.1,
              rank: 1,
              rejectionReason: "taste_mismatch",
            },
            {
              trackId: "pop-track",
              action: "reject",
              relevance: "none",
              confidence: 0.1,
              rank: 2,
              rejectionReason: "taste_mismatch",
            },
          ],
        }),
      },
    });

    const adapter = new ModelAssistedRecommendationAdapter(deterministic as any);
    const result = await adapter.recommend({
      sessionId: "session-1",
      userId: "user-1",
      recentTrackIds: [],
      budgetRemainingUsd: 1,
      preferences: { genres: ["Reggaeton"] },
      limit: 3,
    });

    expect(result.strategy).toBe("model-assisted");
    expect(result.reason).toBe("model_no_matching_taste_candidates");
    expect(result.selected).toEqual([]);
    expect(result.rejected).toEqual([
      { trackId: "ambient-track", reason: "taste_mismatch" },
      { trackId: "pop-track", reason: "taste_mismatch" },
    ]);
  });

  it("falls back to deterministic ranking when model output is malformed", async () => {
    process.env.GOOGLE_AI_API_KEY = "test-key";
    const deterministic = {
      recommend: jest.fn().mockResolvedValue({
        strategy: "deterministic",
        candidates: ["track-1"],
        selected: [{ id: "track-1", title: "Track 1" }],
        rejected: [],
        reason: "ranked_shortlist",
      }),
    };
    mockGenerateContent.mockResolvedValue({
      response: { text: () => "{not-json" },
    });

    const result = await new ModelAssistedRecommendationAdapter(deterministic as any).recommend({
      sessionId: "session-1",
      userId: "user-1",
      recentTrackIds: [],
      budgetRemainingUsd: 1,
      preferences: { genres: ["Hip Hop"] },
      limit: 1,
    });

    expect(result.strategy).toBe("deterministic");
    expect(result.reason).toBe("ranked_shortlist");
    expect(result.trace?.fallbackReason).toBe("model_adapter_failure");
  });

  it("falls back to deterministic ranking when the model call fails", async () => {
    process.env.GOOGLE_AI_API_KEY = "test-key";
    const deterministic = {
      recommend: jest.fn().mockResolvedValue({
        strategy: "deterministic",
        candidates: ["track-1"],
        selected: [{ id: "track-1", title: "Track 1" }],
        rejected: [],
        reason: "ranked_shortlist",
      }),
    };
    mockGenerateContent.mockRejectedValue(new Error("model unavailable"));

    const result = await new ModelAssistedRecommendationAdapter(deterministic as any).recommend({
      sessionId: "session-1",
      userId: "user-1",
      recentTrackIds: [],
      budgetRemainingUsd: 1,
      preferences: { genres: ["Hip Hop"] },
      limit: 1,
    });

    expect(result.strategy).toBe("deterministic");
    expect(result.trace?.fallbackReason).toBe("model_adapter_failure");
  });
});
