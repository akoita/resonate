/**
 * AI DJ session request helpers (#2037). Pure: no network, no storage.
 *
 * A listener describes the session in their own words; the server turns that
 * into an `AgentSessionRequest` (the listening filters). These helpers turn a
 * request into editable chips, apply chip edits, derive a request from a
 * preset, and explain how well the DJ's picks matched. The typed sentence is
 * never part of a request and never leaves the parse call.
 */

import type {
  AgentRequestCoverage,
  AgentSessionEnergy,
  AgentSessionRequest,
  AgentSessionRequestIgnoredKey,
} from "./api";

export const SESSION_REQUEST_MAX_TEXT_LENGTH = 500;
export const SESSION_ENERGY_BANDS: readonly AgentSessionEnergy[] = ["low", "medium", "high"];

export type RequestChipKind = "genre" | "mood" | "energy" | "bpm";

export type RequestChip = {
  /** Stable key passed to {@link removeChip}. */
  key: string;
  kind: RequestChipKind;
  label: string;
};

/** The slice of a session preset a request is derived from. */
type PresetLike = {
  searchVibes: string[];
  preferences: { mood?: string; energy?: AgentSessionEnergy };
};

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function formatBpm(bpm: NonNullable<AgentSessionRequest["bpm"]>): string | null {
  const { min, max } = bpm;
  if (min !== null && max !== null) return `${min}–${max} BPM`;
  if (max !== null) return `under ${max} BPM`;
  if (min !== null) return `over ${min} BPM`;
  return null;
}

/** The editable chips for a request: genres, moods, energy, then tempo. */
export function chipsFromRequest(request: AgentSessionRequest | null | undefined): RequestChip[] {
  if (!request) return [];
  const chips: RequestChip[] = [];
  for (const genre of request.genres) {
    chips.push({ key: `genre:${genre}`, kind: "genre", label: titleCase(genre) });
  }
  for (const mood of request.moods) {
    chips.push({ key: `mood:${mood}`, kind: "mood", label: `${titleCase(mood)} mood` });
  }
  if (request.energy) {
    chips.push({ key: "energy", kind: "energy", label: `${titleCase(request.energy)} energy` });
  }
  if (request.bpm) {
    const label = formatBpm(request.bpm);
    if (label) chips.push({ key: "bpm", kind: "bpm", label });
  }
  return chips;
}

/** The request with one chip removed. Unknown keys return the request unchanged. */
export function removeChip(request: AgentSessionRequest, chipKey: string): AgentSessionRequest {
  if (chipKey === "energy") return { ...request, energy: null };
  if (chipKey === "bpm") return { ...request, bpm: null };
  if (chipKey.startsWith("genre:")) {
    const genre = chipKey.slice("genre:".length);
    return { ...request, genres: request.genres.filter((candidate) => candidate !== genre) };
  }
  if (chipKey.startsWith("mood:")) {
    const mood = chipKey.slice("mood:".length);
    return { ...request, moods: request.moods.filter((candidate) => candidate !== mood) };
  }
  return request;
}

/** The request with the energy band replaced (or cleared with null). */
export function setEnergy(
  request: AgentSessionRequest,
  band: AgentSessionEnergy | null,
): AgentSessionRequest {
  return { ...request, energy: band };
}

/** An empty request, the starting point for a sentence that yields nothing. */
export function emptyRequest(): AgentSessionRequest {
  return { genres: [], moods: [], energy: null, bpm: null };
}

/** The request a preset stands for, so a preset chip shows (and edits) real filters. */
export function requestFromPreset(preset: PresetLike): AgentSessionRequest {
  const mood = preset.preferences.mood;
  return {
    genres: [...preset.searchVibes],
    moods: mood ? [mood] : [],
    energy: preset.preferences.energy ?? null,
    bpm: null,
  };
}

