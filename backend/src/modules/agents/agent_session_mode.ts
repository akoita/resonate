export type AgentSessionMode = "curate" | "buy";

/**
 * ADR-TE-1: the AI DJ never buys on a listener's behalf without an approved
 * quote. Stored `buy` sessions are honored only while an operator has enabled
 * `AGENT_SESSION_BUY_MODE_ENABLED`; the flag is off by default.
 */
export function isAgentSessionBuyModeEnabled(): boolean {
    return process.env.AGENT_SESSION_BUY_MODE_ENABLED?.trim().toLowerCase() === "true";
}

export function resolveEffectiveSessionMode(storedMode: string | null | undefined): AgentSessionMode {
    return storedMode === "buy" && isAgentSessionBuyModeEnabled() ? "buy" : "curate";
}
