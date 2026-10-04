const DEFAULT_AGENT_TRACK_LIMIT = 5;

export function getAgentTrackLimit() {
  const configured = Number.parseInt(process.env.AGENT_TRACK_LIMIT ?? "", 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_AGENT_TRACK_LIMIT;
  }
  return Math.min(configured, 50);
}

const DEFAULT_AGENT_SESSION_HISTORY_LIMIT = 10;
const MAX_AGENT_SESSION_HISTORY_LIMIT = 50;

/** Most recent AI DJ sessions returned by `GET /agents/config/history`. */
export function getAgentSessionHistoryLimit() {
  const configured = Number.parseInt(process.env.AGENT_SESSION_HISTORY_LIMIT ?? "", 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_AGENT_SESSION_HISTORY_LIMIT;
  }
  return Math.min(configured, MAX_AGENT_SESSION_HISTORY_LIMIT);
}
