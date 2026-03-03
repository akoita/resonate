/**
 * Sessions Service — Infra-backed Tests (zero-mock)
 *
 * Tests SessionsService with real Postgres for session, license, and payment records.
 * WalletService is mocked (uses external blockchain ops).
 *
 * Requires: make dev-up (Postgres at localhost:5432)
 * Run: npm test
 */

import { PrismaClient } from '@prisma/client';
import { SessionsService } from '../modules/sessions/sessions.service';
import { EventBus } from '../modules/shared/event_bus';
import { AgentOrchestrationService } from '../modules/sessions/agent_orchestration.service';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://resonate:resonate@localhost:5432/resonate';

let prisma: PrismaClient;
let dbAvailable = false;

const TEST_PREFIX = `sess_${Date.now()}_`;

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

describe('SessionsService (infra-backed)', () => {
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
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    try {
      await prisma.payment.deleteMany({ where: { session: { userId: `${TEST_PREFIX}user` } } }).catch(() => {});
      await prisma.license.deleteMany({ where: { track: { release: { artist: { userId: `${TEST_PREFIX}user` } } } } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
      await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } });
    } catch (err) {
      console.warn('Cleanup warning:', err);
    }
    await prisma.$disconnect();
  });

  it('creates a session with budget cap', async () => {
    if (!dbAvailable) return;

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

    // Verify in DB
    const found = await prisma.session.findUnique({ where: { id: session.id } });
    expect(found).not.toBeNull();
    expect(found!.budgetCapUsd).toBe(10);
  });
});
