import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type AgentConfig } from "@prisma/client";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  isAddress,
  stringToHex,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { base, baseSepolia, foundry, sepolia } from "viem/chains";
import { prisma } from "../../db/prisma";
import { KernelAccountService } from "../identity/kernel_account.service";
import { AgentLearningService } from "./agent_learning.service";
import { AgentWalletService } from "./agent_wallet.service";

export type AgentIdentityStatus = "local" | "pending" | "minted" | "attested";

export type AgentReputationInput = {
  sessions: number;
  tracksCurated: number;
  totalSpendUsd: number;
  monthlyCapUsd: number;
  genresExplored: string[];
  tasteScore?: number;
};

export type AgentReputationSnapshot = AgentReputationInput & {
  score: number;
  tier: "New" | "Emerging" | "Trusted" | "Proven";
  acceptanceRate: number;
  budgetUtilization: number;
  tasteDepth: number;
  updatedAt: string;
};

export type AgentIdentityCredential = Prisma.InputJsonObject;
export type EnrichedAgentConfig = Omit<AgentConfig, "identityCredential" | "reputationSnapshot"> & {
  reputationSnapshot: AgentReputationSnapshot;
  identityCredential: AgentIdentityCredential;
};

export type AgentRegistrationFile = Prisma.InputJsonObject & {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  image: string;
  services: Array<{ name: string; endpoint: string; version?: string }>;
  x402Support: boolean;
  active: boolean;
  registrations: Array<{ agentId: number | string; agentRegistry: string }>;
  supportedTrust: string[];
};

export type AgentIdentityOnchainResult = {
  status: AgentIdentityStatus;
  chainId: number | null;
  registry: string | null;
  txHash: string | null;
  tokenId: string | null;
  reason?: "erc8004_disabled" | "missing_session_key" | "already_minted" | "missing_token_id";
};

type AgentConfigWithIdentity = AgentConfig & {
  identityStatus: AgentIdentityStatus;
};

const AGENT_IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setMetadata",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
      { name: "metadataValue", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export function buildAgentRegistryId(chainId: number, registry: string): string {
  return `eip155:${chainId}:${registry}`;
}

export function buildAgentRegistrationFile(input: {
  config: AgentConfig;
  chainId: number | null;
  registry: string | null;
  publicBaseUrl?: string | null;
}): AgentRegistrationFile {
  const publicBaseUrl = input.publicBaseUrl?.replace(/\/$/, "");
  const registrations =
    input.chainId && input.registry && input.config.identityTokenId
      ? [{
        agentId: input.config.identityTokenId,
        agentRegistry: buildAgentRegistryId(input.chainId, input.registry),
      }]
      : [];

  const services: AgentRegistrationFile["services"] = [];
  if (publicBaseUrl) {
    services.push(
      { name: "web", endpoint: publicBaseUrl },
      { name: "MCP", endpoint: `${publicBaseUrl}/mcp`, version: "2025-06-18" },
    );
  }

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: input.config.name,
    description: `Resonate AI DJ agent for ${input.config.vibes.join(", ") || "music curation"}.`,
    image: publicBaseUrl ? `${publicBaseUrl}/icon.png` : "",
    services,
    x402Support: true,
    active: input.config.isActive,
    registrations,
    supportedTrust: ["reputation"],
  };
}

export function toDataUriJson(value: unknown): string {
  const json = JSON.stringify(value);
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}

export function computeAgentReputationSnapshot(
  input: AgentReputationInput,
  now = new Date(),
): AgentReputationSnapshot {
  const sessions = Math.max(0, input.sessions);
  const tracksCurated = Math.max(0, input.tracksCurated);
  const monthlyCapUsd = Math.max(0, input.monthlyCapUsd);
  const totalSpendUsd = Math.max(0, input.totalSpendUsd);
  const genresExplored = Array.from(new Set(input.genresExplored.filter(Boolean)));
  const acceptanceRate = sessions === 0 ? 0 : Math.min(1, tracksCurated / sessions);
  const budgetUtilization = monthlyCapUsd === 0 ? 0 : Math.min(1, totalSpendUsd / monthlyCapUsd);
  const tasteDepth = Math.min(1, (tracksCurated / 12) + (genresExplored.length / 10));
  const score = Math.min(
    100,
    Math.round(
      sessions * 6 +
      tracksCurated * 4 +
      genresExplored.length * 5 +
      (input.tasteScore ?? 0) * 0.25 +
      acceptanceRate * 20 +
      budgetUtilization * 10
    ),
  );
  const tier =
    score >= 80 ? "Proven" :
      score >= 50 ? "Trusted" :
        score >= 20 ? "Emerging" :
          "New";

  return {
    ...input,
    sessions,
    tracksCurated,
    totalSpendUsd,
    monthlyCapUsd,
    genresExplored,
    score,
    tier,
    acceptanceRate,
    budgetUtilization,
    tasteDepth,
    updatedAt: now.toISOString(),
  };
}

