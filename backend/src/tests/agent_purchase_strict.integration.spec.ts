/**
 * Agent Purchase Service — Integration Test (Testcontainers)
 *
 * Tests AgentPurchaseService.purchase against real Postgres for
 * AgentTransaction records. External blockchain services (wallet,
 * session keys, kernel account) stay mocked per policy.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { AgentPurchaseService } from '../modules/agents/agent_purchase.service';
import { SensitiveBuffer } from '../modules/shared/sensitive_buffer';

const TEST_PREFIX = `agp_${Date.now()}_`;

function makeMockServices() {
  return {
    walletService: {
      spend: async () => ({ allowed: true, remaining: 50 }),
      getWallet: async () => ({ id: 'w1', userId: `${TEST_PREFIX}user` }),
    },
    agentWalletService: {
      validateSessionKey: () => true,
      getAgentKeyData: async () => ({
        agentPrivateKey: new SensitiveBuffer('mock_agent_private_key_hex'),
        approvalData: 'mock_approval_data',
      }),
      checkAndEmitBudgetAlert: () => {},
    },
    kernelAccountService: {
      sendSessionKeyTransaction: async () => '0xreal_session_key_tx_hash',
    },
    eventBus: {
      publish: () => {},
    },
  };
}

function makeService() {
  const mocks = makeMockServices();
  const svc = new AgentPurchaseService(
    mocks.walletService as any,
    mocks.agentWalletService as any,
    mocks.kernelAccountService as any,
    mocks.eventBus as any,
  );
  return { svc, mocks };
}

describe('AgentPurchaseService (integration)', () => {
  let sessionId: string;

  beforeAll(async () => {
    // Seed: User → Session (AgentTransaction FK requires Session)
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    const session = await prisma.session.create({
      data: {
        userId: `${TEST_PREFIX}user`,
        budgetCapUsd: 100,
      },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await prisma.agentTransaction.deleteMany({ where: { sessionId } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  const baseInput = () => ({
    sessionId,
    userId: `${TEST_PREFIX}user`,
    listingId: BigInt(1),
    tokenId: BigInt(100),
    amount: BigInt(1),
    totalPriceWei: '1000000000000000',
    priceUsd: 5,
  });

  it('always uses sendSessionKeyTransaction for purchases', async () => {
    const { svc } = makeService();
    const result = await svc.purchase(baseInput());
    expect(result.success).toBe(true);
    expect(result.mode).toBe('onchain');
    expect(result.txHash).toBe('0xreal_session_key_tx_hash');

    // Verify record persisted in real DB
    const tx = await prisma.agentTransaction.findFirst({
      where: { sessionId, txHash: '0xreal_session_key_tx_hash' },
    });
    expect(tx).not.toBeNull();
    expect(tx!.status).toBe('confirmed');
  });

  it('rejects when session key is invalid', async () => {
    const { svc, mocks } = makeService();
    mocks.agentWalletService.validateSessionKey = () => false;

    const result = await svc.purchase(baseInput());
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('session_key_invalid');
  });

  it('rejects when no agent key data is found', async () => {
    const { svc, mocks } = makeService();
    mocks.agentWalletService.getAgentKeyData = async () => null as any;

    const result = await svc.purchase(baseInput());
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('transaction_failed');
    expect((result as any).message).toContain('agent key data');

    // Verify failed transaction persisted
    const tx = await prisma.agentTransaction.findFirst({
      where: { sessionId, status: 'failed' },
    });
    expect(tx).not.toBeNull();
    expect(tx!.errorMessage).toContain('agent key data');
  });

  it('handles sendSessionKeyTransaction failure gracefully', async () => {
    const { svc, mocks } = makeService();
    mocks.kernelAccountService.sendSessionKeyTransaction = async () => {
      throw new Error('Bundler rejected UserOp');
    };

    const result = await svc.purchase(baseInput());
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('transaction_failed');
    expect((result as any).message).toContain('Bundler rejected UserOp');
  });
});
