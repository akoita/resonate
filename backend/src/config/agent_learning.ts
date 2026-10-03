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
