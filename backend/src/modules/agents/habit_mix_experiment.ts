import { discoveryVariantForUser } from "../recommendations/discovery_experiment";
import type { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";

export type HabitOrderingVariant = "habit" | "neutral" | "single_profile";
export type HabitSessionSource = "my_mix" | "preset" | "described";

/** Assignment is resolved from the existing stable holdout, never caller labels. */
export function habitMixAssignment(input: AgentRuntimeInput) {
  const assignment = discoveryVariantForUser(input.userId);
  const sessionSource: HabitSessionSource = input.preferences?.myMix != null
    ? "my_mix"
    : input.preferences?.request != null ? "described" : "preset";
  const arm = sessionSource === "my_mix" && assignment.experimentKey
    ? assignment.rankerVariant : undefined;
  const orderingVariant: HabitOrderingVariant = sessionSource !== "my_mix" || arm === "single_profile"
    ? "single_profile" : arm === "my_mix_lanes" ? "neutral" : "habit";
  return { ...assignment, sessionSource, orderingVariant };
}
