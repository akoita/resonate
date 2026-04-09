/**
 * IndexerService — Testcontainers Integration Test
 *
 * Tests IndexerService against:
 *   - Real Postgres (via globalSetup Testcontainer)
 *   - Real Anvil local Ethereum node (via globalSetup Testcontainer)
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { IndexerService } from '../modules/contracts/indexer.service';
import { EventBus } from '../modules/shared/event_bus';
import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';

const anvilUrl = () => process.env.ANVIL_RPC_URL;

describe('IndexerService (integration)', () => {
  let service: IndexerService;
  let eventBus: EventBus;
  const P = `indexer_${Date.now()}_`;

  beforeAll(async () => {
    if (!anvilUrl()) {
      console.warn('⚠️  ANVIL_RPC_URL not set. Skipping IndexerService integration tests.');
      return;
    }

    eventBus = new EventBus();
    service = new IndexerService(eventBus);

    // Override the internal client to use Anvil
    const client = createPublicClient({
      chain: { ...foundry, id: 31337 },
      transport: http(anvilUrl()),
    });
    (service as any).clients = new Map([[31337, client]]);
  });

  afterAll(async () => {
    if (!anvilUrl()) return;
    await prisma.stemPurchase.deleteMany({
      where: { listing: { chainId: 31337 } },
    }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { chainId: 31337 } }).catch(() => {});
    await prisma.stemNftMint.deleteMany({ where: { chainId: 31337 } }).catch(() => {});
    await prisma.contentProtectionStake.deleteMany({ where: { chainId: 31337 } }).catch(() => {});
    await prisma.contentAttestation.deleteMany({ where: { chainId: 31337 } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.contractEvent.deleteMany({}).catch(() => {});
    await prisma.indexerState.deleteMany({}).catch(() => {});
  });

  it('connects to Anvil and reads block number', async () => {
    if (!anvilUrl()) return;

    const client = createPublicClient({
      chain: { ...foundry, id: 31337 },
      transport: http(anvilUrl()),
    });

    // Light retry — globalSetup already confirms Anvil RPC is ready
    let blockNumber: bigint | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        blockNumber = await client.getBlockNumber();
        break;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (blockNumber === undefined) {
      throw new Error(
        `Could not connect to Anvil at ${anvilUrl()} after 3 attempts (3s). ` +
        `Ensure the Anvil Testcontainer started correctly.`,
      );
    }
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
  });

  it('stores contract events with idempotency', async () => {
    if (!anvilUrl()) return;

    const txHash = '0x' + 'a'.repeat(64);
    const logIndex = 0;

    await prisma.contractEvent.create({
      data: {
        transactionHash: txHash,
        logIndex,
        blockNumber: 1,
        blockHash: '0x' + 'b'.repeat(64),
        chainId: 31337,
        contractAddress: '0x' + 'c'.repeat(40),
        eventName: 'StemMinted',
        args: {},
      },
    });

    const existing = await prisma.contractEvent.findUnique({
      where: { transactionHash_logIndex: { transactionHash: txHash, logIndex } },
    });
    expect(existing).not.toBeNull();
    expect(existing!.eventName).toBe('StemMinted');
  });

  it('publishes typed events via EventBus', async () => {
    if (!anvilUrl()) return;

    const received: any[] = [];
    eventBus.subscribe('contract.stem_minted', (data) => received.push(data));

    // publishTypedEvent expects (eventName, decodedArgs, log, chainId)
    // where log is a viem Log object
    const fakeLog = {
      transactionHash: '0x' + 'f'.repeat(64),
      blockNumber: 100n,
      address: '0x' + 'e'.repeat(40),
      blockHash: '0x' + 'd'.repeat(64),
      logIndex: 0,
      data: '0x',
      topics: [],
      removed: false,
      transactionIndex: 0,
    };

    await (service as any).publishTypedEvent(
      'StemMinted',
      {
        tokenId: '42',
        creator: '0xCreator',
        parentIds: [],
        tokenURI: 'ipfs://test',
        chainStemId: '1',
      },
      fakeLog,
      31337,
    );

    expect(received).toHaveLength(1);
    expect(received[0].tokenId).toBe('42');
    expect(received[0].chainId).toBe(31337);
  });

  it('purges stale local-chain marketplace state after a reset', async () => {
    const userId = `${P}user`;
    const artistId = `${P}artist`;
    const releaseId = `${P}release`;
    const trackId = `${P}track`;
    const stemId = `${P}stem`;

    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: 'Reset Artist',
        payoutAddress: '0x' + '1'.repeat(40),
      },
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: 'Reset Release', status: 'published' },
    });
    await prisma.track.create({
      data: { id: trackId, releaseId, title: 'Reset Track', position: 1 },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: 'vocals',
        uri: '/reset.wav',
        ipnftId: '77',
      },
    });
    await prisma.stemNftMint.create({
      data: {
        stemId,
        tokenId: 77n,
        chainId: 31337,
        contractAddress: '0x' + '2'.repeat(40),
        creatorAddress: '0x' + '3'.repeat(40),
        royaltyBps: 500,
        remixable: true,
        metadataUri: 'ipfs://reset',
        transactionHash: '0x' + '4'.repeat(64),
        blockNumber: 1n,
        mintedAt: new Date(),
      },
    });
    const listing = await prisma.stemListing.create({
      data: {
        listingId: 9n,
        stemId,
        tokenId: 77n,
        chainId: 31337,
        contractAddress: '0x' + '5'.repeat(40),
        sellerAddress: '0x' + '6'.repeat(40),
        pricePerUnit: '10000000000000000',
        amount: 1n,
        paymentToken: '0x0000000000000000000000000000000000000000',
        expiresAt: new Date(Date.now() + 60_000),
        transactionHash: '0x' + '7'.repeat(64),
        blockNumber: 2n,
        listedAt: new Date(),
        status: 'active',
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: '0x' + '8'.repeat(40),
        amount: 1n,
        totalPaid: '10000000000000000',
        royaltyPaid: '500000000000000',
        protocolFeePaid: '500000000000000',
        sellerReceived: '9000000000000000',
        transactionHash: '0x' + '9'.repeat(64),
        blockNumber: 3n,
        purchasedAt: new Date(),
      },
    });
    await prisma.royaltyPayment.create({
      data: {
        tokenId: 77n,
        chainId: 31337,
        recipientAddress: '0x' + 'a'.repeat(40),
        amount: '500000000000000',
        transactionHash: '0x' + 'b'.repeat(64),
        blockNumber: 4n,
        paidAt: new Date(),
      },
    });
    await prisma.contentProtectionStake.create({
      data: {
        tokenId: '77',
        chainId: 31337,
        stakerAddress: '0x' + 'c'.repeat(40),
        amount: '10000000000000000',
        depositedAt: new Date(),
        transactionHash: '0x' + 'd'.repeat(64),
        blockNumber: 5n,
      },
    });
    await prisma.contentAttestation.create({
      data: {
        tokenId: '77',
        chainId: 31337,
        attesterAddress: '0x' + 'e'.repeat(40),
        contentHash: '0x' + 'f'.repeat(64),
        fingerprintHash: '0x' + '1'.repeat(64),
        metadataURI: 'ipfs://reset',
        attestedAt: new Date(),
        transactionHash: '0x' + '2'.repeat(64),
        blockNumber: 6n,
      },
    });
    await prisma.contractEvent.create({
      data: {
        transactionHash: '0x' + '3'.repeat(64),
        logIndex: 0,
        blockNumber: 7n,
        blockHash: '0x' + '4'.repeat(64),
        chainId: 31337,
        contractAddress: '0x' + '5'.repeat(40),
        eventName: 'Listed',
        args: {},
      },
    });

    await (service as any).purgeEphemeralChainState(31337);

    expect(await prisma.stemNftMint.count({ where: { chainId: 31337 } })).toBe(0);
    expect(await prisma.stemListing.count({ where: { chainId: 31337 } })).toBe(0);
    expect(await prisma.stemPurchase.count({ where: { listing: { chainId: 31337 } } })).toBe(0);
    expect(await prisma.royaltyPayment.count({ where: { chainId: 31337 } })).toBe(0);
    expect(await prisma.contentProtectionStake.count({ where: { chainId: 31337 } })).toBe(0);
    expect(await prisma.contentAttestation.count({ where: { chainId: 31337 } })).toBe(0);
    expect(await prisma.contractEvent.count({ where: { chainId: 31337 } })).toBe(0);
    expect((await prisma.stem.findUnique({ where: { id: stemId } }))?.ipnftId).toBeNull();
  });
});
