import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  AgentRecommendationAdapter,
  AgentRecommendationInput,
  AgentRecommendationResult,
  AgentRecommendationStrategy,
} from "./agent_recommendation.adapter";
import { DeterministicRecommendationAdapter } from "./deterministic_recommendation.adapter";
import { ModelAssistedRecommendationAdapter } from "./model_assisted_recommendation.adapter";

const DEFAULT_RECOMMENDATION_STRATEGY: AgentRecommendationStrategy = "deterministic";

export function resolveAgentRecommendationStrategy(
  value = process.env.AGENT_RECOMMENDATION_STRATEGY,
): AgentRecommendationStrategy {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_RECOMMENDATION_STRATEGY;
  if (normalized === "deterministic") return "deterministic";
  if (normalized === "model-assisted" || normalized === "model_assisted") return "model-assisted";
  return DEFAULT_RECOMMENDATION_STRATEGY;
}

@Injectable()
export class AgentRecommendationService {
  private readonly logger = new Logger(AgentRecommendationService.name);

  constructor(
    private readonly deterministicAdapter: DeterministicRecommendationAdapter,
    @Optional()
    private readonly modelAssistedAdapter?: ModelAssistedRecommendationAdapter,
  ) {}

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
    if (strategy === "model-assisted") {
      return this.modelAssistedAdapter ?? this.deterministicAdapter;
    }
    if (strategy === "deterministic") {
      return this.deterministicAdapter;
    }
    return this.deterministicAdapter;
  }
}
