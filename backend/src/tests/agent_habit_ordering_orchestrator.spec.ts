import { AgentOrchestratorService } from "../modules/agents/agent_orchestrator.service";
import { EventBus } from "../modules/shared/event_bus";

describe("My Mix ordering integration", () => {
  const selected = [
    { id: "a", title: "A", mixLaneId: "soul", agentRecommendation: { explanation: ["Soul"] } },
    { id: "b", title: "B", mixLaneId: "ambient", agentRecommendation: { explanation: ["Ambient"] } },
    { id: "c", title: "C", mixLaneId: "soul", agentRecommendation: { explanation: ["Soul"] } },
  ];
  const mixCoverage = { lanes: [{ id: "soul", label: "Soul", requested: 2, matched: 2 }] };

  function build() {
    const recommendations = { recommend: jest.fn().mockResolvedValue({ selected, candidates: [], strategy: "deterministic", mixCoverage }) };
    const mixer = { plan: jest.fn((input) => ({ ...input, transition: "crossfade" })) };
    const ordering = { orderMyMix: jest.fn().mockResolvedValue([selected[0], selected[2], selected[1]]) };
    const eventBus = new EventBus();
    const events: unknown[] = [];
    for (const name of ["agent.selection", "agent.mix_planned", "agent.decision_made"] as const) {
      eventBus.subscribe(name, (event) => events.push(event));
    }
    return { orchestrator: new AgentOrchestratorService(recommendations as any, mixer as any, eventBus, ordering as any), mixer, ordering, events };
  }

  it("orders before mixer planning and preserves coverage and pick provenance", async () => {
    const { orchestrator, mixer, ordering, events } = build();
    const plan = { lanes: [] };
    const result = await orchestrator.orchestrate({ sessionId: "session", userId: "owner", recentTrackIds: ["previous"], preferences: { myMix: {} }, myMixPlan: plan });
    expect(ordering.orderMyMix).toHaveBeenCalledWith("owner", "session", selected, plan);
    expect(result.tracks.map((track) => track.trackId)).toEqual(["a", "c", "b"]);
    expect(mixer.plan.mock.calls.map(([input]) => [input.previousTrackId, input.trackId])).toEqual([["previous", "a"], ["a", "c"], ["c", "b"]]);
    expect(result.mixCoverage).toBe(mixCoverage);
    expect(result.tracks.map((track) => track.pick.recommendation)).toEqual([selected[0].agentRecommendation, selected[2].agentRecommendation, selected[1].agentRecommendation]);
    expect(result.tracks.map((track) => track.mixLaneId)).toEqual(["soul", "soul", "ambient"]);
    expect(JSON.stringify(events)).not.toContain("mixLaneId");
    expect(JSON.stringify(events)).not.toContain("laneTransitions");
  });

  it("keeps ordinary sessions in their existing order without reading habits", async () => {
    const { orchestrator, ordering } = build();
    const result = await orchestrator.orchestrate({ sessionId: "session", userId: "owner", recentTrackIds: [], preferences: {} });
    expect(ordering.orderMyMix).not.toHaveBeenCalled();
    expect(result.tracks.map((track) => track.trackId)).toEqual(["a", "b", "c"]);
  });

  it("retains selector order for the neutral experiment arm without reading habits", async () => {
    const { orchestrator, mixer, ordering } = build();
    const result = await orchestrator.orchestrate({ sessionId: "session", userId: "owner", recentTrackIds: [],
      preferences: { myMix: {} }, myMixPlan: { lanes: [], orderingVariant: "neutral" } });
    expect(ordering.orderMyMix).not.toHaveBeenCalled();
    expect(result.tracks.map((track) => track.trackId)).toEqual(["a", "b", "c"]);
    expect(mixer.plan.mock.calls.map(([input]) => input.trackId)).toEqual(["a", "b", "c"]);
    expect(result.mixCoverage).toBe(mixCoverage);
  });

  it("does not read ordering history for an empty batch", async () => {
    const ordering = { orderMyMix: jest.fn() };
    const orchestrator = new AgentOrchestratorService({ recommend: jest.fn().mockResolvedValue({ selected: [], reason: "no_candidates" }) } as any, {} as any, new EventBus(), ordering as any);
    const result = await orchestrator.orchestrate({ sessionId: "session", userId: "owner", recentTrackIds: [], preferences: { myMix: {} }, myMixPlan: { lanes: [] } });
    expect(result.tracks).toEqual([]);
    expect(ordering.orderMyMix).not.toHaveBeenCalled();
  });
});
