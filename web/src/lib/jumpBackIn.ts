import { recentArtworkUrl, type AiDisclosure, type RecentPlayItem } from "./api";
import { formatReleaseType } from "./catalogDisplay";
import { publicReleaseHref } from "./artistRoutes";
import type { RecentView, RecentViewKind } from "./recentViews";

/**
 * Home's "Jump back in" (#2735): server plays and this device's opened pages,
 * merged into one newest-first row. One tile per thing: a release played and
 * later opened is one tile at its latest moment, and keeps the play's resume
 * point.
 */

export const JUMP_BACK_IN_LIMIT = 12;

export type JumpBackInKind = RecentViewKind;

export type JumpBackInPlay =
  | { kind: "release"; releaseId: string; resumeTrackId?: string }
  | { kind: "playlist"; playlistId: string; isOwner: boolean; resumeTrackId?: string }
  | { kind: "artist"; artistId: string | null; name: string };

export type JumpBackInIcon = "album" | "tune" | "mic" | "queue_music" | "rocket_launch" | "graphic_eq" | "library_music";

export type JumpBackInItem = {
  key: string;
  kind: JumpBackInKind;
  title: string;
  subtitle?: string;
  badge: string;
  icon: JumpBackInIcon;
  href: string;
  /** One cover, a playlist mosaic, or nothing (monogram). */
  covers: string[];
  at: number;
  /** What happened last: played it, or opened its page. */
  last: "played" | "opened";
  play?: JumpBackInPlay;
  aiDisclosure?: AiDisclosure | null;
};

const KIND_ICON: Record<JumpBackInKind, JumpBackInIcon> = {
  release: "album",
  mixer: "tune",
  artist: "mic",
  playlist: "queue_music",
  show: "rocket_launch",
  stem: "graphic_eq",
};

function releaseBadge(type: string | undefined, isRemix: boolean | undefined): string {
  return isRemix ? "Remix" : formatReleaseType(type);
}

function fromPlay(item: RecentPlayItem): JumpBackInItem {
  const at = Date.parse(item.lastPlayedAt) || 0;
  if (item.kind === "playlist") {
    return {
      key: `playlist:${item.playlistId}`,
      kind: "playlist",
      title: item.name,
      subtitle: item.isOwner ? "Your playlist" : "Public playlist",
      badge: "Playlist",
      icon: KIND_ICON.playlist,
      href: item.isOwner
        ? `/library?tab=playlists&playlist=${encodeURIComponent(item.playlistId)}`
        : `/playlist/${encodeURIComponent(item.playlistId)}`,
      covers: item.covers.map(recentArtworkUrl).filter((url): url is string => Boolean(url)),
      at,
      last: "played",
      play: { kind: "playlist", playlistId: item.playlistId, isOwner: item.isOwner, resumeTrackId: item.lastTrackId },
    };
  }
  const cover = recentArtworkUrl(item);
  return {
    key: `release:${item.releaseId}`,
    kind: "release",
    title: item.title,
    subtitle: item.artistName,
    badge: releaseBadge(item.releaseType, item.isRemix),
    icon: item.isRemix ? "library_music" : KIND_ICON.release,
    href: publicReleaseHref(item.releaseId),
    covers: cover ? [cover] : [],
    at,
    last: "played",
    play: { kind: "release", releaseId: item.releaseId, resumeTrackId: item.lastTrackId },
    aiDisclosure: item.aiDisclosure,
  };
}

function fromView(view: RecentView): JumpBackInItem {
  const base = {
    key: `${view.kind}:${view.id}`,
    kind: view.kind,
    title: view.title,
    subtitle: view.subtitle,
    href: view.href,
    covers: view.imageUrl ? [view.imageUrl] : [],
    at: view.viewedAt,
    last: "opened" as const,
    icon: KIND_ICON[view.kind],
  };
  switch (view.kind) {
    case "release":
      return {
        ...base,
        badge: releaseBadge(view.releaseType, view.isRemix),
        icon: view.isRemix ? "library_music" : base.icon,
        play: { kind: "release", releaseId: view.id },
      };
    case "mixer":
      return { ...base, badge: "Stems", play: { kind: "release", releaseId: view.id } };
    case "artist":
      return {
        ...base,
        badge: "Artist",
        play: { kind: "artist", artistId: view.artistId ?? null, name: view.title },
      };
    case "playlist":
      return { ...base, badge: "Playlist", play: { kind: "playlist", playlistId: view.id, isOwner: false } };
    case "show":
      return { ...base, badge: "Show" };
    case "stem":
      return { ...base, badge: "Stem" };
  }
}

/**
 * Merges plays and opened pages, newest first, one tile per thing, hiding
 * everything at or before `clearedAt`.
 */
export function mergeJumpBackIn(
  plays: readonly RecentPlayItem[],
  views: readonly RecentView[],
  options: { clearedAt?: number; limit?: number } = {},
): JumpBackInItem[] {
  const clearedAt = options.clearedAt ?? 0;
  const limit = options.limit ?? JUMP_BACK_IN_LIMIT;
  const byKey = new Map<string, JumpBackInItem>();

  for (const item of [...plays.map(fromPlay), ...views.map(fromView)]) {
    if (item.at <= clearedAt) continue;
    const existing = byKey.get(item.key);
    if (!existing) {
      byKey.set(item.key, item);
      continue;
    }
    // Keep the played entry's resume point and server data; take the newest moment.
    const played = existing.last === "played" ? existing : item.last === "played" ? item : existing;
    const newest = item.at > existing.at ? item : existing;
    byKey.set(item.key, {
      ...played,
      covers: played.covers.length > 0 ? played.covers : newest.covers,
      at: newest.at,
      last: newest.last,
    });
  }

  return [...byKey.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** `just now`, `5 min ago`, `3 h ago`, `yesterday`, `4 days ago`, `2 weeks ago`, `3 months ago`. */
export function formatRecentAge(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.round(diff / minute)} min ago`;
  if (diff < day) return `${Math.round(diff / hour)} h ago`;
  const days = Math.floor(diff / day);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
