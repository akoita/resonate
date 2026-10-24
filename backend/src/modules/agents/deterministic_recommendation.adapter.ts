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
import { requestScopeFor, SESSION_REQUEST_TEXT_MAX_LENGTH } from "./agent_session_request";
import { selectorSeedsFor } from "./agent_session_seed";
import { isDiscoveryLevel } from "../recommendations/discovery-policy";

/**
 * The catalog queries of a session. A session whose request names a catalog
 * constraint (a genre or a seed, #2316) searches for the request itself: its own
 * genres and moods. The learned favourites and saved vibes merged into
 * `preferences.genres` are NOT searched then (see {@link tasteQueriesFor}); they
 * stay ranking signals. Every other session searches its `genres` as before.
 */
export function buildAgentRecommendationQueries(
  preferences: AgentRecommendationInput["preferences"],
  myMixPlan?: ResolvedMyMixPlan,
): string[] {
  const queries: string[] = [];
  const scope = myMixPlan ? undefined : requestScopeFor(preferences);
  if (scope?.gated) {
    for (const term of [...scope.request.genres, ...scope.request.moods]) {
      if (!queries.some((query) => query.toLowerCase() === term.toLowerCase())) queries.push(term);
    }
    return queries;
  }
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
 * The learned favourites and saved vibes a request-first session does not search
 * (#2316): `preferences.genres` without the session's own genres. Empty for a
 * session without a gating request, whose `genres` are all queries.
 */
export function tasteQueriesFor(
  preferences: AgentRecommendationInput["preferences"],
  myMixPlan?: ResolvedMyMixPlan,
): string[] {
  const scope = myMixPlan ? undefined : requestScopeFor(preferences);
  if (!scope?.gated) return [];
  const own = new Set(scope.request.genres.map((genre) => genre.toLowerCase()));
  return (preferences.genres ?? []).filter((genre) => genre && !own.has(genre.toLowerCase()));
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
 * itself (genres, mood(s), an intent or a sentence); learned taste alone never
 * triggers it.
 *
 * The listener's own sentence (#2241) joins the query for this session only:
 * bounded, in memory, never stored or logged. The query text is identical on
 * every pick, which is what lets the embedding service reuse one vector.
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
  const sentence = clean([preferences.requestText])[0]
    ?.slice(0, SESSION_REQUEST_TEXT_MAX_LENGTH)
    .replace(/[\s.!?]+$/u, "");
  if (!intent && !sentence && genres.length === 0 && moods.length === 0) return undefined;

  const asked = new Set(genres.map((genre) => genre.toLowerCase()));
  const related = dedupe(
    genres.flatMap((genre) => relatedGenreLabels(genre, SEMANTIC_RELATED_STYLE_LIMIT)),
  )
    .filter((label) => !asked.has(label.toLowerCase()))
    .slice(0, SEMANTIC_RELATED_STYLE_LIMIT);

  const sentences: string[] = [];
  if (intent) sentences.push(intent);
  if (sentence) sentences.push(`Listener request: ${sentence}`);
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
  input: Pick<AgentRecommendationInput, "userId" | "recentTrackIds" | "preferences" | "limit" | "myMixPlan"> &
    Partial<Pick<AgentRecommendationInput, "sessionId">>,
): AgentSelectorInput {
  const queries = buildAgentRecommendationQueries(input.preferences, input.myMixPlan);
  const requestScope = input.myMixPlan ? undefined : requestScopeFor(input.preferences);
  const tasteQueries = tasteQueriesFor(input.preferences, input.myMixPlan);
  return {
    userId: input.userId,
    // The live session, so its own skips, saves and finishes steer this pick (#2247).
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    queries,
    ...(requestScope ? { requestScope } : {}),
    ...(tasteQueries.length > 0 ? { tasteQueries } : {}),
    ...(input.preferences.newArtists === true ? { newArtistsOnly: true } : {}),
    ...(isDiscoveryLevel(input.preferences.discovery) ? { discovery: input.preferences.discovery } : {}),
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
    ...(input.preferences.sessionGenres?.length ? { requestedGenres: input.preferences.sessionGenres } : {}),
    semanticQuery: buildSemanticSessionQuery(input.preferences),
    ...(input.preferences.seedTrackId ? { seedTrackId: input.preferences.seedTrackId } : {}),
    ...(input.preferences.artists?.length ? { seedArtists: input.preferences.artists } : {}),
    // The session's seed (#2244): a track, an artist or a playlist, kept for the live session.
    ...(selectorSeedsFor(input.preferences.seed) ? { seeds: selectorSeedsFor(input.preferences.seed) } : {}),
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
      ...(selection.heldBack ? { heldBack: selection.heldBack } : {}),
      ...(selection.capRelaxed ? { capRelaxed: selection.capRelaxed } : {}),
      ...(selection.shortfallReason ? { shortfallReason: selection.shortfallReason } : {}),
    };
  }
}
