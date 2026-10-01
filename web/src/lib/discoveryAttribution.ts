/**
 * AI DJ attribution for discovery measurement (#2005, WS-8 of #1455).
 *
 * Mirrors `homeAttribution.ts`: an accepted DJ pick remembers the listener's
 * ranker variant for that track, and playback started / completed / skipped and
 * `library.saved` events for the same track forward `surface: "dj"` plus the
 * variant labels while the attribution is fresh.
 *
 * Labels only: a surface name, a variant name and an experiment key. Nothing
 * about the listener is stored, the entry lives in sessionStorage (tab-scoped),
 * and it expires after 30 minutes or when the same track is picked again.
 *
 * `getDiscoveryAttribution` is the single lookup for outcome events. When a
 * track has both a Home rail attribution and a DJ attribution, the more recent
 * one wins, so a play is never counted on two surfaces.
 */

import { getHomeAttribution, getHomeAttributionAt, type HomeAttribution } from "./homeAttribution";

const STORAGE_KEY = "resonate.dj.attribution";
export const DJ_ATTRIBUTION_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 20;

export type DjAttribution = {
  surface: "dj";
  rankerVariant?: string;
  experimentKey?: string;
};

/** What outcome events forward: a Home rail or the AI DJ surface. */
export type DiscoveryAttribution = HomeAttribution | DjAttribution;

type StoredEntry = {
  trackId: string;
  rankerVariant?: string;
  experimentKey?: string;
  at: number;
};

function readEntries(): StoredEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: StoredEntry[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Storage unavailable: attribution is best-effort.
  }
}

export function rememberDjAttribution(
  trackId: string,
  labels: { rankerVariant?: string; experimentKey?: string } = {},
  now = Date.now(),
) {
  if (typeof window === "undefined" || !trackId) return;
  const fresh = readEntries().filter(
    (entry) => entry.trackId !== trackId && now - entry.at < DJ_ATTRIBUTION_TTL_MS,
  );
  writeEntries([
    ...fresh,
    {
      trackId,
      ...(labels.rankerVariant ? { rankerVariant: labels.rankerVariant } : {}),
      ...(labels.experimentKey ? { experimentKey: labels.experimentKey } : {}),
      at: now,
    },
  ]);
}

function findDjEntry(trackId: string | undefined, now: number): StoredEntry | undefined {
  if (!trackId) return undefined;
  return readEntries().find(
    (candidate) => candidate.trackId === trackId && now - candidate.at < DJ_ATTRIBUTION_TTL_MS,
  );
}

/** The fresh AI DJ attribution for a track, or undefined. */
export function getDjAttribution(
  trackId: string | undefined,
  now = Date.now(),
): DjAttribution | undefined {
  const entry = findDjEntry(trackId, now);
  if (!entry) return undefined;
  return {
    surface: "dj",
    ...(entry.rankerVariant ? { rankerVariant: entry.rankerVariant } : {}),
    ...(entry.experimentKey ? { experimentKey: entry.experimentKey } : {}),
  };
}

/**
 * The attribution outcome events for a track should carry: the most recent of
 * its Home rail and AI DJ attributions, or undefined.
 */
export function getDiscoveryAttribution(
  trackId: string | undefined,
  now = Date.now(),
): DiscoveryAttribution | undefined {
  const dj = getDjAttribution(trackId, now);
  const home = getHomeAttribution(trackId, now);
  if (!dj) return home;
  if (!home) return dj;
  const homeAt = getHomeAttributionAt(trackId, now) ?? 0;
  const djAt = findDjEntry(trackId, now)?.at ?? 0;
  return djAt > homeAt ? dj : home;
}
