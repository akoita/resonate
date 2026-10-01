/**
 * Home rail attribution for discovery measurement (#1455 WS-8).
 *
 * A Home rail tile opens a release page (or seeds an AI DJ session); the play
 * happens later, on another page. To measure per-rail skip / save / completion
 * rates, the click remembers which rail and ranker variant a track came from,
 * and playback and save events for that track forward the same labels while the
 * attribution is fresh.
 *
 * Labels only: a rail id, a variant name and an experiment key. Nothing about the listener is
 * stored, the entry lives in sessionStorage (tab-scoped), and it expires after
 * 30 minutes or when the same track is attributed again.
 */

const STORAGE_KEY = "resonate.home.attribution";
export const HOME_ATTRIBUTION_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 20;

export type HomeAttribution = {
  railId: string;
  rankerVariant?: string;
  /** #2005: kept with the variant so outcome rows join their impressions. */
  experimentKey?: string;
};

type StoredEntry = HomeAttribution & { trackId: string; at: number };

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

export function rememberHomeAttribution(
  trackId: string,
  attribution: HomeAttribution,
  now = Date.now(),
) {
  if (typeof window === "undefined" || !trackId || !attribution.railId) return;
  const fresh = readEntries().filter(
    (entry) => entry.trackId !== trackId && now - entry.at < HOME_ATTRIBUTION_TTL_MS,
  );
  writeEntries([
    ...fresh,
    {
      trackId,
      railId: attribution.railId,
      ...(attribution.rankerVariant ? { rankerVariant: attribution.rankerVariant } : {}),
      ...(attribution.experimentKey ? { experimentKey: attribution.experimentKey } : {}),
      at: now,
    },
  ]);
}

/** The fresh rail attribution for a track, or undefined. */
export function getHomeAttribution(
  trackId: string | undefined,
  now = Date.now(),
): HomeAttribution | undefined {
  if (!trackId) return undefined;
  const entry = readEntries().find(
    (candidate) => candidate.trackId === trackId && now - candidate.at < HOME_ATTRIBUTION_TTL_MS,
  );
  if (!entry) return undefined;
  return {
    railId: entry.railId,
    ...(entry.rankerVariant ? { rankerVariant: entry.rankerVariant } : {}),
    ...(entry.experimentKey ? { experimentKey: entry.experimentKey } : {}),
  };
}

/** When the fresh rail attribution for a track was recorded (ms), or undefined. */
export function getHomeAttributionAt(
  trackId: string | undefined,
  now = Date.now(),
): number | undefined {
  if (!trackId) return undefined;
  return readEntries().find(
    (candidate) => candidate.trackId === trackId && now - candidate.at < HOME_ATTRIBUTION_TTL_MS,
  )?.at;
}
