/**
 * Sessions Service — Integration Test (Testcontainers)
 *
 * Tests SessionsService with real Postgres for session records.
 * WalletService is mocked (uses external blockchain ops — per policy).
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { SessionsService } from '../modules/sessions/sessions.service';
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
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it('creates a session with budget cap', async () => {
    const walletService = {
      spend: async () => ({ allowed: true, remaining: 4 }),
      setBudget: async () => ({}),
      getWallet: async () => null,
    } as any;
    const eventBus = new EventBus();
    const agentService = new AgentOrchestrationService(eventBus);
    const agentPurchaseService = {} as any;
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
  });
});
