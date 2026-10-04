/**
 * Why an LLM runtime adapter could not produce picks (#2075). The executor
 * falls back to the deterministic orchestrator and records this categorical
 * reason, never the raw error text, on the decision event and Next Pick.
 */
export type AgentRuntimeFallbackReason = "not_configured" | "timeout" | "error";

export class AgentRuntimeUnavailableError extends Error {
  constructor(
    readonly reason: Exclude<AgentRuntimeFallbackReason, "error">,
    message: string,
  ) {
    super(message);
    this.name = "AgentRuntimeUnavailableError";
  }
}

/** Any other adapter failure (SDK error, network, malformed state) is `error`. */
export function agentRuntimeFallbackReason(error: unknown): AgentRuntimeFallbackReason {
  return error instanceof AgentRuntimeUnavailableError ? error.reason : "error";
}
