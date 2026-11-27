import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { classifyTrackAvailability } from "../catalog/track-availability";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../analytics/analytics_consent.service";
import { MAIN_ARTIST_CREDIT_ROLES, normalizeCreditName, resolveCreditedArtistName } from "../shared/artist_attribution";
import {
  aggregateListeningStats,
  type ListeningStats,
  type ListeningStatsWindow,
  PLAY_ACTIONS,
  type StatsTrackInfo,
} from "./listening_stats.aggregate";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hard cap on play rows read per request (newest first), across both windows. */
export const PLAY_READ_CAP = 20_000;
/** Hard cap on earlier tracks read to tell which artists are new. */
export const EARLIER_TRACKS_CAP = 5_000;

const trackSelect = {
  id: true,
  title: true,
  artist: true,
  contentStatus: true,
  rightsRoute: true,
  release: {
    select: {
      id: true,
      title: true,
      status: true,
      rightsRoute: true,
      withdrawnAt: true,
      withdrawalReason: true,
      artistId: true,
      primaryArtist: true,
      genre: true,
      moods: true,
      artworkUrl: true,
      artworkMimeType: true,
      artworkRevision: true,
      artist: { select: { displayName: true } },
      artistCredits: {
        select: { role: true, displayName: true, artistId: true },
        orderBy: { sortOrder: "asc" as const },
      },
    },
  },
} satisfies Prisma.TrackSelect;

type StatsTrackRow = Prisma.TrackGetPayload<{ select: typeof trackSelect }>;

function toTrackInfo(track: StatsTrackRow): StatsTrackInfo {
  const release = track.release;
  const name =
    resolveCreditedArtistName({
      trackArtist: track.artist,
      credits: release.artistCredits,
      primaryArtist: release.primaryArtist,
      accountDisplayName: release.artist?.displayName,
    }) ?? "Unknown Artist";
  const mainCredit = release.artistCredits.find((credit) =>
    MAIN_ARTIST_CREDIT_ROLES.has(credit.role.toLowerCase()),
  );
  // Group by the credited artist's identity when the track names nobody else;
  // otherwise by the credited name, so a track-level artist override is kept apart.
  const overridden = normalizeCreditName(track.artist) !== "";
  const artistKey = !overridden && mainCredit ? `id:${mainCredit.artistId}` : `name:${name.toLowerCase()}`;
  return {
    trackId: track.id,
    title: track.title,
    artistKey,
    artistId: !overridden && mainCredit ? mainCredit.artistId : release.artistId,
    artistName: name,
    releaseId: release.id,
    releaseTitle: release.title,
    artworkUrl: release.artworkUrl,
    hasUploadedArtwork: Boolean(release.artworkMimeType),
    artworkRevision: release.artworkRevision,
    genre: release.genre,
    moods: release.moods ?? [],
    available: classifyTrackAvailability(track).state === "available",
  };
}

/**
 * The signed-in listener's own listening stats, computed on read from their
 * own AgentSignal rows (the plays they allowed Resonate to remember). It never
 * reads another listener's data and stores nothing new. A taste reset forgets
 * everything before it here too.
 */
@Injectable()
export class ListeningStatsService {
  async getStats(
    userId: string,
    options: { windowDays: ListeningStatsWindow; now?: Date },
  ): Promise<ListeningStats> {
    const now = options.now ?? new Date();
    const windowStart = new Date(now.getTime() - options.windowDays * DAY_MS);
    const readFrom = new Date(now.getTime() - 2 * options.windowDays * DAY_MS);

    const [consent, settings] = await Promise.all([
      prisma.analyticsConsent.findUnique({
        where: { userId },
        select: { productAnalytics: true, policyVersion: true },
      }),
      prisma.listenerTasteMemorySettings.findUnique({
        where: { userId },
        select: { agentPlaybackTrainingEnabled: true, resetAt: true },
      }),
    ]);
    const recording =
      consent?.productAnalytics === true &&
      consent.policyVersion === ANALYTICS_CONSENT_POLICY_VERSION &&
      settings?.agentPlaybackTrainingEnabled !== false;
    const resetAt = settings?.resetAt ?? null;
    // From `start` up to now, and never at or before a taste reset.
    const after = (start: Date): Prisma.DateTimeFilter =>
      resetAt && resetAt >= start ? { gt: resetAt, lte: now } : { gte: start, lte: now };

    const [plays, saves] = await Promise.all([
      prisma.agentSignal.findMany({
        where: { userId, action: { in: [...PLAY_ACTIONS] }, createdAt: after(readFrom) },
        orderBy: { createdAt: "desc" },
        take: PLAY_READ_CAP,
        select: { trackId: true, action: true, createdAt: true, metadata: true },
      }),
      prisma.agentSignal.count({
        where: { userId, action: "save", createdAt: after(windowStart) },
      }),
    ]);

    const windowTrackIds = [
      ...new Set(plays.filter((row) => row.createdAt >= windowStart).map((row) => row.trackId)),
    ];
    const earlier = await prisma.agentSignal.findMany({
      where: {
        userId,
        trackId: { notIn: windowTrackIds },
        createdAt: { lt: windowStart, ...(resetAt ? { gt: resetAt } : {}) },
      },
      distinct: ["trackId"],
      orderBy: { trackId: "asc" },
      take: EARLIER_TRACKS_CAP,
      select: { trackId: true },
    });
    // Tracks played in the window may also have been played before it.
    const playedBeforeInWindow = await prisma.agentSignal.findMany({
      where: {
        userId,
        trackId: { in: windowTrackIds },
        createdAt: { lt: windowStart, ...(resetAt ? { gt: resetAt } : {}) },
      },
      distinct: ["trackId"],
      select: { trackId: true },
    });

    const earlierIds = [...new Set([...earlier, ...playedBeforeInWindow].map((row) => row.trackId))];
    const rows = await prisma.track.findMany({
      where: { id: { in: [...new Set([...plays.map((row) => row.trackId), ...earlierIds])] } },
      select: trackSelect,
    });
    const infoById = new Map(rows.map((row) => [row.id, toTrackInfo(row)]));
    const windowTracks = new Map(
      windowTrackIds.filter((id) => infoById.has(id)).map((id) => [id, infoById.get(id)!]),
    );
    const artistKeysBefore = new Set(
      earlierIds.map((id) => infoById.get(id)?.artistKey).filter((key): key is string => Boolean(key)),
    );

    return aggregateListeningStats({
      windowDays: options.windowDays,
      now,
      recording,
      truncated: plays.length >= PLAY_READ_CAP,
      plays,
      saves,
      tracks: windowTracks,
      artistKeysBefore,
    });
  }
}
