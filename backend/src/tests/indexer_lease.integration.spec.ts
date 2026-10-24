/**
 * Contract indexer distributed lease (#2360) - Testcontainers integration test.
 *
 * Real Postgres; the chain RPC is a scripted client. Mirrors the Shows escrow
 * indexer lease tests (#1567): exactly one of several pollers indexes a range,
 * a crashed holder is replaced after expiry, and a stale holder's writes are
 * fenced by the lease epoch.
 */

// IndexerService reads contract addresses from the environment at import time,
// so configure them before the service module is loaded.
const STEM_NFT = `0x${"1".repeat(40)}`;
process.env.STEM_NFT_ADDRESS = STEM_NFT;
process.env.MARKETPLACE_ADDRESS = `0x${"2".repeat(40)}`;
process.env.CONTENT_PROTECTION_ADDRESS = `0x${"3".repeat(40)}`;
process.env.DISPUTE_RESOLUTION_ADDRESS = `0x${"4".repeat(40)}`;
process.env.CURATION_REWARDS_ADDRESS = `0x${"5".repeat(40)}`;

import { prisma } from "../db/prisma";
import { IndexerService } from "../modules/contracts/indexer.service";
import { EventBus } from "../modules/shared/event_bus";

// A chain id no other spec uses, so this file can run beside the others.
const CHAIN_ID = 84532;
const TX_PREFIX = "0xa1ea5e";

function buildLog(seed: number) {
  const transactionHash = `${TX_PREFIX}${seed.toString(16).padStart(58, "0")}`;
  return {
    address: STEM_NFT,
    topics: [`0x${"d".repeat(64)}`],
    data: "0x",
    blockNumber: 1000n,
    blockHash: `0x${"b".repeat(64)}`,
    transactionHash,
    logIndex: 0,
  };
}

function scriptedClient(options: {
  currentBlock: bigint;
  logs?: unknown[];
  onGetLogs?: () => Promise<void> | void;
}) {
  const getLogs = jest.fn(async (args: { address: string }) => {
    await options.onGetLogs?.();
    return args.address === STEM_NFT ? (options.logs ?? []) : [];
  });
  return {
    getLogs,
    getBlockNumber: jest.fn().mockResolvedValue(options.currentBlock),
  };
}

