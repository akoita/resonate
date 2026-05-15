import type { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";
import type { AgentCandidateTrack } from "./agent_selector.service";

export type AgentRecommendationStrategy = "deterministic";

export interface AgentRejectedCandidate {
  trackId: string;
  reason: string;
}

export interface AgentRecommendationInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  budgetRemainingUsd: number;
  preferences: AgentRuntimeInput["preferences"];
  limit: number;
}

export interface AgentRecommendationResult {
  strategy: AgentRecommendationStrategy;
  candidates: string[];
  selected: AgentCandidateTrack[];
  rejected: AgentRejectedCandidate[];
  reason: string;
}

export interface AgentRecommendationAdapter {
  name: AgentRecommendationStrategy;
  recommend(input: AgentRecommendationInput): Promise<AgentRecommendationResult>;
}
