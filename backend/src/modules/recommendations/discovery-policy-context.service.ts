import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { deriveCreatorVerificationStates } from "../trust/verification-semantics";

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
