/**
 * Sessions Service — Integration Test (Testcontainers)
 *
 * Tests SessionsService with real Postgres for session records.
 * Real WalletService with providerRegistry stub (returns deterministic address).
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { SessionsService } from '../modules/sessions/sessions.service';
import { WalletService } from '../modules/identity/wallet.service';
import { EventBus } from '../modules/shared/event_bus';
import { AgentOrchestrationService } from '../modules/sessions/agent_orchestration.service';

const TEST_PREFIX = `sess_${Date.now()}_`;

describe('SessionsService (integration)', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { session: { userId: `${TEST_PREFIX}user` } } }).catch(() => {});
    await prisma.license.deleteMany({ where: { track: { release: { artist: { userId: `${TEST_PREFIX}user` } } } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it('creates a session with budget cap', async () => {
    const eventBus = new EventBus();
    // Real WalletService — providerRegistry stub returns deterministic address
    const providerRegistry = {
      getProvider: () => ({
        getAccount: (uid: string) => ({
          address: '0x' + uid.slice(0, 40).padEnd(40, '0'),
          chainId: 31337,
          accountType: 'eoa',
          provider: 'local',
          ownerAddress: null, entryPoint: null, factory: null,
          paymaster: null, bundler: null, salt: null,
        }),
      }),
    };
    const walletService = new WalletService(
      eventBus as any,
      providerRegistry as any,
      {} as any, // Erc4337Client — not called
      {} as any, // PaymasterService — not called
      {} as any, // KernelAccountService — not called
    );
    const agentService = new AgentOrchestrationService(eventBus);
    const agentPurchaseService = { purchase: async () => {} } as any;
    const service = new SessionsService(walletService, eventBus, agentService, agentPurchaseService);

    const session = await service.startSession({
      userId: `${TEST_PREFIX}user`,
      budgetCapUsd: 10,
    });

    expect(session.id).toBeDefined();
    expect(session.userId).toBe(`${TEST_PREFIX}user`);

    const found = await prisma.session.findUnique({ where: { id: session.id } });
    expect(found).not.toBeNull();
    expect(found!.budgetCapUsd).toBe(10);

    // Verify real wallet was created in DB
    const wallet = await prisma.wallet.findFirst({ where: { userId: `${TEST_PREFIX}user` } });
    expect(wallet).not.toBeNull();
    expect(wallet!.monthlyCapUsd).toBe(10);
  });
});

