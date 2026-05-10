import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../../db/prisma";
import { createPublicClient, http, type Address } from "viem";
import { foundry, sepolia, baseSepolia } from "viem/chains";
import { getDefaultTrustTier, resolveTrustTiers, type TrustTierInfo } from "./trustTierConfig";

/**
 * Trust tier thresholds per issue #406:
 *   New (0 uploads)       → 0.01 ETH, 30 days
 *   Established (5+)      → 0.005 ETH, 14 days
 *   Trusted (50+)         → 0.001 ETH, 7 days
 *   Verified economic tier → waived, 3 days
 */
type TrustRequirement = Awaited<ReturnType<typeof prisma.creatorTrust.upsert>> & {
  tierStakeAmountWei: string;
  tierStakeAmountUsd: string;
  protocolMinimumStakeAmountWei: string;
  protocolMinimumStakeAmountUsd: string;
  stakeAmountUsd: string;
  policySource: "contract" | "fallback";
  maxPriceMultiplier: number;
  maxListingPriceWei: string | null;
  maxListingPriceUsd: string | null;
  maxListingPriceUncapped: boolean;
};

type CreatorVerificationRecord = {
  humanVerificationStatus: string | null;
  humanVerifiedAt: Date | null;
};

const CONTENT_PROTECTION_CONFIG_ABI = [
  {
    name: "stakeAmount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "maxPriceMultiplier",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTierPolicy",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tierName", type: "string" }],
    outputs: [
      { name: "requiredStakeWei", type: "uint256" },
      { name: "escrowDays", type: "uint256" },
    ],
  },
] as const;

const DEFAULT_MAX_PRICE_MULTIPLIER = 10n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_SEPOLIA_RPC_URL = "https://sepolia.drpc.org";
const DEFAULT_PROTOCOL_MINIMUM_STAKE_USD = "10";

type TrustPolicyConfig = {
  source: "contract" | "fallback";
  tierPolicy: TrustTierInfo;
  protocolMinimumStakeAmountWei: bigint;
  protocolMinimumStakeAmountUsd: string;
  maxPriceMultiplier: bigint;
};

@Injectable()
export class TrustService {
  private readonly logger = new Logger(TrustService.name);
  private maxPriceMultiplierCache: { value: bigint; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get trustTiers() {
    return resolveTrustTiers((key) => this.config.get<string>(key));
  }

  /**
   * Calculate the trust tier for an artist based on their upload and dispute history.
   */
  async calculateTier(artistId: string): Promise<TrustTierInfo> {
    const trust = await prisma.creatorTrust.findUnique({
      where: { artistId },
    });

    // Verified economic tier is set manually — if already present, keep it.
    if (trust?.tier === "verified") {
      return this.trustTiers.verified;
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
      return this.trustTiers.new;
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
      return this.trustTiers.new;
    }

    // Tier assignment
    if (cleanHistory >= 50) return this.trustTiers.trusted;
    if (cleanHistory >= 5) return this.trustTiers.established;
    return this.trustTiers.new;
  }

  /**
   * Get or create trust record for an artist, calculating tier from history.
   */
  async getStakeRequirement(artistId: string): Promise<TrustRequirement> {
    const tierInfo = await this.calculateTier(artistId);
    const policy = await this.getPolicyConfig(tierInfo.tier);
    const effectiveStakeAmountWei = this.getEffectiveStakeAmountWei(policy);
    const effectiveStakeAmountUsd = this.getEffectiveStakeAmountUsd(policy);

    // Upsert the trust record
    const trust = await prisma.creatorTrust.upsert({
      where: { artistId },
      create: {
        artistId,
        tier: tierInfo.tier,
        stakeAmountWei: effectiveStakeAmountWei.toString(),
        escrowDays: policy.tierPolicy.escrowDays,
      },
      update: {
        tier: tierInfo.tier,
        stakeAmountWei: effectiveStakeAmountWei.toString(),
        escrowDays: policy.tierPolicy.escrowDays,
      },
    });

    const stakeAmountWei = effectiveStakeAmountWei;
    const maxListingPriceUncapped = stakeAmountWei === 0n;

    return {
      ...trust,
      tierStakeAmountWei: policy.tierPolicy.stakeAmountWei.toString(),
      tierStakeAmountUsd: policy.tierPolicy.stakeAmountUsd,
      protocolMinimumStakeAmountWei: policy.protocolMinimumStakeAmountWei.toString(),
      protocolMinimumStakeAmountUsd: policy.protocolMinimumStakeAmountUsd,
      stakeAmountUsd: effectiveStakeAmountUsd,
      policySource: policy.source,
      maxPriceMultiplier: Number(policy.maxPriceMultiplier),
      maxListingPriceWei: maxListingPriceUncapped
        ? null
        : (stakeAmountWei * policy.maxPriceMultiplier).toString(),
      maxListingPriceUsd: maxListingPriceUncapped
        ? null
        : this.multiplyDecimalString(effectiveStakeAmountUsd, policy.maxPriceMultiplier),
      maxListingPriceUncapped,
    };
  }

  async getCreatorVerificationRecord(
    artistId: string,
  ): Promise<CreatorVerificationRecord> {
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { userId: true },
    });

