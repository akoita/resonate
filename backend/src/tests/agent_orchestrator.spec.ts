import { AgentOrchestratorService } from "../modules/agents/agent_orchestrator.service";
import { AgentMixerService } from "../modules/agents/agent_mixer.service";
import { EventBus } from "../modules/shared/event_bus";

function makeTracks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    agentRecommendation: {
      score: 50 - index,
      explanation: ["taste match"],
      reasonCode: "taste_match",
    },
  }));
}

function build(selected: ReturnType<typeof makeTracks>) {
  const eventBus = new EventBus();
  const events: any[] = [];
  const names = [
    "agent.selection",
    "agent.mix_planned",
    "agent.negotiated",
    "agent.decision_made",
  ] as const;
  for (const name of names) {
    eventBus.subscribe(name as any, (event: any) => events.push(event));
  }
  const recommendations = {
    recommend: jest.fn().mockResolvedValue({
      strategy: "deterministic",
      candidates: selected.map((track) => track.id),
      selected,
      rejected: [],
      reason: "test",
    }),
  };
  const orchestrator = new AgentOrchestratorService(
    recommendations as any,
    new AgentMixerService(),
    eventBus,
  );
  return { orchestrator, recommendations, events };
}

describe("AgentOrchestratorService (listening picks)", () => {
  const originalLimit = process.env.AGENT_TRACK_LIMIT;

  beforeEach(() => {
    process.env.AGENT_TRACK_LIMIT = "5";
  });

  afterAll(() => {
    if (originalLimit === undefined) delete process.env.AGENT_TRACK_LIMIT;
    else process.env.AGENT_TRACK_LIMIT = originalLimit;
  });

  it("returns every selected track regardless of the budget", async () => {
    const { orchestrator, recommendations } = build(makeTracks(5));

    const result = await orchestrator.orchestrate({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      budgetRemainingUsd: 0,
      preferences: { genres: ["soul"] },
    });

    expect(result.status).toBe("approved");
    expect(result.tracks.map((track) => track.trackId)).toEqual([
      "track-1",
      "track-2",
      "track-3",
      "track-4",
      "track-5",
    ]);
    expect(result.shortfall).toBe(0);
    // The budget is not part of the selection request.
    expect(recommendations.recommend).toHaveBeenCalledWith(
      expect.not.objectContaining({ budgetRemainingUsd: expect.anything() }),
    );
  });

  it("records unpriced pick records carrying the recommendation", async () => {
    const { orchestrator } = build(makeTracks(1));

    const result = await orchestrator.orchestrate({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      budgetRemainingUsd: 10,
      preferences: {},
    });

    expect(result.tracks[0].pick).toEqual({
      licenseType: "personal",
      priceUsd: 0,
      reason: "selected",
      recommendation: expect.objectContaining({ reasonCode: "taste_match" }),
    });
    expect(result.tracks[0]).not.toHaveProperty("negotiation");
    expect(result.tracks[0].mixPlan.transition).toBeDefined();
  });

  it("tags the decision event as rule-curated, with no fallback unless one was given (#2075)", async () => {
    const { orchestrator, events } = build(makeTracks(2));

    const result = await orchestrator.orchestrate({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      budgetRemainingUsd: 0,
      preferences: {},
    });

    const decision = events.find((event) => event.eventName === "agent.decision_made");
    expect(decision.curatedBy).toBe("rules");
    expect(decision).not.toHaveProperty("runtimeFallback");
    expect(result).not.toHaveProperty("runtimeFallback");
  });

  it("records the runtime fallback on the decision event and the result (#2075)", async () => {
    const { orchestrator, events } = build(makeTracks(2));
    const runtimeFallback = { from: "adk" as const, reason: "not_configured" as const };

    const result = await orchestrator.orchestrate(
      { sessionId: "s1", userId: "u1", recentTrackIds: [], budgetRemainingUsd: 0, preferences: {} },
      { runtimeFallback },
    );

    const decision = events.find((event) => event.eventName === "agent.decision_made");
    expect(decision.curatedBy).toBe("rules");
    expect(decision.runtimeFallback).toEqual(runtimeFallback);
    expect(result.runtimeFallback).toEqual(runtimeFallback);
  });

  it("records the runtime fallback when the catalog returned nothing (#2075)", async () => {
    const { orchestrator, events } = build([]);
    const runtimeFallback = { from: "vertex" as const, reason: "error" as const };

    const result = await orchestrator.orchestrate(
      { sessionId: "s1", userId: "u1", recentTrackIds: [], budgetRemainingUsd: 0, preferences: {} },
      { runtimeFallback },
    );

    const decision = events.find((event) => event.eventName === "agent.decision_made");
    expect(decision.reason).toBe("no_tracks");
    expect(decision.curatedBy).toBe("rules");
    expect(decision.runtimeFallback).toEqual(runtimeFallback);
    expect(result.runtimeFallback).toEqual(runtimeFallback);
  });

  it("never emits agent.negotiated and plans a mix per track", async () => {
    const { orchestrator, events } = build(makeTracks(3));

    await orchestrator.orchestrate({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      budgetRemainingUsd: 10,
      preferences: {},
    });

    expect(events.filter((event) => event.eventName === "agent.negotiated")).toHaveLength(0);
    expect(events.filter((event) => event.eventName === "agent.mix_planned")).toHaveLength(3);
  });

  it("publishes a decision event without spend", async () => {
    const { orchestrator, events } = build(makeTracks(5));

    await orchestrator.orchestrate({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      budgetRemainingUsd: 0.01,
      preferences: {},
    });

    const decision = events.find((event) => event.eventName === "agent.decision_made");
    expect(decision).toEqual(
      expect.objectContaining({ sessionId: "s1", trackCount: 5, reason: "approved" }),
    );
    expect(decision).not.toHaveProperty("totalSpend");
    expect(decision).not.toHaveProperty("priceUsd");
  });

  it("reports a shortfall when the catalog is sparse, not a budget limit", async () => {
    const { orchestrator, events } = build(makeTracks(2));

    const result = await orchestrator.orchestrate({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      budgetRemainingUsd: 0,
      preferences: { genres: ["soul"] },
    });

    expect(result.tracks).toHaveLength(2);
    expect(result.shortfall).toBe(3);
    const decision = events.find((event) => event.eventName === "agent.decision_made");
    expect(decision).toEqual(
      expect.objectContaining({ shortfall: 3, unmetIntent: { genres: ["soul"] } }),
    );
  });

  it("returns no_tracks with the full shortfall when nothing is selected", async () => {
    const { orchestrator } = build([]);

    const result = await orchestrator.orchestrate({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      preferences: {},
    });

    // The selector's reason travels with the empty result (#2056).
    expect(result).toEqual({ status: "no_tracks", tracks: [], shortfall: 5, reason: "test" });
  });

  describe("request coverage (#2037)", () => {
    const measured = (tempoBpm: number) => ({
      energyBand: "high",
      tempoBpm,
      featureSources: { tempo: "measured", key: "unavailable", energy: "measured" },
    });
    const track = (
      index: number,
      release: { genre: string | null; moods: string[] },
      audioFeatures: object,
    ) => ({
      id: `track-${index}`,
      title: `Track ${index}`,
      release,
      agentRecommendation: { score: 50, explanation: [], reasonCode: "taste_match", audioFeatures },
    });
    const request = {
      genres: ["Deep House"],
      moods: ["Dark"],
      energy: "high" as const,
      bpm: { min: 120, max: 125 },
    };

    it("puts coverage on the decision event and the result", async () => {
      const { orchestrator, events } = build([
        track(1, { genre: "Deep House", moods: ["Dark"] }, measured(122)),
        track(2, { genre: "Deep House", moods: ["Bright"] }, measured(130)),
        track(3, { genre: "Techno", moods: ["Dark"] }, { ...measured(122), featureSources: { tempo: "inferred" } }),
      ] as any);

      const result = await orchestrator.orchestrate({
        sessionId: "s1",
        userId: "u1",
        recentTrackIds: [],
        preferences: { genres: ["Deep House"], request },
      });

      expect(result.requestCoverage).toEqual({
        picks: 3,
        gaps: [
          { filter: "bpm", matched: 1 },
          { filter: "genres", matched: 2 },
          { filter: "moods", matched: 2 },
        ],
      });
      const decision = events.find((event) => event.eventName === "agent.decision_made");
      expect(decision.coverage).toEqual(result.requestCoverage);
      expect(decision.coverageSummary).toBe(
        "not matched: 120\u2013125 BPM (1 of 3), Deep House (2 of 3), Dark (2 of 3)",
      );
    });

    it("reports full coverage without a summary when every pick matches", async () => {
      const { orchestrator, events } = build([
        track(1, { genre: "Deep House", moods: ["Dark"] }, measured(122)),
      ] as any);

      const result = await orchestrator.orchestrate({
        sessionId: "s1",
        userId: "u1",
        recentTrackIds: [],
        preferences: { request },
      });

      expect(result.requestCoverage).toEqual({ picks: 1, gaps: [] });
      const decision = events.find((event) => event.eventName === "agent.decision_made");
      expect(decision.coverage).toEqual({ picks: 1, gaps: [] });
      expect(decision).not.toHaveProperty("coverageSummary");
    });

    it("adds nothing without a request, or with a request that has no filters", async () => {
      for (const preferences of [{}, { request: { genres: [], moods: [], energy: null, bpm: null } }]) {
        const { orchestrator, events } = build(makeTracks(2));
        const result = await orchestrator.orchestrate({
          sessionId: "s1",
          userId: "u1",
          recentTrackIds: [],
          preferences,
        });
        expect(result).not.toHaveProperty("requestCoverage");
        const decision = events.find((event) => event.eventName === "agent.decision_made");
        expect(decision).not.toHaveProperty("coverage");
        expect(decision).not.toHaveProperty("coverageSummary");
      }
    });
  });
});
