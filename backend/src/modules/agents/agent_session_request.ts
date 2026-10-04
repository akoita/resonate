import type { CrateFilters, CrateParseResult } from "../crates/crate.types";
import { genreMatchesRequest } from "../recommendations/genre_families";

/**
 * A listener describes an AI DJ session in their own words (#2037). The text is
 * parsed by the Crate Digger request parser into {@link CrateFilters}; only the
 * LISTENING subset survives here (genres, moods, energy, tempo). The sentence
 * itself never appears in any of these types, and this module is pure: no
 * database, no network, no logging, no clock.
 */

/**
 * Nest injection token for the Crate Digger request parser the session prompt
 * uses (#2037). AgentsModule provides it with `createCrateRequestParser()`; it
 * cannot import CratesModule (which imports AgentsModule).
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
};

export type AgentSessionParseResponse = {
  request: AgentSessionRequest;
  unparsed: string[];
  ignored: AgentSessionRequestIgnoredKey[];
  strategy: CrateParseResult["strategy"];
};

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
  /** Request genres: they count as session genres. */
  sessionGenres: string[];
  /** The mood as sent, else the request's first mood. */
  mood?: string;
  moods: string[];
  /** The request's energy, else the energy as sent. */
  energy?: AgentSessionEnergy;
  tempoBpm?: AgentSessionTempoRange;
};

export function requestRankingPreferences(preferences: {
  mood?: string;
  energy?: AgentSessionEnergy;
  request?: unknown;
}): AgentSessionRankingPreferences {
  const request = sanitizeSessionRequest(preferences.request);
  if (!request) {
    return {
      sessionGenres: [],
      mood: preferences.mood,
      moods: [],
      energy: preferences.energy,
    };
  }
  return {
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
  moods: string[];
  energyBand?: string;
  tempoBpm?: number;
  /** Only a measured tempo counts toward a BPM filter; inferred tempo is a hash. */
  tempoMeasured: boolean;
};

const COVERAGE_FILTER_ORDER: AgentRequestCoverageFilter[] = ["genres", "moods", "energy", "bpm"];

/**
 * How well the picks matched each requested filter. Only filters the picks did
 * not all satisfy appear as gaps, largest gap first. Undefined when there are
 * no picks or the request has no filters.
 */
export function computeRequestCoverage(
  request: AgentSessionRequest,
  picks: readonly AgentRequestCoveragePick[],
): AgentRequestCoverage | undefined {
  if (picks.length === 0 || !hasRequestFilters(request)) return undefined;

  const requestedGenres = new Set(request.genres.map(normalizeTerm));
  const requestedMoods = new Set(request.moods.map(normalizeTerm));
  const counts: Partial<Record<AgentRequestCoverageFilter, number>> = {};

  if (requestedGenres.size > 0) {
    // Free-text catalog genres: "African" satisfies a "World" request (#2088).
    counts.genres = picks.filter(
      (pick) =>
        !!pick.genre &&
        [...requestedGenres].some((requested) => genreMatchesRequest(pick.genre, requested)),
    ).length;
  }
  if (requestedMoods.size > 0) {
    counts.moods = picks.filter((pick) => (pick.moods ?? []).some((mood) => requestedMoods.has(normalizeTerm(mood)))).length;
  }
  if (request.energy !== null) {
    counts.energy = picks.filter((pick) => pick.energyBand === request.energy).length;
  }
  if (hasTempo(request.bpm)) {
    const { min, max } = request.bpm;
    counts.bpm = picks.filter(
      (pick) =>
        pick.tempoMeasured &&
        typeof pick.tempoBpm === "number" &&
        Number.isFinite(pick.tempoBpm) &&
        pick.tempoBpm >= (min ?? Number.NEGATIVE_INFINITY) &&
        pick.tempoBpm <= (max ?? Number.POSITIVE_INFINITY),
    ).length;
  }

  const gaps = COVERAGE_FILTER_ORDER.flatMap((filter) => {
    const matched = counts[filter];
    return matched !== undefined && matched < picks.length ? [{ filter, matched }] : [];
  })
    // Every gap is measured against the same pick count, so the largest gap is
    // the fewest matches. Sort is stable: ties keep the genres, moods, energy,
    // bpm order above.
    .sort((a, b) => a.matched - b.matched);
  return { picks: picks.length, gaps };
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
): { coverage: AgentRequestCoverage; summary: string } | undefined {
  const request = sanitizeSessionRequest(rawRequest);
  if (!request || !hasRequestFilters(request)) return undefined;
  const coverage = computeRequestCoverage(request, picks);
  if (!coverage) return undefined;
  return { coverage, summary: describeCoverageGaps(request, coverage) };
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
