import type { CrateFilters, CrateParseResult } from "../crates/crate.types";
import { genreMatchesRequest, genreOrDescriptorMatchesRequest } from "../recommendations/genre_families";
import { sanitizeArtistNames } from "./agent_session_artists";
import { rememberedSessionSeed, selectorSeedsFor } from "./agent_session_seed";

/**
 * A listener describes an AI DJ session in their own words (#2037). The text is
 * parsed by the Crate Digger request parser into {@link CrateFilters}; only the
 * LISTENING subset survives here (genres, moods, energy, tempo). The sentence
 * itself appears in only one place, {@link AgentSessionRankingPreferences}'s
 * bounded `requestText` (#2241), which joins that session's semantic query and
 * is never stored or logged. This module is pure: no database, no network, no
 * logging, no clock.
 */

/**
 * Nest injection token for the request parser the session prompt uses (#2037).
 * AgentsModule provides it with `createAgentSessionRequestParser()` (Crate
 * Digger rules plus catalog artist names, #2241); it cannot import CratesModule
 * (which imports AgentsModule).
 */
export const AGENT_SESSION_REQUEST_PARSER = Symbol("AGENT_SESSION_REQUEST_PARSER");

export type AgentSessionEnergy = "low" | "medium" | "high";

/** Tempo range in BPM; a null side is open. */
export type AgentSessionTempoRange = { min: number | null; max: number | null };

/** The listening subset of a parsed request. Free text never appears here. */
export type AgentSessionRequest = {
  genres: string[];
  moods: string[];
  energy: AgentSessionEnergy | null;
  bpm: AgentSessionTempoRange | null;
};

/** Crate filters a listening session has no use for; reported, never applied. */
export type AgentSessionRequestIgnoredKey =
  | "keys"
  | "requiredStems"
  | "licenseType"
  | "maxTotalUsd"
  | "maxPerItemUsd"
  | "verifiedHumanOnly";

export type AgentRequestCoverageFilter = "genres" | "moods" | "energy" | "bpm";

export type AgentRequestCoverage = {
  /** How many picks the coverage was computed over. */
  picks: number;
  /** Only filters with matched < picks; largest gap first. */
  gaps: Array<{ filter: AgentRequestCoverageFilter; matched: number }>;
  /**
   * Strong matches the batch left out, by reason (absent when none): `variety`
   * is the per-artist cap (ADR-TE-2), `explicit` the listener's explicit
   * preference. Reported, never overridden.
   */
  heldBack?: AgentRequestHeldBack;
  /**
   * Request-first selection (#2316): the per-artist cap was relaxed because the
   * catalog had no other matching tracks left for this batch. `top` names the
   * credited artist with the most tracks in the batch.
   */
  capRelaxed?: AgentRequestCapRelaxed;
  /**
   * Request-first selection (#2316): the batch is shorter than the target
   * because the catalog has no more tracks that match the request (and the
   * listener did not allow similar sounds to fill it).
   */
  shortfallReason?: AgentRequestShortfallReason;
};

export type AgentRequestHeldBack = { variety: number; explicit: number };

export type AgentRequestShortfallReason = "catalog_short";

export type AgentRequestCapRelaxed = {
  /** How many credited artists hold more tracks in this batch than the cap. */
  artists: number;
  top?: { artist: string; tracks: number };
};

/** What request-first selection reports next to the coverage (#2316). */
export type AgentRequestCoverageNotes = {
  capRelaxed?: AgentRequestCapRelaxed;
  shortfallReason?: AgentRequestShortfallReason;
};

export type AgentSessionParseResponse = {
  request: AgentSessionRequest;
  /**
   * Catalog artists the sentence named (#2241), as the catalog spells them. They
   * seed the session's retrieval and show as removable "Like: <Artist>" chips.
   */
  artists: string[];
  unparsed: string[];
  ignored: AgentSessionRequestIgnoredKey[];
  strategy: CrateParseResult["strategy"];
};

/** Longest sentence that joins a session's semantic query (the parse route's own limit). */
export const SESSION_REQUEST_TEXT_MAX_LENGTH = 500;
export const SESSION_REQUEST_MAX_TERMS = 8;
export const SESSION_REQUEST_MAX_TERM_LENGTH = 64;
export const SESSION_REQUEST_BPM_MIN = 40;
export const SESSION_REQUEST_BPM_MAX = 220;

