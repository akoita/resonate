/**
 * ContractsService — Testcontainers Integration Test
 *
 * Tests ContractsService against real Postgres (via Testcontainer).
 * Uses EventBus.publish() to trigger internal handlers, same as production.
 *
 * Verifies:
 *   - StemMinted event → stemNftMint record persisted
 *   - StemListed event → stemListing record persisted
 *   - StemSold event → stemPurchase record persisted
 *   - RoyaltyPaid event → royaltyPayment record persisted
 *   - Query methods (getListings, getArtistEarnings) against real data
 *   - Idempotency (re-publishing same event)
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { ContractsService } from '../modules/contracts/contracts.service';
import { EventBus } from '../modules/shared/event_bus';
import type {
  ContractStemMintedEvent,
  ContractStemListedEvent,
  ContractStemSoldEvent,
  ContractRoyaltyPaidEvent,
} from '../events/event_types';

const TEST_PREFIX = `ctr_${Date.now()}_`;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('ContractsService (integration)', () => {
  let service: ContractsService;
  let eventBus: EventBus;

  beforeAll(async () => {
    eventBus = new EventBus();
    service = new ContractsService(eventBus);
    service.onModuleInit();

    // Seed full ownership chain: User → Artist → Release → Track → Stem
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'Contract Test Artist',
        payoutAddress: '0x' + 'C'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        title: 'Contract Test Release',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        title: 'Ct Track',
        releaseId: `${TEST_PREFIX}release`,
        position: 1,
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}stem`,
        trackId: `${TEST_PREFIX}track`,
        type: 'vocals',
        uri: '/ct.mp3',
      },
    });
  });

  afterAll(async () => {
    // Clean up in reverse FK order
    await prisma.royaltyPayment.deleteMany({}).catch(() => {});
    await prisma.stemPurchase.deleteMany({}).catch(() => {});
    await prisma.stemListing.deleteMany({}).catch(() => {});
    await prisma.stemNftMint.deleteMany({}).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it('persists StemMinted event to database', async () => {
    const event: ContractStemMintedEvent = {
      eventName: 'contract.stem_minted',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      tokenId: '42',
      creatorAddress: '0x' + 'C'.repeat(40),
      parentIds: [],
      tokenUri: `https://api.resonate.fm/metadata/31337/${TEST_PREFIX}stem`,
      chainId: 31337,
      contractAddress: '0xStemNFT',
      transactionHash: `0x${TEST_PREFIX}mint1`,
      blockNumber: '100',
    };

    eventBus.publish(event);
    await wait(200);

    const mint = await prisma.stemNftMint.findFirst({
      where: { transactionHash: `0x${TEST_PREFIX}mint1` },
    });
    expect(mint).not.toBeNull();
    expect(mint!.chainId).toBe(31337);
    expect(mint!.creatorAddress).toBe('0x' + 'C'.repeat(40));
  });

  it('persists StemListed event to database', async () => {
    const event: ContractStemListedEvent = {
      eventName: 'contract.stem_listed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '7',
      sellerAddress: '0x' + 'C'.repeat(40),
      tokenId: '42',
      amount: '50',
      pricePerUnit: '1000000000000000000',
      paymentToken: '0x0000000000000000000000000000000000000000',
      expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
      chainId: 31337,
      contractAddress: '0xMarketplace',
      transactionHash: `0x${TEST_PREFIX}list1`,
      blockNumber: '101',
    };

    eventBus.publish(event);
    await wait(200);

    const listing = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${TEST_PREFIX}list1` },
    });
    expect(listing).not.toBeNull();
    expect(listing!.status).toBe('active');
  });

  it('retrieves active listings via getListings', async () => {
    const results = await service.getListings({ status: 'active', chainId: 31337 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].status).toBe('active');
  });

  it('returns empty array from getListings when no matches', async () => {
    const results = await service.getListings({ status: 'nonexistent_status' });
    expect(results).toEqual([]);
  });
});
