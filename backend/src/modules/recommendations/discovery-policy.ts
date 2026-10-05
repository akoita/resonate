import { isPromotionEligible } from "../catalog/ai-disclosure.policy";
import {
  DISCOVERY_EXPLANATIONS,
  DiscoveryReasonCode,
  primaryReasonFor,
} from "./discovery-explanations";
import type {
  DiscoveryCandidate,
  RankedDiscoveryCandidate,
} from "./discovery-ranking.service";
import { hasSignal, TasteMemoryPolicy } from "./taste_memory.service";

/**
 * The discovery policy stage (ADR-TE-2, docs/rfc/taste-engine.md §3.4).
 *
 * Runs AFTER scoring (`DiscoveryRankingService.rank`) on every surface that
 * recommends music. It is a pure function: no I/O, no clock, no randomness.
 * The two lookups it needs (which artists are verified humans, which the
 * listener has played) are loaded by `DiscoveryPolicyContextService` and
 * passed in as plain sets.
 *
 * The six rules, in the order they are applied:
 *  1. Declared taste first. Anything the listener hid (taste memory `hidden`:
 *     genre, mood, artist, scene, intent ...) is removed. Downranks were
 *     already applied as score multipliers by the ranking core.
 *  2. Fully AI-generated tracks are removed unless the request explicitly
 *     asked for AI content (`allowAiContent`), via `isPromotionEligible`.
 *  3. Exploration share: default 20% of the page (or session), at least one
 *     item, reserved for verified human artists the listener has never
 *     played, chosen by taste fit (highest ranked score). With no eligible
 *     candidate the slots fall back to normal ranked order; ineligible items
 *     are never labeled as discovery.
 *  4. Diversity cap: at most two tracks per credited artist per page, or per 10
 *     session tracks when the caller passes the artists of the prior session
 *     tracks.
 *  5. Every returned item carries a non-empty categorical explanation and a
 *     `reasonCode` from the shared vocabulary (`discovery-explanations.ts`).
 *  6. No input through which ranking could be bought. This module reads no
 *     payment, placement, partner or commercial-availability data; there is
 *     no option, field or signal it consults for that, and `hasListing` is
 *     ignored here exactly as in the ranking core.
 */

export const DISCOVERY_POLICY_DEFAULTS = {
  /** Share of the page/session reserved for exploration (rule 3). */
  explorationShare: 0.2,
  /** Maximum tracks per credited artist per page / per 10 session tracks (rule 4). */
  maxPerArtist: 2,
  /** Session window for the diversity cap: prior tracks considered + 1. */
  sessionWindow: 10,
} as const;

const FIRST_LISTENER_TASTE_SIGNALS = new Set([
  "taste_match",
  "expanded_taste_match",
  "learned_preference",
  "declared_preference",
  "embedding_similarity",
  "semantic_similarity",
  "declared_note_match",
  "bigquery_taste_score",
  "session_intent_fit",
]);

export interface DiscoveryPolicyOptions {
  /** Page size: the maximum number of items returned. */
  limit: number;
  /** Listener taste memory; its `hidden` controls are enforced (rule 1). */
  tastePolicy?: TasteMemoryPolicy;
  /** True only when the request explicitly asked for AI content (rule 2). */
  allowAiContent?: boolean;
  /** Default `DISCOVERY_POLICY_DEFAULTS.explorationShare`. */
  explorationShare?: number;
  /** Default `DISCOVERY_POLICY_DEFAULTS.maxPerArtist`. */
  maxPerArtist?: number;
  /** Artist ids with a human-verified creator (see the context service). */
  verifiedHumanArtistIds?: ReadonlySet<string>;
  /** Artist ids the listener has any recorded interaction with. */
  playedArtistIds?: ReadonlySet<string>;
  /**
   * Session mode. Artist keys (see `discoveryArtistKey`) of the most recent
   * session tracks; only the last 9 are used, so the cap is per 10 session
   * tracks counting the page being built. Omit for plain page mode.
   */
  priorSessionArtistKeys?: readonly string[];
  /**
   * Session mode. How many of those prior tracks were exploration picks, so
   * the exploration share is per session, not per call (a one-track "next
   * pick" call must not always be a discovery pick). When `undefined` the
   * prior count is unknown, so the target falls back to the page alone
   * (`limit` only, not the session window): an unknown count must never
   * inflate the reserve by treating every prior track as a missed exploration
   * slot (9 prior + limit 5 would otherwise reserve 3 of 5 instead of 1).
   */
  priorExplorationCount?: number;
  /** Optional, session-only My Mix quotas applied inside this same policy pass. */
  laneQuotas?: readonly { id: string; requested: number; strength: number }[];
  /** Strict metadata matches computed by the caller; fuzzy query hits are not included. */
  laneMatchesByCandidateId?: ReadonlyMap<string, readonly string[]>;
  /** Per-lane score order computed from the already-loaded shared candidate facts. */
  laneCandidateOrderByLaneId?: ReadonlyMap<string, readonly string[]>;
}