/** Whether the request would steer anything. */
export function hasFilters(request: AgentSessionRequest | null | undefined): boolean {
  if (!request) return false;
  if (request.genres.length > 0 || request.moods.length > 0 || request.energy) return true;
  return !!request.bpm && (request.bpm.min !== null || request.bpm.max !== null);
}

/** Which kinds of filter a request uses; safe for analytics (no values, no text). */
export function requestFilterKeys(request: AgentSessionRequest | null | undefined): string[] {
  if (!request) return [];
  const keys: string[] = [];
  if (request.genres.length > 0) keys.push("genres");
  if (request.moods.length > 0) keys.push("moods");
  if (request.energy) keys.push("energy");
  if (request.bpm && (request.bpm.min !== null || request.bpm.max !== null)) keys.push("bpm");
  return keys;
}

const IGNORED_LABELS: Record<AgentSessionRequestIgnoredKey, string> = {
  keys: "key",
  requiredStems: "stems",
  licenseType: "license",
  maxTotalUsd: "price",
  maxPerItemUsd: "price",
  verifiedHumanOnly: "verified human only",
};

/** Plain-language names for the filters a listening session ignores, de-duplicated. */
export function ignoredKeyLabels(keys: readonly AgentSessionRequestIgnoredKey[]): string[] {
  const labels: string[] = [];
  for (const key of keys) {
    const label = IGNORED_LABELS[key];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function coverageSubject(
  filter: AgentRequestCoverage["gaps"][number]["filter"],
  request: AgentSessionRequest | null | undefined,
): string | null {
  if (!request) return null;
  switch (filter) {
    case "bpm":
      return request.bpm ? formatBpm(request.bpm) : null;
    case "energy":
      return request.energy ? `${request.energy} energy` : null;
    case "genres":
      return request.genres.length > 0 ? request.genres.join(", ") : null;
    case "moods":
      return request.moods.length > 0 ? request.moods.join(", ") : null;
    default:
      return null;
  }
}

/**
 * One line per gap, largest gap first (as sent), e.g.
 * "Only 1 of 5 picks matched 120–125 BPM". Gaps for filters the listener
 * has since removed are dropped.
 */
export function coverageNotes(
  coverage: AgentRequestCoverage | null | undefined,
  request: AgentSessionRequest | null | undefined,
): string[] {
  if (!coverage || coverage.picks <= 0) return [];
  const notes: string[] = [];
  for (const gap of coverage.gaps) {
    if (gap.matched >= coverage.picks) continue;
    const subject = coverageSubject(gap.filter, request);
    if (!subject) continue;
    notes.push(
      gap.matched <= 0
        ? `None of the ${coverage.picks} picks matched ${subject}`
        : `Only ${gap.matched} of ${coverage.picks} picks matched ${subject}`,
    );
  }
  return notes;
}

type QueuedTrackLike = { id: string; catalogTrackId?: string | null };

/**
 * Indices of the upcoming queue entries (after the current one) that belong to
 * the DJ set, highest first, so removing them in order never shifts an index
 * still to be removed. Tracks the listener queued themselves are left alone.
 */
export function upcomingDjIndices(
  queue: readonly QueuedTrackLike[],
  currentIndex: number,
  setTrackIds: readonly string[],
): number[] {
  const inSet = new Set(setTrackIds);
  const indices: number[] = [];
  for (let index = queue.length - 1; index > currentIndex && index >= 0; index -= 1) {
    const track = queue[index];
    if (inSet.has(track.id) || (track.catalogTrackId && inSet.has(track.catalogTrackId))) {
      indices.push(index);
    }
  }
  return indices;
}

/** The set ids of the queue entries at the given indices (catalog id when present). */
export function trackIdsAt(queue: readonly QueuedTrackLike[], indices: readonly number[]): Set<string> {
  const ids = new Set<string>();
  for (const index of indices) {
    const track = queue[index];
    if (!track) continue;
    ids.add(track.id);
    if (track.catalogTrackId) ids.add(track.catalogTrackId);
  }
  return ids;
}
