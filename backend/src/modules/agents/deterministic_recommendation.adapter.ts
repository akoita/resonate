import { Injectable } from "@nestjs/common";
import {
  AgentRecommendationAdapter,
  AgentRecommendationInput,
  AgentRecommendationResult,
} from "./agent_recommendation.adapter";
import { AgentSelectorService } from "./agent_selector.service";

export function buildAgentRecommendationQueries(
  preferences: AgentRecommendationInput["preferences"],
): string[] {
  const queries: string[] = [];
  if (preferences.genres?.length) {
    queries.push(...preferences.genres);
  }
  if (preferences.mood && !queries.includes(preferences.mood)) {
    queries.push(preferences.mood);
  }
  return queries;
}

@Injectable()
export class DeterministicRecommendationAdapter implements AgentRecommendationAdapter {
  readonly name = "deterministic" as const;

  constructor(private readonly selector: AgentSelectorService) {}

  async recommend(input: AgentRecommendationInput): Promise<AgentRecommendationResult> {
    const queries = buildAgentRecommendationQueries(input.preferences);
    const selection = await this.selector.select({
      userId: input.userId,
      queries,
      recentTrackIds: input.recentTrackIds,
      allowExplicit: input.preferences.allowExplicit,
      useEmbeddings: queries.length > 0,
      limit: input.limit,
      energy: input.preferences.energy,
      learnedGenreWeights: input.preferences.learnedGenreWeights,
    });

    return {
      strategy: this.name,
      candidates: selection.candidates,
      selected: selection.selected,
      rejected: selection.rejected,
      reason: selection.reason,
    };
  }
}
