import { Injectable, Logger } from "@nestjs/common";
import {
  AgentRecommendationAdapter,
  AgentRecommendationInput,
  AgentRecommendationResult,
  AgentRecommendationStrategy,
} from "./agent_recommendation.adapter";
import { DeterministicRecommendationAdapter } from "./deterministic_recommendation.adapter";

const DEFAULT_RECOMMENDATION_STRATEGY: AgentRecommendationStrategy = "deterministic";

export function resolveAgentRecommendationStrategy(
  value = process.env.AGENT_RECOMMENDATION_STRATEGY,
): AgentRecommendationStrategy {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_RECOMMENDATION_STRATEGY;
  if (normalized === "deterministic") return "deterministic";
  return DEFAULT_RECOMMENDATION_STRATEGY;
}

@Injectable()
export class AgentRecommendationService {
  private readonly logger = new Logger(AgentRecommendationService.name);

  constructor(private readonly deterministicAdapter: DeterministicRecommendationAdapter) {}

  async recommend(input: AgentRecommendationInput): Promise<AgentRecommendationResult> {
    const requested = process.env.AGENT_RECOMMENDATION_STRATEGY;
    const strategy = resolveAgentRecommendationStrategy(requested);
    if (requested && requested.trim().toLowerCase() !== strategy) {
      this.logger.warn(
        `Unknown AGENT_RECOMMENDATION_STRATEGY=${requested}; using ${strategy}`
      );
    }
    return this.getAdapter(strategy).recommend(input);
  }

  private getAdapter(strategy: AgentRecommendationStrategy): AgentRecommendationAdapter {
    if (strategy === "deterministic") {
      return this.deterministicAdapter;
    }
    return this.deterministicAdapter;
  }
}
