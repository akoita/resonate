/**
 * Wallet Service — Integration Test (Testcontainers)
 *
 * Tests WalletService with real Postgres for wallet records and budget enforcement.
 * External deps (ZeroDev, Pimlico bundler) mocked per policy.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { WalletService } from '../modules/identity/wallet.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `wal_${Date.now()}_`;

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
    await prisma.wallet.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
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
});
