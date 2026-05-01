import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { baseSepolia, foundry, sepolia } from "viem/chains";
import type { Prisma } from "@prisma/client";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "../../db/prisma";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";

const MINT_AUTHORIZATION_DOMAIN = {
  name: "Resonate StemNFT",
  version: "1",
} as const;

const MINT_AUTHORIZATION_TYPES = {
  MintAuthorization: [
    { name: "minter", type: "address" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "tokenURIHash", type: "bytes32" },
    { name: "protectionId", type: "uint256" },
    { name: "royaltyReceiver", type: "address" },
    { name: "royaltyBps", type: "uint96" },
    { name: "remixable", type: "bool" },
    { name: "parentIdsHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const STEM_NFT_ADDRESSES: Record<number, () => string | undefined> = {
  31337: () => process.env.STEM_NFT_ADDRESS,
  11155111: () =>
    process.env.SEPOLIA_STEM_NFT_ADDRESS || process.env.STEM_NFT_ADDRESS,
  84532: () => process.env.BASE_SEPOLIA_STEM_NFT_ADDRESS || process.env.STEM_NFT_ADDRESS,
};

const CONTENT_PROTECTION_ADDRESSES: Record<number, () => string | undefined> = {
  31337: () => process.env.CONTENT_PROTECTION_ADDRESS,
  11155111: () =>
    process.env.SEPOLIA_CONTENT_PROTECTION_ADDRESS ||
    process.env.CONTENT_PROTECTION_ADDRESS,
  84532: () =>
    process.env.BASE_SEPOLIA_CONTENT_PROTECTION_ADDRESS ||
    process.env.CONTENT_PROTECTION_ADDRESS,
};

const RPC_OVERRIDE = process.env.RPC_URL || "";
const CHAIN_CONFIGS: Record<number, () => { chain: Chain; rpcUrl?: string }> = {
  31337: () => ({
    chain: foundry,
    rpcUrl: RPC_OVERRIDE || process.env.LOCAL_RPC_URL || "http://localhost:8545",
  }),
  11155111: () => ({
    chain: sepolia,
    rpcUrl:
      RPC_OVERRIDE ||
      process.env.LOCAL_RPC_URL ||
      process.env.SEPOLIA_RPC_URL,
  }),
  84532: () => ({
    chain: baseSepolia,
    rpcUrl: RPC_OVERRIDE || process.env.BASE_SEPOLIA_RPC_URL,
  }),
};

const CONTENT_PROTECTION_ABI = [
  {
    name: "attestations",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "contentHash", type: "bytes32" },
      { name: "fingerprintHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
      { name: "attester", type: "address" },
      { name: "timestamp", type: "uint256" },
      { name: "valid", type: "bool" },
    ],
  },
] as const;

const PROTECTION_READ_MAX_ATTEMPTS = 15;
const PROTECTION_READ_RETRY_MS = 1000;

function getReleaseMetadataUriCandidates(title: string): string[] {
  const canonicalSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const legacySlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  return Array.from(
    new Set(
      [canonicalSlug, legacySlug]
        .filter(Boolean)
        .map((slug) => `resonate://release/${slug}`),
    ),
  );
}

type MintAuthorizationInput = {
  stemId: string;
  chainId: number;
  minterAddress: string;
  to?: string;
  amount?: string | number;
  royaltyReceiver?: string;
  royaltyBps?: number;
  remixable?: boolean;
  parentIds?: Array<string | number>;
  protectionId?: string | number;
};

export type MintAuthorizationResponse = {
  stemId: string;
  chainId: number;
  contractAddress: Address;
  tokenURI: string;
  authorization: {
    minter: Address;
    to: Address;
    amount: string;
    protectionId: string;
    royaltyReceiver: Address;
    royaltyBps: number;
    remixable: boolean;
    parentIds: string[];
    deadline: string;
    nonce: `0x${string}`;
  };
  signature: `0x${string}`;
};

type StemAuthorizationRecord = Prisma.StemGetPayload<{
  include: {
    nftMint: { select: { id: true } };
    track: {
      include: {
        release: {
          include: {
            artist: {
              select: {
                userId: true;
                payoutAddress: true;
              };
            };
          };
        };
      };
    };
  };
}>;

@Injectable()
export class MintAuthorizationService {
  private readonly logger = new Logger(MintAuthorizationService.name);
  private warnedPrivateKeyFallback = false;
  private warnedLocalRpcFallback = false;

  constructor(
    private readonly config: ConfigService,
    private readonly uploadRightsRoutingService: UploadRightsRoutingService,
  ) {}

  async createAuthorization(
    userId: string,
    input: MintAuthorizationInput,
    backendBaseUrl: string,
  ): Promise<MintAuthorizationResponse> {
    const prepared = await this.prepareAuthorization(userId, input, backendBaseUrl);
    const signature = await this.signMintAuthorization(prepared);

    return {
      stemId: prepared.stemId,
      chainId: prepared.chainId,
      contractAddress: prepared.contractAddress,
      tokenURI: prepared.tokenURI,
      authorization: {
        minter: prepared.message.minter,
        to: prepared.message.to,
        amount: prepared.message.amount.toString(),
        protectionId: prepared.message.protectionId.toString(),
        royaltyReceiver: prepared.message.royaltyReceiver,
        royaltyBps: Number(prepared.message.royaltyBps),
        remixable: prepared.message.remixable,
        parentIds: prepared.parentIds.map((id) => id.toString()),
        deadline: prepared.message.deadline.toString(),
        nonce: prepared.message.nonce,
      },
      signature,
    };
  }

  async createBatchAuthorizations(
    userId: string,
    inputs: MintAuthorizationInput[],
    backendBaseUrl: string,
  ): Promise<MintAuthorizationResponse[]> {
    return Promise.all(
      inputs.map((input) =>
        this.createAuthorization(userId, input, backendBaseUrl),
      ),
    );
  }

  private async prepareAuthorization(
    userId: string,
    input: MintAuthorizationInput,
    backendBaseUrl: string,
  ) {
    const stem = await prisma.stem.findUnique({
      where: { id: input.stemId },
      include: {
        nftMint: { select: { id: true } },
        track: {
          include: {
            release: {
              include: {
                artist: {
                  select: {
                    userId: true,
                    payoutAddress: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!stem) {
      throw new NotFoundException(`Stem ${input.stemId} not found`);
    }
    if (stem.nftMint) {
      throw new BadRequestException(
        `Stem ${input.stemId} has already been minted`,
      );
    }

    const ownerUserId = stem.track?.release?.artist?.userId;
    if (!ownerUserId || ownerUserId !== userId) {
      throw new ForbiddenException("You do not own this stem");
    }
    await this.uploadRightsRoutingService.assertMarketplaceAllowedForStem(input.stemId);

    const chainId = Number(input.chainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new BadRequestException("Invalid chainId");
    }

    const contractAddress = this.resolveStemNftAddress(chainId);
    const minter = this.normalizeAddress(input.minterAddress, "minterAddress");
    const to = this.normalizeAddress(input.to || minter, "to");
    const amount = this.parsePositiveBigInt(input.amount ?? 1, "amount");
    const royaltyReceiver = this.normalizeAddress(
      input.royaltyReceiver || minter,
      "royaltyReceiver",
    );
    const royaltyBps = Number(input.royaltyBps ?? 500);
    if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 1000) {
      throw new BadRequestException("royaltyBps must be between 0 and 1000");
    }

    const remixable = input.remixable ?? true;
    const parentIds = (input.parentIds ?? []).map((parentId) =>
      this.parsePositiveBigInt(parentId, "parentIds"),
    );
    const protectionId = await this.resolveReleaseProtectionId(
      stem,
      chainId,
      minter,
      input.protectionId,
    );

    const tokenURI = this.buildTokenUri(backendBaseUrl, chainId, input.stemId);
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + this.getAuthorizationTtlSeconds(),
    );
    const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;

    return {
      stemId: input.stemId,
      chainId,
      contractAddress,
      tokenURI,
      parentIds,
      message: {
        minter,
        to,
        amount,
        tokenURIHash: keccak256(stringToHex(tokenURI)),
        protectionId,
        royaltyReceiver,
        royaltyBps: BigInt(royaltyBps),
        remixable,
        parentIdsHash: keccak256(
          encodeAbiParameters([{ type: "uint256[]" }], [parentIds]),
        ),
        deadline,
        nonce,
      },
    };
  }

  private buildTokenUri(
    backendBaseUrl: string,
    chainId: number,
    stemId: string,
  ): string {
    const normalizedBase = backendBaseUrl.endsWith("/")
      ? backendBaseUrl
      : `${backendBaseUrl}/`;
    return new URL(`metadata/${chainId}/stem/${stemId}`, normalizedBase).toString();
  }

  private async resolveReleaseProtectionId(
    stem: StemAuthorizationRecord,
    chainId: number,
    minter: Address,
    protectionIdOverride?: string | number,
  ): Promise<bigint> {
    const release = stem.track?.release;
    if (!release) {
      throw new BadRequestException(
        "Release is missing a content-protection root",
      );
    }

    const metadataUris = getReleaseMetadataUriCandidates(release.title);
    const attesterCandidates = this.getAttesterCandidates(stem, minter);

    if (protectionIdOverride != null) {
      const protectionId = this.parsePositiveBigInt(
        protectionIdOverride,
        "protectionId",
      );
      await this.assertOnChainReleaseProtection({
        chainId,
        protectionId,
        metadataUris,
        attesterCandidates,
      });
      return protectionId;
    }

    const attestation = await prisma.contentAttestation.findFirst({
      where: {
        chainId,
        attesterAddress: { in: attesterCandidates },
        metadataURI: { in: metadataUris },
      },
      orderBy: { attestedAt: "desc" },
    });

    if (!attestation) {
      throw new BadRequestException(
        `Release ${release.id} has not been attested on-chain yet`,
      );
    }

    return this.parsePositiveBigInt(attestation.tokenId, "protectionId");
  }

  private getAttesterCandidates(
    stem: StemAuthorizationRecord,
    minter: Address,
  ): string[] {
    const release = stem.track?.release;
    return Array.from(
      new Set(
        [
          minter,
          release?.artist?.userId,
          release?.artist?.payoutAddress,
        ]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase()),
      ),
    );
  }

  private async assertOnChainReleaseProtection(input: {
    chainId: number;
    protectionId: bigint;
    metadataUris: string[];
    attesterCandidates: string[];
  }): Promise<void> {
    const contentProtectionAddress = this.resolveContentProtectionAddress(
      input.chainId,
    );
    const chainConfig = this.resolveChainConfig(input.chainId);
    const client = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const expectedAttesters = input.attesterCandidates.filter((candidate) =>
      isAddress(candidate),
    );

    for (let attempt = 1; attempt <= PROTECTION_READ_MAX_ATTEMPTS; attempt += 1) {
      const attestation = await client.readContract({
        address: contentProtectionAddress,
        abi: CONTENT_PROTECTION_ABI,
        functionName: "attestations",
        args: [input.protectionId],
      });

      const metadataURI = attestation[2];
      const attester = String(attestation[3]).toLowerCase();
      const valid = Boolean(attestation[5]);

      if (
        valid &&
        input.metadataUris.includes(metadataURI) &&
        (
          expectedAttesters.length === 0 ||
          expectedAttesters.some((candidate) => candidate.toLowerCase() === attester)
        )
      ) {
        return;
      }

      if (valid && !input.metadataUris.includes(metadataURI)) {
        throw new BadRequestException(
          "Release protection metadata does not match this release",
        );
      }

      if (
        valid &&
        expectedAttesters.length > 0 &&
        !expectedAttesters.some((candidate) => candidate.toLowerCase() === attester)
      ) {
        throw new BadRequestException(
          "Release protection attester does not match the minting wallet",
        );
      }

      if (attempt < PROTECTION_READ_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, PROTECTION_READ_RETRY_MS),
        );
      }
    }

    throw new BadRequestException(
      `Release protection ${input.protectionId.toString()} has not been attested on-chain yet`,
    );
  }

  private getAuthorizationTtlSeconds(): number {
    const raw = this.config.get<string>("MINT_AUTHORIZATION_TTL_SECONDS");
    const parsed = raw ? Number(raw) : 900;
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 900;
    }
    return parsed;
  }

  private resolveStemNftAddress(chainId: number): Address {
    const resolver = STEM_NFT_ADDRESSES[chainId];
    const value = resolver?.();
    if (!value || !isAddress(value)) {
      throw new BadRequestException(
        `StemNFT address is not configured for chain ${chainId}`,
      );
    }
    return getAddress(value);
  }

  private resolveContentProtectionAddress(chainId: number): Address {
    const resolver = CONTENT_PROTECTION_ADDRESSES[chainId];
    const value = resolver?.();
    if (!value || !isAddress(value)) {
      throw new BadRequestException(
        `ContentProtection address is not configured for chain ${chainId}`,
      );
    }
    return getAddress(value);
  }

  private resolveChainConfig(chainId: number) {
    const resolver = CHAIN_CONFIGS[chainId];
    if (!resolver) {
      throw new BadRequestException(`Unsupported chain ${chainId}`);
    }
    const config = resolver();
    if (!config.rpcUrl) {
      throw new BadRequestException(`RPC URL is not configured for chain ${chainId}`);
    }
    return config as { chain: Chain; rpcUrl: string };
  }

  private normalizeAddress(value: string, field: string): Address {
    if (!value || !isAddress(value)) {
      throw new BadRequestException(`${field} must be a valid address`);
    }
    return getAddress(value);
  }

  private parsePositiveBigInt(
    value: string | number,
    field: string,
  ): bigint {
    try {
      const parsed = BigInt(value);
      if (parsed <= 0n) {
        throw new Error("must be positive");
      }
      return parsed;
    } catch {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
  }

  private getAuthorizerAccount() {
    const configured = this.getConfiguredAuthorizerPrivateKey();
    if (!configured) {
      return null;
    }

    if (
      !this.config.get<string>("MINT_AUTHORIZER_PRIVATE_KEY") &&
      !this.warnedPrivateKeyFallback
    ) {
      this.warnedPrivateKeyFallback = true;
      this.logger.warn(
        "MINT_AUTHORIZER_PRIVATE_KEY is not set; falling back to PRIVATE_KEY",
      );
    }

    const normalized = configured.startsWith("0x")
      ? configured
      : `0x${configured}`;
    return privateKeyToAccount(normalized as `0x${string}`);
  }

  private getConfiguredAuthorizerPrivateKey(): string | null {
    return (
      this.config.get<string>("MINT_AUTHORIZER_PRIVATE_KEY") ||
      this.config.get<string>("PRIVATE_KEY") ||
      null
    );
  }

  private async signMintAuthorization(prepared: {
    chainId: number;
    contractAddress: Address;
    message: {
      minter: Address;
      to: Address;
      amount: bigint;
      tokenURIHash: Hex;
      protectionId: bigint;
      royaltyReceiver: Address;
      royaltyBps: bigint;
      remixable: boolean;
      parentIdsHash: Hex;
      deadline: bigint;
      nonce: `0x${string}`;
    };
  }): Promise<`0x${string}`> {
    const account = this.getAuthorizerAccount();
    const typedData = {
      domain: {
        ...MINT_AUTHORIZATION_DOMAIN,
        chainId: prepared.chainId,
        verifyingContract: prepared.contractAddress,
      },
      types: MINT_AUTHORIZATION_TYPES,
      primaryType: "MintAuthorization" as const,
      message: prepared.message,
    };

    if (account) {
      return account.signTypedData(typedData);
    }

    return this.signWithUnlockedLocalAccount(typedData);
  }

  private async signWithUnlockedLocalAccount(typedData: {
    domain: {
      name: typeof MINT_AUTHORIZATION_DOMAIN.name;
      version: typeof MINT_AUTHORIZATION_DOMAIN.version;
      chainId: number;
      verifyingContract: Address;
    };
    types: typeof MINT_AUTHORIZATION_TYPES;
    primaryType: "MintAuthorization";
    message: {
      minter: Address;
      to: Address;
      amount: bigint;
      tokenURIHash: Hex;
      protectionId: bigint;
      royaltyReceiver: Address;
      royaltyBps: bigint;
      remixable: boolean;
      parentIdsHash: Hex;
      deadline: bigint;
      nonce: `0x${string}`;
    };
  }): Promise<`0x${string}`> {
    const rpcUrl =
      this.config.get<string>("LOCAL_RPC_URL") ||
      this.config.get<string>("RPC_URL");

    if (!rpcUrl || !this.isLocalRpcUrl(rpcUrl)) {
      throw new InternalServerErrorException(
        "Mint authorizer private key is not configured",
      );
    }

    const walletClient = createWalletClient({
      transport: http(rpcUrl),
    });
    const addresses = await walletClient.getAddresses();
    const account = addresses[0];

    if (!account) {
      throw new InternalServerErrorException(
        `No unlocked local accounts are available at ${rpcUrl}`,
      );
    }

    if (!this.warnedLocalRpcFallback) {
      this.warnedLocalRpcFallback = true;
      this.logger.warn(
        `MINT_AUTHORIZER_PRIVATE_KEY is not set; using unlocked local RPC signer ${account} from ${rpcUrl}`,
      );
    }

    return walletClient.signTypedData({
      account,
      ...typedData,
    });
  }

  private isLocalRpcUrl(rpcUrl: string): boolean {
    return (
      rpcUrl.includes("localhost") ||
      rpcUrl.includes("127.0.0.1") ||
      rpcUrl.includes("0.0.0.0")
    );
  }
}