@Injectable()
export class AgentIdentityService {
  private readonly logger = new Logger(AgentIdentityService.name);

  constructor(
    private readonly learningService: AgentLearningService,
    private readonly agentWalletService: AgentWalletService,
    private readonly kernelAccountService: KernelAccountService,
    private readonly configService: ConfigService,
  ) {}

  async enrichConfig(config: AgentConfig): Promise<EnrichedAgentConfig> {
    const reputationSnapshot = await this.computeReputation(config);
    const identityCredential = this.buildCredential(config as AgentConfigWithIdentity, reputationSnapshot);

    if (this.shouldPersistSnapshot(config, reputationSnapshot)) {
      await prisma.agentConfig.update({
        where: { id: config.id },
        data: {
          reputationScore: reputationSnapshot.score,
          reputationSnapshot,
          identityCredential,
        },
      });
    }

    return {
      ...config,
      reputationScore: reputationSnapshot.score,
      reputationSnapshot,
      identityCredential,
    };
  }

  async mintIdentity(userId: string): Promise<EnrichedAgentConfig & { onchain: AgentIdentityOnchainResult }> {
    const config = await prisma.agentConfig.findUnique({ where: { userId } });
    if (!config) {
      throw new BadRequestException("Agent config is required before minting identity");
    }

    const registryConfig = this.getRegistryConfig();
    if (!registryConfig) {
      const enriched = await this.enrichConfig(config);
      return {
        ...enriched,
        onchain: {
          status: enriched.identityStatus as AgentIdentityStatus,
          chainId: enriched.identityChainId,
          registry: enriched.identityRegistry,
          txHash: enriched.identityTxHash,
          tokenId: enriched.identityTokenId,
          reason: "erc8004_disabled",
        },
      };
    }

    if (config.identityStatus === "minted" || config.identityStatus === "attested") {
      const enriched = await this.enrichConfig(config);
      return {
        ...enriched,
        onchain: {
          status: enriched.identityStatus as AgentIdentityStatus,
          chainId: enriched.identityChainId,
          registry: enriched.identityRegistry,
          txHash: enriched.identityTxHash,
          tokenId: enriched.identityTokenId,
          reason: "already_minted",
        },
      };
    }

    const keyData = await this.agentWalletService.getAgentKeyData(userId);
    if (!keyData) {
      const pending = await prisma.agentConfig.update({
        where: { id: config.id },
        data: {
          identityStatus: "pending",
          identityChainId: registryConfig.chainId,
          identityRegistry: registryConfig.identityRegistry,
        },
      });
      const enriched = await this.enrichConfig(pending);
      return {
        ...enriched,
        onchain: {
          status: "pending",
          chainId: registryConfig.chainId,
          registry: registryConfig.identityRegistry,
          txHash: null,
          tokenId: null,
          reason: "missing_session_key",
        },
      };
    }

    try {
      const agentURI = toDataUriJson(buildAgentRegistrationFile({
        config,
        chainId: registryConfig.chainId,
        registry: registryConfig.identityRegistry,
        publicBaseUrl: registryConfig.publicBaseUrl,
      }));
      const data = encodeFunctionData({
        abi: AGENT_IDENTITY_ABI,
        functionName: "register",
        args: [agentURI],
      });
      const txHash = await this.kernelAccountService.sendSessionKeyTransaction(
        keyData.agentPrivateKey.toString(),
        keyData.approvalData,
        registryConfig.identityRegistry,
        data,
      );
      const tokenId = await this.readRegisteredAgentId(txHash as Hex, registryConfig);
      const minted = await prisma.agentConfig.update({
        where: { id: config.id },
        data: {
          identityStatus: tokenId ? "minted" : "pending",
          identityChainId: registryConfig.chainId,
          identityRegistry: registryConfig.identityRegistry,
          identityTokenId: tokenId,
          identityTxHash: txHash,
        },
      });
      const enriched = await this.enrichConfig(minted);
      return {
        ...enriched,
        onchain: {
          status: enriched.identityStatus as AgentIdentityStatus,
          chainId: registryConfig.chainId,
          registry: registryConfig.identityRegistry,
          txHash,
          tokenId,
          reason: tokenId ? undefined : "missing_token_id",
        },
      };
    } finally {
      keyData.agentPrivateKey.zero();
    }
  }

