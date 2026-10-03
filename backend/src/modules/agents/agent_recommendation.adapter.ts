import type { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";
import type { AgentCandidateTrack } from "./agent_selector.service";
import type { ResolvedMyMixPlan } from "./agent_my_mix";
import type { MixCoverage } from "./agent_my_mix";

export type AgentRecommendationStrategy = "deterministic" | "model-assisted";

export interface AgentRejectedCandidate {
  trackId: string;
  reason: string;
}

export interface AgentRecommendationInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  preferences: AgentRuntimeInput["preferences"];
  limit: number;
  /** Trusted server-resolved plan; never accepted from runtime wire input. */
  myMixPlan?: ResolvedMyMixPlan;
}

export interface AgentRecommendationResult {
  strategy: AgentRecommendationStrategy;
  candidates: string[];
  selected: AgentCandidateTrack[];
  rejected: AgentRejectedCandidate[];
  reason: string;
  /** Private My Mix coverage; kept inside the owner-bound session response path. */
  mixCoverage?: MixCoverage;
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
