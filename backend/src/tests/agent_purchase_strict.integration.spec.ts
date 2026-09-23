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
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const STEM_ID = `${TEST_PREFIX}stem`;
const LISTING_ID = BigInt(Date.now());
const TOKEN_ID = LISTING_ID + 1_000n;
let listingRowId: string;

function makeMockServices() {
  return {
    walletService: {
      spend: jest.fn(async () => ({ allowed: true, remaining: 50 })),
      getWallet: async () => ({ id: 'w1', userId: `${TEST_PREFIX}user` }),
    },
    agentWalletService: {
      validateSessionKey: jest.fn(async () => true),
      getAgentKeyData: async () => ({
        agentPrivateKey: new SensitiveBuffer('mock_agent_private_key_hex'),
        approvalData: 'mock_approval_data',
      }),
      checkAndEmitBudgetAlert: () => {},
    },
    kernelAccountService: {
      sendSessionKeyTransaction: jest.fn(async () => '0xreal_session_key_tx_hash'),
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
      data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` },
    });
    const session = await prisma.session.create({
      data: {
        userId: USER_ID,
        budgetCapUsd: 100,
      },
    });
    sessionId = session.id;
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: USER_ID,
        displayName: `${TEST_PREFIX}artist`,
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: `${TEST_PREFIX}release`,
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: `${TEST_PREFIX}track`,
      },
    });
    await prisma.stem.create({
      data: {
        id: STEM_ID,
        trackId: TRACK_ID,
        type: 'vocals',
        uri: '/test/agent-purchase-vocals.mp3',
      },
    });
    const listing = await prisma.stemListing.create({
      data: {
        listingId: LISTING_ID,
        stemId: STEM_ID,
        tokenId: TOKEN_ID,
        chainId: 31337,
        contractAddress: `0x${'c3'.repeat(20)}`,
        sellerAddress: `0x${'b2'.repeat(20)}`,
        pricePerUnit: '1000000000000000',
        amount: BigInt(1),
        paymentToken: `0x${'00'.repeat(20)}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        transactionHash: `${TEST_PREFIX}listing`,
        blockNumber: BigInt(1),
        listedAt: new Date(),
      },
    });
    listingRowId = listing.id;
  });

  afterAll(async () => {
    await prisma.agentTransaction.deleteMany({ where: { sessionId } }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { stemId: STEM_ID } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: TRACK_ID } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: RELEASE_ID } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => {});
  });

  beforeEach(async () => {
    await prisma.stem.update({
      where: { id: STEM_ID },
      data: { isCurrent: true },
    });
    await prisma.stemListing.update({
      where: { id: listingRowId },
      data: {
        amount: BigInt(1),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: 'active',
      },
    });
  });

  const baseInput = () => ({
    sessionId,
    userId: USER_ID,
    listingId: LISTING_ID,
    tokenId: TOKEN_ID,
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
    mocks.agentWalletService.validateSessionKey.mockResolvedValue(false);

    const result = await svc.purchase(baseInput());
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('session_key_invalid');
  });

  it('rejects a historical stem listing before spending or submitting', async () => {
    const { svc, mocks } = makeService();
    await prisma.stem.update({
      where: { id: STEM_ID },
      data: { isCurrent: false },
    });
    const beforeCount = await prisma.agentTransaction.count({
      where: { sessionId },
    });

    const result = await svc.purchase(baseInput());

    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('stem_historical');
    expect(mocks.walletService.spend).not.toHaveBeenCalled();
    expect(mocks.kernelAccountService.sendSessionKeyTransaction).not.toHaveBeenCalled();
    await expect(
      prisma.agentTransaction.count({ where: { sessionId } }),
    ).resolves.toBe(beforeCount);
  });

  it('rechecks stem currency after session-key validation and before budget spend', async () => {
    const { svc, mocks } = makeService();
    mocks.agentWalletService.validateSessionKey.mockImplementation(async () => {
      await prisma.stem.update({
        where: { id: STEM_ID },
        data: { isCurrent: false },
      });
      return true;
    });
    const beforeCount = await prisma.agentTransaction.count({
      where: { sessionId },
    });

    const result = await svc.purchase(baseInput());

    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('stem_historical');
    expect(mocks.walletService.spend).not.toHaveBeenCalled();
    expect(mocks.kernelAccountService.sendSessionKeyTransaction).not.toHaveBeenCalled();
    await expect(
      prisma.agentTransaction.count({ where: { sessionId } }),
    ).resolves.toBe(beforeCount);
  });

  it('rejects an inactive listing before spending or submitting', async () => {
    const { svc, mocks } = makeService();
    await prisma.stemListing.update({
      where: { id: listingRowId },
      data: { status: 'cancelled' },
    });

    const result = await svc.purchase(baseInput());

    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('listing_unavailable');
    expect(mocks.walletService.spend).not.toHaveBeenCalled();
    expect(mocks.kernelAccountService.sendSessionKeyTransaction).not.toHaveBeenCalled();
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
    mocks.kernelAccountService.sendSessionKeyTransaction.mockRejectedValue(
      new Error('Bundler rejected UserOp'),
    );

    const result = await svc.purchase(baseInput());
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe('transaction_failed');
    expect((result as any).message).toContain('Bundler rejected UserOp');
  });
});