export interface DiscoveryPolicyResult<T extends RankedDiscoveryCandidate> {
  items: T[];
  dropped: { hidden: number; aiGenerated: number; diversity: number };
  exploration: { reserved: number; served: number };
  /** Candidate ID to private lane ID; callers must keep this out of broadcast events. */
  laneAssignments?: Map<string, string>;
}

/**
 * Identity used for the diversity cap: the CREDITED artist, i.e. the performer
 * the listener hears. That is the normalized credited name (#1492); when no
 * name is known, `artistId`; otherwise the track id, so an unknown artist never
 * collides with another track. `artistId` is deliberately not first: it is the
 * uploading profile, and one profile can carry releases credited to many
 * different performers (a label, a manager or an aggregator account), which
 * would collapse them all into one "artist" and starve the page. Prefixed so
 * names, ids and track ids cannot collide with each other.
 */
export function discoveryArtistKey(
  candidate: Pick<DiscoveryCandidate, "id" | "artistId" | "artist" | "release">,
): string {
  const name = creditedArtistKey(candidate.release?.artistDisplayName ?? candidate.artist);
  if (name) return `name:${name}`;
  if (candidate.artistId) return `id:${candidate.artistId}`;
  return `track:${candidate.id}`;
}

export function applyDiscoveryPolicy<T extends RankedDiscoveryCandidate>(
  ranked: readonly T[],
  options: DiscoveryPolicyOptions,
): DiscoveryPolicyResult<T> {
  const limit = Math.max(0, Math.floor(options.limit));
  const dropped = { hidden: 0, aiGenerated: 0, diversity: 0 };
  if (limit === 0) {
    return { items: [], dropped, exploration: { reserved: 0, served: 0 } };
  }

  const maxPerArtist = Math.max(
    1,
    Math.floor(options.maxPerArtist ?? DISCOVERY_POLICY_DEFAULTS.maxPerArtist),
  );
  const share = options.explorationShare ?? DISCOVERY_POLICY_DEFAULTS.explorationShare;
  const verified = options.verifiedHumanArtistIds ?? new Set<string>();
  const played = options.playedArtistIds ?? new Set<string>();

  // Rules 1 and 2: declared taste, then AI. Hidden wins the accounting when
  // both apply, so each dropped candidate is counted once.
  const eligible: T[] = [];
  for (const candidate of ranked) {
    if (options.tastePolicy && isHiddenByListener(candidate, options.tastePolicy)) {
      dropped.hidden += 1;
      continue;
    }
    if (!options.allowAiContent && !isPromotionEligible(candidate.aiDisclosureLevel)) {
      dropped.aiGenerated += 1;
      continue;
    }
    eligible.push(candidate);
  }

  // Session mode seeds the diversity counts and the exploration window.
  const priorKeys = (options.priorSessionArtistKeys ?? []).slice(
    -(DISCOVERY_POLICY_DEFAULTS.sessionWindow - 1),
  );
  const sessionMode = options.priorSessionArtistKeys !== undefined;
  const counts = new Map<string, number>();
  for (const key of priorKeys) counts.set(key, (counts.get(key) ?? 0) + 1);

  // Rule 3: number of reserved exploration slots. The session window only
  // applies when the prior exploration count is known; otherwise the share is
  // taken over this page alone.
  const knownPriorExploration =
    sessionMode && options.priorExplorationCount !== undefined;
  const windowSize = knownPriorExploration ? priorKeys.length + limit : limit;
  const target = Math.max(1, Math.round(windowSize * share));
  const alreadyExplored = knownPriorExploration
    ? Math.max(0, Math.floor(options.priorExplorationCount ?? 0))
    : 0;
  // Never catch up in a burst: one call reserves at most its own page share,
  // so a session that fell behind on discovery stays near "one in five"
  // instead of turning a whole page into discovery picks.
  const pageShare = Math.max(1, Math.round(limit * share));
  const reserved = Math.min(limit, pageShare, Math.max(0, target - alreadyExplored));

  const chosen = new Set<T>();
  const explorationPicks = new Set<T>();
  const laneAssignments = new Map<string, string>();
  const assignedPerLane = new Map<string, number>();
  const laneQuotas = [...(options.laneQuotas ?? [])]
    .filter((lane) => lane.id && Number.isFinite(lane.requested) && lane.requested >= 0)
    .map((lane) => ({
      id: lane.id,
      requested: Math.floor(lane.requested),
      strength: Number.isFinite(lane.strength) && lane.strength > 0 ? lane.strength : 0,
    }))
    .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
  const candidateLaneIds = (candidate: T) =>
    (options.laneMatchesByCandidateId?.get(candidate.id) ?? [])
      .filter((id) => laneQuotas.some((lane) => lane.id === id));
  const eligibleById = new Map(eligible.map((candidate) => [candidate.id, candidate]));
  const laneCandidatesInRankOrder = (laneId: string) => {
    const preferred = options.laneCandidateOrderByLaneId?.get(laneId);
    if (!preferred) return eligible.filter((candidate) => candidateLaneIds(candidate).includes(laneId));
    return preferred
      .map((id) => eligibleById.get(id))
      .filter((candidate): candidate is T => Boolean(candidate));
  };
  const chooseLane = (candidate: T, onlyDeficit = false) => {
    const matching = candidateLaneIds(candidate)
      .map((id) => laneQuotas.find((lane) => lane.id === id)!)
      .filter((lane) => !onlyDeficit || (assignedPerLane.get(lane.id) ?? 0) < lane.requested)
      .sort((a, b) => {
        const aDeficit = Math.max(0, a.requested - (assignedPerLane.get(a.id) ?? 0));
        const bDeficit = Math.max(0, b.requested - (assignedPerLane.get(b.id) ?? 0));
        return bDeficit - aDeficit || b.strength - a.strength || a.id.localeCompare(b.id);
      });
    return matching[0]?.id;
  };
  const withinCap = (candidate: T) =>
    (counts.get(discoveryArtistKey(candidate)) ?? 0) < maxPerArtist;
  const take = (candidate: T, laneId?: string) => {
    const key = discoveryArtistKey(candidate);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    chosen.add(candidate);
    if (laneId) {
      laneAssignments.set(candidate.id, laneId);
      assignedPerLane.set(laneId, (assignedPerLane.get(laneId) ?? 0) + 1);
    }
  };

  // Eligible exploration candidates: a known artist id that is a verified
  // human, that the listener has never played, with a positive taste score. Recently served tracks are
  // not "new", so they are never discovery picks. `ranked` is score-sorted, so
  // a stable sort here only guards callers that pass unsorted input. Fresh
  // first-listener candidates need a named, positive taste signal as well as a
  // positive total score; they receive priority only inside these reserved
  // exploration positions.
  if (reserved > 0) {
    const explorationPool = eligible
      .filter(
        (candidate) =>
          !!candidate.artistId &&
          candidate.aiDisclosureLevel !== "ALL" &&
          !candidate.recentlyPlayed &&
          candidate.score > 0 &&
          (!candidate.firstListenerEligible ||
          hasPositiveFirstListenerTasteSignal(candidate)) &&
          verified.has(candidate.artistId) &&
          !played.has(candidate.artistId),
      )
      .map((candidate, index) => ({ candidate, index }))
      .sort(
        (a, b) =>
          Number(Boolean(b.candidate.firstListenerEligible)) -
            Number(Boolean(a.candidate.firstListenerEligible)) ||
          b.candidate.score - a.candidate.score ||
          a.index - b.index,
      );
    for (const { candidate } of explorationPool) {
      if (explorationPicks.size >= reserved) break;
      if (!withinCap(candidate)) continue;
      take(candidate, chooseLane(candidate, true) ?? chooseLane(candidate));
      explorationPicks.add(candidate);
    }
  }

  // My Mix lane quotas are enforced after exploration reservation, so policy
  // removal, exploration and diversity still run globally exactly once.
  for (const lane of laneQuotas) {
    while ((assignedPerLane.get(lane.id) ?? 0) < lane.requested && chosen.size < limit) {
      const candidate = laneCandidatesInRankOrder(lane.id).find((entry) =>
        !chosen.has(entry) &&
        withinCap(entry),
      );
      if (!candidate) break;
      take(candidate, lane.id);
    }
  }

  // Unfilled quotas transfer to the strongest remaining matching lane. Picks
  // without any exact catalog lane match remain for the ordinary fallback.
  if (laneQuotas.length > 0) {
    for (const lane of laneQuotas) {
      for (const candidate of laneCandidatesInRankOrder(lane.id)) {
        if (chosen.size >= limit) break;
        if (chosen.has(candidate) || !withinCap(candidate)) continue;
        take(candidate, lane.id);
      }
      if (chosen.size >= limit) break;
    }
  }

  // Remaining slots (including any exploration slots nobody could fill) in
  // normal ranked order, under the diversity cap.
  for (const candidate of eligible) {
    if (chosen.size >= limit) break;
    if (chosen.has(candidate)) continue;
    if (!withinCap(candidate)) {
      dropped.diversity += 1;
      continue;
    }
    take(candidate);
  }

  // Final order is the ranked order of the chosen set. Exploration picks keep
  // their score position instead of being pinned to the top or bottom, so the
  // page reads as one ranked list and a discovery pick surfaces wherever its
  // taste fit puts it.
  const items = eligible
    .filter((candidate) => chosen.has(candidate))
    .map((candidate) =>
      explorationPicks.has(candidate)
        ? asDiscoveryPick(candidate)
        : withGuaranteedReason(candidate),
    );

  return {
    items,
    dropped,
    exploration: { reserved, served: explorationPicks.size },
    ...(laneQuotas.length ? { laneAssignments } : {}),
  };
}

