import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { prisma } from "../../db/prisma";
import { deriveCreatorVerificationStates } from "../trust/verification-semantics";
import {
  FIRST_LISTENER_CANDIDATE_LIMIT,
  FIRST_LISTENER_MAX_RELEASE_PLACEMENTS,
  FIRST_LISTENER_PLAYABLE_TRACK_WHERE,
  FIRST_LISTENER_PUBLIC_RIGHTS_ROUTES,
  FIRST_LISTENER_CANDIDATE_TRACK_SELECT,
  FIRST_LISTENER_WINDOW_MS,
  type FirstListenerCandidateTrack,
  type FirstListenerExposureCandidate,
} from "./first_listener.contracts";

const FIRST_LISTENER_PUBLIC_RELEASE_STATUSES = ["ready", "published"];

/**
 * Candidate source and durable placement reservation for #1970.
 *
 * Freshness is based on `Release.createdAt` because the catalog has no
 * `publishedAt`. `releaseDate` is still checked as a future date is not a
 * playable public release. Candidate retrieval is bounded to 100 releases,
 * picks one playable track per release, and leaves verification, taste,
 * hides, and diversity to the shared discovery policy.
 */
@Injectable()
export class FirstListenerDiscoveryService {
  async getFreshCandidates(input: {
    userId: string;
    allowExplicit: boolean;
    now?: Date;
  }): Promise<FirstListenerCandidateTrack[]> {
    const now = input.now ?? new Date();
    const freshSince = new Date(now.getTime() - FIRST_LISTENER_WINDOW_MS);
    const playableTrackWhere = {
      ...FIRST_LISTENER_PLAYABLE_TRACK_WHERE,
      ...(input.allowExplicit ? {} : { explicit: false }),
    };
    const releases = await prisma.release.findMany({
      where: {
        createdAt: { gte: freshSince, lte: now },
        status: { in: FIRST_LISTENER_PUBLIC_RELEASE_STATUSES },
        withdrawnAt: null,
        AND: [
          {
            OR: [
              { rightsRoute: null },
              { rightsRoute: { in: [...FIRST_LISTENER_PUBLIC_RIGHTS_ROUTES] } },
            ],
          },
          { OR: [{ releaseDate: null }, { releaseDate: { lte: now } }] },
        ],
        tracks: { some: playableTrackWhere },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: FIRST_LISTENER_CANDIDATE_LIMIT,
      include: {
        artist: {
          select: {
            id: true,
            displayName: true,
            userId: true,
            managementOwnerUserId: true,
          },
        },
        tracks: {
          where: playableTrackWhere,
          orderBy: [{ position: "asc" }, { id: "asc" }],
          take: 1,
          select: FIRST_LISTENER_CANDIDATE_TRACK_SELECT,
        },
      },
    });

    const candidates: FirstListenerCandidateTrack[] = [];
    for (const { tracks, artist, ...release } of releases) {
      // Never recommend an artist's own release to them as a first-listener
      // placement, including releases they manage for another artist.
      if (
        release.managementOwnerUserId === input.userId ||
        artist.userId === input.userId ||
        artist.managementOwnerUserId === input.userId
      ) {
        continue;
      }
      for (const track of tracks) {
        const publicArtist = { id: artist.id, displayName: artist.displayName };
        const publicRelease = {
          id: release.id,
          title: release.title,
          genre: release.genre,
          moods: release.moods,
          artistId: release.artistId,
          primaryArtist: release.primaryArtist,
          artist: publicArtist,
        };
        candidates.push({
          ...track,
          release: publicRelease,
        });
      }
    }
    return candidates;
  }

  /**
   * Atomically claims placements after shared policy has selected them. A
   * PostgreSQL transaction advisory lock serializes every instance by release
   * before its cap and listener/release uniqueness checks.
   */
  async reservePlacements(
    userId: string,
    candidates: readonly FirstListenerExposureCandidate[],
    options: { allowExplicit?: boolean; now?: Date } = {},
  ): Promise<Set<string>> {
    if (!userId || candidates.length === 0) return new Set();

    const now = options.now ?? new Date();
    const freshSince = new Date(now.getTime() - FIRST_LISTENER_WINDOW_MS);
    const candidatesByRelease = new Map<string, FirstListenerExposureCandidate>();
    for (const candidate of candidates) {
      if (candidate.trackId && candidate.releaseId && !candidatesByRelease.has(candidate.releaseId)) {
        candidatesByRelease.set(candidate.releaseId, candidate);
      }
    }

    return prisma.$transaction(async (tx) => {
      const reserved = new Set<string>();
      for (const [releaseId, candidate] of [...candidatesByRelease].sort(([a], [b]) => a.localeCompare(b))) {
        const lockKey = `first-listener:release:${releaseId}`;
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS "locked"
        `;

        const playableTrackWhere = {
          ...FIRST_LISTENER_PLAYABLE_TRACK_WHERE,
          ...(options.allowExplicit ? {} : { explicit: false }),
        };
        const eligibleTrack = await tx.track.findFirst({
          where: {
            AND: [
              { id: candidate.trackId, releaseId, ...playableTrackWhere },
              {
                release: {
                  is: {
                    id: releaseId,
                    createdAt: { gte: freshSince, lte: now },
                    status: { in: FIRST_LISTENER_PUBLIC_RELEASE_STATUSES },
                    withdrawnAt: null,
                    AND: [
                      {
                        OR: [
                          { rightsRoute: null },
                          { rightsRoute: { in: [...FIRST_LISTENER_PUBLIC_RIGHTS_ROUTES] } },
                        ],
                      },
                      { OR: [{ releaseDate: null }, { releaseDate: { lte: now } }] },
                    ],
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            release: {
              select: {
                managementOwnerUserId: true,
                artist: {
                  select: { userId: true, managementOwnerUserId: true },
                },
              },
            },
          },
        });
        if (!eligibleTrack) continue;

        const artistUserId = eligibleTrack.release.artist.userId;
        if (
          eligibleTrack.release.managementOwnerUserId === userId ||
          eligibleTrack.release.artist.managementOwnerUserId === userId ||
          artistUserId === userId ||
          !artistUserId
        ) {
          continue;
        }
        const reputation = await tx.curatorReputation.findUnique({
          where: { walletAddress: artistUserId.toLowerCase() },
          select: { humanVerificationStatus: true, humanVerifiedAt: true },
        });
        if (
          deriveCreatorVerificationStates({
            humanVerificationStatus: reputation?.humanVerificationStatus,
            humanVerifiedAt: reputation?.humanVerifiedAt,
          }).humanVerificationStatus !== "human_verified"
        ) {
          continue;
        }

        const prior = await tx.firstListenerExposure.findUnique({
          where: { userId_releaseId: { userId, releaseId } },
          select: { id: true },
        });
        if (prior) continue;

        const [budget, placementRows] = await Promise.all([
          tx.release.findUnique({
            where: { id: releaseId },
            select: { firstListenerPlacementsUsed: true },
          }),
          tx.firstListenerExposure.count({
            where: { releaseId },
          }),
        ]);
        if (!budget) continue;
        const placementsUsed = Math.max(budget.firstListenerPlacementsUsed, placementRows);
        if (placementsUsed >= FIRST_LISTENER_MAX_RELEASE_PLACEMENTS) continue;

        // This counter survives listener erasure. The per-release advisory
        // lock above serializes the counter update with every placement.
        await tx.release.update({
          where: { id: releaseId },
          data: { firstListenerPlacementsUsed: placementsUsed + 1 },
        });

        await tx.firstListenerExposure.create({
          data: { id: randomUUID(), userId, releaseId, placedAt: now },
        });
        reserved.add(releaseId);
      }
      return reserved;
    });
  }
}
