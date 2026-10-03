export const AGENT_SIGNAL_WEIGHTS = {
  accept: 1,
  skip: -1,
  complete: 1.5,
  replay: 2,
  loop: 2.5,
  save: 3,
  unsave: -2,
  add_to_playlist: 3,
  purchase: 5,
} as const;

export const AGENT_REPLAY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum recent signal history used by listener habit profiles. */
export const AGENT_TASTE_HISTORY_LIMIT = 500;
/** Signals older than this are outside the habit profile's learning window. */
export const AGENT_TASTE_HISTORY_WINDOW_DAYS = 730;
/** Behavioral playback signals lose half their influence after this period. */
export const AGENT_BEHAVIORAL_HALF_LIFE_DAYS = 60;
/** Purchases and other commitments lose half their influence after this period. */
export const AGENT_COMMITMENT_HALF_LIFE_DAYS = 365;
