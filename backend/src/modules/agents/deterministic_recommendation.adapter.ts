import { Injectable } from "@nestjs/common";
import {
  AgentRecommendationAdapter,
  AgentRecommendationInput,
  AgentRecommendationResult,
} from "./agent_recommendation.adapter";
import { AgentSelectorService } from "./agent_selector.service";
import { myMixSearchTerms } from "./agent_my_mix";
import type { ResolvedMyMixPlan } from "./agent_my_mix";

export function buildAgentRecommendationQueries(
  preferences: AgentRecommendationInput["preferences"],
  myMixPlan?: ResolvedMyMixPlan,
): string[] {
  const queries: string[] = [];
  if (preferences.genres?.length) {
    queries.push(...preferences.genres);
  }
  if (preferences.mood && !queries.includes(preferences.mood)) {
    queries.push(preferences.mood);
  }
  // Every mood the listener described is also a search query (#2037).
  for (const mood of preferences.moods ?? []) {
    const trimmed = mood?.trim();
    if (!trimmed) continue;
    if (queries.some((query) => query.toLowerCase() === trimmed.toLowerCase())) continue;
    queries.push(trimmed);
  }
  for (const term of myMixPlan ? myMixSearchTerms(myMixPlan) : []) {
    if (!queries.some((query) => query.toLowerCase() === term.toLowerCase())) queries.push(term);
  }
  return queries;
}

@Injectable()
export class DeterministicRecommendationAdapter implements AgentRecommendationAdapter {
  readonly name = "deterministic" as const;

  constructor(private readonly selector: AgentSelectorService) {}

  async recommend(input: AgentRecommendationInput): Promise<AgentRecommendationResult> {
    const queries = buildAgentRecommendationQueries(input.preferences, input.myMixPlan);
    const selection = await this.selector.select({
      userId: input.userId,
      queries,
      recentTrackIds: input.recentTrackIds,
      allowExplicit: input.preferences.allowExplicit,
      useEmbeddings: queries.length > 0,
      limit: input.limit,
      energy: input.preferences.energy,
      learnedGenreWeights: input.preferences.learnedGenreWeights,
      // Session intent is ranking context for this request (WS-9), not taste.
      sessionIntent: input.preferences.sessionIntent,
      mood: input.preferences.mood,
      queueStyle: input.preferences.queueStyle,
      tempoBpm: input.preferences.tempoBpm,
      // Listening sessions never dead-end while an unplayed track fits (#2056).
      fallback: true,
      myMixPlan: input.myMixPlan,
    });

    return {
      strategy: this.name,
      candidates: selection.candidates,
      selected: selection.selected,
      rejected: selection.rejected,
      reason: selection.reason,
      ...(selection.mixCoverage ? { mixCoverage: selection.mixCoverage } : {}),
    };
  }
}
