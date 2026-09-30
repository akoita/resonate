import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import { deriveCreatorVerificationStates } from "../trust/verification-semantics";
import type { DiscoveryCandidate } from "./discovery-ranking.service";

export interface DiscoveryPolicyContext {
  /** Candidate artist ids whose creator is human-verified. */
  verifiedHumanArtistIds: Set<string>;
  /** Candidate artist ids the listener has any recorded interaction with. */
  playedArtistIds: Set<string>;
}

/**
 * Loads the two lookups the discovery policy stage needs for exploration
 * (ADR-TE-2 rule 2, docs/rfc/taste-engine.md §3.4 step 3): which of the
 * candidates' artists are verified humans, and which the listener has already
 * played. Reads creator verification and the listener's own interaction
 * history only; no payment, placement or partner data.
 *
 * Bounded: every query is scoped to the given artist ids and runs once per
 * call (three batched queries, no per-artist round trips).
 */
@Injectable()
export class DiscoveryPolicyContextService {
  async loadContext(
    userId: string | undefined,
    artistIds: string[],
  ): Promise<DiscoveryPolicyContext> {
    const ids = [...new Set(artistIds.filter(Boolean))];
    if (ids.length === 0) {
      return { verifiedHumanArtistIds: new Set(), playedArtistIds: new Set() };
    }
    const [verifiedHumanArtistIds, playedArtistIds] = await Promise.all([
      this.loadVerifiedHumanArtists(ids),
      userId ? this.loadPlayedArtists(userId, ids) : Promise.resolve(new Set<string>()),
    ]);
    return { verifiedHumanArtistIds, playedArtistIds };
  }

  /**
   * Artist id per track id, in one batched query. Session mode of the policy
   * stage needs the artists of the prior session tracks (diversity cap per 10
   * session tracks); unknown track ids are simply absent from the map.
   */
  async artistIdsForTracks(trackIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(trackIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const tracks = await prisma.track.findMany({
      where: { id: { in: ids } },
      select: { id: true, release: { select: { artistId: true } } },
    });
    return new Map(tracks.map((track) => [track.id, track.release.artistId]));
  }

  /**
   * Ranking candidates for arbitrary track ids (picks made outside the
   * candidate pipeline, such as LLM runtime picks), in one batched query.
   * Same fields the Home and DJ candidate mappers use: genre, moods, titles,
   * credited artist (#1492), artistId and AI disclosure level. Unknown ids are
   * absent from the map. Commercial availability is deliberately not read.
   */
  async loadTrackCandidates(
    trackIds: string[],
  ): Promise<Map<string, DiscoveryCandidate>> {
    const ids = [...new Set(trackIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const tracks = await prisma.track.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        artist: true,
        aiDisclosureLevel: true,
        release: {
          select: {
            title: true,
            genre: true,
            moods: true,
            artistId: true,
            primaryArtist: true,
            artist: { select: { displayName: true } },
          },
        },
      },
    });
    return new Map(
      tracks.map((track) => [
        track.id,
        {
          id: track.id,
          title: track.title,
          artist: track.artist,
          artistId: track.release.artistId,
          aiDisclosureLevel: track.aiDisclosureLevel,
          release: {
            genre: track.release.genre,
            title: track.release.title,
            moods: track.release.moods,
            artistDisplayName: resolveCreditedArtistName({
              trackArtist: track.artist,
              primaryArtist: track.release.primaryArtist,
              accountDisplayName: track.release.artist?.displayName,
            }),
          },
        },
      ]),
    );
  }

  /**
   * Artist.userId -> CuratorReputation(walletAddress = userId lowercased),
   * mirroring `PayoutEligibilityService.resolveHumanVerificationState` for a
   * set of artists instead of one.
   */
  private async loadVerifiedHumanArtists(artistIds: string[]): Promise<Set<string>> {
    const artists = await prisma.artist.findMany({
      where: { id: { in: artistIds }, userId: { not: null } },
      select: { id: true, userId: true },
    });
    const wallets = [
      ...new Set(
        artists.map((artist) => (artist.userId as string).toLowerCase()),
      ),
    ];
    if (wallets.length === 0) return new Set();

    const reputations = await prisma.curatorReputation.findMany({
      where: { walletAddress: { in: wallets } },
      select: {
        walletAddress: true,
        humanVerificationStatus: true,
        humanVerifiedAt: true,
      },
    });
    const verifiedWallets = new Set(
      reputations
        .filter(
          (record) =>
            deriveCreatorVerificationStates({
              humanVerificationStatus: record.humanVerificationStatus,
              humanVerifiedAt: record.humanVerifiedAt,
            }).humanVerificationStatus === "human_verified",
        )
        .map((record) => record.walletAddress),
    );
    return new Set(
      artists
        .filter((artist) =>
          verifiedWallets.has((artist.userId as string).toLowerCase()),
        )
        .map((artist) => artist.id),
    );
  }

  /** Any AgentSignal (any action) on a track of the artist counts as played. */
  private async loadPlayedArtists(
    userId: string,
    artistIds: string[],
  ): Promise<Set<string>> {
    const signals = await prisma.agentSignal.findMany({
      where: { userId, track: { release: { artistId: { in: artistIds } } } },
      distinct: ["trackId"],
      select: { track: { select: { release: { select: { artistId: true } } } } },
    });
    return new Set(signals.map((signal) => signal.track.release.artistId));
  }
}