/**
 * Resolves a reservation attempt without returning an unreserved first-listener
 * source item. Accepted placements keep their exploration eligibility; all
 * other fresh-source candidates leave the pool before the ordinary policy is
 * rerun, so available baseline candidates can fill the page safely.
 */
export function applyFirstListenerReservationOutcome<
  T extends RankedDiscoveryCandidate,
>(
  ranked: readonly T[],
  initial: DiscoveryPolicyResult<T>,
  reservedReleaseIds: ReadonlySet<string>,
  options: DiscoveryPolicyOptions,
): DiscoveryPolicyResult<T> {
  const reservedCandidateIds = new Set(
    initial.items
      .filter(
        (candidate) =>
          candidate.firstListenerEligible &&
          candidate.reasonCode === "discovery_pick" &&
          candidate.releaseId &&
          reservedReleaseIds.has(candidate.releaseId),
      )
      .map((candidate) => candidate.id),
  );
  return applyDiscoveryPolicy(
    ranked.filter(
      (candidate) =>
        !candidate.firstListenerEligible || reservedCandidateIds.has(candidate.id),
    ),
    options,
  );
}

/** A fresh placement must have an explicit positive signal from the ranker. */
export function hasPositiveFirstListenerTasteSignal(
  candidate: Pick<RankedDiscoveryCandidate, "signals">,
): boolean {
  return (candidate.signals ?? []).some(
    (signal) => FIRST_LISTENER_TASTE_SIGNALS.has(signal.label) && signal.weight > 0,
  );
}

