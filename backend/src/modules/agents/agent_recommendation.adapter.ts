import type { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";
import type { AgentCandidateTrack } from "./agent_selector.service";

export type AgentRecommendationStrategy = "deterministic" | "model-assisted";

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
  trace?: {
    strategy: AgentRecommendationStrategy;
    fallbackReason?: string;
    model?: string;
    summary?: string;
    decisions?: AgentModelRankingDecision[];
  };
}

export interface AgentRecommendationAdapter {
  name: AgentRecommendationStrategy;
  recommend(input: AgentRecommendationInput): Promise<AgentRecommendationResult>;
}

export interface AgentModelRankingDecision {
  trackId: string;
  action: "select" | "reject";
  relevance: "exact" | "semantic" | "none";
  confidence: number;
  rank: number;
  explanation?: string;
  rejectionReason?: string;
}
