/**
 * "Jump back in" (Home): the releases and playlists a listener played most
 * recently, newest first, built from the same remembered plays as "Your
 * listening". Pure so the grouping rules are unit tested without a database.
 *
 * - A play made from a playlist the listener can still open counts for that
 *   playlist; any other play counts for the track's release.
 * - Each release or playlist appears once, at its most recent play, and keeps
 *   the track played last so the tile can resume there.
 * - Unavailable tracks (withdrawn, removed, under review) are left out. Device
 *   files never reach this list: they are not catalog tracks.
 */
import type { AiDisclosureRecord } from "../catalog/ai-disclosure.policy";

export const LISTENING_RECENT_SCHEMA_VERSION = "listening-recent/v1";
/** How far back "recent" reaches: hours, days and months, not years. */
export const RECENT_WINDOW_DAYS = 180;
/** Newest play rows read per request; plenty to fill a dozen distinct tiles. */
export const RECENT_PLAY_READ_CAP = 600;
export const RECENT_DEFAULT_LIMIT = 12;
export const RECENT_MAX_LIMIT = 24;
/** Distinct covers sampled for a playlist tile's mosaic. */
export const RECENT_PLAYLIST_COVER_LIMIT = 4;

export interface RecentPlayRow {
  trackId: string;
  createdAt: Date;
  metadata: unknown;
}

export interface RecentArtwork {
  releaseId: string;
  artworkUrl: string | null;
  hasUploadedArtwork: boolean;
  artworkRevision: number;
}

export interface RecentTrackInfo extends RecentArtwork {
  trackId: string;
  title: string;
  available: boolean;
  releaseTitle: string;
  releaseType: string;
  isRemix: boolean;
  artistId: string | null;
  artistName: string;
  aiDisclosure: AiDisclosureRecord | null;
}

export interface RecentPlaylistInfo {
  playlistId: string;
  name: string;
  isOwner: boolean;
  visibility: string;
  trackCount: number;
}

export type RecentPlayItem =
  | (RecentArtwork & {
      kind: "release";
      title: string;
      releaseType: string;
      isRemix: boolean;
      artistId: string | null;
      artistName: string;
      aiDisclosure: AiDisclosureRecord | null;
      lastTrackId: string;
      lastTrackTitle: string;
      lastPlayedAt: string;
    })
  | {
      kind: "playlist";
      playlistId: string;
      name: string;
      isOwner: boolean;
      visibility: string;
      trackCount: number;
      covers: RecentArtwork[];
      lastTrackId: string;
      lastTrackTitle: string;
      lastPlayedAt: string;
    };

export interface ListeningRecent {
  schemaVersion: typeof LISTENING_RECENT_SCHEMA_VERSION;
  /** False when plays are not being remembered right now (consent or taste memory off). */
  recording: boolean;
  items: RecentPlayItem[];
}

export function playlistIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).playlistId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function artworkOf(track: RecentTrackInfo): RecentArtwork {
  return {
    releaseId: track.releaseId,
    artworkUrl: track.artworkUrl,
    hasUploadedArtwork: track.hasUploadedArtwork,
    artworkRevision: track.artworkRevision,
  };
}

function hasArtwork(art: RecentArtwork): boolean {
  return Boolean(art.artworkUrl) || art.hasUploadedArtwork;
}

export function groupRecentPlays(input: {
  plays: RecentPlayRow[];
  tracks: Map<string, RecentTrackInfo>;
  playlists: Map<string, RecentPlaylistInfo>;
  limit: number;
}): RecentPlayItem[] {
  const plays = [...input.plays].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const items: RecentPlayItem[] = [];
  const byKey = new Map<string, RecentPlayItem>();

  for (const play of plays) {
    const track = input.tracks.get(play.trackId);
    if (!track || !track.available) continue;
    const playlistId = playlistIdOf(play.metadata);
    const playlist = playlistId ? input.playlists.get(playlistId) : undefined;
    const key = playlist ? `playlist:${playlist.playlistId}` : `release:${track.releaseId}`;
    const existing = byKey.get(key);

    if (existing) {
      // Older plays from a playlist only add cover variety to its tile.
      if (existing.kind === "playlist" && existing.covers.length < RECENT_PLAYLIST_COVER_LIMIT) {
        const art = artworkOf(track);
        if (hasArtwork(art) && !existing.covers.some((cover) => cover.releaseId === art.releaseId)) {
          existing.covers.push(art);
        }
      }
      continue;
    }
    if (items.length >= input.limit) continue;

    const lastPlayedAt = play.createdAt.toISOString();
    const item: RecentPlayItem = playlist
      ? {
          kind: "playlist",
          playlistId: playlist.playlistId,
          name: playlist.name,
          isOwner: playlist.isOwner,
          visibility: playlist.visibility,
          trackCount: playlist.trackCount,
          covers: hasArtwork(artworkOf(track)) ? [artworkOf(track)] : [],
          lastTrackId: track.trackId,
          lastTrackTitle: track.title,
          lastPlayedAt,
        }
      : {
          kind: "release",
          ...artworkOf(track),
          title: track.releaseTitle,
          releaseType: track.releaseType,
          isRemix: track.isRemix,
          artistId: track.artistId,
          artistName: track.artistName,
          aiDisclosure: track.aiDisclosure,
          lastTrackId: track.trackId,
          lastTrackTitle: track.title,
          lastPlayedAt,
        };
    byKey.set(key, item);
    items.push(item);
  }
  return items;
}
