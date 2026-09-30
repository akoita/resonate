export type AgentSessionMode = "curate" | "buy";

/**
 * Operator flag: the AI DJ may only buy stems on a listener's behalf when
 * AGENT_SESSION_BUY_MODE_ENABLED is exactly "true". Default is off (#1954).
 */
export function isAgentSessionBuyModeEnabled(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return env.AGENT_SESSION_BUY_MODE_ENABLED === "true";
}

/**
 * Resolve the effective session mode. `buy` is honored only when the operator
 * flag is on; a stored `buy` with the flag off is downgraded to `curate`.
 */
export function resolveAgentSessionMode(
    stored: string | null | undefined,
    buyModeEnabled: boolean,
): { mode: AgentSessionMode; downgraded: boolean } {
    if (stored === "buy") {
        return buyModeEnabled
            ? { mode: "buy", downgraded: false }
            : { mode: "curate", downgraded: true };
    }
    return { mode: "curate", downgraded: false };
}
