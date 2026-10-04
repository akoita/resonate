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

const DEFAULT_AGENT_SEMANTIC_MIN_SIMILARITY = 0.55;

/**
 * Cosine-similarity floor for catalog-wide semantic retrieval (#2088). Below it
 * a neighbour is not a candidate, so a request nothing in the catalog resembles
 * still finds nothing and the unmet demand stays visible (ADR-TE-4).
 */
export function getAgentSemanticMinSimilarity() {
  const raw = process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
  if (raw === undefined || raw.trim() === "") return DEFAULT_AGENT_SEMANTIC_MIN_SIMILARITY;
  const configured = Number(raw);
  if (!Number.isFinite(configured)) return DEFAULT_AGENT_SEMANTIC_MIN_SIMILARITY;
  return Math.min(1, Math.max(0, configured));
}
