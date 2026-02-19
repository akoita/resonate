export interface AgentRuntimeInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  budgetRemainingUsd: number;
  /** Budget available for Lyria AI generation ($0.06/clip). Defaults to $1.00. */
  generationBudgetUsd?: number;
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

export interface LlmGenerationPick {
  jobId: string;
  costUsd: number;
  prompt: string;
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
  /** Number of Lyria generations triggered during this session */
  generationsUsed?: number;
  /** Total USD spent on generations during this session */
  generationSpendUsd?: number;
  /** AI-generated track picks */
  generationPicks?: LlmGenerationPick[];
}

export interface AgentRuntimeAdapter {
  name: "vertex" | "langgraph" | "adk";
  run(input: AgentRuntimeInput): Promise<AgentRuntimeResult>;
}
