/**
 * Wallet Service — Integration Test (Testcontainers)
 *
 * Tests WalletService with real Postgres for wallet records and budget enforcement.
 * External deps (ZeroDev, Pimlico bundler) mocked per policy.
 *
 * Run: npm run test:integration
 */

import { BadRequestException } from '@nestjs/common';
import { prisma } from '../db/prisma';
import { WalletService } from '../modules/identity/wallet.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `wal_${Date.now()}_`;
const TEST_ADDRESS = `0x${Date.now().toString(16).padStart(40, '0').slice(-40)}`;

describe('WalletService (integration)', () => {
  let wallet: WalletService;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });

    const eventBus = new EventBus();
    wallet = new WalletService(
      eventBus as any,
      {
        getProvider: () => ({
          getAccount: () => ({
            address: 'wallet_user-1',
            chainId: 0,
            accountType: 'local',
            provider: 'local',
          }),
        }),
      } as any,
      {
        sendUserOperation: async () => '0xhash',
        waitForReceipt: async () => ({}),
      } as any,
      { configure: () => {} } as any,
      {} as any,
    );
  });

  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { userId: { in: [`${TEST_PREFIX}user`, TEST_ADDRESS] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [`${TEST_PREFIX}user`, TEST_ADDRESS] } } }).catch(() => {});
  });

  it('enforces monthly budget cap', async () => {
    await wallet.setBudget({ userId: `${TEST_PREFIX}user`, monthlyCapUsd: 10 });
    await wallet.fundWallet({ userId: `${TEST_PREFIX}user`, amountUsd: 10 });
    const first = await wallet.spend(`${TEST_PREFIX}user`, 6);
    const second = await wallet.spend(`${TEST_PREFIX}user`, 6);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it('persists wallet record in real DB', async () => {
    const found = await prisma.wallet.findFirst({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(found).not.toBeNull();
    expect(found!.monthlyCapUsd).toBe(10);
  });

  it('uses an authenticated smart account address instead of a derived placeholder', async () => {
    const found = await wallet.getWallet(TEST_ADDRESS);

    expect(found.address).toBe(TEST_ADDRESS);
    expect(found.ownerAddress).toBeNull();
  });

  it('writes nothing when a fund or budget call is rejected (#2361)', async () => {
    const userId = `${TEST_PREFIX}rejected`;
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    const events: unknown[] = [];
    const unsubscribe = (wallet as any).eventBus.subscribe('wallet.funded', (e: unknown) => events.push(e));

    for (const amountUsd of [0, -5, NaN, Infinity, 10_001]) {
      await expect(wallet.fundWallet({ userId, amountUsd })).rejects.toThrow(BadRequestException);
    }
    for (const monthlyCapUsd of [-1, NaN, Infinity, 10_001]) {
      await expect(wallet.setBudget({ userId, monthlyCapUsd })).rejects.toThrow(BadRequestException);
    }

    expect(await prisma.wallet.count({ where: { userId } })).toBe(0);
    expect(events).toHaveLength(0);
    unsubscribe.unsubscribe();

    // An existing wallet keeps its balance and cap.
    await wallet.setBudget({ userId, monthlyCapUsd: 20 });
    await wallet.fundWallet({ userId, amountUsd: 5 });
    await expect(wallet.fundWallet({ userId, amountUsd: -1 })).rejects.toThrow(BadRequestException);
    await expect(wallet.setBudget({ userId, monthlyCapUsd: -1 })).rejects.toThrow(BadRequestException);
    const row = await prisma.wallet.findFirst({ where: { userId } });
    expect(row!.balanceUsd).toBe(5);
    expect(row!.monthlyCapUsd).toBe(20);

    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('accepts a zero monthly cap (spending paused)', async () => {
    const userId = `${TEST_PREFIX}user`;
    await wallet.setBudget({ userId, monthlyCapUsd: 0 });
    const row = await prisma.wallet.findFirst({ where: { userId } });
    expect(row!.monthlyCapUsd).toBe(0);
    await wallet.setBudget({ userId, monthlyCapUsd: 10 });
  });
});