describe("IndexerService lease (integration)", () => {
  const services: IndexerService[] = [];
  let previousChainId: string | undefined;

  function makeService(client: ReturnType<typeof scriptedClient>) {
    const service = new IndexerService(new EventBus());
    (service as any).clientCache.set(CHAIN_ID, client);
    services.push(service);
    return service;
  }

  async function seedCursor(lastBlockNumber: bigint) {
    await prisma.indexerState.deleteMany({ where: { chainId: CHAIN_ID } });
    return prisma.indexerState.create({
      data: { chainId: CHAIN_ID, lastBlockNumber },
    });
  }

  const readState = () =>
    prisma.indexerState.findUniqueOrThrow({ where: { chainId: CHAIN_ID } });

  async function cleanup() {
    await prisma.contractEvent.deleteMany({
      where: { transactionHash: { startsWith: TX_PREFIX } },
    });
    await prisma.indexerState.deleteMany({ where: { chainId: CHAIN_ID } });
  }

  beforeAll(() => {
    previousChainId = process.env.INDEXER_CHAIN_ID;
    process.env.INDEXER_CHAIN_ID = String(CHAIN_ID);
  });

  afterEach(async () => {
    await Promise.all(services.splice(0).map((s) => s.onModuleDestroy()));
    await cleanup();
  });

  afterAll(() => {
    if (previousChainId === undefined) delete process.env.INDEXER_CHAIN_ID;
    else process.env.INDEXER_CHAIN_ID = previousChainId;
  });

  it("lets exactly one of two parallel pollers index a range", async () => {
    await seedCursor(999n);
    const log = buildLog(1);
    const clientA = scriptedClient({ currentBlock: 1000n, logs: [log] });
    const clientB = scriptedClient({ currentBlock: 1000n, logs: [log] });
    const first = makeService(clientA);
    const second = makeService(clientB);

    await Promise.all([
      (first as any).runIndexCycle(),
      (second as any).runIndexCycle(),
    ]);

    // One batch covers the five watched contracts, fetched by one process only.
    expect(clientA.getLogs.mock.calls.length + clientB.getLogs.mock.calls.length).toBe(5);
    expect(
      await prisma.contractEvent.count({ where: { transactionHash: log.transactionHash } }),
    ).toBe(1);
    const state = await readState();
    expect(state.lastBlockNumber).toBe(1000n);
    expect(state.leaseEpoch).toBe(1n);
    expect(state.leaseOwnerId).not.toBeNull();
  });

  it("creates the first cursor row once when two pollers start together", async () => {
    await prisma.indexerState.deleteMany({ where: { chainId: CHAIN_ID } });
    const clientA = scriptedClient({ currentBlock: 500n });
    const clientB = scriptedClient({ currentBlock: 500n });
    const first = makeService(clientA);
    const second = makeService(clientB);

    await Promise.all([
      (first as any).runIndexCycle(),
      (second as any).runIndexCycle(),
    ]);

    expect(await prisma.indexerState.count({ where: { chainId: CHAIN_ID } })).toBe(1);
    expect((await readState()).lastBlockNumber).toBe(500n);
    expect(clientA.getLogs.mock.calls.length + clientB.getLogs.mock.calls.length).toBe(5);
  });

  it("skips the cycle while another live holder owns the chain", async () => {
    await seedCursor(999n);
    await prisma.indexerState.update({
      where: { chainId: CHAIN_ID },
      data: {
        leaseOwnerId: "other-process",
        leaseEpoch: 4n,
        leaseExpiresAt: new Date(Date.now() + 300_000),
        leaseHeartbeatAt: new Date(),
      },
    });
    const client = scriptedClient({ currentBlock: 1000n });
    const service = makeService(client);

    await (service as any).runIndexCycle();

    expect(client.getLogs).not.toHaveBeenCalled();
    const state = await readState();
    expect(state.lastBlockNumber).toBe(999n);
    expect(state.leaseOwnerId).toBe("other-process");
    expect(state.leaseEpoch).toBe(4n);
  });

  it("takes over an expired holder, logs the takeover and fences the stale epoch", async () => {
    const seeded = await seedCursor(999n);
    const oldHolder = makeService(scriptedClient({ currentBlock: 1000n }));
    const successor = makeService(scriptedClient({ currentBlock: 1000n }));
    const oldLease = await (oldHolder as any).acquireLease(seeded.id, CHAIN_ID);
    expect(oldLease.epoch).toBe(1n);
    await prisma.indexerState.update({
      where: { id: seeded.id },
      data: { leaseExpiresAt: new Date(0) },
    });

    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    let lines: string[] = [];
    let newLease: { epoch: bigint };
    try {
      newLease = await (successor as any).acquireLease(seeded.id, CHAIN_ID);
      await expect((oldHolder as any).fenceCursor(oldLease, 1000n)).rejects.toThrow(
        "lease lost",
      );
      lines = [infoSpy, warnSpy, errorSpy].flatMap((spy) =>
        spy.mock.calls.map((call) => String(call[0])),
      );
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(newLease.epoch).toBe(2n);
    expect(
      lines.some((line) => line.includes('"event":"contract_indexer.lease_takeover"')),
    ).toBe(true);
    expect(
      lines.some((line) => line.includes('"event":"contract_indexer.lease_lost"')),
    ).toBe(true);
    // The stale cursor write moved nothing.
    expect((await readState()).lastBlockNumber).toBe(999n);

    // The successor continues from the unchanged cursor.
    const client = scriptedClient({ currentBlock: 1001n });
    (successor as any).clientCache.set(CHAIN_ID, client);
    await (successor as any).runIndexCycle();
    expect(client.getLogs.mock.calls[0][0]).toMatchObject({
      fromBlock: 1000n,
      toBlock: 1001n,
    });
    expect((await readState()).lastBlockNumber).toBe(1001n);
  });

  it("fences a stale holder's event write so nothing is recorded or published", async () => {
    const seeded = await seedCursor(999n);
    const oldHolder = makeService(scriptedClient({ currentBlock: 1000n }));
    const successor = makeService(scriptedClient({ currentBlock: 1000n }));
    const oldLease = await (oldHolder as any).acquireLease(seeded.id, CHAIN_ID);
    await prisma.indexerState.update({
      where: { id: seeded.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await (successor as any).acquireLease(seeded.id, CHAIN_ID);

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const publishSpy = jest.spyOn((oldHolder as any).eventBus, "publish");
    const staleLog = buildLog(2);
    try {
      await expect(
        (oldHolder as any).processLog(staleLog, CHAIN_ID, { lease: oldLease }),
      ).rejects.toThrow("lease lost");
    } finally {
      errorSpy.mockRestore();
    }

    expect(publishSpy).not.toHaveBeenCalled();
    expect(
      await prisma.contractEvent.count({ where: { transactionHash: staleLog.transactionHash } }),
    ).toBe(0);
  });

  it("abandons a batch whose lease is taken over mid-fetch without advancing the cursor", async () => {
    const seeded = await seedCursor(999n);
    const log = buildLog(3);
    let successor!: IndexerService;
    let stolen = false;
    const slowClient = scriptedClient({
      currentBlock: 1000n,
      logs: [log],
      onGetLogs: async () => {
        if (stolen) return;
        stolen = true;
        // The RPC call outlives the lease and another process takes over.
        await prisma.indexerState.update({
          where: { id: seeded.id },
          data: { leaseExpiresAt: new Date(0) },
        });
        await (successor as any).acquireLease(seeded.id, CHAIN_ID);
      },
    });
    const slow = makeService(slowClient);
    successor = makeService(scriptedClient({ currentBlock: 1000n }));

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await (slow as any).runIndexCycle();
    } finally {
      errorSpy.mockRestore();
    }

    const state = await readState();
    expect(state.lastBlockNumber).toBe(999n);
    expect(state.leaseEpoch).toBe(2n);
    expect(
      await prisma.contractEvent.count({ where: { transactionHash: log.transactionHash } }),
    ).toBe(0);
  });

  it("fences an in-flight poller when the cursor is reset by an operator", async () => {
    const seeded = await seedCursor(999n);
    const service = makeService(scriptedClient({ currentBlock: 1000n }));
    const lease = await (service as any).acquireLease(seeded.id, CHAIN_ID);

    await service.resetIndexer(CHAIN_ID, 500n);

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect((service as any).fenceCursor(lease, 1000n)).rejects.toThrow(
        "lease lost",
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect((await readState()).lastBlockNumber).toBe(499n);
    // The owner re-acquires on its next cycle and reads the reset cursor.
    const renewed = await (service as any).acquireLease(seeded.id, CHAIN_ID);
    expect(renewed.epoch).toBe(lease.epoch + 1n);
  });

  it("releases only its own lease on shutdown and keeps the epoch", async () => {
    const seeded = await seedCursor(999n);
    const service = makeService(scriptedClient({ currentBlock: 1000n }));
    await (service as any).runIndexCycle();
    expect((await readState()).leaseOwnerId).not.toBeNull();

    await service.onModuleDestroy();

    const released = await readState();
    expect(released.leaseOwnerId).toBeNull();
    expect(released.leaseExpiresAt).toBeNull();
    expect(released.leaseEpoch).toBe(1n);

    // A different process's lease is left alone.
    await prisma.indexerState.update({
      where: { id: seeded.id },
      data: {
        leaseOwnerId: "other-process",
        leaseExpiresAt: new Date(Date.now() + 300_000),
        leaseHeartbeatAt: new Date(),
      },
    });
    await service.onModuleDestroy();
    expect((await readState()).leaseOwnerId).toBe("other-process");
  });

  it("rejects an invalid lease TTL", () => {
    process.env.INDEXER_LEASE_TTL_MS = "1000";
    try {
      expect(() => new IndexerService(new EventBus())).toThrow("INDEXER_LEASE_TTL_MS");
    } finally {
      delete process.env.INDEXER_LEASE_TTL_MS;
    }
  });
});
