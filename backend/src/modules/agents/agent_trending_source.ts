/**
 * Trending as a hybrid retrieval source (#2246): the pure parts.
 *
 * "Trending in your genre families" brings popular tracks into the candidate
 * pool; it never ranks, never fills a request, and never reaches a payout:
 *  - it is one more source in `hybrid_rrf_v1` (the ranking core, taste policy,
 *    explicit preference and AI-promotion filter run after fusion, unchanged);
 *  - the tracks only it found fill at most a capped share of the fused
 *    candidates (see `capSourceShare`, `AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT`);
 *  - for a session that asked for something it contributes only tracks that
 *    already match the request (tier A or B of #2316), so it can never put an
 *    off-request track in front of, or instead of, a request match;
 *  - without a request it reads the listener's top genre families;
 *  - the popularity itself comes from the serving tables behind Home's Trending
 *    rail, which enforce `DISCOVERY_MIN_AUDIENCE` and never fall back to
 *    recency: low data contributes nothing.
 * Popularity is an engagement signal, not a payout input (ADR-BM-4), and
 * ranking is never for sale (ADR-TE-2): `hasListing` is not read here.
 */

import {
  genreFamiliesFor,
  genreFamilyById,
  type GenreFamily,
} from "../recommendations/genre_families";
import { familyTasteWeights } from "./agent_sounds";
import {
  requestTierOf,
  tierMatchesRequest,
  type AgentRequestScope,
} from "./agent_session_request";

/** Most genre families one pick's trending read covers. */
export const TRENDING_MAX_FAMILIES = 2;

export interface TrendingFamilyInput {
  /** The session's request scope; absent when the listener asked for nothing. */
  scope?: AgentRequestScope;
  /** The listener's learned genre weights (the shared taste profile). */
  genreWeights?: Readonly<Record<string, number>> | null;
  /** True when the listener hid this family label (a hidden taste is never trended). */
  isHidden?: (familyLabel: string) => boolean;
}

/**
 * The genre families whose trending tracks may enter this pick's pool.
 *  - a request that names genres: the families those genres name (only on-request
 *    tracks are admitted, see {@link admitTrendingTrack});
 *  - a seed-only request: none (the seed steers it);
 *  - otherwise the listener's top positive-taste families; no taste, no families.
 */
export function trendingFamiliesFor(input: TrendingFamilyInput): GenreFamily[] {
  const { scope } = input;
  const families: GenreFamily[] = [];
  const add = (family: GenreFamily | undefined) => {
    if (!family || families.some((existing) => existing.id === family.id)) return;
    if (input.isHidden?.(family.label)) return;
    families.push(family);
  };
  if (scope && scope.request.genres.length > 0) {
    for (const genre of scope.request.genres) {
      for (const family of genreFamiliesFor(genre)) add(family);
    }
  } else if (scope?.gated) {
    // A seed steers this session; trending has no family to add.
    return [];
  } else {
    const taste = [...familyTasteWeights(input.genreWeights)].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    for (const [familyId] of taste) add(genreFamilyById(familyId));
  }
  return families.slice(0, TRENDING_MAX_FAMILIES);
}

/** The facts of one trending track the request tier reads. */
export interface TrendingTrackFacts {
  release?: { genre?: string | null; moods?: string[] | null } | null;
  descriptor?: { families?: string[] | null; energyBand?: string | null } | null;
}

/**
 * Whether a trending track may enter the pool. A session without a request admits
 * any; a session with one admits only tracks that match it (tier A or B of the
 * shared request predicate, so selection, display and this source can never
 * disagree about what "matches" means).
 */
export function admitTrendingTrack(scope: AgentRequestScope | undefined, track: TrendingTrackFacts): boolean {
  if (!scope) return true;
  const tier = requestTierOf(scope, {
    genre: track.release?.genre ?? null,
    descriptorFamilies: track.descriptor?.families ?? [],
    moods: track.release?.moods ?? [],
    ...(track.descriptor?.energyBand ? { energyBand: track.descriptor.energyBand } : {}),
    tempoMeasured: false,
    seedMatched: false,
  });
  return tierMatchesRequest(tier);
}
