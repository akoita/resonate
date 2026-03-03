/**
 * Choreography Flow 3 — Agent Session Lifecycle
 *
 * Tests the event chain: SessionsService.startSession → session.started →
 * AgentOrchestrationService.selectNextTrack → agent.track_selected + agent.decision_made
 *
 * Real WalletService (setBudget writes to real Postgres via prisma.wallet).
 * Real SessionsService, real AgentOrchestrationService.
 * Real AgentPurchaseService (full dep chain: KernelAccountService → Anvil,
 *   ZeroDevSessionKeyService → CryptoService + KeyAuditService).
 *
 * See: backend/CHOREOGRAPHY.md (Flow 3) for sequence diagrams.
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { WalletService } from '../modules/identity/wallet.service';
import { SessionsService } from '../modules/sessions/sessions.service';
import { AgentOrchestrationService } from '../modules/sessions/agent_orchestration.service';
import { AgentPurchaseService } from '../modules/agents/agent_purchase.service';
import { AgentWalletService } from '../modules/agents/agent_wallet.service';
import { KernelAccountService } from '../modules/identity/kernel_account.service';
import { ZeroDevSessionKeyService } from '../modules/identity/zerodev_session_key.service';
import { CryptoService } from '../modules/shared/crypto.service';
import { KeyAuditService } from '../modules/shared/key_audit.service';
import { ConfigService } from '@nestjs/config';
import type { ResonateEvent } from '../events/event_types';

const P = `cf3_${Date.now()}_`;

function eventSpy(eventBus: EventBus, eventName: string): ResonateEvent[] {
  const bag: ResonateEvent[] = [];
  eventBus.subscribe(eventName as any, (e: any) => bag.push(e));
  return bag;
}

describe('Choreography Flow 3: Agent Session Lifecycle', () => {
  let eventBus: EventBus;
  let walletService: WalletService;
  let agentService: AgentOrchestrationService;
  let sessionsService: SessionsService;

  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;

  beforeAll(async () => {
    eventBus = new EventBus();

    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'Session Artist', payoutAddress: '0x' + 'E'.repeat(40) },
    });
    await prisma.release.create({
      data: { id: releaseId, title: 'Session Release', artistId, status: 'ready', genre: 'electronic' },
    });
    await prisma.track.create({
      data: { id: trackId, title: 'Session Track', releaseId, position: 1 },
    });

    // Real WalletService — with minimal infrastructure stubs for blockchain
    // providerRegistry is needed by getOrCreate() to derive a wallet address
    const providerRegistry = {
      getProvider: () => ({
        getAccount: (uid: string) => ({
          address: '0x' + uid.slice(0, 40).padEnd(40, '0'),
          chainId: 31337,
          accountType: 'eoa',
          provider: 'local',
          ownerAddress: null,
          entryPoint: null,
          factory: null,
          paymaster: null,
          bundler: null,
          salt: null,
        }),
      }),
    };

    // Real ConfigService — RPC_URL defaults to Anvil (Testcontainers)
    const configService = new ConfigService({
      RPC_URL: process.env.ANVIL_RPC_URL || 'http://localhost:8545',
      ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || 'test-encryption-secret',
    });

    walletService = new WalletService(
      eventBus as any,
      providerRegistry as any,
      {} as any,  // Erc4337Client — not called in setBudget/getOrCreate path
      {} as any,  // PaymasterService — not called in setBudget/getOrCreate path
      new KernelAccountService(configService),
    );

    agentService = new AgentOrchestrationService(eventBus as any);

    // Real AgentPurchaseService — full dep chain, no external calls in constructor
    // purchase() is never invoked in this test (session choreography only)
    const cryptoService = new CryptoService(configService);
    const keyAuditService = new KeyAuditService();
    const zeroDevService = new ZeroDevSessionKeyService(configService, cryptoService, keyAuditService);
    const agentWalletService = new AgentWalletService(walletService, zeroDevService, eventBus);
    const kernelAccountService = new KernelAccountService(configService);
    const agentPurchaseService = new AgentPurchaseService(
      walletService, agentWalletService, kernelAccountService, eventBus,
    );

    sessionsService = new SessionsService(walletService, eventBus as any, agentService, agentPurchaseService);
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('Start session → select track → event chain verified', async () => {
    const sessionStarted = eventSpy(eventBus, 'session.started');
    const trackSelected = eventSpy(eventBus, 'agent.track_selected');
    const decisionMade = eventSpy(eventBus, 'agent.decision_made');
    const budgetSet = eventSpy(eventBus, 'wallet.budget_set');

    // Step 1: Start session (real WalletService writes to Postgres)
    const session = await sessionsService.startSession({
      userId,
      budgetCapUsd: 5.0,
      preferences: { genres: ['electronic'] },
    });

    expect(session).toBeDefined();
    expect(session.budgetCapUsd).toBe(5.0);

    // Assert: session.started emitted
    expect(sessionStarted.length).toBe(1);
    expect((sessionStarted[0] as any).sessionId).toBe(session.id);

    // Assert: wallet.budget_set emitted (from real WalletService)
    expect(budgetSet.length).toBe(1);
    expect((budgetSet[0] as any).monthlyCapUsd).toBe(5.0);

    // Assert: Wallet persisted in real DB
    const wallet = await prisma.wallet.findFirst({ where: { userId } });
    expect(wallet).not.toBeNull();
    expect(wallet!.monthlyCapUsd).toBe(5.0);

    // Assert: Session persisted in real DB
    const dbSession = await prisma.session.findUnique({ where: { id: session.id } });
    expect(dbSession).not.toBeNull();
    expect(dbSession!.budgetCapUsd).toBe(5.0);

    // Step 2: Select track (real AgentOrchestrationService queries real Postgres)
    const selection = await agentService.selectNextTrack({
      sessionId: session.id,
      preferences: { genres: ['electronic'] },
    });

    expect(selection.status).toBe('ok');
    expect(selection.track).toBeDefined();

    // Assert: events emitted
    expect(trackSelected.length).toBeGreaterThanOrEqual(1);
    expect(decisionMade.length).toBeGreaterThanOrEqual(1);
  }, 20000);
});
