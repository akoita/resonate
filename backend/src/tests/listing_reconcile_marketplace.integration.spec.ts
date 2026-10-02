/**
 * ContractsService.reconcileListings — marketplace scoping (integration)
 *
 * A StemListing row carries the contractAddress of the marketplace that emitted
 * its Listed log. Startup reconciliation reads listings from the ONE configured
 * marketplace, so it must only judge rows on that contract; a row on another
 * marketplace reads as empty there and must not be marked sold.
 *
 * Runs against the real Testcontainer Postgres. The on-chain read is injected,
 * so no chain is needed.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import type { ContractsService as ContractsServiceType } from '../modules/contracts/contracts.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `lrm_${Date.now()}_`;
const CHAIN_ID = 31337;
const CONFIGURED_MARKETPLACE = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const OTHER_MARKETPLACE = '0x1111111111111111111111111111111111111111';
const EMPTY_LISTING = {
  seller: '0x0000000000000000000000000000000000000000',
  amount: 0n,
  expiry: 0,
};

describe('ContractsService.reconcileListings marketplace scoping (integration)', () => {
  let service: ContractsServiceType;
  let savedChainId: string | undefined;
  let savedMarketplace: string | undefined;

  beforeAll(async () => {
    savedChainId = process.env.INDEXER_CHAIN_ID;
    savedMarketplace = process.env.MARKETPLACE_ADDRESS;
    process.env.INDEXER_CHAIN_ID = String(CHAIN_ID);
    // Mixed case here; the seeded row stores it lowercase to prove a case-insensitive match.
    process.env.MARKETPLACE_ADDRESS = CONFIGURED_MARKETPLACE;

    // MARKETPLACE_ADDRESSES is computed at module load, so load after setting env.
    jest.isolateModules(() => {
      const { ContractsService } = require('../modules/contracts/contracts.service');
      service = new ContractsService(new EventBus(), {} as any);
    });

    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'Reconcile Test Artist',
        payoutAddress: '0x' + 'D'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        title: 'Reconcile Test Release',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        title: 'Reconcile Track',
        releaseId: `${TEST_PREFIX}release`,
        position: 1,
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}stem`,
        trackId: `${TEST_PREFIX}track`,
        type: 'vocals',
        uri: '/lrm.mp3',
      },
    });

    const base = {
      stemId: `${TEST_PREFIX}stem`,
      tokenId: 7n,
      chainId: CHAIN_ID,
      sellerAddress: '0x' + 'D'.repeat(40),
      pricePerUnit: '1000000',
      amount: 5n,
      paymentToken: '0x0000000000000000000000000000000000000000',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      blockNumber: 100n,
      status: 'active',
      listedAt: new Date(),
    };
    await prisma.stemListing.create({
      data: {
        ...base,
        listingId: 910001n,
        contractAddress: CONFIGURED_MARKETPLACE.toLowerCase(),
        transactionHash: `0x${TEST_PREFIX}configured`,
      },
    });
    await prisma.stemListing.create({
      data: {
        ...base,
        listingId: 910002n,
        contractAddress: OTHER_MARKETPLACE,
        transactionHash: `0x${TEST_PREFIX}other`,
      },
    });
  });

  afterAll(async () => {
    // Clean up in reverse FK order
    await prisma.stemListing.deleteMany({ where: { stemId: `${TEST_PREFIX}stem` } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});

    if (savedChainId === undefined) delete process.env.INDEXER_CHAIN_ID;
    else process.env.INDEXER_CHAIN_ID = savedChainId;
    if (savedMarketplace === undefined) delete process.env.MARKETPLACE_ADDRESS;
    else process.env.MARKETPLACE_ADDRESS = savedMarketplace;
  });

  it('marks only configured-marketplace listings sold and leaves other-marketplace rows active', async () => {
    const reads: bigint[] = [];
    await service.reconcileListings(async (listingId: bigint) => {
      reads.push(listingId);
      return EMPTY_LISTING;
    });

    const configured = await prisma.stemListing.findFirstOrThrow({
      where: { transactionHash: `0x${TEST_PREFIX}configured` },
    });
    const other = await prisma.stemListing.findFirstOrThrow({
      where: { transactionHash: `0x${TEST_PREFIX}other` },
    });

    expect(configured.status).toBe('sold');
    expect(configured.amount).toBe(0n);
    expect(other.status).toBe('active');
    expect(other.amount).toBe(5n);
    // The other marketplace's listing id was never looked up on the configured contract.
    expect(reads).not.toContain(910002n);
  });
});
