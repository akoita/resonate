import { Injectable } from "@nestjs/common";
import {
  AgentRecommendationAdapter,
  AgentRecommendationInput,
  AgentRecommendationResult,
} from "./agent_recommendation.adapter";
import { AgentSelectorService } from "./agent_selector.service";
import type { AgentSelectorInput } from "./agent_selector.service";
import { myMixSearchTerms } from "./agent_my_mix";
import type { ResolvedMyMixPlan } from "./agent_my_mix";
import { relatedGenreLabels } from "../recommendations/genre_families";

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

/**
 * What the session itself asked for (#2059): its own genres plus its mood(s),
 * never the learned favourites or saved vibes merged into `genres`.
 */
export function requestedTermsFor(
  preferences: AgentRecommendationInput["preferences"],
): { requestedTerms?: string[] } {
  const terms = [
    ...(preferences.sessionGenres ?? []),
    ...(preferences.mood ? [preferences.mood] : []),
    ...(preferences.moods ?? []),
  ]
    .map((term) => term?.trim())
    .filter((term): term is string => Boolean(term));
  const seen = new Set<string>();
  const unique = terms.filter((term) => !seen.has(term.toLowerCase()) && Boolean(seen.add(term.toLowerCase())));
  return unique.length ? { requestedTerms: unique } : {};
}

const SEMANTIC_RELATED_STYLE_LIMIT = 8;

/**
 * The session the listener asked for, described in words for catalog-wide
 * semantic retrieval (#2088). Undefined unless the session asked for something
 * itself (genres, mood(s) or an intent); learned taste alone never triggers it.
 */
export function buildSemanticSessionQuery(
  preferences: AgentRecommendationInput["preferences"],
): string | undefined {
  const clean = (values: Array<string | undefined | null>) =>
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
  const dedupe = (values: string[]) => {
    const seen = new Set<string>();
    return values.filter((value) => !seen.has(value.toLowerCase()) && Boolean(seen.add(value.toLowerCase())));
  };

  const intent = clean([preferences.sessionIntentName ?? preferences.sessionIntent])[0];
  const genres = dedupe(clean(preferences.sessionGenres ?? []));
  const moods = dedupe(clean([preferences.mood, ...(preferences.moods ?? [])]));
  if (!intent && genres.length === 0 && moods.length === 0) return undefined;

  const asked = new Set(genres.map((genre) => genre.toLowerCase()));
  const related = dedupe(
    genres.flatMap((genre) => relatedGenreLabels(genre, SEMANTIC_RELATED_STYLE_LIMIT)),
  )
    .filter((label) => !asked.has(label.toLowerCase()))
    .slice(0, SEMANTIC_RELATED_STYLE_LIMIT);

  const sentences: string[] = [];
  if (intent) sentences.push(intent);
  if (genres.length > 0) {
    sentences.push(
      `Genres: ${genres.join(", ")}${related.length > 0 ? `, plus related styles: ${related.join(", ")}` : ""}`,
    );
  }
  if (moods.length > 0) sentences.push(`Mood: ${moods.join(", ")}`);
  if (preferences.energy) sentences.push(`Energy: ${preferences.energy}`);
  return `${sentences.join(". ")}.`;
}

/**
 * The selector request for one listening session, shared by the rule-based
 * adapter and the LLM runtime's top-up (`AgentRuntimePolicyService`), so both
 * rank the catalog the same way.
 */
export function deterministicSelectorInput(
  input: Pick<AgentRecommendationInput, "userId" | "recentTrackIds" | "preferences" | "limit" | "myMixPlan">,
): AgentSelectorInput {
  const queries = buildAgentRecommendationQueries(input.preferences, input.myMixPlan);
  return {
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
    ...requestedTermsFor(input.preferences),
    semanticQuery: buildSemanticSessionQuery(input.preferences),
    myMixPlan: input.myMixPlan,
  };
}

@Injectable()
export class DeterministicRecommendationAdapter implements AgentRecommendationAdapter {
  readonly name = "deterministic" as const;

  constructor(private readonly selector: AgentSelectorService) {}

  async recommend(input: AgentRecommendationInput): Promise<AgentRecommendationResult> {
    const selection = await this.selector.select(deterministicSelectorInput(input));

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
