/**
 * AttestationVoucherService — Integration Test (Testcontainer Anvil)
 *
 * CP-1 (#1271). This is the authoritative proof that the backend-signed
 * registrar voucher verifies on-chain, and that the ownership crux works at the
 * FIRST attestation (no persisted Release row — the web attests before the
 * release is created):
 *
 *   - deploy ContentProtection (impl + ERC1967 proxy + initialize +
 *     reinitializeV5 to set the EIP-712 domain), setRegistrar(signer, true);
 *   - the service signs a voucher for a token id that has NO Release row and NO
 *     prior attestation; attestRelease() called FROM the attester account
 *     succeeds on-chain;
 *   - a voucher signed by a NON-registrar key is rejected on-chain
 *     (InvalidAttestationSignature);
 *   - the service refuses to sign a token id NOT derivable from the requester's
 *     own address (the squatting case);
 *   - the service refuses to sign for an attester the user does not control;
 *   - defense-in-depth: refuses a token id already indexed under another account.
 */

import { ForbiddenException } from "@nestjs/common";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  encodePacked,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { prisma } from "../db/prisma";
import { AttestationVoucherService } from "../modules/contracts/attestation-voucher.service";

const ANVIL_CHAIN_ID = 31337;

// Standard Anvil / Foundry dev accounts (deterministic mnemonic).
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // account 0 — owner + registrar signer
const ATTESTER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // account 1 — the artist (msg.sender)
const NON_REGISTRAR_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // account 2 — not a registrar / a stranger

const CP_ARTIFACT =
  require("../../../contracts/out/ContentProtection.sol/ContentProtection.json") as {
    abi: any[];
    bytecode: { object: `0x${string}` };
  };
const ERC1967_PROXY_ARTIFACT =
  require("../../../contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json") as {
    abi: any[];
    bytecode: { object: `0x${string}` };
  };

const TEST_PREFIX = `attv_${Date.now()}_`;

const anvilUrl = () => process.env.ANVIL_RPC_URL;

/** Re-derive the on-chain release token id the way the web/service does. */
function computeReleaseTokenId(
  attester: Address,
  contentHash: Hex,
  metadataURI: string,
): bigint {
  const metadataHash = keccak256(stringToHex(metadataURI));
  return BigInt(
    keccak256(
      encodePacked(
        ["address", "bytes32", "bytes32"],
        [attester, contentHash, metadataHash],
      ),
    ),
  );
}

async function deployContentProtection(
  walletClient: any,
  publicClient: any,
  owner: Address,
): Promise<Address> {
  const implHash = await walletClient.deployContract({
    abi: CP_ARTIFACT.abi,
    bytecode: CP_ARTIFACT.bytecode.object,
    args: [],
  });
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
  const initData = encodeFunctionData({
    abi: CP_ARTIFACT.abi,
    functionName: "initialize",
    args: [owner, owner, 0n], // owner, treasury, stakeAmount
  });
  const proxyHash = await walletClient.deployContract({
    abi: ERC1967_PROXY_ARTIFACT.abi,
    bytecode: ERC1967_PROXY_ARTIFACT.bytecode.object,
    args: [implReceipt.contractAddress!, initData],
  });
  const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash });
  const proxyAddress = proxyReceipt.contractAddress! as Address;

  // V5 migration: initialize the EIP-712 domain on the proxy so vouchers verify.
  const reinitHash = await walletClient.writeContract({
    address: proxyAddress,
    abi: CP_ARTIFACT.abi,
    functionName: "reinitializeV5",
    args: [],
  });
  await publicClient.waitForTransactionReceipt({ hash: reinitHash });

  return proxyAddress;
}

