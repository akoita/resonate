import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  PLAYABLE_TRACK_WHERE,
  WITHDRAWABLE_RELEASE_STATUSES,
} from "../catalog/track-availability";
import { PUBLIC_RELEASE_ROUTES } from "../catalog/catalog-public.constants";
import { PlaylistService } from "../playlist/playlist.service";

/** Shortest query worth a round trip; one letter matches half the catalog. */
export const SEARCH_MIN_QUERY_LENGTH = 2;
/** Longer input is cut, not refused: a pasted title still finds something. */
export const SEARCH_MAX_QUERY_LENGTH = 80;
export const SEARCH_GROUP_LIMIT = 5;

/**
 * An artist result. `profile` is an artist account (its page is by id);
 * `credit` is a name credited on releases with no account behind it, such
 * as an imported catalog's artist (its page is by name).
 */
export type SearchArtist = {
  kind: "profile" | "credit";
  id: string | null;
  displayName: string;
  imageUrl: string | null;
};
export type SearchRelease = {
  id: string;
  title: string;
  type: string;
  artistName: string;
  hasArtwork: boolean;
  artworkRevision: number;
};
export type SearchTrack = {
  id: string;
  title: string;
  artistName: string;
  releaseId: string;
  releaseTitle: string;
  hasArtwork: boolean;
  artworkRevision: number;
};
export type SearchPlaylist = {
  id: string;
  name: string;
  ownerDisplayName: string | null;
  playableTrackCount: number;
};
export type SearchResults = {
  query: string;
  artists: SearchArtist[];
  releases: SearchRelease[];
  tracks: SearchTrack[];
  playlists: SearchPlaylist[];
};

/** Trim, collapse spaces and cut to the maximum length. */
export function normalizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
}

/**
 * Artist accounts first, then credited names that no listed account already
 * shows (compared without case), names that start with the query before the
 * rest, at most `SEARCH_GROUP_LIMIT` in all.
 */
export function mergeArtistResults(
  profiles: SearchArtist[],
  creditedNames: Array<string | null>,
  query: string,
): SearchArtist[] {
  const seen = new Set(profiles.map((artist) => artist.displayName.trim().toLowerCase()));
  const needle = query.toLowerCase();
  const credits: SearchArtist[] = [];
  for (const raw of creditedNames) {
    const name = raw?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    credits.push({ kind: "credit", id: null, displayName: name, imageUrl: null });
  }
  credits.sort((a, b) => {
    const aStarts = a.displayName.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = b.displayName.toLowerCase().startsWith(needle) ? 0 : 1;
    return aStarts - bStarts || a.displayName.localeCompare(b.displayName);
  });
  return [...profiles, ...credits].slice(0, SEARCH_GROUP_LIMIT);
}

const PUBLIC_ROUTE = {
  OR: [{ rightsRoute: null }, { rightsRoute: { in: [...PUBLIC_RELEASE_ROUTES] } }],
} satisfies Prisma.ReleaseWhereInput;

/**
 * A release anyone may open: ready or published, on a public rights route,
 * with at least one track that can be played right now. Withdrawn, removed or
 * restricted releases never match.
 */
export const LISTED_RELEASE_WHERE = {
  AND: [
    { status: { in: [...WITHDRAWABLE_RELEASE_STATUSES] } },
    PUBLIC_ROUTE,
    { tracks: { some: PLAYABLE_TRACK_WHERE } },
  ],
} satisfies Prisma.ReleaseWhereInput;

/**
 * Top-bar search (#2671): artists, releases, tracks and public playlists in
 * one call. Every group applies the playable-content rule, so content a
 * listener cannot open never appears.
 */
@Injectable()
export class SearchService {
  constructor(private readonly playlists: PlaylistService) {}

  async search(rawQuery: unknown): Promise<SearchResults> {
    const query = normalizeSearchQuery(rawQuery);
    if (query.length < SEARCH_MIN_QUERY_LENGTH) {
      return { query, artists: [], releases: [], tracks: [], playlists: [] };
    }
    const contains = { contains: query, mode: "insensitive" as const };

    const [artists, credits, releases, tracks, playlists] = await Promise.all([
      prisma.artist.findMany({
        where: { displayName: contains, releases: { some: LISTED_RELEASE_WHERE } },
        orderBy: { displayName: "asc" },
        take: SEARCH_GROUP_LIMIT,
        select: { id: true, displayName: true, imageUrl: true },
      }),
      // Names credited on listed releases: an imported catalog credits artists
      // that have no account, and they are still who listeners search for.
      prisma.release.findMany({
        where: { AND: [LISTED_RELEASE_WHERE, { primaryArtist: contains }] },
        distinct: ["primaryArtist"],
        orderBy: { primaryArtist: "asc" },
        take: SEARCH_GROUP_LIMIT * 2,
        select: { primaryArtist: true },
      }),
      prisma.release.findMany({
        where: {
          AND: [
            LISTED_RELEASE_WHERE,
            { OR: [{ title: contains }, { primaryArtist: contains }, { artist: { displayName: contains } }] },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: SEARCH_GROUP_LIMIT,
        select: {
          id: true,
          title: true,
          type: true,
          primaryArtist: true,
          artworkMimeType: true,
          artworkRevision: true,
          artist: { select: { displayName: true } },
        },
      }),
      prisma.track.findMany({
        where: { AND: [PLAYABLE_TRACK_WHERE, { OR: [{ title: contains }, { artist: contains }] }] },
        orderBy: { createdAt: "desc" },
        take: SEARCH_GROUP_LIMIT,
        select: {
          id: true,
          title: true,
          artist: true,
          releaseId: true,
          release: {
            select: {
              title: true,
              primaryArtist: true,
              artworkMimeType: true,
              artworkRevision: true,
              artist: { select: { displayName: true } },
            },
          },
        },
      }),
      this.playlists.listPublicPlaylists({ query, limit: SEARCH_GROUP_LIMIT }),
    ]);

    return {
      query,
      artists: mergeArtistResults(
        artists.map((artist) => ({
          kind: "profile" as const,
          id: artist.id,
          displayName: artist.displayName,
          imageUrl: artist.imageUrl ?? null,
        })),
        credits.map((credit) => credit.primaryArtist),
        query,
      ),
      releases: releases.map((release) => ({
        id: release.id,
        title: release.title,
        type: release.type,
        artistName: release.primaryArtist || release.artist.displayName,
        hasArtwork: Boolean(release.artworkMimeType),
        artworkRevision: release.artworkRevision,
      })),
      tracks: tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artistName: track.artist || track.release.primaryArtist || track.release.artist.displayName,
        releaseId: track.releaseId,
        releaseTitle: track.release.title,
        hasArtwork: Boolean(track.release.artworkMimeType),
        artworkRevision: track.release.artworkRevision,
      })),
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        ownerDisplayName: playlist.ownerDisplayName,
        playableTrackCount: playlist.playableTrackCount,
      })),
    };
  }
}
