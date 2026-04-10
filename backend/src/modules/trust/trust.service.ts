import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../../db/prisma";
import { createPublicClient, http, type Address } from "viem";
import { foundry, sepolia, baseSepolia } from "viem/chains";

/**
 * Trust tier thresholds per issue #406:
 *   New (0 uploads)       → 0.01 ETH, 30 days
 *   Established (5+)      → 0.005 ETH, 14 days
 *   Trusted (50+)         → 0.001 ETH, 7 days
 *   Verified trust tier   → waived, 3 days
 */
interface TrustTierInfo {
  tier: string;
  stakeAmountWei: string;
  escrowDays: number;
}

type TrustRequirement = Awaited<ReturnType<typeof prisma.creatorTrust.upsert>> & {
  maxPriceMultiplier: number;
  maxListingPriceWei: string | null;
  maxListingPriceUncapped: boolean;
};

const TIERS: Record<string, TrustTierInfo> = {
  verified: { tier: "verified", stakeAmountWei: "0", escrowDays: 3 },
  trusted: { tier: "trusted", stakeAmountWei: "1000000000000000", escrowDays: 7 }, // 0.001 ETH
  established: { tier: "established", stakeAmountWei: "5000000000000000", escrowDays: 14 }, // 0.005 ETH
  new: { tier: "new", stakeAmountWei: "10000000000000000", escrowDays: 30 }, // 0.01 ETH
};

const CONTENT_PROTECTION_CONFIG_ABI = [
  {
    name: "maxPriceMultiplier",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const DEFAULT_MAX_PRICE_MULTIPLIER = 10n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_SEPOLIA_RPC_URL = "https://sepolia.drpc.org";

@Injectable()
export class TrustService {
  private readonly logger = new Logger(TrustService.name);
  private maxPriceMultiplierCache: { value: bigint; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Calculate the trust tier for an artist based on their upload and dispute history.
   */
  async calculateTier(artistId: string): Promise<TrustTierInfo> {
    const trust = await prisma.creatorTrust.findUnique({
      where: { artistId },
    });

    // Verified trust tier is set manually — if already present, keep it.
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
  async getStakeRequirement(artistId: string): Promise<TrustRequirement> {
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

    const maxPriceMultiplier = await this.getMaxPriceMultiplier();
    const stakeAmountWei = BigInt(trust.stakeAmountWei || "0");
    const maxListingPriceUncapped = stakeAmountWei === 0n;

    return {
      ...trust,
      maxPriceMultiplier: Number(maxPriceMultiplier),
      maxListingPriceWei: maxListingPriceUncapped
        ? null
        : (stakeAmountWei * maxPriceMultiplier).toString(),
      maxListingPriceUncapped,
    };
  }

  /**
   * Manually set an artist to the verified trust tier (admin action).
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

  private async getMaxPriceMultiplier(): Promise<bigint> {
    const now = Date.now();
    if (this.maxPriceMultiplierCache && this.maxPriceMultiplierCache.expiresAt > now) {
      return this.maxPriceMultiplierCache.value;
    }

    const chainId = Number(
      this.config.get<string>("INDEXER_CHAIN_ID") ||
        this.config.get<string>("CHAIN_ID") ||
        this.config.get<string>("AA_CHAIN_ID") ||
        "31337",
    );
    const address = this.resolveContentProtectionAddress(chainId);

    if (!address || address === ZERO_ADDRESS) {
      return DEFAULT_MAX_PRICE_MULTIPLIER;
    }

    const client = createPublicClient({
      chain: this.resolveChain(chainId),
      transport: http(this.resolveRpcUrl(chainId)),
    });

    try {
      const value = (await client.readContract({
        address: address as Address,
        abi: CONTENT_PROTECTION_CONFIG_ABI,
        functionName: "maxPriceMultiplier",
      })) as bigint;

      this.maxPriceMultiplierCache = {
        value,
        expiresAt: now + 60 * 60 * 1000,
      };

      return value;
    } catch (error) {
      this.logger.warn(
        `Failed to read ContentProtection.maxPriceMultiplier for chain ${chainId}: ${error}`,
      );
      return DEFAULT_MAX_PRICE_MULTIPLIER;
    }
  }

  private resolveContentProtectionAddress(chainId: number): string {
    switch (chainId) {
      case 11155111:
        return (
          this.config.get<string>("SEPOLIA_CONTENT_PROTECTION_ADDRESS") ||
          this.config.get<string>("CONTENT_PROTECTION_ADDRESS") ||
          ZERO_ADDRESS
        );
      case 84532:
        return (
          this.config.get<string>("BASE_SEPOLIA_CONTENT_PROTECTION_ADDRESS") ||
          this.config.get<string>("CONTENT_PROTECTION_ADDRESS") ||
          ZERO_ADDRESS
        );
      case 31337:
      default:
        return (
          this.config.get<string>("CONTENT_PROTECTION_ADDRESS") ||
          ZERO_ADDRESS
        );
    }
  }

  private resolveRpcUrl(chainId: number): string {
    const override = this.config.get<string>("RPC_URL");
    if (override) return override;

    switch (chainId) {
      case 11155111:
        return (
          this.config.get<string>("LOCAL_RPC_URL") ||
          this.config.get<string>("SEPOLIA_RPC_URL") ||
          DEFAULT_SEPOLIA_RPC_URL
        );
      case 84532:
        return (
          this.config.get<string>("BASE_SEPOLIA_RPC_URL") ||
          "https://sepolia.base.org"
        );
      case 31337:
      default:
        return (
          this.config.get<string>("LOCAL_RPC_URL") || "http://localhost:8545"
        );
    }
  }

  private resolveChain(chainId: number) {
    switch (chainId) {
      case 11155111:
        return sepolia;
      case 84532:
        return baseSepolia;
      case 31337:
      default:
        return foundry;
    }
  }
}
