import type {
  AgentRequestCoverage,
  AgentSessionRequest,
} from "../agents/agent_session_request";
import { parseKeyToCamelot } from "../crates/crate_camelot";
import { canonicalCrateGenre, canonicalCrateMood } from "../crates/crate_filters";
import {
  CRATE_LICENSE_TYPES,
  CRATE_STEM_TYPES,
  type CrateCandidateFacts,
  type CrateCoverage,
  type CrateFilterKey,
  type CrateFilters,
  type CrateNumberRange,
} from "../crates/crate.types";
import { failedFilters, isExcludedAsFullyAi } from "../crates/crate_selection";

/** A private, categorized pointer into the canonical catalog, never user text. */
export interface CandidateDemandDraft {
  targetType: "artist" | "track";
  candidateTrackId: string;
  kind: "stem" | "license" | "bpm" | "key" | "energy" | "mood" | "price" | "verifiedHuman";
  value: string;
}

export interface CrateDemandDerivation {
  candidates: CandidateDemandDraft[];
  /** Resolve these only against exact playable catalog genres in the service. */
  requestedGenres: string[];
}

export interface SessionDemandCandidate {
  trackId: string;
  genre: string | null;
  moods: string[];
  tempoBpm: number | null;
  energy: number | null;
}

export interface SessionDemandDerivation {
  candidates: CandidateDemandDraft[];
  requestedGenres: string[];
}

const PRICE_CEILINGS: readonly number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const MAX_DRAFTS_PER_SOURCE = 100;

function canonicalGenres(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => canonicalCrateGenre(value)).filter((value): value is string => Boolean(value)))];
}

function canonicalMoods(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => canonicalCrateMood(value)).filter((value): value is string => Boolean(value)))];
}

function uniqueDrafts(drafts: CandidateDemandDraft[]): CandidateDemandDraft[] {
  const unique = new Map<string, CandidateDemandDraft>();
  for (const draft of drafts) {
    const key = `${draft.targetType}\u0000${draft.candidateTrackId}\u0000${draft.kind}\u0000${draft.value}`;
    if (!unique.has(key)) unique.set(key, draft);
    if (unique.size >= MAX_DRAFTS_PER_SOURCE) break;
  }
  return [...unique.values()].sort((a, b) =>
    a.targetType.localeCompare(b.targetType) ||
    a.candidateTrackId.localeCompare(b.candidateTrackId) ||
    a.kind.localeCompare(b.kind) ||
    a.value.localeCompare(b.value),
  );
}

function bpmBin(range: CrateNumberRange | null): string | undefined {
  if (!range || (range.min === null && range.max === null)) return undefined;
  const min = range.min === null ? null : Math.min(300, Math.max(30, range.min));
  const max = range.max === null ? null : Math.min(300, Math.max(30, range.max));
  if (min !== null && max !== null) {
    const low = Math.floor(min / 5) * 5;
    const high = Math.min(300, Math.floor(max / 5) * 5 + 4);
    return `${low}–${high} BPM`;
  }
  if (min !== null) return `${Math.floor(min / 10) * 10}+ BPM`;
  return `Up to ${Math.min(300, Math.floor((max ?? 30) / 5) * 5 + 4)} BPM`;
}

function energyBand(range: CrateNumberRange | null): string | undefined {
  if (!range || (range.min === null && range.max === null)) return undefined;
  const min = range.min ?? 0;
  const max = range.max ?? 1;
  if (max <= 0.4) return "low";
  if (min >= 0.6) return "high";
  return "medium";
}

function priceBin(max: number | null): string | undefined {
  if (max === null || !Number.isFinite(max) || max < 0) return undefined;
  const ceiling = PRICE_CEILINGS.find((candidate) => max <= candidate) ?? 10_000;
  return `up to $${ceiling >= 1_000 ? `${ceiling / 1_000}k` : ceiling}`;
}

function keyValues(filters: CrateFilters): string[] {
  return [...new Set(filters.keys.map((key) => parseKeyToCamelot(key)).filter((key): key is string => Boolean(key)))].slice(0, 6);
}

function candidateDraftsForFilter(
  facts: CrateCandidateFacts,
  filter: CrateFilterKey,
  filters: CrateFilters,
): CandidateDemandDraft[] {
  const make = (
    kind: CandidateDemandDraft["kind"],
    value: string,
    targetType: CandidateDemandDraft["targetType"] = "artist",
  ): CandidateDemandDraft => ({ targetType, candidateTrackId: facts.trackId, kind, value });

  switch (filter) {
    case "requiredStems": {
      const available = new Set(facts.stemTypes.map((stem) => stem.toLowerCase()));
      return filters.requiredStems
        .filter((stem) => (CRATE_STEM_TYPES as readonly string[]).includes(stem) && !available.has(stem))
        .map((stem) => make("stem", stem, "track"));
    }
    case "licenseType":
      return filters.licenseType && (CRATE_LICENSE_TYPES as readonly string[]).includes(filters.licenseType)
        ? [make("license", filters.licenseType, "track")]
        : [];
    case "bpm": {
      const value = bpmBin(filters.bpm);
      return value ? [make("bpm", value)] : [];
    }
    case "keys":
      return keyValues(filters).map((value) => make("key", value));
    case "energy": {
      const value = energyBand(filters.energy);
      return value ? [make("energy", value)] : [];
    }
    case "moods":
      return canonicalMoods(filters.moods).map((value) => make("mood", value));
    case "maxPerItemUsd": {
      const value = priceBin(filters.maxPerItemUsd);
      return value ? [make("price", value)] : [];
    }
    case "verifiedHumanOnly":
      return filters.verifiedHumanOnly ? [make("verifiedHuman", "verified human")] : [];
    case "genres":
    case "maxTotalUsd":
      // Genre matching uses exact catalog resolution below. A whole-crate
      // budget has no honest per-track attribution.
      return [];
  }
}