  async attestReputation(userId: string): Promise<EnrichedAgentConfig & { onchain: AgentIdentityOnchainResult }> {
    const config = await prisma.agentConfig.findUnique({ where: { userId } });
    if (!config) {
      throw new BadRequestException("Agent config is required before attesting reputation");
    }
    if (!config.identityTokenId) {
      throw new BadRequestException("Agent identity must be minted before reputation can be attested");
    }

    const registryConfig = this.getRegistryConfig();
    if (!registryConfig) {
      const enriched = await this.enrichConfig(config);
      return {
        ...enriched,
        onchain: {
          status: enriched.identityStatus as AgentIdentityStatus,
          chainId: enriched.identityChainId,
          registry: enriched.identityRegistry,
          txHash: enriched.reputationTxHash,
          tokenId: enriched.identityTokenId,
          reason: "erc8004_disabled",
        },
      };
    }

    const enrichedBeforeTx = await this.enrichConfig(config);
    const keyData = await this.agentWalletService.getAgentKeyData(userId);
    if (!keyData) {
      return {
        ...enrichedBeforeTx,
        onchain: {
          status: enrichedBeforeTx.identityStatus as AgentIdentityStatus,
          chainId: registryConfig.chainId,
          registry: registryConfig.identityRegistry,
          txHash: enrichedBeforeTx.reputationTxHash,
          tokenId: enrichedBeforeTx.identityTokenId,
          reason: "missing_session_key",
        },
      };
    }

    try {
      const reputationPayload = {
        schemaVersion: "resonate-agent-reputation/v1",
        agentId: config.id,
        erc8004: {
          agentRegistry: buildAgentRegistryId(registryConfig.chainId, registryConfig.identityRegistry),
          agentId: config.identityTokenId,
        },
        reputation: enrichedBeforeTx.reputationSnapshot,
        credential: enrichedBeforeTx.identityCredential,
      };
      const data = encodeFunctionData({
        abi: AGENT_IDENTITY_ABI,
        functionName: "setMetadata",
        args: [
          BigInt(config.identityTokenId),
          "resonate.reputation",
          stringToHex(JSON.stringify(reputationPayload)),
        ],
      });
      const txHash = await this.kernelAccountService.sendSessionKeyTransaction(
        keyData.agentPrivateKey.toString(),
        keyData.approvalData,
        registryConfig.identityRegistry,
        data,
      );
      const attested = await prisma.agentConfig.update({
        where: { id: config.id },
        data: {
          identityStatus: "attested",
          identityChainId: registryConfig.chainId,
          identityRegistry: registryConfig.identityRegistry,
          reputationAttestedAt: new Date(),
          reputationTxHash: txHash,
        },
      });
      const enriched = await this.enrichConfig(attested);
      return {
        ...enriched,
        onchain: {
          status: "attested",
          chainId: registryConfig.chainId,
          registry: registryConfig.identityRegistry,
          txHash,
          tokenId: enriched.identityTokenId,
        },
      };
    } finally {
      keyData.agentPrivateKey.zero();
    }
  }

  buildRegistrationFile(config: AgentConfig): AgentRegistrationFile {
    const registryConfig = this.getRegistryConfig();
    return buildAgentRegistrationFile({
      config,
      chainId: config.identityChainId ?? registryConfig?.chainId ?? null,
      registry: config.identityRegistry ?? registryConfig?.identityRegistry ?? null,
      publicBaseUrl: registryConfig?.publicBaseUrl,
    });
  }

  private shouldPersistSnapshot(
    config: AgentConfig,
    next: AgentReputationSnapshot,
  ): boolean {
    const stored = config.reputationSnapshot;
    if (config.reputationScore !== next.score || !config.identityCredential) {
      return true;
    }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return true;
    }

