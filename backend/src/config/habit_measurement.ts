/** Fixed quality-report thresholds for Habit Mix measurement (#2067). */
export const HABIT_MIX_MEASUREMENT = {
  earlySkipBeforeMs: 30_000,
  completionRatioAtLeast: 0.8,
  recentDjActionWithinMs: 30 * 60 * 1_000,
  promotionMinimumSessions: 100,
  promotionMinimumPlays: 500,
  candidateRankerVariant: "my_mix_habits",
  candidateOrderingVariant: "habit",
  baselineRankerVariant: "single_profile",
  baselineOrderingVariant: "single_profile",
} as const;

export const HABIT_MIX_SESSION_SOURCES = ["my_mix", "preset", "described"] as const;

export type HabitMixSessionSource = (typeof HABIT_MIX_SESSION_SOURCES)[number];
