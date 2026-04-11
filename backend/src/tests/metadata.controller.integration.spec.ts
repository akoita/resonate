// @ts-nocheck - Prisma strict types conflict with null values for fallback testing
/**
 * Metadata Controller — Integration Test (Testcontainers)
 *
 * Tests MetadataController response formatting against real Postgres
 * for stemNftMint queries. Uses real ContractsService (all query methods
 * hit real Postgres).
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { MetadataController } from '../modules/contracts/metadata.controller';
import { ContractsService } from '../modules/contracts/contracts.service';
import { EventBus } from '../modules/shared/event_bus';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const TEST_PREFIX = `meta_${Date.now()}_`;

describe('MetadataController (integration)', () => {
  let controller: MetadataController;
  let contractsService: ContractsService;
  let stemId: string;
  let typedDisputeId: string | null = null;
  const creatorWalletAddress = ("0x" + "1".repeat(40)).toLowerCase();
  const payoutOnlyAddress = ("0x" + "2".repeat(40)).toLowerCase();

  beforeAll(async () => {
    // Seed: User → Artist → Release → Track → Stem → StemNftMint
    await prisma.user.create({
      data: { id: creatorWalletAddress, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: creatorWalletAddress,
        displayName: 'Meta Artist',
        payoutAddress: payoutOnlyAddress,
      },
    });
    await prisma.release.create({
      data: { id: `${TEST_PREFIX}release`, title: 'Meta Release', artistId: `${TEST_PREFIX}artist`, status: 'published' },
    });
    await prisma.track.create({
      data: { id: `${TEST_PREFIX}track`, title: 'Meta Track', releaseId: `${TEST_PREFIX}release`, position: 1 },
    });
    const stem = await prisma.stem.create({
      data: { trackId: `${TEST_PREFIX}track`, type: 'vocals', uri: '/meta/vocals.mp3' },
    });
    stemId = stem.id;

    await prisma.stemNftMint.create({
      data: {
        stemId,
        tokenId: 42n,
        chainId: 31337,
        contractAddress: '0xStemNFT',
        creatorAddress: '0xCreator',
        royaltyBps: 500,
        remixable: true,
        metadataUri: 'ipfs://QmTest',
        transactionHash: '0x' + 'a'.repeat(64),
        blockNumber: 100n,
        mintedAt: new Date(),
      },
    });

    // Real ContractsService — all query methods use real Postgres
    const eventBus = new EventBus();
    contractsService = new ContractsService(eventBus as any);
    controller = new MetadataController(contractsService);

    await prisma.curatorReputation.create({
      data: {
        walletAddress: creatorWalletAddress,
        verifiedHuman: true,
        humanVerificationProvider: "mock",
        humanVerificationStatus: "verified",
        humanVerifiedAt: new Date("2026-04-09T19:51:38.721Z"),
      },
    });

    await prisma.contentAttestation.create({
      data: {
        tokenId: `${TEST_PREFIX}token`,
        chainId: 11155111,
        attesterAddress: creatorWalletAddress,
        contentHash: "0x" + "a".repeat(64),
        fingerprintHash: "0x" + "b".repeat(64),
        metadataURI: "resonate://release/meta-release",
        transactionHash: "0x" + "c".repeat(64),
        blockNumber: 101n,
        attestedAt: new Date("2026-04-09T20:00:00.000Z"),
      },
    });

    await prisma.contentProtectionStake.create({
      data: {
        tokenId: `${TEST_PREFIX}token`,
        chainId: 11155111,
        stakerAddress: creatorWalletAddress,
        amount: "10000000000000000",
        active: true,
        depositedAt: new Date("2026-04-09T20:00:00.000Z"),
        transactionHash: "0x" + "d".repeat(64),
        blockNumber: 102n,
      },
    });
  });

  afterAll(async () => {
    await prisma.contentProtectionStake.deleteMany({ where: { tokenId: `${TEST_PREFIX}token` } }).catch(() => {});
    await prisma.contentAttestation.deleteMany({ where: { tokenId: `${TEST_PREFIX}token` } }).catch(() => {});
    await prisma.rightsEvidence.deleteMany({
      where: {
        OR: [
          { subjectId: `${TEST_PREFIX}release` },
          ...(typedDisputeId ? [{ subjectId: typedDisputeId }] : []),
        ],
      },
    }).catch(() => {});
    await prisma.rightsEvidenceBundle.deleteMany({
      where: {
        OR: [
          { subjectId: `${TEST_PREFIX}release` },
          ...(typedDisputeId ? [{ subjectId: typedDisputeId }] : []),
        ],
      },
    }).catch(() => {});
    await prisma.dispute.deleteMany({ where: { tokenId: `${TEST_PREFIX}typed-token` } }).catch(() => {});
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: creatorWalletAddress } }).catch(() => {});
    await prisma.stemNftMint.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: creatorWalletAddress } }).catch(() => {});
  });


  // ===== getStemNftInfo — uses real Prisma =====

  describe('getStemNftInfo', () => {
    it('returns null when stem has no NFT mint', async () => {
      const result = await controller.getStemNftInfo('nonexistent');
      expect(result).toBeNull();
    });

    it('returns formatted NFT info from real DB', async () => {
      const result = await controller.getStemNftInfo(stemId);
      expect(result).not.toBeNull();
      expect(result!.tokenId).toBe('42');
      expect(result!.chainId).toBe(31337);
      expect(result!.contractAddress).toBe('0xStemNFT');
      expect(result!.creator).toBe('0xCreator');
    });
  });

  // ===== getCollection =====

  describe('getCollection', () => {
    it('returns empty collection for wallet with no stems', async () => {
      const result = await controller.getCollection('0xEmpty');
      expect(result.total).toBe(0);
      expect(result.stems).toEqual([]);
    });
  });

  // ===== getListings =====

  describe('getListings', () => {
    it('returns empty listings when none are seeded', async () => {
      const result = await controller.getListings();
      expect(result.listings).toBeDefined();
      expect(result.listings.length).toBe(0);
      expect(result.total).toBe(0);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });
  });

  // ===== getListingById =====

  describe('getListingById', () => {
    it('throws NotFoundException when listing not found', async () => {
      await expect(controller.getListingById('31337', '999')).rejects.toThrow(NotFoundException);
    });
  });

  // ===== getEarnings =====

  describe('getEarnings', () => {
    it('returns zero ETH for no earnings', async () => {
      const result = await controller.getEarnings('0xNobody');
      expect(result.totalEth).toBe('0');
      expect(result.totalPayments).toBe(0);
    });
  });

  // ===== getContractMetadata =====

  describe('getContractMetadata', () => {
    it('returns collection-level metadata', async () => {
      const result = await controller.getContractMetadata('31337');
      expect(result.name).toBe('Resonate Stems');
      expect(result.description).toContain('Audio stem NFTs');
      expect(result.seller_fee_basis_points).toBe(500);
    });
  });

  describe('getContentProtectionByRelease', () => {
    it('uses the creator wallet identity instead of payout address for human verification and protection records', async () => {
      const result = await contractsService.getContentProtectionByRelease(`${TEST_PREFIX}release`);
      expect(result).not.toBeNull();
      expect(result!.humanVerificationStatus).toBe('human_verified');
      expect(result!.humanVerifiedAt).toBe('2026-04-09T19:51:38.721Z');
      expect(result!.attested).toBe(true);
      expect(result!.staked).toBe(true);
      expect(result!.stakeAmount).toBe('10000000000000000');
    });
  });

  describe('typed rights evidence', () => {
    it('creates an evidence bundle for a release before a formal dispute exists', async () => {
      const bundle = await controller.createEvidenceBundle(
        {
          user: {
            userId: creatorWalletAddress,
            role: 'admin',
          },
        },
        {
          subjectType: 'release',
          subjectId: `${TEST_PREFIX}release`,
          submittedByRole: 'ops',
          submittedByAddress: creatorWalletAddress,
          purpose: 'upload_review',
          summary: 'Ops review packet for upload screening.',
          evidences: [
            {
              kind: 'internal_review_note',
              title: 'Initial review note',
              description: 'Flagged for manual rights follow-up.',
            },
          ],
        },
      );

      expect(bundle.subjectType).toBe('release');
      expect(bundle.subjectId).toBe(`${TEST_PREFIX}release`);
      expect(bundle.evidences).toHaveLength(1);
      expect(bundle.evidences[0].kind).toBe('internal_review_note');
    });

    it('rejects privileged evidence roles from non-admin callers', async () => {
      await expect(
        controller.createEvidenceBundle(
          {
            user: {
              userId: creatorWalletAddress,
              role: 'listener',
            },
          },
          {
            subjectType: 'release',
            subjectId: `${TEST_PREFIX}release`,
            submittedByRole: 'ops',
            submittedByAddress: creatorWalletAddress,
            purpose: 'upload_review',
            evidences: [
              {
                kind: 'internal_review_note',
                title: 'Unauthorized reviewer note',
                description: 'This should be rejected.',
              },
            ],
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('files a dispute with typed evidence and returns hydrated evidence records', async () => {
      const dispute = await controller.fileDispute({
        tokenId: `${TEST_PREFIX}typed-token`,
        reporterAddr: creatorWalletAddress,
        counterStake: '0',
        narrativeSummary: 'The reporter published and controls the original release first.',
        primaryEvidence: {
          kind: 'prior_publication',
          title: 'Canonical release page',
          sourceUrl: 'https://example.com/releases/original',
          claimedRightsholder: 'Meta Artist',
          strength: 'high',
        },
      });

      expect(dispute).not.toBeNull();
      typedDisputeId = dispute.id;
      expect(dispute.tokenId).toBe(`${TEST_PREFIX}typed-token`);
      expect(dispute.evidenceURI).toBe('https://example.com/releases/original');
      expect(dispute.evidences).toHaveLength(2);
      expect(dispute.evidences[0].kind).toBe('prior_publication');
      expect(dispute.evidences[0].title).toBe('Canonical release page');
      expect(dispute.evidences[1].kind).toBe('narrative_statement');

      const persistedEvidence = await prisma.rightsEvidence.findMany({
        where: {
          subjectType: 'dispute',
          subjectId: dispute.id,
        },
        orderBy: { createdAt: 'asc' },
      });

      expect(persistedEvidence).toHaveLength(2);
      expect(persistedEvidence[0].claimedRightsholder).toBe('Meta Artist');
    });
  });

  // ===== getTokenMetadata =====

  describe('getTokenMetadata', () => {
    it('throws NotFoundException when token not found', async () => {
      await expect(controller.getTokenMetadata('31337', '999')).rejects.toThrow(NotFoundException);
    });
  });
});