const ENERGY_LOW_BELOW = 0.4;
const ENERGY_HIGH_ABOVE = 0.6;

// ---------------------------------------------------------------------------
// Parse result -> listening request
// ---------------------------------------------------------------------------

/**
 * Maps the crate parser's result onto the listening request. The energy range
 * becomes a band by its midpoint (an open side counts as the edge of the 0..1
 * scale). `count` is ignored silently; the other crate-only filters the text
 * DID set are listed in `ignored` so the listener sees them acknowledged.
 */
export function listeningRequestFromCrateParse(result: CrateParseResult): AgentSessionParseResponse {
  const { filters } = result;
  const request: AgentSessionRequest = {
    genres: cleanTerms(filters.genres),
    moods: cleanTerms(filters.moods),
    energy: energyBandFromRange(filters.energy),
    bpm: cleanBpm(filters.bpm),
  };
  return {
    request,
    artists: sanitizeArtistNames(result.artists),
    unparsed: [...(result.unparsed ?? [])],
    ignored: ignoredKeysOf(filters),
    strategy: result.strategy,
  };
}

function energyBandFromRange(range: CrateFilters["energy"]): AgentSessionEnergy | null {
  if (!range || (range.min === null && range.max === null)) return null;
  const min = range.min ?? 0;
  const max = range.max ?? 1;
  // Rounded so 0.4..0.8 (midpoint 0.6000000000000001) stays on the boundary.
  const midpoint = Math.round(((min + max) / 2) * 1000) / 1000;
  if (midpoint < ENERGY_LOW_BELOW) return "low";
  if (midpoint > ENERGY_HIGH_ABOVE) return "high";
  return "medium";
}

function ignoredKeysOf(filters: CrateFilters): AgentSessionRequestIgnoredKey[] {
  const ignored: AgentSessionRequestIgnoredKey[] = [];
  if (filters.keys?.length) ignored.push("keys");
  if (filters.requiredStems?.length) ignored.push("requiredStems");
  if (filters.licenseType != null) ignored.push("licenseType");
  if (filters.maxTotalUsd != null) ignored.push("maxTotalUsd");
  if (filters.maxPerItemUsd != null) ignored.push("maxPerItemUsd");
  if (filters.verifiedHumanOnly === true) ignored.push("verifiedHumanOnly");
  return ignored;
}

// ---------------------------------------------------------------------------
// Sanitizing an untrusted request
// ---------------------------------------------------------------------------

/**
 * Reads an untrusted `preferences.request`: invalid fields are dropped, never
 * echoed, and nothing here throws. Returns undefined when no valid filter is
 * left (so an empty or garbage request behaves like no request).
 */
export function sanitizeSessionRequest(value: unknown): AgentSessionRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const raw = value as Record<string, unknown>;
    const request: AgentSessionRequest = {
      genres: cleanTerms(raw.genres),
      moods: cleanTerms(raw.moods),
      energy: raw.energy === "low" || raw.energy === "medium" || raw.energy === "high" ? raw.energy : null,
      bpm: cleanBpm(raw.bpm),
    };
    return hasRequestFilters(request) ? request : undefined;
  } catch {
    // A hostile getter or proxy is just an invalid request.
    return undefined;
  }
}

/** True when the request asks for at least one listening filter. */
export function hasRequestFilters(request: AgentSessionRequest | undefined | null): boolean {
  if (!request) return false;
  return (
    request.genres.length > 0 ||
    request.moods.length > 0 ||
    request.energy !== null ||
    hasTempo(request.bpm)
  );
}

function hasTempo(bpm: AgentSessionTempoRange | null | undefined): bpm is AgentSessionTempoRange {
  return !!bpm && (bpm.min !== null || bpm.max !== null);
}

/** Trimmed, non-empty, bounded strings; deduped case-insensitively; at most 8. */
function cleanTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const term = entry.trim();
    if (!term || term.length > SESSION_REQUEST_MAX_TERM_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= SESSION_REQUEST_MAX_TERMS) break;
  }
  return terms;
}

function cleanBpmBound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < SESSION_REQUEST_BPM_MIN || value > SESSION_REQUEST_BPM_MAX) return null;
  return value;
}

function cleanBpm(value: unknown): AgentSessionTempoRange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  let min = cleanBpmBound(raw.min);
  let max = cleanBpmBound(raw.max);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { min, max };
}

// ---------------------------------------------------------------------------
// Request -> ranking preferences
// ---------------------------------------------------------------------------

