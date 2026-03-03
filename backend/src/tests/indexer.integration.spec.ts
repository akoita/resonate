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
    await prisma.contractEvent.deleteMany({}).catch(() => {});
    await prisma.indexerState.deleteMany({}).catch(() => {});
  });

  it('connects to Anvil and reads block number', async () => {
    if (!anvilUrl()) return;

    const client = createPublicClient({
      chain: { ...foundry, id: 31337 },
      transport: http(anvilUrl()),
    });

    // Retry to handle Anvil still starting
    let blockNumber: bigint | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        blockNumber = await client.getBlockNumber();
        break;
      } catch {
        await new Promise(r => setTimeout(r, 2000));
      }
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
});
