export interface AgentRuntimeInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  budgetRemainingUsd: number;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    allowExplicit?: boolean;
    licenseType?: "personal" | "remix" | "commercial";
  };
}

export interface LlmTrackPick {
  trackId: string;
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: number;
}

export interface AgentRuntimeResult {
  status: "approved" | "rejected";
  trackId?: string;
  licenseType?: "personal" | "remix" | "commercial";
  priceUsd?: number;
  reason?: string;
  /** LLM-generated explanation for why these tracks were selected */
  reasoning?: string;
  /** Time taken for the adapter to produce a result, in milliseconds */
  latencyMs?: number;
  /** Multiple track picks from the LLM */
  picks?: LlmTrackPick[];
}

export interface AgentRuntimeAdapter {
  name: "vertex" | "langgraph";
  run(input: AgentRuntimeInput): Promise<AgentRuntimeResult>;
}
