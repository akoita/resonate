import { habitMixAssignment } from "../modules/agents/habit_mix_experiment";
import type { AgentRuntimeInput } from "../modules/agents/runtime/agent_runtime.adapter";
const previous = process.env.DISCOVERY_RANKER_EXPERIMENT;
const input = (preferences: AgentRuntimeInput["preferences"]): AgentRuntimeInput => ({
  userId: "listener", sessionId: "owner-session", recentTrackIds: [], budgetRemainingUsd: 0, preferences,
});
afterEach(() => { if (previous === undefined) delete process.env.DISCOVERY_RANKER_EXPERIMENT;
  else process.env.DISCOVERY_RANKER_EXPERIMENT = previous; });
describe("server-owned Habit Mix experiment assignment", () => {
  it.each([["my_mix_habits", "habit"], ["my_mix_lanes", "neutral"], ["single_profile", "single_profile"]])(
    "activates explicit %s arm for My Mix only", (arm, orderingVariant) => {
      process.env.DISCOVERY_RANKER_EXPERIMENT = `habit:${arm}=100`;
      expect(habitMixAssignment(input({ myMix: {} }))).toMatchObject({ sessionSource: "my_mix", rankerVariant: arm, orderingVariant });
      expect(habitMixAssignment(input({}))).toMatchObject({ sessionSource: "preset", orderingVariant: "single_profile" });
      expect(habitMixAssignment(input({ request: { genres: [], moods: [], energy: null, bpm: null } }))).toMatchObject({ sessionSource: "described", orderingVariant: "single_profile" });
    });
  it.each([undefined, "", "malformed", "other:candidate=100"])("keeps existing behavior for %s", (raw) => {
    if (raw === undefined) delete process.env.DISCOVERY_RANKER_EXPERIMENT; else process.env.DISCOVERY_RANKER_EXPERIMENT = raw;
    expect(habitMixAssignment(input({ myMix: {} }))).toMatchObject({ sessionSource: "my_mix", orderingVariant: "habit" });
  });
  it("ignores untrusted source and ordering labels", () => {
    delete process.env.DISCOVERY_RANKER_EXPERIMENT;
    expect(habitMixAssignment(input({ source: "described", orderingVariant: "neutral" } as any))).toMatchObject({ sessionSource: "preset", orderingVariant: "single_profile" });
  });
});