    if (!artist?.userId) {
      return {
        humanVerificationStatus: null,
        humanVerifiedAt: null,
      };
    }

    const record = await prisma.curatorReputation.findUnique({
      where: { walletAddress: artist.userId.toLowerCase() },
      select: {
        humanVerificationStatus: true,
        humanVerifiedAt: true,
      },
    });

    return {
      humanVerificationStatus: record?.humanVerificationStatus ?? null,
      humanVerifiedAt: record?.humanVerifiedAt ?? null,
    };
  }

  /**
   * Manually set an artist to the verified economic tier (admin action).
   */
  async setVerified(artistId: string) {
    const verifiedTier = await this.getPolicyConfig("verified");
    const verifiedStakeAmountWei = this.getEffectiveStakeAmountWei(verifiedTier);
    return prisma.creatorTrust.upsert({
      where: { artistId },
      create: {
        artistId,
        tier: "verified",
        stakeAmountWei: verifiedStakeAmountWei.toString(),
        escrowDays: verifiedTier.tierPolicy.escrowDays,
      },
      update: {
        tier: "verified",
        stakeAmountWei: verifiedStakeAmountWei.toString(),
        escrowDays: verifiedTier.tierPolicy.escrowDays,
      },
    });
  }

  /**
   * Increment upload count after a successful publish.
   */
  async recordUpload(artistId: string) {
    const newTier = await this.getPolicyConfig("new");
    const newStakeAmountWei = this.getEffectiveStakeAmountWei(newTier);
    await prisma.creatorTrust.upsert({
      where: { artistId },
      create: {
        artistId,
        tier: newTier.tierPolicy.tier,
        stakeAmountWei: newStakeAmountWei.toString(),
        escrowDays: newTier.tierPolicy.escrowDays,
      },
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
    const newTier = await this.getPolicyConfig("new");
    const newStakeAmountWei = this.getEffectiveStakeAmountWei(newTier);
    await prisma.creatorTrust.upsert({
      where: { artistId },
      create: {
        artistId,
        disputesLost: 1,
        tier: newTier.tierPolicy.tier,
        stakeAmountWei: newStakeAmountWei.toString(),
        escrowDays: newTier.tierPolicy.escrowDays,
      },
      update: {
        disputesLost: { increment: 1 },
        tier: "new",
        stakeAmountWei: newStakeAmountWei.toString(),
        escrowDays: newTier.tierPolicy.escrowDays,
      },
    });
  }

  private async getPolicyConfig(tierName: string): Promise<TrustPolicyConfig> {
    const chainId = Number(
      this.config.get<string>("INDEXER_CHAIN_ID") ||
        this.config.get<string>("CHAIN_ID") ||
        this.config.get<string>("AA_CHAIN_ID") ||
        "31337",
    );
    const address = this.resolveContentProtectionAddress(chainId);

    if (!address || address === ZERO_ADDRESS) {
      return this.getFallbackPolicyConfig(tierName);
    }

    const client = createPublicClient({
      chain: this.resolveChain(chainId),
      transport: http(this.resolveRpcUrl(chainId)),
    });

    try {
      const [protocolMinimumStakeAmountWei, maxPriceMultiplier] = await Promise.all([
        client.readContract({
          address: address as Address,
          abi: CONTENT_PROTECTION_CONFIG_ABI,
          functionName: "stakeAmount",
        }) as Promise<bigint>,
        client.readContract({
          address: address as Address,
          abi: CONTENT_PROTECTION_CONFIG_ABI,
          functionName: "maxPriceMultiplier",
        }) as Promise<bigint>,
      ]);
      this.maxPriceMultiplierCache = {
        value: maxPriceMultiplier,
        expiresAt: Date.now() + 60 * 60 * 1000,
      };

      const tierPolicyTuple = (await client.readContract({
          address: address as Address,
          abi: CONTENT_PROTECTION_CONFIG_ABI,
          functionName: "getTierPolicy",
          args: [tierName],
        })) as readonly [bigint, bigint];
      const tierPolicy: TrustTierInfo = {
        tier: tierName,
        stakeAmountWei: tierPolicyTuple[0].toString(),
        stakeAmountUsd: this.trustTiers[tierName]?.stakeAmountUsd ?? this.trustTiers.new.stakeAmountUsd,
        escrowDays: Number(tierPolicyTuple[1]),
      };

      return {
        source: "contract",
        tierPolicy,
        protocolMinimumStakeAmountWei,
        protocolMinimumStakeAmountUsd: this.getProtocolMinimumStakeAmountUsd(),
        maxPriceMultiplier,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to read ContentProtection policy for tier ${tierName} on chain ${chainId}: ${error}`,
      );
      return {
        ...this.getFallbackPolicyConfig(tierName),
        maxPriceMultiplier: await this.getMaxPriceMultiplier(),
      };
    }
  }

  private getFallbackPolicyConfig(tierName: string): TrustPolicyConfig {
    const fallbackTier = this.trustTiers[tierName] || getDefaultTrustTier("new");
    return {
      source: "fallback",
      tierPolicy: fallbackTier,
      protocolMinimumStakeAmountWei: BigInt(fallbackTier.stakeAmountWei),
      protocolMinimumStakeAmountUsd: this.getProtocolMinimumStakeAmountUsd(),
      maxPriceMultiplier: this.maxPriceMultiplierCache?.value || DEFAULT_MAX_PRICE_MULTIPLIER,
    };
  }

  private getEffectiveStakeAmountWei(policy: TrustPolicyConfig): bigint {
    const tierStakeAmountWei = BigInt(policy.tierPolicy.stakeAmountWei);
    return tierStakeAmountWei > policy.protocolMinimumStakeAmountWei
      ? tierStakeAmountWei
      : policy.protocolMinimumStakeAmountWei;
  }

  private getEffectiveStakeAmountUsd(policy: TrustPolicyConfig): string {
    const tierStakeAmountUsd = Number(policy.tierPolicy.stakeAmountUsd);
    const protocolMinimumStakeAmountUsd = Number(policy.protocolMinimumStakeAmountUsd);
    if (!Number.isFinite(tierStakeAmountUsd) || tierStakeAmountUsd < 0) {
      return policy.protocolMinimumStakeAmountUsd;
    }
    if (!Number.isFinite(protocolMinimumStakeAmountUsd) || protocolMinimumStakeAmountUsd < 0) {
      return policy.tierPolicy.stakeAmountUsd;
    }
    return tierStakeAmountUsd > protocolMinimumStakeAmountUsd
      ? policy.tierPolicy.stakeAmountUsd
      : policy.protocolMinimumStakeAmountUsd;
  }

  private getProtocolMinimumStakeAmountUsd(): string {
    return this.config.get<string>("TRUST_STAKE_USD_MIN")?.trim() || DEFAULT_PROTOCOL_MINIMUM_STAKE_USD;
  }

  private multiplyDecimalString(value: string, multiplier: bigint): string {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value;
    return (parsed * Number(multiplier)).toString();
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
