import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * Trust tier thresholds per issue #406:
 *   New (0 uploads)       → 0.01 ETH, 30 days
 *   Established (5+)      → 0.005 ETH, 14 days
 *   Trusted (50+)         → 0.001 ETH, 7 days
 *   Verified (manual)     → waived, 3 days
 */
interface TrustTierInfo {
  tier: string;
  stakeAmountWei: string;
  escrowDays: number;
}

const TIERS: Record<string, TrustTierInfo> = {
  verified: { tier: "verified", stakeAmountWei: "0", escrowDays: 3 },
  trusted: { tier: "trusted", stakeAmountWei: "1000000000000000", escrowDays: 7 }, // 0.001 ETH
  established: { tier: "established", stakeAmountWei: "5000000000000000", escrowDays: 14 }, // 0.005 ETH
  new: { tier: "new", stakeAmountWei: "10000000000000000", escrowDays: 30 }, // 0.01 ETH
};

@Injectable()
export class TrustService {
  private readonly logger = new Logger(TrustService.name);

  /**
   * Calculate the trust tier for an artist based on their upload and dispute history.
   */
  async calculateTier(artistId: string): Promise<TrustTierInfo> {
    const trust = await prisma.creatorTrust.findUnique({
      where: { artistId },
    });

    // Verified is set manually — if already verified, keep it
    if (trust?.tier === "verified") {
      return TIERS.verified;
    }

    // Count uploads and disputes
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      include: {
        releases: {
          include: {
            tracks: {
              include: { dmcaReports: { where: { status: "upheld" } } },
            },
          },
        },
      },
    });

    if (!artist) {
      return TIERS.new;
    }

    const totalUploads = artist.releases.length;
    const disputesLost = artist.releases.reduce(
      (count, r) =>
        count +
        r.tracks.reduce(
          (tc, t) => tc + t.dmcaReports.length,
          0,
        ),
      0,
    );
    const cleanHistory = totalUploads - disputesLost;

    // If they have lost disputes, cap at "new" tier
    if (disputesLost > 0) {
      return TIERS.new;
    }

    // Tier assignment
    if (cleanHistory >= 50) return TIERS.trusted;
    if (cleanHistory >= 5) return TIERS.established;
    return TIERS.new;
  }

  /**
   * Get or create trust record for an artist, calculating tier from history.
   */
  async getStakeRequirement(artistId: string) {
    const tierInfo = await this.calculateTier(artistId);

    // Upsert the trust record
    const trust = await prisma.creatorTrust.upsert({
      where: { artistId },
      create: {
        artistId,
        tier: tierInfo.tier,
        stakeAmountWei: tierInfo.stakeAmountWei,
        escrowDays: tierInfo.escrowDays,
      },
      update: {
        tier: tierInfo.tier,
        stakeAmountWei: tierInfo.stakeAmountWei,
        escrowDays: tierInfo.escrowDays,
      },
    });

    return trust;
  }

  /**
   * Manually set an artist as verified (admin action).
   */
  async setVerified(artistId: string) {
    return prisma.creatorTrust.upsert({
      where: { artistId },
      create: {
        artistId,
        tier: "verified",
        stakeAmountWei: "0",
        escrowDays: 3,
      },
      update: {
        tier: "verified",
        stakeAmountWei: "0",
        escrowDays: 3,
      },
    });
  }

  /**
   * Increment upload count after a successful publish.
   */
  async recordUpload(artistId: string) {
    await prisma.creatorTrust.upsert({
      where: { artistId },
      create: { artistId },
      update: {
        totalUploads: { increment: 1 },
        cleanHistory: { increment: 1 },
      },
    });
  }

  /**
   * Record a lost dispute — resets tier to "new".
   */
  async recordDisputeLost(artistId: string) {
    await prisma.creatorTrust.upsert({
      where: { artistId },
      create: { artistId, disputesLost: 1 },
      update: {
        disputesLost: { increment: 1 },
        tier: "new",
        stakeAmountWei: TIERS.new.stakeAmountWei,
        escrowDays: TIERS.new.escrowDays,
      },
    });
  }
}