    const snapshot = stored as Record<string, unknown>;
    return (
      snapshot.score !== next.score ||
      snapshot.sessions !== next.sessions ||
      snapshot.tracksCurated !== next.tracksCurated ||
      snapshot.totalSpendUsd !== next.totalSpendUsd ||
      snapshot.monthlyCapUsd !== next.monthlyCapUsd ||
      snapshot.updatedAt !== next.updatedAt ||
      JSON.stringify(snapshot.genresExplored ?? []) !== JSON.stringify(next.genresExplored)
    );
  }

  private async computeReputation(config: AgentConfig): Promise<AgentReputationSnapshot> {
    const tasteProfile = await this.learningService.computeTasteProfile(config.userId, config.vibes);
    const sessions = await prisma.session.findMany({
      where: { userId: config.userId },
      include: {
        licenses: {
          include: {
            track: {
              select: {
                release: {
                  select: { genre: true },
                },
              },
            },
          },
        },
      },
      orderBy: { startedAt: "desc" },
      take: 100,
    });

    const licenseGenres = sessions.flatMap((session) =>
      session.licenses
        .map((license) => license.track.release.genre)
        .filter((genre): genre is string => Boolean(genre)),
    );
    const totalSpendUsd = sessions.reduce((sum, session) => sum + session.spentUsd, 0);
    const tracksCurated = sessions.reduce((sum, session) => sum + session.licenses.length, 0);
    const genresExplored = tasteProfile.genresExplored.length > 0
      ? tasteProfile.genresExplored
      : (licenseGenres.length > 0 ? licenseGenres : config.vibes);

    const lastSignalAt = new Date(Math.max(
      sessions[0]?.startedAt.getTime() ?? 0,
      Date.parse(tasteProfile.updatedAt),
      config.updatedAt.getTime(),
    ));
    return computeAgentReputationSnapshot({
      sessions: sessions.length,
      tracksCurated: Math.max(tracksCurated, tasteProfile.positiveSignals),
      totalSpendUsd,
      monthlyCapUsd: config.monthlyCapUsd,
      genresExplored,
      tasteScore: tasteProfile.score,
    }, lastSignalAt);
  }

  private buildCredential(
    config: AgentConfigWithIdentity,
    reputationSnapshot: AgentReputationSnapshot,
  ): AgentIdentityCredential {
    return {
      "@context": [
        "urn:w3c:credentials:v1",
        "urn:resonate:agent-identity:v1",
      ],
      id: `urn:resonate:agent-credential:${config.id}`,
      type: ["VerifiableCredential", "ResonateAgentIdentityCredential"],
      issuer: "did:resonate:protocol",
      issuanceDate: reputationSnapshot.updatedAt,
      credentialSubject: {
        id: `urn:resonate:agent:${config.id}`,
        owner: config.userId,
        agentId: config.id,
        name: config.name,
        vibes: config.vibes,
        stemTypes: config.stemTypes,
        monthlyCapUsd: config.monthlyCapUsd,
        erc8004: {
          status: config.identityStatus,
          chainId: config.identityChainId,
          registry: config.identityRegistry,
          tokenId: config.identityTokenId,
          txHash: config.identityTxHash,
        },
        reputation: reputationSnapshot,
      },
    };
  }

  private getRegistryConfig(): {
    chainId: number;
    identityRegistry: Address;
    rpcUrl: string;
    publicBaseUrl: string | null;
  } | null {
    const enabled = this.configService.get<string>("ERC8004_ENABLED") === "true";
    const registry = this.configService.get<string>("ERC8004_IDENTITY_REGISTRY_ADDRESS");
    if (!enabled || !registry) {
      return null;
    }
    if (!isAddress(registry)) {
      throw new Error("ERC8004_IDENTITY_REGISTRY_ADDRESS must be a valid EVM address");
    }

    const chainId = Number(
      this.configService.get<string>("ERC8004_CHAIN_ID") ||
      this.configService.get<string>("AA_CHAIN_ID") ||
      this.configService.get<string>("CHAIN_ID") ||
      "31337",
    );
    const rpcUrl =
      this.configService.get<string>("ERC8004_RPC_URL") ||
      this.configService.get<string>("RPC_URL") ||
      this.configService.get<string>("LOCAL_RPC_URL") ||
      "http://localhost:8545";

    return {
      chainId,
      identityRegistry: registry,
      rpcUrl,
      publicBaseUrl:
        this.configService.get<string>("ERC8004_PUBLIC_BASE_URL") ||
        this.configService.get<string>("PUBLIC_BASE_URL") ||
        null,
    };
  }

  private getChain(chainId: number, rpcUrl: string): Chain {
    if (chainId === 31337) return { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } };
    if (chainId === 11155111) return { ...sepolia, rpcUrls: { default: { http: [rpcUrl] } } };
    if (chainId === 84532) return { ...baseSepolia, rpcUrls: { default: { http: [rpcUrl] } } };
    if (chainId === 8453) return { ...base, rpcUrls: { default: { http: [rpcUrl] } } };
    return {
      id: chainId,
      name: `EVM ${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    };
  }

  private async readRegisteredAgentId(
    txHash: Hex,
    registryConfig: { chainId: number; identityRegistry: Address; rpcUrl: string },
  ): Promise<string | null> {
    const publicClient = createPublicClient({
      chain: this.getChain(registryConfig.chainId, registryConfig.rpcUrl),
      transport: http(registryConfig.rpcUrl),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryConfig.identityRegistry.toLowerCase()) {
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: AGENT_IDENTITY_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Registered") {
          return decoded.args.agentId.toString();
        }
      } catch {
        // Ignore unrelated ERC-721 Transfer/metadata logs in the same receipt.
      }
    }
    this.logger.warn(`ERC-8004 register tx ${txHash} did not include a Registered event`);
    return null;
  }
}
