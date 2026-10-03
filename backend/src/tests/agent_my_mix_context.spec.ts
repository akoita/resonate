import { buildMixCoverage, matchingMyMixLaneIds, resolveMyMixPlan } from "../modules/agents/agent_my_mix";
import type { ListeningLane } from "../modules/agents/listening_lanes";
import { applyDiscoveryPolicy } from "../modules/recommendations/discovery-policy";
import type { RankedDiscoveryCandidate } from "../modules/recommendations/discovery-ranking.service";

function lane(id: string, contexts: Record<string, number>): ListeningLane {
  return {
    id,
    label: id === "soul" ? "Soul · Warm" : "Ambient · Zen",
    genreWeights: { [id === "soul" ? "Soul" : "Ambient"]: 1 },
    moodWeights: {},
    strength: 1,
    contexts,
    energyBand: null,
  };
}

describe("My Mix context allocation", () => {
  it("shifts the same five-pick mix between fixed morning and evening contexts", () => {
    const lanes = [
      lane("soul", { "morning:weekday": 1 }),
      lane("ambient", { "evening:weekday": 1 }),
    ];
    const morning = resolveMyMixPlan({ context: "morning:weekday" }, lanes, 5)!;
    const evening = resolveMyMixPlan({ context: "evening:weekday" }, lanes, 5)!;

    expect(morning.lanes.map(({ requested }) => requested)).toEqual([3, 2]);
    expect(evening.lanes.map(({ requested }) => requested)).toEqual([2, 3]);
  });

  it("assigns every remainder with stable ties across three equal lanes", () => {
    const lanes = [lane("c", {}), lane("a", {}), lane("b", {})];
    const plan = resolveMyMixPlan({}, lanes, 5)!;
    expect(Object.fromEntries(plan.lanes.map(({ id, requested }) => [id, requested])))
      .toEqual({ a: 2, b: 2, c: 1 });
    expect(plan.lanes.reduce((sum, { requested }) => sum + requested, 0)).toBe(5);
  });

  it("fills a 3+2 batch while keeping exploration, hidden taste, AI removal and artist history", () => {
    const plan = resolveMyMixPlan({}, [
      { ...lane("soul", {}), strength: 3 },
      { ...lane("ambient", {}), strength: 2 },
    ], 5)!;
    const candidate = (id: string, genre: string, artistId = id): RankedDiscoveryCandidate => ({
      id, title: id, artistId, release: { genre }, score: 20,
      signals: [], explanation: ["Matches this session"],
      reasonCode: "taste_match", recentlyPlayed: false,
    });
    const candidates = [
      candidate("hidden", "Soul"),
      { ...candidate("ai", "Ambient"), aiDisclosureLevel: "ALL" },
      candidate("blocked", "Soul"),
      candidate("soul-1", "Soul"),
      candidate("soul-2", "Soul"),
      candidate("soul-new", "Soul"),
      candidate("ambient-1", "Ambient"),
      candidate("ambient-2", "Ambient"),
    ];
    const result = applyDiscoveryPolicy(candidates, {
      limit: 5,
      laneQuotas: plan.lanes.map(({ id, requested, allocationWeight }) => ({ id, requested, strength: allocationWeight })),
      laneMatchesByCandidateId: new Map(candidates.map((track) => [track.id, matchingMyMixLaneIds(plan.lanes, track.release)])),
      verifiedHumanArtistIds: new Set(["soul-new"]),
      priorSessionArtistKeys: ["id:blocked", "id:blocked"],
      tastePolicy: {
        settings: {
          socialMatchingEnabled: false, citySceneDiscoveryEnabled: false,
          agentPlaybackTrainingEnabled: true, recommendationExplanationPreference: "balanced", resetAt: null,
        },
        hidden: new Map([["artist", new Set(["hidden"])]]),
        downranked: new Map(), boosted: new Map(),
      },
    });
    expect(result.items.map(({ id }) => id).sort()).toEqual([
      "ambient-1", "ambient-2", "soul-1", "soul-2", "soul-new",
    ]);
    expect(result.exploration).toEqual({ reserved: 1, served: 1 });
    expect(buildMixCoverage(plan, result.laneAssignments!).lanes)
      .toEqual([
        { id: "soul", label: "Soul · Warm", requested: 3, matched: 3 },
        { id: "ambient", label: "Ambient · Zen", requested: 2, matched: 2 },
      ]);
  });
});
