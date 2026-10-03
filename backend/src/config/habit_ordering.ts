/** Total decayed transition evidence required before lane-pair learning guides ordering. */
export const HABIT_ORDERING_MIN_TRANSITION_EVIDENCE = 3;
/** Decayed evidence required before one lane pair is considered learned. */
export const HABIT_ORDERING_PAIR_EVIDENCE = 1;

/** Lane runs aim for three tracks and can extend to four if no acceptable switch exists. */
export const HABIT_ORDERING_SHORT_RUN_TARGET = 3;
export const HABIT_ORDERING_SHORT_RUN_MAX = 4;

/** A skip is early only when it meets both the time and known-duration bounds. */
export const HABIT_ORDERING_EARLY_SKIP_MAX_POSITION_MS = 30_000;
export const HABIT_ORDERING_EARLY_SKIP_MAX_DURATION_SHARE = 0.25;

/** A learned large energy jump needs repeated positive evidence and a strong positive share. */
export const HABIT_ORDERING_LARGE_ENERGY_MIN_POSITIVE = 3;
export const HABIT_ORDERING_LARGE_ENERGY_MIN_POSITIVE_SHARE = 0.75;
