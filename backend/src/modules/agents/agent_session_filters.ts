/**
 * The session's OWN filters, summarised for the Session History card (#2096).
 *
 * Only structured, bounded values are kept: the preset name, genres, moods,
 * an energy band, a tempo range, whether it was a My Mix session, and whether
 * explicit tracks were allowed. The listener's typed sentence is never an
 * input here (it is "read once and not saved"), and My Mix lane ids or labels
 * are reduced to a flag. This module is pure: no database, network, or clock.
 */

export interface AgentSessionFilters {
  presetName?: string;
  genres: string[];
  moods: string[];
  energy?: "low" | "medium" | "high";
  tempoBpm?: { min: number | null; max: number | null };
  myMix?: true;
  explicit: boolean;
}

export const SESSION_FILTERS_MAX_TERMS = 8;
export const SESSION_FILTERS_MAX_TERM_LENGTH = 40;
export const SESSION_FILTERS_MAX_PRESET_LENGTH = 60;

export function sessionFilterSummary(input: {
  sessionIntentName?: string;
  sessionGenres?: string[];
  moods?: string[];
  mood?: string;
  energy?: string;
  tempoBpm?: { min: number | null; max: number | null };
  myMix?: unknown;
  allowExplicit: boolean;
}): AgentSessionFilters {
  const summary: AgentSessionFilters = {
    genres: cleanTerms(input.sessionGenres),
    moods: cleanTerms(input.moods?.length ? input.moods : input.mood ? [input.mood] : []),
    explicit: input.allowExplicit === true,
  };

  const presetName =
    typeof input.sessionIntentName === "string"
      ? input.sessionIntentName.trim().slice(0, SESSION_FILTERS_MAX_PRESET_LENGTH).trim()
      : "";
  if (presetName) summary.presetName = presetName;

  if (input.energy === "low" || input.energy === "medium" || input.energy === "high") {
    summary.energy = input.energy;
  }

  const tempo = cleanTempo(input.tempoBpm);
  if (tempo) summary.tempoBpm = tempo;

  if (input.myMix != null) summary.myMix = true;
  return summary;
}

/** Stable comparison of two summaries (key order never matters). */
export function sameSessionFilters(a: unknown, b: AgentSessionFilters): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function cleanTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const term = entry.trim();
    if (!term || term.length > SESSION_FILTERS_MAX_TERM_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= SESSION_FILTERS_MAX_TERMS) break;
  }
  return terms;
}

function cleanTempo(value: unknown): { min: number | null; max: number | null } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const bound = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const min = bound(raw.min);
  const max = bound(raw.max);
  if (min === null && max === null) return undefined;
  return { min, max };
}