/**
 * Keeps only otherwise eligible, single-filter near matches that explain an
 * actual coverage gap. Every emitted value is a fixed enum, a canonical term,
 * or a bounded numeric/key category; raw request phrases never enter here.
 */
export function deriveCrateUnmetDemand(input: {
  filters: CrateFilters;
  considered: readonly CrateCandidateFacts[];
  coverage: CrateCoverage;
}): CrateDemandDerivation {
  const gapFilters = new Set(input.coverage.gaps.map((gap) => gap.filter));
  const candidates: CandidateDemandDraft[] = [];
  if (input.coverage.found < input.coverage.requested && gapFilters.size > 0) {
    for (const facts of input.considered) {
      if (isExcludedAsFullyAi(facts, input.filters)) continue;
      const failed = failedFilters(facts, input.filters);
      if (failed.length !== 1 || !gapFilters.has(failed[0])) continue;
      candidates.push(...candidateDraftsForFilter(facts, failed[0], input.filters));
    }
  }
  const requestedGenres = gapFilters.has("genres") && input.coverage.found < input.coverage.requested
    ? canonicalGenres(input.filters.genres)
    : [];
  return { candidates: uniqueDrafts(candidates), requestedGenres };
}

function sessionFailures(candidate: SessionDemandCandidate, request: AgentSessionRequest): Array<"genres" | "moods" | "energy" | "bpm"> {
  const failed: Array<"genres" | "moods" | "energy" | "bpm"> = [];
  const genres = canonicalGenres(request.genres);
  if (genres.length > 0 && !genres.some((genre) => {
    const actual = canonicalCrateGenre(candidate.genre ?? "");
    return actual === genre;
  })) failed.push("genres");
  const moods = canonicalMoods(request.moods);
  if (moods.length > 0 && !candidate.moods.some((mood) => moods.includes(canonicalCrateMood(mood) ?? ""))) {
    failed.push("moods");
  }
  if (request.energy !== null) {
    const energy = candidate.energy;
    const band = energy === null ? null : energy < 0.4 ? "low" : energy > 0.6 ? "high" : "medium";
    if (band !== request.energy) failed.push("energy");
  }
  if (request.bpm && (request.bpm.min !== null || request.bpm.max !== null)) {
    const bpm = candidate.tempoBpm;
    if (bpm === null ||
      (request.bpm.min !== null && bpm < request.bpm.min) ||
      (request.bpm.max !== null && bpm > request.bpm.max)) failed.push("bpm");
  }
  return failed;
}

function sessionValue(filter: "moods" | "energy" | "bpm", request: AgentSessionRequest): string | undefined {
  if (filter === "moods") return canonicalMoods(request.moods)[0];
  if (filter === "energy") return request.energy ?? undefined;
  return bpmBin(request.bpm);
}

/** Short sessions use canonical picks when present and a bounded catalog near-match pool otherwise. */
export function deriveSessionUnmetDemand(input: {
  request: AgentSessionRequest;
  candidates: readonly SessionDemandCandidate[];
  shortfall: number;
  requestCoverage?: AgentRequestCoverage;
}): SessionDemandDerivation {
  if (!Number.isFinite(input.shortfall) || input.shortfall <= 0) {
    return { candidates: [], requestedGenres: [] };
  }
  const coverageGaps = input.requestCoverage
    ? new Set(input.requestCoverage.gaps.map((gap) => gap.filter))
    : null;
  const drafts: CandidateDemandDraft[] = [];
  for (const candidate of input.candidates) {
    const failed = sessionFailures(candidate, input.request);
    if (failed.length !== 1) continue;
    const filter = failed[0];
    if (coverageGaps && !coverageGaps.has(filter)) continue;
    if (filter === "genres") continue; // Exact genre owners are resolved against playable catalog rows.
    const kind = filter === "moods" ? "mood" : filter === "energy" ? "energy" : "bpm";
    const value = sessionValue(filter, input.request);
    if (value) drafts.push({ targetType: "artist", candidateTrackId: candidate.trackId, kind, value });
  }
  return {
    candidates: uniqueDrafts(drafts),
    requestedGenres: canonicalGenres(input.request.genres),
  };
}
