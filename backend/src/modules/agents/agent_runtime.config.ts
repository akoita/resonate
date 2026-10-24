/**
 * Default selection target of one AI DJ pick (env `AGENT_TRACK_LIMIT`, capped at
 * 50). 5 cut a request's sixth strong match off a small catalog (staging
 * feedback: a three-genre hip-hop session showed 5 picks); 12 shows a whole
 * small catalog's matches while the per-artist cap (2) and the explicit
 * preference still apply. Continuations ask for the same target, not more.
 */
const DEFAULT_AGENT_TRACK_LIMIT = 12;

export function getAgentTrackLimit() {
  const configured = Number.parseInt(process.env.AGENT_TRACK_LIMIT ?? "", 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_AGENT_TRACK_LIMIT;
  }
  return Math.min(configured, 50);
}

const DEFAULT_AGENT_SESSION_HISTORY_LIMIT = 5;
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

/**
 * Hybrid retrieval (`hybrid_rrf_v1`, #2242) replaces the single fixed floor
 * with top-k plus a calibrated floor: of the `limit` nearest neighbours, keep
 * those at or above `max(absolute floor, best score - margin)`.
 *  - The absolute floor is lower than the fixed one (a relevant track just
 *    under 0.55 is no longer dropped), and `AGENT_SEMANTIC_MIN_SIMILARITY`
 *    still overrides it when set.
 *  - The relative margin trims a long tail behind a strong match, so the lower
 *    floor does not flood the list with weak neighbours.
 *  - When even the best neighbour is under the absolute floor nothing is kept,
 *    so a request nothing resembles stays unmet (ADR-TE-4).
 */
export const CALIBRATED_SEMANTIC_ABSOLUTE_FLOOR = 0.5;
export const CALIBRATED_SEMANTIC_RELATIVE_MARGIN = 0.15;

export function calibratedSemanticFloor(topScore: number): number {
  const raw = process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
  const overridden = raw !== undefined && raw.trim() !== "" && Number.isFinite(Number(raw));
  const absolute = overridden ? getAgentSemanticMinSimilarity() : CALIBRATED_SEMANTIC_ABSOLUTE_FLOOR;
  return Math.max(absolute, topScore - CALIBRATED_SEMANTIC_RELATIVE_MARGIN);
}
