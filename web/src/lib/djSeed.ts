/**
 * Seeded AI DJ sessions (#2244): "Start a DJ session from this" on a track, an
 * artist or one of the listener's playlists. The entry point queues the seed in
 * this tab (sessionStorage; an id and a display label, nothing private beyond
 * what the listener already sees) and sends them to Home's `#ai-dj` section,
 * where the prompt shows a removable "From: <label>" chip. The server checks the
 * seed again on start; a label sent here is only a display fallback.
 */

export const DJ_SEED_KINDS = ["track", "artist", "playlist"] as const;
export type DjSeedKind = (typeof DJ_SEED_KINDS)[number];

export type DjSeed = { kind: DjSeedKind; id: string; label: string };

const STORAGE_KEY = "resonate:dj-seed";
/** Fired on `window` when a seed is queued, for a DJ panel that is already mounted. */
export const DJ_SEED_EVENT = "resonate:dj-seed";
export const DJ_SEED_HREF = "/#ai-dj";
const MAX_ID = 100;
const MAX_LABEL = 120;

/** A well-formed seed, or null. Labels are trimmed and bounded. */
export function parseDjSeed(value: unknown): DjSeed | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const kind = DJ_SEED_KINDS.find((candidate) => candidate === record.kind);
  if (!kind || !id || id.length > MAX_ID) return null;
  const label = typeof record.label === "string" ? record.label.trim().slice(0, MAX_LABEL).trim() : "";
  return { kind, id, label: label || kind };
}

/** Queues a seed for the DJ panel and tells a mounted panel about it. */
export function queueDjSeed(seed: DjSeed): boolean {
  const clean = parseDjSeed(seed);
  if (!clean || typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(DJ_SEED_EVENT));
  return true;
}

/** The queued seed, removed from storage so it is used once; null when there is none. */
export function takeDjSeed(): DjSeed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return parseDjSeed(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The chip text for a seed. */
export function djSeedChipLabel(seed: Pick<DjSeed, "label">): string {
  return `From: ${seed.label}`;
}

/** Plain-words name of what a seed is, for history lines. */
export function djSeedKindLabel(kind: DjSeedKind): string {
  return kind === "track" ? "track" : kind === "artist" ? "artist" : "playlist";
}
