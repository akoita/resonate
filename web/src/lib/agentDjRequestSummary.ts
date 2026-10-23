import type { AgentNextPreferences } from "./api";
import { chipsFromRequest } from "./agentSessionRequest";

/** Longest summary the player queue header shows (#2312). */
export const DJ_SET_SUMMARY_MAX_LENGTH = 60;
/** Shown when the set's preferences say nothing the header can summarise. */
export const DJ_SET_SUMMARY_FALLBACK = "Live session";

const MAX_TERMS = 3;

function titleCase(value: string): string {
    return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function clip(text: string): string {
    return text.length > DJ_SET_SUMMARY_MAX_LENGTH ? `${text.slice(0, DJ_SET_SUMMARY_MAX_LENGTH - 1).trimEnd()}…` : text;
}

function clean(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * A short plain line saying what the live DJ set was asked for, for the player
 * queue header (#2312): the seed ("From <label>"), else the request's genres,
 * moods, energy and tempo, else the session's own genres, mood and energy, else
 * the session intent. It reads the set's stored preferences only, which never
 * hold the typed sentence (`requestText` is stripped before storage), and it
 * ignores that field even if it were present.
 */
export function describeDjSetRequest(preferences: AgentNextPreferences | null | undefined): string {
    if (!preferences) return DJ_SET_SUMMARY_FALLBACK;

    const seedLabel = clean(preferences.seed?.label);
    if (seedLabel) return clip(`From ${seedLabel}`);

    const fromRequest = chipsFromRequest(preferences.request)
        .map((chip) => chip.label)
        .slice(0, MAX_TERMS + 2);
    if (fromRequest.length > 0) return clip(fromRequest.join(" · "));

    const seen = new Set<string>();
    const genres = (preferences.genres ?? [])
        .map(clean)
        .filter((genre) => {
            const key = genre.toLowerCase();
            if (!genre || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_TERMS)
        .map(titleCase);
    const parts = [...genres];
    const mood = clean(preferences.mood);
    if (mood) parts.push(`${titleCase(mood)} mood`);
    if (preferences.energy) parts.push(`${titleCase(preferences.energy)} energy`);
    if (parts.length > 0) return clip(parts.join(" · "));

    const intent = clean(preferences.sessionIntentName);
    return intent ? clip(intent) : DJ_SET_SUMMARY_FALLBACK;
}
