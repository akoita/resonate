const DEFAULT_AGENT_TRACK_LIMIT = 5;

export function getAgentTrackLimit() {
  const configured = Number.parseInt(process.env.AGENT_TRACK_LIMIT ?? "", 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_AGENT_TRACK_LIMIT;
  }
  return Math.min(configured, 50);
}

export type AgentSessionMode = "curate" | "buy";

export type ResolvedAgentSessionMode = {
  mode: AgentSessionMode;
  /** True when a stored `buy` config was treated as `curate` because the operator flag is off. */
  downgraded: boolean;
};

/**
 * ADR-TE-1: the listener AI DJ never buys without a quote the listener approved.
 * Autonomous `buy` sessions stay reachable only behind this operator flag
 * (default off) until the Crate Digger quote flow replaces them.
 */
export function isAgentSessionBuyModeEnabled() {
  const raw = (process.env.AGENT_SESSION_BUY_MODE_ENABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function resolveAgentSessionMode(stored: string | null | undefined): ResolvedAgentSessionMode {
  if (stored !== "buy") {
    return { mode: "curate", downgraded: false };
  }
  if (isAgentSessionBuyModeEnabled()) {
    return { mode: "buy", downgraded: false };
  }
  return { mode: "curate", downgraded: true };
}
