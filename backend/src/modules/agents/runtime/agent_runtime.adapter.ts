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

export interface AgentRuntimeResult {
  status: "approved" | "rejected";
  trackId?: string;
  licenseType?: "personal" | "remix" | "commercial";
  priceUsd?: number;
  reason?: string;
}

export interface AgentRuntimeAdapter {
  name: "vertex" | "langgraph";
  run(input: AgentRuntimeInput): Promise<AgentRuntimeResult>;
}
