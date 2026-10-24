import { prisma } from "../db/prisma";
import { fastForwardStaleIndexerCursor } from "../modules/contracts/indexer_cursor_self_heal";

const SEPOLIA = 11155111;

describe("indexer cursor self-healing fast-forward (integration, #2360)", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await prisma.indexerState.deleteMany({ where: { chainId: SEPOLIA } });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await prisma.indexerState.deleteMany({ where: { chainId: SEPOLIA } });
  });

  it("bumps the lease epoch when it fast-forwards a stale cursor, fencing an in-flight poller", async () => {
    const row = await prisma.indexerState.create({
      data: {
        chainId: SEPOLIA,
        lastBlockNumber: 5_000_000n,
        leaseOwnerId: "running-poller",
        leaseEpoch: 3n,
        leaseExpiresAt: new Date(Date.now() + 300_000),
        leaseHeartbeatAt: new Date(),
      },
    });

    expect(await fastForwardStaleIndexerCursor(SEPOLIA)).toBe(true);

    const after = await prisma.indexerState.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lastBlockNumber).toBe(10_295_000n);
    expect(after.leaseEpoch).toBe(4n);
    // The running poller still holds epoch 3, so its fenced write matches nothing.
    const fenced = await prisma.indexerState.updateMany({
      where: { id: row.id, leaseOwnerId: "running-poller", leaseEpoch: 3n },
      data: { lastBlockNumber: 5_000_100n },
    });
    expect(fenced.count).toBe(0);
  });

  it("creates the cursor at the safe block when none exists", async () => {
    expect(await fastForwardStaleIndexerCursor(SEPOLIA)).toBe(true);
    const created = await prisma.indexerState.findUniqueOrThrow({ where: { chainId: SEPOLIA } });
    expect(created.lastBlockNumber).toBe(10_295_000n);
    expect(created.leaseEpoch).toBe(0n);
  });

  it("leaves a current cursor and other chains alone", async () => {
    await prisma.indexerState.create({
      data: { chainId: SEPOLIA, lastBlockNumber: 10_300_000n, leaseEpoch: 2n },
    });
    expect(await fastForwardStaleIndexerCursor(SEPOLIA)).toBe(false);
    expect(await fastForwardStaleIndexerCursor(84532)).toBe(false);
    const state = await prisma.indexerState.findUniqueOrThrow({ where: { chainId: SEPOLIA } });
    expect(state.lastBlockNumber).toBe(10_300_000n);
    expect(state.leaseEpoch).toBe(2n);
  });
});
