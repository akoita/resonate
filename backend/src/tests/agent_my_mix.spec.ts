import { BadRequestException } from "@nestjs/common";
import {
  matchingMyMixLaneIds,
  resolveMyMixPlan,
} from "../modules/agents/agent_my_mix";
import type { ListeningLane } from "../modules/agents/listening_lanes";

function lane(
  id: string,
  strength: number,
  contexts: Record<string, number> = {},
): ListeningLane {
  return {
    id,
    label: `Private ${id}`,
    genreWeights: { "Deep House": 1 },
    moodWeights: { Warm: 0.5 },
    strength,
    contexts,
    energyBand: null,
  };
}

describe("My Mix request resolution", () => {
  it("uses all visible lanes when lanes are omitted and ignores client weights/labels", () => {
    const visible = [lane("lane_a", 0.7), lane("lane_b", 0.3)];
    const plan = resolveMyMixPlan({
      lanes: [{ id: "lane_a", boost: true, label: "forged", strength: 100, genreWeights: { Punk: 100 } }],
    }, visible, 5)!;

    expect(plan.lanes).toHaveLength(1);
    expect(plan.lanes[0]).toMatchObject({
      id: "lane_a",
      label: "Private lane_a",
      strength: 0.7,
      genreWeights: { "Deep House": 1 },
      requested: 5,
      boost: true,
    });

    const implicitAll = resolveMyMixPlan({}, visible, 5)!;
    expect(implicitAll.lanes.map(({ id }) => id)).toEqual(["lane_a", "lane_b"]);
    expect(implicitAll.lanes.reduce((sum, item) => sum + item.requested, 0)).toBe(5);
  });

  it("rejects unknown or hidden lane IDs and invalid bounds", () => {
    const visible = [lane("visible", 1)];
    expect(() => resolveMyMixPlan({ lanes: [{ id: "hidden" }] }, visible, 5)).toThrow(BadRequestException);
    expect(() => resolveMyMixPlan({ context: "lunch:weekday" }, visible, 5)).toThrow(BadRequestException);
    expect(() => resolveMyMixPlan({ additions: [{ genre: "not in catalog" }] }, visible, 5)).toThrow(BadRequestException);
  });

  it("treats explicit empty lanes as an opt out and null as a clear", () => {
    expect(resolveMyMixPlan({ lanes: [] }, [lane("visible", 1)], 5)).toBeUndefined();
    expect(resolveMyMixPlan(null, [lane("visible", 1)], 5)).toBeUndefined();
  });

  it("allocates largest remainders deterministically and applies current context and boost", () => {
    const visible = [
      lane("lane_a", 0.6, { "night:weekday": 0.4, "night:weekend": 0.8 }),
      lane("lane_b", 0.4, { "night:weekday": 0.1, "night:weekend": 0.2 }),
    ];
    const contextual = resolveMyMixPlan({
      context: "night:weekday",
      lanes: [{ id: "lane_a" }, { id: "lane_b", boost: true }],
    }, visible, 5)!;
    expect(contextual.lanes.map(({ requested }) => requested)).toEqual([2, 3]);

    const neutral = resolveMyMixPlan({ lanes: [{ id: "lane_a" }, { id: "lane_b" }] }, visible, 5)!;
    expect(neutral.lanes.map(({ requested }) => requested)).toEqual([3, 2]);
  });

  it("canonicalizes and deduplicates catalog additions with stable IDs", () => {
    const plan = resolveMyMixPlan({
      lanes: [],
      additions: [
        { genre: "Afrobeats", mood: "Warmer" },
        { genre: "Afrobeat", mood: "Warm" },
      ],
    }, [], 5)!;
    expect(plan.lanes).toHaveLength(1);
    expect(plan.lanes[0]).toMatchObject({
      id: expect.stringMatching(/^mix_[a-f0-9]{32}$/),
      label: "Afrobeat · Warm",
      genreWeights: { Afrobeat: 1 },
      moodWeights: { Warm: 1 },
      strength: 1,
      contexts: {},
      energyBand: null,
    });
    expect(matchingMyMixLaneIds(plan.lanes, { genre: "Afrobeats", moods: ["Warmer"] })).toEqual([plan.lanes[0].id]);
  });

  it("uses the median positive selected lane strength for additions", () => {
    const plan = resolveMyMixPlan({
      lanes: [{ id: "lane_a" }, { id: "lane_b" }, { id: "lane_c" }, { id: "lane_d" }],
      additions: [{ genre: "Soul" }],
    }, [lane("lane_a", 0.1), lane("lane_b", 0.3), lane("lane_c", 0.7), lane("lane_d", 0.9)], 5)!;
    expect(plan.lanes[4].strength).toBe(0.5);
  });
});
