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

const TEST_PREFIX = `sess_${Date.now()}_`;

describe('SessionsService (integration)', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'Session Runtime Artist',
        payoutAddress: '0x' + 'B'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Session Runtime Release',
        status: 'published',
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        releaseId: `${TEST_PREFIX}release`,
        title: 'Session Runtime Track',
        position: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { session: { userId: `${TEST_PREFIX}user` } } }).catch(() => {});
    await prisma.license.deleteMany({ where: { track: { release: { artist: { userId: `${TEST_PREFIX}user` } } } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  function makeService(runtimeService: any = { runCommerce: jest.fn() }) {
    const eventBus = new EventBus();
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
    const agentPurchaseService = { purchase: async () => {} } as any;
    return {
      eventBus,
      service: new SessionsService(walletService, eventBus, runtimeService, agentPurchaseService),
    };
  }

  it('creates a session with budget cap', async () => {
    const { service } = makeService();
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

  it('routes agentNext through AgentRuntimeService with session budget and recent tracks', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({
        status: 'approved',
        tracks: [
          {
            trackId: `${TEST_PREFIX}track`,
            licenseType: 'remix',
            priceUsd: 5,
            reason: 'within_budget',
          },
        ],
        primaryTrack: {
          trackId: `${TEST_PREFIX}track`,
          licenseType: 'remix',
          priceUsd: 5,
          reason: 'within_budget',
        },
      }),
    };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({
      userId: `${TEST_PREFIX}user`,
      budgetCapUsd: 10,
      preferences: { genres: ['electronic'] },
    });

    const first = await service.agentNext({
      sessionId: session.id,
      preferences: { licenseType: 'remix' },
    }) as any;
    const second = await service.agentNext({ sessionId: session.id }) as any;

    expect(first.status).toBe('ok');
    expect(first.track?.id).toBe(`${TEST_PREFIX}track`);
    expect(first.licenseType).toBe('remix');
    expect(first.priceUsd).toBe(5);
    expect(runtimeService.runCommerce).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: session.id,
        userId: `${TEST_PREFIX}user`,
        recentTrackIds: [],
        budgetRemainingUsd: 10,
        preferences: { genres: ['electronic'], licenseType: 'remix' },
      }),
    );
    expect(runtimeService.runCommerce).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        recentTrackIds: [`${TEST_PREFIX}track`],
        preferences: { genres: ['electronic'], licenseType: 'remix' },
      }),
    );
    expect(second.status).toBe('ok');
  });
});
