/**
 * Wallet Service — Infra-backed Tests (zero-mock)
 *
 * Tests WalletService with real Postgres for wallet records and budget enforcement.
 * External deps (ZeroDev, Pimlico bundler) are mocked per policy.
 *
 * Requires: make dev-up (Postgres at localhost:5432)
 * Run: npm test
 */

import { PrismaClient } from '@prisma/client';
import { WalletService } from '../modules/identity/wallet.service';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://resonate:resonate@localhost:5432/resonate';

let prisma: PrismaClient;
let dbAvailable = false;

const TEST_PREFIX = `wal_${Date.now()}_`;

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const p = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await p.$connect();
    await p.$disconnect();
    return true;
  } catch {
    return false;
  }
}

describe('WalletService (infra-backed)', () => {
  let wallet: WalletService;

  beforeAll(async () => {
    dbAvailable = await isPostgresAvailable();
    if (!dbAvailable) {
      console.warn('⚠️  Postgres not available. Start with: make dev-up');
      return;
    }

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();

    // Seed user
    await prisma.user.upsert({
      where: { id: `${TEST_PREFIX}user` },
      update: {},
      create: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });

    // WalletService constructor: (eventBus, zeroDevProvider, bundlerClient, pricingService, contractsService)
    // External deps mocked per policy (blockchain services)
    wallet = new WalletService(
      { publish: () => {} } as any,                             // EventBus
      {
        getProvider: () => ({
          getAccount: () => ({
            address: 'wallet_user-1',
            chainId: 0,
            accountType: 'local',
            provider: 'local',
          }),
        }),
      } as any,                                                 // ZeroDev (external)
      {
        sendUserOperation: async () => '0xhash',
        waitForReceipt: async () => ({}),
      } as any,                                                 // Pimlico bundler (external)
      { configure: () => {} } as any,                            // Pricing
      {} as any,                                                 // Contracts
    );
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    try {
      await prisma.wallet.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
      await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } });
    } catch (err) {
      console.warn('Cleanup warning:', err);
    }
    await prisma.$disconnect();
  });

  it('enforces monthly budget cap', async () => {
    if (!dbAvailable) return;

    await wallet.setBudget({ userId: `${TEST_PREFIX}user`, monthlyCapUsd: 10 });
    await wallet.fundWallet({ userId: `${TEST_PREFIX}user`, amountUsd: 10 });
    const first = await wallet.spend(`${TEST_PREFIX}user`, 6);
    const second = await wallet.spend(`${TEST_PREFIX}user`, 6);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it('persists wallet record in real DB', async () => {
    if (!dbAvailable) return;

    const found = await prisma.wallet.findFirst({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(found).not.toBeNull();
    expect(found!.monthlyCapUsd).toBe(10);
  });
});
