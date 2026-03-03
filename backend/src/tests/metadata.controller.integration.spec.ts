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
import { NotFoundException } from '@nestjs/common';

const TEST_PREFIX = `meta_${Date.now()}_`;

describe('MetadataController (integration)', () => {
  let controller: MetadataController;
  let contractsService: ContractsService;
  let stemId: string;

  beforeAll(async () => {
    // Seed: User → Artist → Release → Track → Stem → StemNftMint
    await prisma.user.create({ data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, userId: `${TEST_PREFIX}user`, displayName: 'Meta Artist', payoutAddress: '0x' + 'M'.repeat(40) },
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
  });

  afterAll(async () => {
    await prisma.stemNftMint.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
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

  // ===== getTokenMetadata =====

  describe('getTokenMetadata', () => {
    it('throws NotFoundException when token not found', async () => {
      await expect(controller.getTokenMetadata('31337', '999')).rejects.toThrow(NotFoundException);
    });
  });
});
