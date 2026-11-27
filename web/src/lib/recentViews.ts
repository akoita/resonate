/**
 * Home's "Jump back in" (#2735): the pages a signed-in listener opened lately
 * (artists, releases, mixers, playlists, shows, stems, the listener's own
 * Remix Studio drafts), kept in THIS browser
 * only. Nothing here is sent to the server: what someone looks at is not
 * listening history and is not telemetry. Plays come from the server's
 * consented play history instead (`getRecentListening`).
 *
 * - One list per account on this device, capped, newest first.
 * - Only catalog pages are recorded, never device files.
 * - "Clear" empties the list and hides everything up to that moment, plays
 *   included, from the row on this device.
 */

export type RecentViewKind = "release" | "mixer" | "artist" | "playlist" | "show" | "stem" | "remixDraft";

export type RecentView = {
  kind: RecentViewKind;
  /** Release, artist, playlist, campaign or stem token id. */
  id: string;
  title: string;
  subtitle?: string;
  /** Absolute http(s) URL or a same-origin path. */
  imageUrl?: string | null;
  /** Same-origin path the tile opens. */
  href: string;
  viewedAt: number;
  /** Release type (album, single, ep) for release and mixer views. */
  releaseType?: string;
  isRemix?: boolean;
  /** For artist views: the profile id, or null when only a name is known. */
  artistId?: string | null;
};

export const RECENT_VIEWS_STORAGE_PREFIX = "resonate.recentViews.v1.";
export const RECENT_VIEWS_CLEARED_PREFIX = "resonate.recentViews.clearedAt.v1.";
export const RECENT_VIEWS_CHANGED_EVENT = "resonate:recent-views-changed";
export const RECENT_VIEWS_CAP = 30;

const KINDS = new Set<RecentViewKind>(["release", "mixer", "artist", "playlist", "show", "stem", "remixDraft"]);
const MAX_TEXT = 200;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isSafeHref(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && value.length <= 500;
}

function isSafeImage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return /^https?:\/\//i.test(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined;
}

/** Validates one stored entry; anything malformed is dropped. */
export function normalizeRecentView(raw: unknown): RecentView | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const kind = entry.kind as RecentViewKind;
  const id = text(entry.id);
  const title = text(entry.title);
  if (!KINDS.has(kind) || !id || !title || !isSafeHref(entry.href)) return null;
  const viewedAt = typeof entry.viewedAt === "number" && Number.isFinite(entry.viewedAt) ? entry.viewedAt : null;
  if (viewedAt === null) return null;
  const subtitle = text(entry.subtitle);
  const releaseType = text(entry.releaseType);
  return {
    kind,
    id,
    title,
    href: entry.href,
    viewedAt,
    ...(subtitle ? { subtitle } : {}),
    ...(isSafeImage(entry.imageUrl) ? { imageUrl: entry.imageUrl } : {}),
    ...(releaseType ? { releaseType } : {}),
    ...(entry.isRemix === true ? { isRemix: true } : {}),
    ...(kind === "artist" ? { artistId: text(entry.artistId) ?? null } : {}),
  };
}

export function recentViewKey(view: Pick<RecentView, "kind" | "id">): string {
  return `${view.kind}:${view.id}`;
}

export function readRecentViews(userId: string | null | undefined): RecentView[] {
  const store = storage();
  if (!store || !userId) return [];
  try {
    const parsed = JSON.parse(store.getItem(RECENT_VIEWS_STORAGE_PREFIX + userId) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRecentView)
      .filter((view): view is RecentView => view !== null)
      .sort((a, b) => b.viewedAt - a.viewedAt);
  } catch {
    return [];
  }
}

export function readRecentClearedAt(userId: string | null | undefined): number {
  const store = storage();
  if (!store || !userId) return 0;
  try {
    const value = Number(store.getItem(RECENT_VIEWS_CLEARED_PREFIX + userId));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(RECENT_VIEWS_CHANGED_EVENT));
}

/** Remembers that the listener opened a page. Newest first, one entry per page. */
export function recordRecentView(
  userId: string | null | undefined,
  view: Omit<RecentView, "viewedAt"> & { viewedAt?: number },
): void {
  const store = storage();
  if (!store || !userId) return;
  const entry = normalizeRecentView({ ...view, viewedAt: view.viewedAt ?? Date.now() });
  if (!entry) return;
  const key = recentViewKey(entry);
  const next = [entry, ...readRecentViews(userId).filter((existing) => recentViewKey(existing) !== key)].slice(
    0,
    RECENT_VIEWS_CAP,
  );
  try {
    store.setItem(RECENT_VIEWS_STORAGE_PREFIX + userId, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the row simply shows plays only.
    return;
  }
  notify();
}

/** Empties this device's list and hides everything up to now, plays included. */
export function clearRecent(userId: string | null | undefined, now: number = Date.now()): void {
  const store = storage();
  if (!store || !userId) return;
  try {
    store.removeItem(RECENT_VIEWS_STORAGE_PREFIX + userId);
    store.setItem(RECENT_VIEWS_CLEARED_PREFIX + userId, String(now));
  } catch {
    return;
  }
  notify();
}

/** Every account's list on this device (full local reset). */
export function removeAllRecentViews(): string[] {
  const store = storage();
  if (!store) return [];
  const keys: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && (key.startsWith(RECENT_VIEWS_STORAGE_PREFIX) || key.startsWith(RECENT_VIEWS_CLEARED_PREFIX))) {
        keys.push(key);
      }
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    return keys;
  }
  return keys;
}