/** Rule 1: true when the listener hid this candidate by any declared axis. */
export function isHiddenByListener(
  candidate: DiscoveryCandidate,
  policy: TasteMemoryPolicy,
): boolean {
  const hidden = policy.hidden;
  if (hidden.size === 0) return false;
  const release = candidate.release;
  if (hasSignal(hidden, "genre", release?.genre)) return true;
  if ((release?.moods ?? []).some((mood) => hasSignal(hidden, "mood", mood))) {
    return true;
  }
  if (
    hasSignal(hidden, "artist", candidate.artist) ||
    hasSignal(hidden, "artist", release?.artistDisplayName) ||
    hasSignal(hidden, "artist", candidate.artistId)
  ) {
    return true;
  }
  // The listener's hidden queries also remove candidates that surfaced only
  // because they matched one (genre, mood, scene and intent hides).
  return (candidate.matchedQueries ?? []).some(
    (query) =>
      hasSignal(hidden, "genre", query) ||
      hasSignal(hidden, "mood", query) ||
      hasSignal(hidden, "scene", query) ||
      hasSignal(hidden, "intent", query),
  );
}

function asDiscoveryPick<T extends RankedDiscoveryCandidate>(candidate: T): T {
  const sentence = DISCOVERY_EXPLANATIONS.discovery_pick;
  const rest = (candidate.explanation ?? []).filter(
    (line) => line && line !== sentence,
  );
  return {
    ...candidate,
    reasonCode: "discovery_pick" satisfies DiscoveryReasonCode,
    explanation: [sentence, ...rest],
  };
}

/** Rule 5: never hand a surface an item with no reason. */
function withGuaranteedReason<T extends RankedDiscoveryCandidate>(candidate: T): T {
  const explanation = (candidate.explanation ?? []).filter(Boolean);
  const reasonCode = candidate.reasonCode ?? primaryReasonFor(candidate.signals ?? []);
  if (explanation.length > 0 && candidate.reasonCode) return candidate;
  return {
    ...candidate,
    reasonCode,
    explanation: explanation.length
      ? explanation
      : [DISCOVERY_EXPLANATIONS[reasonCode]],
  };
}

/**
 * Credited-name key: accents folded, case-insensitive, the featured-guest
 * segment dropped ("Ryan Leslie Feat. Booba" and "Drake (ft. Rihanna)" are
 * Ryan Leslie and Drake), and punctuation collapsed so "T.I" and "T.I." match.
 * `feat`/`ft` must be whole words followed by "." or whitespace, and
 * `featuring` a whole word, so names such as "Ftown" or "Feature Band" are kept.
 */
function creditedArtistKey(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[(\[]?\s*\b(?:(?:feat|ft)(?=[.\s])|featuring\b).*$/u, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