/**
 * What a request changes about a session's ranking inputs. With no valid
 * request every field is empty, so the caller's preferences pass through
 * untouched (a preset start produces the same session as before).
 */
export type AgentSessionRankingPreferences = {
  request?: AgentSessionRequest;
  /**
   * The listener's sentence, bounded (#2241). It joins this session's semantic
   * query and nothing else: never stored, logged, published or sent to a model
   * by the pick path.
   */
  requestText?: string;
  /** Catalog artists the sentence named; seed neighbours for retrieval. */
  artists: string[];
  /** Request genres: they count as session genres. */
  sessionGenres: string[];
  /** The mood as sent, else the request's first mood. */
  mood?: string;
  moods: string[];
  /** The request's energy, else the energy as sent. */
  energy?: AgentSessionEnergy;
  tempoBpm?: AgentSessionTempoRange;
};

/** A bounded, trimmed sentence, or undefined when there is none. Never throws. */
export function sanitizeRequestText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, SESSION_REQUEST_TEXT_MAX_LENGTH).trim();
  return text || undefined;
}

export function requestRankingPreferences(preferences: {
  mood?: string;
  energy?: AgentSessionEnergy;
  request?: unknown;
  requestText?: unknown;
  artists?: unknown;
}): AgentSessionRankingPreferences {
  const request = sanitizeSessionRequest(preferences.request);
  const requestText = sanitizeRequestText(preferences.requestText);
  const sentence = {
    ...(requestText ? { requestText } : {}),
    artists: sanitizeArtistNames(preferences.artists),
  };
  if (!request) {
    return {
      ...sentence,
      sessionGenres: [],
      mood: preferences.mood,
      moods: [],
      energy: preferences.energy,
    };
  }
  return {
    ...sentence,
    request,
    sessionGenres: request.genres,
    mood: preferences.mood ?? request.moods[0],
    moods: request.moods,
    energy: request.energy ?? preferences.energy,
    ...(hasTempo(request.bpm) ? { tempoBpm: { min: request.bpm.min, max: request.bpm.max } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** The facts about one pick that the request filters read. */
export type AgentRequestCoveragePick = {
  genre: string | null;
  /** Genre family ids of the track's stored descriptor (#2240). */
  descriptorFamilies?: readonly string[];
  moods: string[];
  energyBand?: string;
  tempoBpm?: number;
  /** Only a measured tempo counts toward a BPM filter; inferred tempo is a hash. */
  tempoMeasured: boolean;
  /** Request-first selection (#2316): a seed source (artist, track, playlist) retrieved this pick. */
  seedMatched?: boolean;
};

const COVERAGE_FILTER_ORDER: AgentRequestCoverageFilter[] = ["genres", "moods", "energy", "bpm"];

type PickPredicate = (pick: AgentRequestCoveragePick) => boolean;

/**
 * How one pick stands against ONE soft filter (mood, energy, tempo):
 *  - match: the pick satisfies the filter;
 *  - contradict: the pick is the opposite of what was asked (low vs high energy,
 *    a measured tempo far outside the range): never on request;
 *  - mismatch: the pick misses the filter without contradicting it;
 *  - unknown: the pick has no data to judge by (no moods, tempo not measured).
 */
export type SoftFilterOutcome = "match" | "contradict" | "mismatch" | "unknown";

/** A measured tempo further than this many BPM outside the requested range contradicts it. */
export const TEMPO_CONTRADICTION_BPM = 15;

const ENERGY_RANK: Record<AgentSessionEnergy, number> = { low: 0, medium: 1, high: 2 };

/**
 * The energy band a pick is judged by: the MEASURED audio-feature band when the
 * features measured it, else the stored descriptor's band, else the feature
 * band (inferred from genre and title words, a weaker guess). One definition,
 * so tiering, coverage counts and the player's mark agree.
 */
export function effectiveEnergyBand(
  features?: { energyBand?: string | null; featureSources?: { energy?: string | null } | null } | null,
  descriptorEnergyBand?: string | null,
): string | undefined {
  if (features?.featureSources?.energy === "measured" && features.energyBand) return features.energyBand;
  if (descriptorEnergyBand) return descriptorEnergyBand;
  return features?.energyBand ?? undefined;
}

function isEnergy(value: unknown): value is AgentSessionEnergy {
  return value === "low" || value === "medium" || value === "high";
}

function energyOutcome(requested: AgentSessionEnergy, band: string | undefined): SoftFilterOutcome {
  if (!isEnergy(band)) return "mismatch";
  if (band === requested) return "match";
  return Math.abs(ENERGY_RANK[band] - ENERGY_RANK[requested]) >= 2 ? "contradict" : "mismatch";
}

function bpmOutcome(range: AgentSessionTempoRange, pick: AgentRequestCoveragePick): SoftFilterOutcome {
  if (!pick.tempoMeasured || typeof pick.tempoBpm !== "number" || !Number.isFinite(pick.tempoBpm)) {
    return "unknown";
  }
  const below = range.min !== null ? range.min - pick.tempoBpm : Number.NEGATIVE_INFINITY;
  const above = range.max !== null ? pick.tempoBpm - range.max : Number.NEGATIVE_INFINITY;
  const outside = Math.max(below, above);
  if (outside <= 0) return "match";
  return outside > TEMPO_CONTRADICTION_BPM ? "contradict" : "mismatch";
}

function moodOutcome(requestedMoods: ReadonlySet<string>, pick: AgentRequestCoveragePick): SoftFilterOutcome {
  const moods = pick.moods ?? [];
  if (moods.length === 0) return "unknown";
  return moods.some((mood) => requestedMoods.has(normalizeTerm(mood))) ? "match" : "mismatch";
}

/** The outcome of every soft filter the request sets (mood, energy, tempo), for one pick. */
function softOutcomes(request: AgentSessionRequest, pick: AgentRequestCoveragePick): SoftFilterOutcome[] {
  const outcomes: SoftFilterOutcome[] = [];
  const requestedMoods = new Set(request.moods.map(normalizeTerm));
  if (requestedMoods.size > 0) outcomes.push(moodOutcome(requestedMoods, pick));
  if (request.energy !== null) outcomes.push(energyOutcome(request.energy, pick.energyBand));
  if (hasTempo(request.bpm)) outcomes.push(bpmOutcome(request.bpm, pick));
  return outcomes;
}

/** True when the request sets a mood, an energy or a tempo (a soft filter). */
function hasSoftFilters(request: AgentSessionRequest): boolean {
  return request.moods.length > 0 || request.energy !== null || hasTempo(request.bpm);
}

/**
 * One predicate per filter the request actually sets. Coverage counts them and
 * {@link pickMatchesRequest} requires all of them, so the two can never
 * disagree about what "matches" means. A soft predicate matches iff its
 * {@link SoftFilterOutcome} is "match", the same outcome the tier reads.
 */
function requestPredicates(
  request: AgentSessionRequest,
): Partial<Record<AgentRequestCoverageFilter, PickPredicate>> {
  const predicates: Partial<Record<AgentRequestCoverageFilter, PickPredicate>> = {};
  const requestedGenres = [...new Set(request.genres.map(normalizeTerm))];
  const requestedMoods = new Set(request.moods.map(normalizeTerm));

  if (requestedGenres.length > 0) {
    // Free-text catalog genres: "African" satisfies a "World" request (#2088).
    predicates.genres = (pick) =>
      requestedGenres.some((requested) =>
        genreOrDescriptorMatchesRequest(pick.genre, pick.descriptorFamilies, requested),
      );
  }
  if (requestedMoods.size > 0) {
    predicates.moods = (pick) => moodOutcome(requestedMoods, pick) === "match";
  }
  if (request.energy !== null) {
    const energy = request.energy;
    predicates.energy = (pick) => energyOutcome(energy, pick.energyBand) === "match";
  }
  if (hasTempo(request.bpm)) {
    const range = request.bpm;
    predicates.bpm = (pick) => bpmOutcome(range, pick) === "match";
  }
  return predicates;
}

/**
 * True when the pick satisfies EVERY filter the request sets (#2312), by the
 * same predicates {@link computeRequestCoverage} counts. Undefined when the
 * request has no filters, so a pick of an unfiltered session carries no flag.
 */
export function pickMatchesRequest(
  request: AgentSessionRequest,
  pick: AgentRequestCoveragePick,
): boolean | undefined {
  if (!hasRequestFilters(request)) return undefined;
  return Object.values(requestPredicates(request)).every((matches) => matches(pick));
}

/**
 * The per-pick match flags for a raw (untrusted) request, in pick order:
 * sanitize, require at least one filter, test each pick. Undefined without a
 * request or without filters. Shared by the deterministic and LLM paths.
 */
export function requestMatchesFor(
  rawRequest: unknown,
  picks: readonly AgentRequestCoveragePick[],
): boolean[] | undefined {
  const request = sanitizeSessionRequest(rawRequest);
  if (!request || !hasRequestFilters(request)) return undefined;
  return picks.map((pick) => pickMatchesRequest(request, pick) === true);
}

/**
 * How well the picks matched each requested filter. Only filters the picks did
 * not all satisfy appear as gaps, largest gap first. Undefined when there are
 * no picks or the request has no filters.
 */
export function computeRequestCoverage(
  request: AgentSessionRequest,
  picks: readonly AgentRequestCoveragePick[],
  heldBack?: AgentRequestHeldBack,
  notes?: AgentRequestCoverageNotes,
): AgentRequestCoverage | undefined {
  if (picks.length === 0 || !hasRequestFilters(request)) return undefined;
  return buildCoverage(request, picks, heldBack, notes);
}

function buildCoverage(
  request: AgentSessionRequest,
  picks: readonly AgentRequestCoveragePick[],
  heldBack?: AgentRequestHeldBack,
  notes?: AgentRequestCoverageNotes,
): AgentRequestCoverage {
  const predicates = requestPredicates(request);
  const counts: Partial<Record<AgentRequestCoverageFilter, number>> = {};
  for (const filter of COVERAGE_FILTER_ORDER) {
    const matches = predicates[filter];
    if (matches) counts[filter] = picks.filter(matches).length;
  }

  const gaps = COVERAGE_FILTER_ORDER.flatMap((filter) => {
    const matched = counts[filter];
    return matched !== undefined && matched < picks.length ? [{ filter, matched }] : [];
  })
    // Every gap is measured against the same pick count, so the largest gap is
    // the fewest matches. Sort is stable: ties keep the genres, moods, energy,
    // bpm order above.
    .sort((a, b) => a.matched - b.matched);
  return {
    picks: picks.length,
    gaps,
    ...(heldBack && heldBack.variety + heldBack.explicit > 0 ? { heldBack } : {}),
    ...(notes?.capRelaxed && notes.capRelaxed.artists > 0 ? { capRelaxed: notes.capRelaxed } : {}),
    ...(notes?.shortfallReason ? { shortfallReason: notes.shortfallReason } : {}),
  };
}

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * Coverage plus its live-feed summary for a raw (untrusted) request: sanitize,
 * require at least one filter, compute. Undefined without a request, without
 * filters, or without picks. Shared by the deterministic and LLM paths.
 */
export function requestCoverageFor(
  rawRequest: unknown,
  picks: readonly AgentRequestCoveragePick[],
  heldBack?: AgentRequestHeldBack,
  notes?: AgentRequestCoverageNotes,
): { coverage: AgentRequestCoverage; summary: string } | undefined {
  const request = sanitizeSessionRequest(rawRequest);
  if (!request || !hasRequestFilters(request)) return undefined;
  const coverage = computeRequestCoverage(request, picks, heldBack, notes);
  if (!coverage) return undefined;
  return { coverage, summary: describeCoverageGaps(request, coverage) };
}

/**
 * Coverage for a request-first session (#2316): measured against the session's
 * effective request, which includes preset and picker genres and may carry no
 * filter at all (a seeded session). Undefined without picks.
 */
export function requestCoverageForScope(
  scope: AgentRequestScope,
  picks: readonly AgentRequestCoveragePick[],
  heldBack?: AgentRequestHeldBack,
  notes?: AgentRequestCoverageNotes,
): { coverage: AgentRequestCoverage; summary: string } | undefined {
  if (picks.length === 0) return undefined;
  const coverage = buildCoverage(scope.request, picks, heldBack, notes);
  return { coverage, summary: describeCoverageGaps(scope.request, coverage) };
}

/**
 * A short human line for the live feed: `not matched: 120–125 BPM (1 of 5),
 * deep house (0 of 5)`. Empty string when nothing is missing.
 */
export function describeCoverageGaps(
  request: AgentSessionRequest,
  coverage: AgentRequestCoverage | undefined,
): string {
  if (!coverage || coverage.gaps.length === 0) return "";
  const parts: string[] = [];
  for (const gap of coverage.gaps) {
    const label = coverageFilterLabel(request, gap.filter);
    if (!label) continue;
    parts.push(`${label} (${gap.matched} of ${coverage.picks})`);
  }
  return parts.length > 0 ? `not matched: ${parts.join(", ")}` : "";
}

function coverageFilterLabel(request: AgentSessionRequest, filter: AgentRequestCoverageFilter): string {
  switch (filter) {
    case "genres":
      return request.genres.join(", ");
    case "moods":
      return request.moods.join(", ");
    case "energy":
      return request.energy ? `${request.energy} energy` : "";
    case "bpm":
      return hasTempo(request.bpm) ? describeTempoRange(request.bpm) : "";
  }
}

/** `120–125 BPM`, `under 125 BPM`, `over 120 BPM`. */
export function describeTempoRange(range: AgentSessionTempoRange): string {
  const { min, max } = range;
  if (min !== null && max !== null) {
    return min === max ? `${formatBpm(min)} BPM` : `${formatBpm(min)}–${formatBpm(max)} BPM`;
  }
  if (max !== null) return `under ${formatBpm(max)} BPM`;
  if (min !== null) return `over ${formatBpm(min)} BPM`;
  return "";
}

function formatBpm(value: number): string {
  return String(Math.round(value));
}

// ---------------------------------------------------------------------------
// Request-first selection (#2316)
// ---------------------------------------------------------------------------

/**
 * How a track stands against the session's request:
 *  - A: matches every filter the request sets;
 *  - B: matches the catalog constraint (a requested genre or family, or a seed)
 *    but misses a soft filter (mood, energy, tempo);
 *  - C: outside the request. C tracks only join a batch when the listener
 *    allowed similar sounds to fill it, and are then marked.
 */
export type RequestTier = "A" | "B" | "C";

/** Display order and selection order of the tiers: A first, C last. */
export const REQUEST_TIER_ORDER: Record<RequestTier, number> = { A: 0, B: 1, C: 2 };

/**
 * The request a session carries into selection. `request` is the EFFECTIVE
 * request: the described session's filters plus preset and picker genres and
 * the mood and energy the session sent, so every path reads one definition.
 */
export interface AgentRequestScope {
  request: AgentSessionRequest;
  /** A seed (an artist the sentence named, a seed track, a session seed) steers retrieval. */
  seeded: boolean;
  /**
   * The request names a catalog constraint (a genre or a seed). A gated request
   * makes a track outside the genre or seed a tier C track. A request that names
   * only mood, energy or tempo asks for every genre (ranked by taste) and is
   * `softGated` instead.
   */
  gated: boolean;
  /**
   * Not gated (no genre, no seed) but the request sets a mood, energy or tempo.
   * Such a request still asks for every genre, yet what it plays must fit the
   * soft filters: a pick that contradicts one, or fits none, is outside the
   * request (tier C). Genre-only paths (`gated`) are unchanged.
   */
  softGated: boolean;
  /** The listener allowed marked off-request tracks to fill a short batch. */
  fillSimilar: boolean;
}

/** The session preferences a request scope is read from (a subset of the runtime input). */
export interface AgentRequestScopePreferences {
  sessionGenres?: readonly string[] | null;
  request?: unknown;
  mood?: string | null;
  moods?: readonly string[] | null;
  energy?: AgentSessionEnergy | null;
  tempoBpm?: AgentSessionTempoRange | null;
  requestText?: string | null;
  artists?: readonly string[] | null;
  seed?: unknown;
  seedTrackId?: string | null;
  fillSimilar?: unknown;
  myMix?: unknown;
}

/**
 * The request scope of a session, or undefined when the session has no request
 * (My Mix and a plain "surprise me" keep their taste-driven path unchanged).
 * A session has a request when it sets any genre, mood, energy, tempo, seed,
 * named artist or sentence of its own. Pure: the caller decides what counts as
 * the session's OWN genres (saved vibes sent back as genres do not).
 */
export function requestScopeFor(preferences: AgentRequestScopePreferences | undefined | null): AgentRequestScope | undefined {
  if (!preferences) return undefined;
  if (preferences.myMix != null) return undefined;
  const described = sanitizeSessionRequest(preferences.request);
  const request: AgentSessionRequest = {
    genres: cleanTerms([...(preferences.sessionGenres ?? []), ...(described?.genres ?? [])]),
    moods: cleanTerms([
      ...(preferences.mood ? [preferences.mood] : []),
      ...(preferences.moods ?? []),
      ...(described?.moods ?? []),
    ]),
    energy: described?.energy ?? sanitizeEnergy(preferences.energy),
    bpm: described?.bpm ?? cleanBpm(preferences.tempoBpm),
  };
  const sessionSeed = rememberedSessionSeed(preferences.seed);
  const seeded =
    selectorSeedsFor(sessionSeed) !== undefined ||
    (typeof preferences.seedTrackId === "string" && preferences.seedTrackId.trim().length > 0) ||
    sanitizeArtistNames(preferences.artists).length > 0;
  const sentence = sanitizeRequestText(preferences.requestText) !== undefined;
  if (!hasRequestFilters(request) && !seeded && !sentence) return undefined;
  const gated = request.genres.length > 0 || seeded;
  return {
    request,
    seeded,
    gated,
    softGated: !gated && hasSoftFilters(request),
    fillSimilar: preferences.fillSimilar === true,
  };
}

function sanitizeEnergy(value: unknown): AgentSessionEnergy | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

/**
 * Whether the request constrains what the catalog may play: a genre or a seed
 * (`gated`), or a mood, energy or tempo with no genre (`softGated`). Where this
 * is true, off-request tracks are held back unless the listener allowed similar
 * sounds to fill the batch.
 */
export function constrainsCatalog(scope: AgentRequestScope | undefined | null): boolean {
  return !!scope && (scope.gated || scope.softGated);
}

/**
 * The tier of one pick (#2316), by the same per-filter outcomes the coverage
 * predicates read, so selection, display and the LLM path can never disagree
 * about what "matches" means. Rules, in order:
 *  1. gated (genre or seed): a pick that is neither on-genre nor seed-matched is C;
 *  2. a soft filter the pick CONTRADICTS (low vs high energy, a measured tempo
 *     more than {@link TEMPO_CONTRADICTION_BPM} outside the range) makes it C,
 *     gated or not; moods never contradict;
 *  3. every soft filter matched (or none set): A;
 *  4. gated (genre or seed satisfied) but a soft filter missed: B;
 *  5. soft-gated (no genre, no seed): B when at least one soft filter matched,
 *     else C;
 *  6. a scope without filters (a sentence only) is never C.
 */
export function requestTierOf(scope: AgentRequestScope, pick: AgentRequestCoveragePick): RequestTier {
  if (scope.gated) {
    const genrePredicate = requestPredicates(scope.request).genres;
    const onGenre = genrePredicate ? genrePredicate(pick) : false;
    const onSeed = scope.seeded && pick.seedMatched === true;
    if (!onGenre && !onSeed) return "C";
  }
  const outcomes = softOutcomes(scope.request, pick);
  if (outcomes.includes("contradict")) return "C";
  if (outcomes.every((outcome) => outcome === "match")) return "A";
  if (scope.gated) return "B";
  if (scope.softGated) return outcomes.includes("match") ? "B" : "C";
  return "B";
}

/**
 * The scope as a path can verify it when it has no seed evidence for a pick
 * (an LLM pick): only a requested genre can gate. A seed-only request cannot be
 * checked there, so its picks pass (the rule-based top-up carries the seed).
 * Soft filters still apply: a seed-only scope with a mood, energy or tempo
 * becomes soft-gated.
 */
export function withoutSeedEvidence(scope: AgentRequestScope): AgentRequestScope {
  const gated = scope.request.genres.length > 0;
  return { ...scope, seeded: false, gated, softGated: !gated && hasSoftFilters(scope.request) };
}

/** Whether a pick belongs to the request: any tier but C. This is what the player's "Outside your request" mark reads. */
export function tierMatchesRequest(tier: RequestTier): boolean {
  return tier !== "C";
}

/**
 * Keeps the catalog items a model may see: with a gated genre request and no
 * padding, only items that match a requested genre or family (#2316). Anything
 * else passes through untouched.
 */
export function keepItemsOnRequest<T extends { release?: { genre?: string | null } | null; descriptor?: { families?: string[] | null } | null }>(
  items: readonly T[],
  scope: AgentRequestScope | undefined,
): T[] {
  if (!scope || !scope.gated || scope.fillSimilar || scope.request.genres.length === 0) return [...items];
  const genrePredicate = requestPredicates(scope.request).genres;
  if (!genrePredicate) return [...items];
  return items.filter((item) =>
    genrePredicate({
      genre: item.release?.genre ?? null,
      descriptorFamilies: item.descriptor?.families ?? [],
      moods: [],
      tempoMeasured: false,
    }),
  );
}