describe("AttestationVoucherService integration (Anvil)", () => {
  const chain = { ...foundry, id: ANVIL_CHAIN_ID };
  const deployer = privateKeyToAccount(DEPLOYER_KEY as Hex);
  const attester = privateKeyToAccount(ATTESTER_KEY as Hex);
  const stranger = privateKeyToAccount(NON_REGISTRAR_KEY as Hex);
  const userId = attester.address.toLowerCase();

  // First-attestation content: NO Release row and NO prior attestation exist.
  const contentHash = keccak256(stringToHex(`${TEST_PREFIX}audio`)) as Hex;
  const fingerprintHash = contentHash;
  const metadataURI = `resonate://release/${TEST_PREFIX}first-release`;
  const releaseId = computeReleaseTokenId(attester.address, contentHash, metadataURI);

  const service = new AttestationVoucherService();

  let cpAddress: Address;
  let publicClient: any;
  let deployerWallet: any;
  let attesterWallet: any;

  const prevCpAddress = process.env.CONTENT_PROTECTION_ADDRESS;
  const prevSignerKey = process.env.MINT_AUTHORIZER_PRIVATE_KEY;
  const prevAltSignerKey = process.env.PRIVATE_KEY;

  beforeAll(async () => {
    if (!anvilUrl()) return;

    publicClient = createPublicClient({ chain, transport: http(anvilUrl()) });
    deployerWallet = createWalletClient({ account: deployer, chain, transport: http(anvilUrl()) });
    attesterWallet = createWalletClient({ account: attester, chain, transport: http(anvilUrl()) });

    cpAddress = await deployContentProtection(deployerWallet, publicClient, deployer.address);

    // Register the backend signer (the deployer key, reused as the registrar).
    const setRegistrarHash = await deployerWallet.writeContract({
      address: cpAddress,
      abi: CP_ARTIFACT.abi,
      functionName: "setRegistrar",
      args: [deployer.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: setRegistrarHash });

    // Point the service at this deployment and reuse the deployer key as the
    // registrar signer (same env var mint-authorization reads).
    process.env.CONTENT_PROTECTION_ADDRESS = cpAddress;
    process.env.MINT_AUTHORIZER_PRIVATE_KEY = DEPLOYER_KEY;
    delete process.env.PRIVATE_KEY;

    // Seed ONLY User + Artist (attester is the artist's own wallet) — crucially
    // NO Release row, proving first-attestation works before the release exists.
    await prisma.user.create({
      data: { id: userId, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId,
        displayName: `${TEST_PREFIX}Artist`,
        payoutAddress: attester.address.toLowerCase(),
      },
    });
  });

  afterAll(async () => {
    if (prevCpAddress === undefined) delete process.env.CONTENT_PROTECTION_ADDRESS;
    else process.env.CONTENT_PROTECTION_ADDRESS = prevCpAddress;
    if (prevSignerKey === undefined) delete process.env.MINT_AUTHORIZER_PRIVATE_KEY;
    else process.env.MINT_AUTHORIZER_PRIVATE_KEY = prevSignerKey;
    if (prevAltSignerKey === undefined) delete process.env.PRIVATE_KEY;
    else process.env.PRIVATE_KEY = prevAltSignerKey;

    await prisma.contentAttestation
      .deleteMany({ where: { metadataURI: { startsWith: `resonate://release/${TEST_PREFIX}` } } })
      .catch(() => {});
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("signs a first-attestation voucher (no Release row) that attestRelease() accepts on-chain", async () => {
    if (!anvilUrl()) {
      console.warn("ANVIL_RPC_URL not set. Skipping attestation-voucher on-chain test.");
      return;
    }

    // Guard: there is genuinely no attestation record for this content.
    const preexisting = await prisma.contentAttestation.findFirst({
      where: { metadataURI },
    });
    expect(preexisting).toBeNull();

    const voucher = await service.createVoucher(userId, {
      releaseId: releaseId.toString(),
      attester: attester.address,
      contentHash,
      metadataURI,
      chainId: ANVIL_CHAIN_ID,
    });

    expect(voucher.attester.toLowerCase()).toBe(attester.address.toLowerCase());
    expect(voucher.tokenId).toBe(releaseId.toString());
    expect(typeof voucher.deadline).toBe("number");
    expect(voucher.signature).toMatch(/^0x[0-9a-f]{130}$/i); // 65-byte (r,s,v)

    // The artist (msg.sender == attester) calls attestRelease with the voucher.
    const attestHash = await attesterWallet.writeContract({
      address: cpAddress,
      abi: CP_ARTIFACT.abi,
      functionName: "attestRelease",
      args: [
        releaseId,
        contentHash,
        fingerprintHash,
        metadataURI,
        BigInt(voucher.deadline),
        voucher.signature,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: attestHash });

    const onChain = (await publicClient.readContract({
      address: cpAddress,
      abi: CP_ARTIFACT.abi,
      functionName: "attestations",
      args: [releaseId],
    })) as readonly [Hex, Hex, string, Address, bigint, boolean];

    expect(onChain[5]).toBe(true); // valid
    expect(onChain[3].toLowerCase()).toBe(attester.address.toLowerCase()); // attester
    expect(onChain[2]).toBe(metadataURI);
  });

  it("rejects a voucher signed by a non-registrar key on-chain (InvalidAttestationSignature)", async () => {
    if (!anvilUrl()) {
      console.warn("ANVIL_RPC_URL not set. Skipping non-registrar rejection test.");
      return;
    }

    // A distinct token id so the check is the signature, not AlreadyAttested.
    const otherContentHash = keccak256(stringToHex(`${TEST_PREFIX}other-audio`)) as Hex;
    const otherReleaseId = computeReleaseTokenId(attester.address, otherContentHash, metadataURI);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    const forgedSignature = await stranger.signTypedData({
      domain: {
        name: "ContentProtection",
        version: "1",
        chainId: ANVIL_CHAIN_ID,
        verifyingContract: cpAddress,
      },
      types: {
        AttestationAuthorization: [
          { name: "attester", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "AttestationAuthorization",
      message: { attester: attester.address, tokenId: otherReleaseId, deadline },
    });

    await expect(
      publicClient.simulateContract({
        account: attester,
        address: cpAddress,
        abi: CP_ARTIFACT.abi,
        functionName: "attestRelease",
        args: [
          otherReleaseId,
          otherContentHash,
          otherContentHash,
          metadataURI,
          deadline,
          forgedSignature,
        ],
      }),
    ).rejects.toThrow(/InvalidAttestationSignature/);
  });

  it("refuses to sign a token id not derivable from the requester's own address (squatting crux)", async () => {
    if (!anvilUrl()) {
      console.warn("ANVIL_RPC_URL not set. Skipping squatting-refusal test.");
      return;
    }

    // The victim's id derives from the STRANGER's address. The requester passes
    // their OWN attester, so the derivation check fails — an attacker cannot get
    // a voucher for someone else's predictable id.
    const victimReleaseId = computeReleaseTokenId(stranger.address, contentHash, metadataURI);

    await expect(
      service.createVoucher(userId, {
        releaseId: victimReleaseId.toString(),
        attester: attester.address,
        contentHash,
        metadataURI,
        chainId: ANVIL_CHAIN_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses to sign for an attester the user does not control", async () => {
    if (!anvilUrl()) {
      console.warn("ANVIL_RPC_URL not set. Skipping attester-binding test.");
      return;
    }

    // A consistent id derived from the stranger, but the requester does not
    // control the stranger address → rejected before any signing.
    const strangerReleaseId = computeReleaseTokenId(stranger.address, contentHash, metadataURI);

    await expect(
      service.createVoucher(userId, {
        releaseId: strangerReleaseId.toString(),
        attester: stranger.address,
        contentHash,
        metadataURI,
        chainId: ANVIL_CHAIN_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("defense-in-depth: refuses a token id already indexed under another account", async () => {
    if (!anvilUrl()) {
      console.warn("ANVIL_RPC_URL not set. Skipping defense-in-depth test.");
      return;
    }

    // An id that IS derivable from the requester (passes the crux) but is already
    // recorded in our attestation index under a different account.
    const claimedContentHash = keccak256(stringToHex(`${TEST_PREFIX}claimed-audio`)) as Hex;
    const claimedMetadataURI = `resonate://release/${TEST_PREFIX}claimed-release`;
    const claimedReleaseId = computeReleaseTokenId(
      attester.address,
      claimedContentHash,
      claimedMetadataURI,
    );
    await prisma.contentAttestation.create({
      data: {
        tokenId: claimedReleaseId.toString(),
        chainId: ANVIL_CHAIN_ID,
        attesterAddress: stranger.address.toLowerCase(),
        contentHash: claimedContentHash,
        fingerprintHash: claimedContentHash,
        metadataURI: claimedMetadataURI,
        transactionHash: `0x${"1".repeat(64)}`,
        blockNumber: 1n,
      },
    });

    await expect(
      service.createVoucher(userId, {
        releaseId: claimedReleaseId.toString(),
        attester: attester.address,
        contentHash: claimedContentHash,
        metadataURI: claimedMetadataURI,
        chainId: ANVIL_CHAIN_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
