export interface AgentRuntimeInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  budgetRemainingUsd: number;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    stemTypes?: string[];
    learnedGenreWeights?: Record<string, number>;
    allowExplicit?: boolean;
    licenseType?: "personal" | "remix" | "commercial";
    sessionIntent?: string;
    sessionIntentName?: string;
    queueStyle?: string;
    source?: string;
  };
}

export interface LlmTrackPick {
  trackId: string;
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: number;
  /**
   * Set by the runtime policy step (`AgentRuntimePolicyService`), never by the
   * model: the shared ranking core's view of the picked track.
   */
  score?: number;
  explanation?: string[];
  /** Primary categorical reason from the shared discovery vocabulary. */
  reasonCode?: string;
  signals?: Array<{ label: string; weight: number; reason: string }>;
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
  /** Runtime policy step accounting (rules 1, 2, 4), when it ran. */
  policy?: { dropped: { hidden: number; aiGenerated: number; diversity: number; unknown: number } };
}

export interface AgentRuntimeAdapter {
  name: "vertex" | "langgraph" | "adk";
  run(input: AgentRuntimeInput): Promise<AgentRuntimeResult>;
}
