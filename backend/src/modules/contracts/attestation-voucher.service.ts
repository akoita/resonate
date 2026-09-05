import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  encodePacked,
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "../../db/prisma";

/**
 * CP-1 (#1271) — registrar-signed attestation authorization voucher.
 *
 * ContentProtection.attest / attestRelease now require an EIP-712
 * `AttestationAuthorization` voucher signed by a registered registrar. This
 * service is the registrar: after verifying the caller controls the `attester`
 * smart-account and that the requested `releaseId` (token id) is derivable from
 * THAT attester, it signs the voucher.
 *
 * THE OWNERSHIP CHECK IS THE SECURITY CRUX. The on-chain token id is a
 * predictable hash the web derives client-side (web `useAttestAndStake`,
 * useContracts.ts:943-950):
 *
 *   releaseId = uint256(keccak256(abi.encodePacked(
 *                 attester, contentHash, keccak256(bytes(metadataURI)))))
 *
 * Because the id COMMITS TO `attester`, an attacker can never obtain a voucher
 * for a victim's slot: the victim's id derives from the victim's address, so it
 * is not derivable from the attacker's own address. We therefore only need to
 * verify the requested id is in the REQUESTER's own partition — recompute it
 * from the caller's controlled `attester` + the supplied `contentHash` /
 * `metadataURI` and require an exact match. This needs NO persisted release, so
 * it works for the first-ever attestation (the squatting-prevention case) —
 * which is exactly when no `Release` row or on-chain record exists yet, because
 * the web attests before the release is created.
 *
 * The voucher does NOT assert that the content is genuinely the creator's —
 * attestation provenance authenticity is enforced economically by
 * staking/slashing (see ContentProtection.slash), not here. The voucher's only
 * jobs are (a) gate WHO may attest at all (a registered registrar must sign)
 * and (b) ensure the requested id sits in the requester's own address partition
 * so nobody can squat another creator's predictable id.
 *
 * Domain / types must match ContentProtection byte-for-byte:
 *   domain  = { name: "ContentProtection", version: "1", chainId, verifyingContract }
 *   struct  = AttestationAuthorization(address attester,uint256 tokenId,uint256 deadline)
 *
 * Signer key: reuses the same key mint-authorization uses
 * (`MINT_AUTHORIZER_PRIVATE_KEY`, falling back to `PRIVATE_KEY`). That signer
 * address MUST be registered on ContentProtection via `setRegistrar(signer,
 * true)` (ops step) or every voucher reverts `InvalidAttestationSignature`.
 *
 * Revenue line: vision-neutral infra/trust (protects the Content Protection
 * attestation surface that underpins the marketplace take-rate, revenue line 3).
 */

const ATTESTATION_VOUCHER_DOMAIN = {
  name: "ContentProtection",
  version: "1",
} as const;

