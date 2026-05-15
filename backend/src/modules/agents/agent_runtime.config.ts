const DEFAULT_AGENT_TRACK_LIMIT = 5;

export function getAgentTrackLimit() {
  const configured = Number.parseInt(process.env.AGENT_TRACK_LIMIT ?? "", 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_AGENT_TRACK_LIMIT;
  }
  return Math.min(configured, 50);
}
