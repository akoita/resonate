import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { classifyTrackAvailability } from "../catalog/track-availability";
import { deriveReleaseAiDisclosureSummary } from "../catalog/ai-disclosure.policy";
import { MAIN_ARTIST_CREDIT_ROLES, normalizeCreditName, resolveCreditedArtistName } from "../shared/artist_attribution";
import { PLAY_ACTIONS } from "./listening_stats.aggregate";
import { readListeningMemory } from "./listening_stats.service";
import {
  groupRecentPlays,
  LISTENING_RECENT_SCHEMA_VERSION,
  playlistIdOf,
  RECENT_PLAY_READ_CAP,
  RECENT_WINDOW_DAYS,
  type ListeningRecent,
  type RecentPlaylistInfo,
  type RecentTrackInfo,
} from "./listening_recent.aggregate";

const DAY_MS = 24 * 60 * 60 * 1000;

const recentTrackSelect = {
  id: true,
  title: true,
  artist: true,
  contentStatus: true,
  rightsRoute: true,
  release: {
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      rightsRoute: true,
      withdrawnAt: true,
      withdrawalReason: true,
      artistId: true,
      primaryArtist: true,
      artworkUrl: true,
      artworkMimeType: true,
      artworkRevision: true,
      artist: { select: { displayName: true } },
      artistCredits: {
        select: { role: true, displayName: true, artistId: true },
        orderBy: { sortOrder: "asc" as const },
      },
      publishedRemixProject: { select: { id: true } },
      tracks: {
        select: {
          aiDisclosureLevel: true,
          aiContributionFacets: true,
          aiDisclosureSource: true,
          aiDisclosureVersion: true,
          aiDeclaredAt: true,
        },
      },
    },
  },
} satisfies Prisma.TrackSelect;

type RecentTrackRow = Prisma.TrackGetPayload<{ select: typeof recentTrackSelect }>;

function toRecentTrackInfo(track: RecentTrackRow): RecentTrackInfo {
  const release = track.release;
  const artistName =
    resolveCreditedArtistName({
      trackArtist: track.artist,
      credits: release.artistCredits,
      primaryArtist: release.primaryArtist,
      accountDisplayName: release.artist?.displayName,
    }) ?? "Unknown Artist";
  const mainCredit = release.artistCredits.find((credit) =>
    MAIN_ARTIST_CREDIT_ROLES.has(credit.role.toLowerCase()),
  );
  const overridden = normalizeCreditName(track.artist) !== "";
  return {
    trackId: track.id,
    title: track.title,
    available: classifyTrackAvailability(track).state === "available",
    releaseId: release.id,
    releaseTitle: release.title,
    releaseType: release.type,
    isRemix: Boolean(release.publishedRemixProject),
    artistId: !overridden && mainCredit ? mainCredit.artistId : release.artistId,
    artistName,
    artworkUrl: release.artworkUrl,
    hasUploadedArtwork: Boolean(release.artworkMimeType),
    artworkRevision: release.artworkRevision,
    aiDisclosure: release.tracks.length > 0 ? deriveReleaseAiDisclosureSummary(release.tracks) : null,
  };
}

/**
 * Home's "Jump back in": the releases and playlists the signed-in listener
 * played most recently, read from their own remembered plays (the same rows as
 * "Your listening"). Stores nothing, never reads another listener's plays, and
 * honors a taste reset. A playlist only appears while the listener can still
 * open it (their own, or another listener's public one).
 */
@Injectable()
export class ListeningRecentService {
  async getRecent(
    userId: string,
    options: { limit: number; now?: Date },
  ): Promise<ListeningRecent> {
    const now = options.now ?? new Date();
    const windowStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);
    const { recording, resetAt } = await readListeningMemory(userId);
    const createdAt: Prisma.DateTimeFilter =
      resetAt && resetAt >= windowStart ? { gt: resetAt, lte: now } : { gte: windowStart, lte: now };

    const plays = await prisma.agentSignal.findMany({
      where: { userId, action: { in: [...PLAY_ACTIONS] }, createdAt },
      orderBy: { createdAt: "desc" },
      take: RECENT_PLAY_READ_CAP,
      select: { trackId: true, createdAt: true, metadata: true },
    });
    if (plays.length === 0) {
      return { schemaVersion: LISTENING_RECENT_SCHEMA_VERSION, recording, items: [] };
    }

    const playlistIds = [
      ...new Set(plays.map((play) => playlistIdOf(play.metadata)).filter((id): id is string => Boolean(id))),
    ];
    const [trackRows, playlistRows] = await Promise.all([
      prisma.track.findMany({
        where: { id: { in: [...new Set(plays.map((play) => play.trackId))] } },
        select: recentTrackSelect,
      }),
      playlistIds.length > 0
        ? prisma.playlist.findMany({
            where: {
              id: { in: playlistIds },
              OR: [{ userId }, { visibility: "public" }],
            },
            select: { id: true, name: true, userId: true, visibility: true, trackIds: true },
          })
        : Promise.resolve([]),
    ]);

    const tracks = new Map(trackRows.map((row) => [row.id, toRecentTrackInfo(row)]));
    const playlists = new Map<string, RecentPlaylistInfo>(
      playlistRows.map((row) => [
        row.id,
        {
          playlistId: row.id,
          name: row.name,
          isOwner: row.userId === userId,
          visibility: row.visibility,
          trackCount: row.trackIds.length,
        },
      ]),
    );

    return {
      schemaVersion: LISTENING_RECENT_SCHEMA_VERSION,
      recording,
      items: groupRecentPlays({ plays, tracks, playlists, limit: options.limit }),
    };
  }
}