const ATTESTATION_AUTHORIZATION_TYPES = {
  AttestationAuthorization: [
    { name: "attester", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const CONTENT_PROTECTION_ADDRESSES: Record<number, () => string | undefined> = {
  31337: () => process.env.CONTENT_PROTECTION_ADDRESS,
  11155111: () =>
    process.env.SEPOLIA_CONTENT_PROTECTION_ADDRESS ||
    process.env.CONTENT_PROTECTION_ADDRESS,
  84532: () =>
    process.env.BASE_SEPOLIA_CONTENT_PROTECTION_ADDRESS ||
    process.env.CONTENT_PROTECTION_ADDRESS,
};

const MAX_UINT256 = 2n ** 256n;
const DEFAULT_VOUCHER_TTL_SECONDS = 600;
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;

export type AttestationVoucherInput = {
  releaseId: string;
  attester: string;
  contentHash: string;
  metadataURI: string;
  chainId?: number;
};

export type AttestationVoucherResponse = {
  attester: Address;
  tokenId: string;
  deadline: number;
  signature: Hex;
};

@Injectable()
export class AttestationVoucherService {
  private readonly logger = new Logger(AttestationVoucherService.name);

  // `config` is optional so on-chain integration tests can construct the
  // service directly (mirrors ShowsService) and rely on process.env.
  constructor(private readonly config?: ConfigService) {}

  async createVoucher(
    userId: string,
    input: AttestationVoucherInput,
  ): Promise<AttestationVoucherResponse> {
    const tokenId = this.parseTokenId(input.releaseId);
    const attester = this.normalizeAddress(input.attester, "attester");
    const contentHash = this.parseBytes32(input.contentHash, "contentHash");
    const metadataURI = this.requireMetadataURI(input.metadataURI);
    const chainId = this.resolveChainId(input.chainId);
    const contractAddress = this.resolveContentProtectionAddress(chainId);

    const attesterCandidates = await this.loadAttesterCandidates(userId);

    // (1) The attester must be a wallet controlled by / linked to this user —
    // never sign a voucher whose msg.sender is an address the caller does not
    // own. Mirrors mint-authorization's attester candidate set (own wallet +
    // artist payout addresses).
    if (!attesterCandidates.has(attester.toLowerCase())) {
      throw new ForbiddenException(
        "attester is not a wallet linked to the authenticated user",
      );
    }

    // (2) THE CRUX: the requested token id must be derivable from the caller's
    // OWN attester address, the supplied contentHash, and metadataURI. This
    // needs no persisted release (works for the first-ever attestation) and is
    // what blocks squatting: a victim's id derives from the victim's address,
    // so it can never match a hash rooted in the requester's address.
    const expectedId = this.computeReleaseTokenId(attester, contentHash, metadataURI);
    if (expectedId !== tokenId) {
      throw new ForbiddenException(
        "releaseId is not derivable from attester, contentHash, and metadataURI",
      );
    }

    // (3) Defense-in-depth: if this id is already recorded in our attestation
    // index under an address the caller does NOT control, refuse — never sign a
    // voucher over a slot another creator already claimed. Absent record (the
    // normal first-attestation case) is fine: proceed to sign.
    await this.assertNotClaimedByAnotherUser(tokenId, chainId, attesterCandidates);

    const deadline = Math.floor(Date.now() / 1000) + this.getVoucherTtlSeconds();
    const signature = await this.signVoucher({
      chainId,
      contractAddress,
      attester,
      tokenId,
      deadline: BigInt(deadline),
    });

    return { attester, tokenId: tokenId.toString(), deadline, signature };
  }

  private async loadAttesterCandidates(userId: string): Promise<Set<string>> {
    const [wallet, artists] = await Promise.all([
      prisma.wallet.findUnique({
        where: { userId },
        select: { address: true, ownerAddress: true },
      }),
      prisma.artist.findMany({
        where: { userId },
        select: { payoutAddress: true },
      }),
    ]);

    const candidates = new Set<string>();
    // Wallet-auth userId IS the lowercased smart-account address (auth.service).
    candidates.add(userId.toLowerCase());
    if (wallet?.address) candidates.add(wallet.address.toLowerCase());
    if (wallet?.ownerAddress) candidates.add(wallet.ownerAddress.toLowerCase());
    for (const artist of artists) {
      if (artist.payoutAddress) candidates.add(artist.payoutAddress.toLowerCase());
    }
    return candidates;
  }

  private async assertNotClaimedByAnotherUser(
    tokenId: bigint,
    chainId: number,
    attesterCandidates: Set<string>,
  ): Promise<void> {
    const record = await prisma.contentAttestation.findUnique({
      where: {
        tokenId_chainId: { tokenId: tokenId.toString(), chainId },
      },
      select: { attesterAddress: true },
    });
    if (record && !attesterCandidates.has(record.attesterAddress.toLowerCase())) {
      throw new ForbiddenException(
        "This release id is already attested by another account",
      );
    }
  }

  /**
   * Re-derives the on-chain release token id the way the web does:
   *   uint256(keccak256(abi.encodePacked(
   *     attester, contentHash, keccak256(bytes(metadataURI)))))
   *
   * `stringToHex(metadataURI)` yields the same UTF-8 bytes as viem `toBytes`, so
   * this is byte-identical to the web derivation (useContracts.ts:942).
   */
  private computeReleaseTokenId(
    attester: Address,
    contentHash: Hex,
    metadataURI: string,
  ): bigint {
    const metadataHash = keccak256(stringToHex(metadataURI));
    const idHex = keccak256(
      encodePacked(
        ["address", "bytes32", "bytes32"],
        [attester, contentHash, metadataHash],
      ),
    );
    return BigInt(idHex);
  }

  private async signVoucher(input: {
    chainId: number;
    contractAddress: Address;
    attester: Address;
    tokenId: bigint;
    deadline: bigint;
  }): Promise<Hex> {
    const account = this.getRegistrarAccount();
    return account.signTypedData({
      domain: {
        ...ATTESTATION_VOUCHER_DOMAIN,
        chainId: input.chainId,
        verifyingContract: input.contractAddress,
      },
      types: ATTESTATION_AUTHORIZATION_TYPES,
      primaryType: "AttestationAuthorization",
      message: {
        attester: input.attester,
        tokenId: input.tokenId,
        deadline: input.deadline,
      },
    });
  }

  private getRegistrarAccount() {
    const configured =
      this.readConfig("MINT_AUTHORIZER_PRIVATE_KEY") || this.readConfig("PRIVATE_KEY");
    if (!configured) {
      throw new InternalServerErrorException(
        "Attestation voucher signer key is not configured (set MINT_AUTHORIZER_PRIVATE_KEY)",
      );
    }
    const normalized = configured.startsWith("0x") ? configured : `0x${configured}`;
    return privateKeyToAccount(normalized as Hex);
  }

  private resolveChainId(chainId?: number): number {
    if (chainId != null) {
      const parsed = Number(chainId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BadRequestException("Invalid chainId");
      }
      return parsed;
    }
    return Number(
      this.readConfig("AA_CHAIN_ID") ||
        this.readConfig("CHAIN_ID") ||
        this.readConfig("INDEXER_CHAIN_ID") ||
        "11155111",
    );
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

  private getVoucherTtlSeconds(): number {
    const raw = this.readConfig("ATTESTATION_VOUCHER_TTL_SECONDS");
    const parsed = raw ? Number(raw) : DEFAULT_VOUCHER_TTL_SECONDS;
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return DEFAULT_VOUCHER_TTL_SECONDS;
    }
    return parsed;
  }

  private parseTokenId(releaseId: string): bigint {
    let value: bigint;
    try {
      value = BigInt(releaseId);
    } catch {
      throw new BadRequestException("releaseId must be a uint256 decimal string");
    }
    if (value < 0n || value >= MAX_UINT256) {
      throw new BadRequestException("releaseId is out of uint256 range");
    }
    return value;
  }

  private parseBytes32(value: string, field: string): Hex {
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be a 0x-prefixed 32-byte hex string`);
    }
    const hex = value.startsWith("0x") ? value : `0x${value}`;
    if (!BYTES32_HEX.test(hex)) {
      throw new BadRequestException(`${field} must be a 0x-prefixed 32-byte hex string`);
    }
    return hex.toLowerCase() as Hex;
  }

  private requireMetadataURI(value: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new BadRequestException("metadataURI is required");
    }
    return value;
  }

  private normalizeAddress(value: string, field: string): Address {
    if (!value || !isAddress(value)) {
      throw new BadRequestException(`${field} must be a valid address`);
    }
    return getAddress(value);
  }

  private readConfig(key: string): string | undefined {
    return this.config?.get<string>(key) ?? process.env[key];
  }
}
