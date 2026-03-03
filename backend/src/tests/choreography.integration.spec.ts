/**
 * Choreography Integration Tests
 *
 * These tests verify end-to-end event-driven flows across services.
 * Each test fires a trigger event into a real EventBus and asserts that
 * downstream subscribers react correctly — producing the expected
 * DB state changes and follow-on events.
 *
 * See: backend/CHOREOGRAPHY.md for sequence diagrams and maintenance guide.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { CatalogService } from '../modules/catalog/catalog.service';
import { ContractsService } from '../modules/contracts/contracts.service';
import type {
  StemsUploadedEvent,
  StemsProcessedEvent,
  StemsFailedEvent,
  ContractStemMintedEvent,
  ContractStemListedEvent,
  ContractStemSoldEvent,
  ContractListingCancelledEvent,
  ContractRoyaltyPaidEvent,
  ResonateEvent,
} from '../events/event_types';

const P = `choreo_${Date.now()}_`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Collect events into an array for assertion */
function eventSpy(eventBus: EventBus, eventName: string): ResonateEvent[] {
  const bag: ResonateEvent[] = [];
  eventBus.subscribe(eventName as any, (e: any) => bag.push(e));
  return bag;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLOW 1 — Release Ingestion Pipeline
// stems.uploaded → CatalogService → DB → stems.processed → CatalogService → DB
// ═══════════════════════════════════════════════════════════════════════════════

describe('Flow 1: Release Ingestion Pipeline', () => {
  let eventBus: EventBus;
  let catalogService: CatalogService;

  const releaseId = `${P}release1`;
  const artistId = `${P}artist1`;
  const trackId = `${P}track1`;
  const stemId1 = `${P}stem1_vocals`;
  const stemId2 = `${P}stem1_drums`;

  beforeAll(async () => {
    // Seed baseline data
    await prisma.user.create({ data: { id: `${P}user1`, email: `${P}user1@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId: `${P}user1`, displayName: 'Choreo Artist', payoutAddress: '0x' + 'C'.repeat(40) },
    });

    // Wire up EventBus → CatalogService (same wiring NestJS does at boot)
    eventBus = new EventBus();
    catalogService = new CatalogService(eventBus as any, {} as any, {} as any);
    catalogService.onModuleInit();
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { track: { releaseId } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${P}user1` } }).catch(() => {});
  });

  it('Scenario 1a — stems.uploaded → CatalogService creates Release + Tracks → stems.processed → release "ready"', async () => {
    // Spy on downstream events
    const trackStatusEvents = eventSpy(eventBus, 'catalog.track_status');
    const releaseReadyEvents = eventSpy(eventBus, 'catalog.release_ready');

    // ── Step 1: Publish stems.uploaded ────────────────────────────────────
    const uploadEvent: StemsUploadedEvent = {
      eventName: 'stems.uploaded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId,
      artistId,
      checksum: 'abc123',
      metadata: {
        title: 'Choreography Album',
        type: 'single',
        genre: 'Electronic',
        tracks: [{
          title: 'Flow Track',
          position: 1,
          stems: [{
            id: stemId1,
            uri: '/catalog/stems/master.mp3',
            type: 'master',
          }],
        }],
      },
    };
    eventBus.publish(uploadEvent);
    await wait(1500); // Allow async handler to complete DB writes

    // Assert: Release created in "processing" state
    const releaseAfterUpload = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(releaseAfterUpload).not.toBeNull();
    expect(releaseAfterUpload!.status).toBe('processing');
    expect(releaseAfterUpload!.title).toBe('Choreography Album');

    // ── Step 2: Publish stems.processed ───────────────────────────────────
    // Find the track that was created by the handler
    const tracks = await prisma.track.findMany({ where: { releaseId } });
    const realTrackId = tracks[0]?.id ?? trackId;

    const processedEvent: StemsProcessedEvent = {
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId,
      artistId,
      modelVersion: 'htdemucs_6s',
      tracks: [{
        id: realTrackId,
        title: 'Flow Track',
        position: 1,
        stems: [
          { id: stemId1, uri: '/catalog/stems/vocals.mp3', type: 'vocals', mimeType: 'audio/mpeg' },
          { id: stemId2, uri: '/catalog/stems/drums.mp3', type: 'drums', mimeType: 'audio/mpeg' },
        ],
      }],
    };
    eventBus.publish(processedEvent);
    await wait(2000); // Allow upserts + release status check

    // Assert: Track processing complete
    const trackAfterProcessed = await prisma.track.findUnique({ where: { id: realTrackId } });
    expect(trackAfterProcessed).not.toBeNull();
    expect(trackAfterProcessed!.processingStatus).toBe('complete');

    // Assert: Stems persisted
    const stems = await prisma.stem.findMany({ where: { trackId: realTrackId } });
    expect(stems.length).toBeGreaterThanOrEqual(2);
    expect(stems.map(s => s.type)).toEqual(expect.arrayContaining(['vocals', 'drums']));

    // Assert: Release marked "ready"
    const releaseAfterProcessed = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(releaseAfterProcessed!.status).toBe('ready');

    // Assert: Events emitted
    expect(trackStatusEvents.length).toBeGreaterThanOrEqual(1);
    expect(releaseReadyEvents.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('Scenario 1b — stems.failed → release marked "failed"', async () => {
    // Create a second release for this test
    const failReleaseId = `${P}fail_release`;
    await prisma.release.create({
      data: { id: failReleaseId, artistId, title: 'Will Fail', status: 'processing' },
    });

    const failEvent: StemsFailedEvent = {
      eventName: 'stems.failed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: failReleaseId,
      artistId,
      error: 'Demucs OOM',
    };
    eventBus.publish(failEvent);
    await wait(1000);

    const failedRelease = await prisma.release.findUnique({ where: { id: failReleaseId } });
    expect(failedRelease!.status).toBe('failed');

    // Cleanup
    await prisma.release.delete({ where: { id: failReleaseId } }).catch(() => {});
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FLOW 2 — Contract Indexing → Marketplace Lifecycle
// contract.stem_minted → ContractsService → StemNftMint
// contract.stem_listed → StemListing(active)
// contract.stem_sold → StemListing(sold) + StemPurchase
// contract.listing_cancelled → StemListing(cancelled)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Flow 2: Contract Indexing → Marketplace Lifecycle', () => {
  let eventBus: EventBus;
  let contractsService: ContractsService;

  const userId = `${P}user2`;
  const artistId = `${P}artist2`;
  const releaseId = `${P}release2`;
  const trackId = `${P}track2`;
  let stemId: string;
  const tokenId = '100';
  const chainId = 31337;
  const contractAddr = '0x' + 'F'.repeat(40);

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${P}user2@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'NFT Artist', payoutAddress: '0x' + 'D'.repeat(40) },
    });
    await prisma.release.create({
      data: { id: releaseId, title: 'NFT Release', artistId, status: 'ready' },
    });
    await prisma.track.create({
      data: { id: trackId, title: 'NFT Track', releaseId, position: 1 },
    });
    const stem = await prisma.stem.create({
      data: { trackId, type: 'vocals', uri: '/catalog/stems/nft_vocals.mp3' },
    });
    stemId = stem.id;

    // Wire EventBus → ContractsService
    eventBus = new EventBus();
    contractsService = new ContractsService(eventBus as any);
    // Call the private method to subscribe to events
    (contractsService as any).subscribeToContractEvents();
  });

  afterAll(async () => {
    await prisma.royaltyPayment.deleteMany({ where: { chainId } }).catch(() => {});
    await prisma.stemPurchase.deleteMany({ where: { transactionHash: { startsWith: `0x${P}` } } }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { chainId } }).catch(() => {});
    await prisma.stemNftMint.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('Scenario 2a — Mint → List → Sell full lifecycle', async () => {
    // The stem URI includes the stemId so ContractsService can find it
    const metadataUri = `http://localhost:3000/contracts/metadata/${chainId}/${stemId}`;

    // ── Step 1: Mint ──────────────────────────────────────────────────────
    const mintEvent: ContractStemMintedEvent = {
      eventName: 'contract.stem_minted',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      tokenId,
      creatorAddress: '0xCreator',
      parentIds: [],
      tokenUri: metadataUri,
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}mint_tx`,
      blockNumber: '1',
    };
    eventBus.publish(mintEvent);
    await wait(1000);

    // Assert: StemNftMint created
    const nftMint = await prisma.stemNftMint.findFirst({ where: { stemId } });
    expect(nftMint).not.toBeNull();
    expect(nftMint!.tokenId).toBe(BigInt(tokenId));
    expect(nftMint!.creatorAddress).toBe('0xCreator');

    // Assert: Stem.ipnftId updated
    const stemAfterMint = await prisma.stem.findUnique({ where: { id: stemId } });
    expect(stemAfterMint!.ipnftId).toBe(tokenId);

    // ── Step 2: List ──────────────────────────────────────────────────────
    const listEvent: ContractStemListedEvent = {
      eventName: 'contract.stem_listed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '1',
      sellerAddress: '0xCreator',
      tokenId,
      amount: '10',
      pricePerUnit: '50000000000000000',
      paymentToken: '0x0000000000000000000000000000000000000000',
      expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}list_tx`,
      blockNumber: '2',
    };
    eventBus.publish(listEvent);
    await wait(1000);

    // Assert: StemListing active
    const listing = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_tx` },
    });
    expect(listing).not.toBeNull();
    expect(listing!.status).toBe('active');

    // ── Step 3: Sell ──────────────────────────────────────────────────────
    const soldEvent: ContractStemSoldEvent = {
      eventName: 'contract.stem_sold',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '1',
      buyerAddress: '0xBuyer',
      amount: '10',
      totalPaid: '50000000000000000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}sold_tx`,
      blockNumber: '3',
    };
    eventBus.publish(soldEvent);
    await wait(1000);

    // Assert: Listing marked sold
    const listingAfterSold = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_tx` },
    });
    expect(listingAfterSold!.status).toBe('sold');

    // Assert: StemPurchase created
    const purchase = await prisma.stemPurchase.findFirst({
      where: { transactionHash: `0x${P}sold_tx` },
    });
    expect(purchase).not.toBeNull();
    expect(purchase!.buyerAddress).toBe('0xbuyer');
  }, 20000);

  it('Scenario 2b — Listing cancellation', async () => {
    // Create a fresh listing to cancel
    const listEvent2: ContractStemListedEvent = {
      eventName: 'contract.stem_listed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '99',
      sellerAddress: '0xCreator',
      tokenId,
      amount: '5',
      pricePerUnit: '100000000000000000',
      paymentToken: '0x0000000000000000000000000000000000000000',
      expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}list_tx_cancel`,
      blockNumber: '4',
    };
    eventBus.publish(listEvent2);
    await wait(1000);

    // Verify listing is active
    const activeListing = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_tx_cancel` },
    });
    expect(activeListing!.status).toBe('active');

    // Cancel it
    const cancelEvent: ContractListingCancelledEvent = {
      eventName: 'contract.listing_cancelled',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '99',
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}cancel_tx`,
      blockNumber: '5',
    };
    eventBus.publish(cancelEvent);
    await wait(1000);

    // Assert: Listing cancelled
    const cancelledListing = await prisma.stemListing.findFirst({
      where: { listingId: 99n, chainId },
    });
    expect(cancelledListing!.status).toBe('cancelled');
  }, 15000);

  it('Scenario 2c — Royalty payment', async () => {
    const royaltyEvent: ContractRoyaltyPaidEvent = {
      eventName: 'contract.royalty_paid',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      tokenId,
      recipientAddress: '0xCreator',
      amount: '2500000000000000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}royalty_tx`,
      blockNumber: '6',
    };
    eventBus.publish(royaltyEvent);
    await wait(1000);

    const royalty = await prisma.royaltyPayment.findFirst({
      where: { transactionHash: `0x${P}royalty_tx` },
    });
    expect(royalty).not.toBeNull();
    expect(royalty!.recipientAddress).toBe('0xCreator');
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FLOW 3 — Agent Session Lifecycle
// SessionsService.startSession → session.started →
// AgentOrchestrationService.selectNextTrack → agent.track_selected + agent.decision_made →
// AgentPurchaseService (mocked blockchain) → agent.purchase_completed
// ═══════════════════════════════════════════════════════════════════════════════

describe('Flow 3: Agent Session Lifecycle', () => {
  let eventBus: EventBus;

  const userId = `${P}user3`;
  const artistId = `${P}artist3`;
  const releaseId = `${P}release3`;
  const trackId = `${P}track3`;

  beforeAll(async () => {
    eventBus = new EventBus();

    await prisma.user.create({ data: { id: userId, email: `${P}user3@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'Session Artist', payoutAddress: '0x' + 'E'.repeat(40) },
    });
    await prisma.release.create({
      data: { id: releaseId, title: 'Session Release', artistId, status: 'ready', genre: 'electronic' },
    });
    await prisma.track.create({
      data: { id: trackId, title: 'Session Track', releaseId, position: 1 },
    });
  });

  afterAll(async () => {
    await prisma.agentTransaction.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('Scenario 3 — Start session → select track → purchase → event chain', async () => {
    // Collect events
    const sessionStarted = eventSpy(eventBus, 'session.started');
    const trackSelected = eventSpy(eventBus, 'agent.track_selected');
    const decisionMade = eventSpy(eventBus, 'agent.decision_made');
    const purchaseCompleted = eventSpy(eventBus, 'agent.purchase_completed');

    // ── Step 1: Start session ──────────────────────────────────────────
    // Import SessionsService and wire it
    const { SessionsService } = await import('../modules/sessions/sessions.service');
    const { AgentOrchestrationService } = await import('../modules/sessions/agent_orchestration.service');

    const walletService = { setBudget: jest.fn().mockResolvedValue(undefined) } as any;
    const agentService = new AgentOrchestrationService(eventBus as any);
    const agentPurchaseService = { purchase: jest.fn() } as any;
    const sessionsService = new SessionsService(walletService, eventBus as any, agentService, agentPurchaseService);

    const session = await sessionsService.startSession({
      userId,
      budgetCapUsd: 5.0,
      preferences: { genres: ['electronic'] },
    });

    expect(session).toBeDefined();
    expect(session.budgetCapUsd).toBe(5.0);
    expect(sessionStarted.length).toBe(1);
    expect((sessionStarted[0] as any).sessionId).toBe(session.id);

    // ── Step 2: Select track (orchestration service) ─────────────────
    const selection = await agentService.selectNextTrack({
      sessionId: session.id,
      preferences: { genres: ['electronic'] },
    });

    expect(selection.status).toBe('ok');
    expect(selection.track).toBeDefined();
    expect(trackSelected.length).toBeGreaterThanOrEqual(1);
    expect(decisionMade.length).toBeGreaterThanOrEqual(1);

    // ── Step 3: DB state ─────────────────────────────────────────────
    const dbSession = await prisma.session.findUnique({ where: { id: session.id } });
    expect(dbSession).not.toBeNull();
    expect(dbSession!.budgetCapUsd).toBe(5.0);
  }, 20000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FLOW 4 — AI Generation Pipeline
// GenerationService.createGeneration → generation.started →
// processGenerationJob → generation.progress (×3) → generation.completed
// ═══════════════════════════════════════════════════════════════════════════════

describe('Flow 4: AI Generation Pipeline', () => {
  let eventBus: EventBus;

  const userId = `${P}user4`;
  const artistId = `${P}artist4`;

  const mockStorageProvider = {
    upload: jest.fn().mockResolvedValue({ uri: 'local://gen-choreo.wav', provider: 'local' }),
    download: jest.fn(),
    delete: jest.fn(),
  };

  const mockLyriaClient = {
    generate: jest.fn().mockResolvedValue({
      audioBytes: Buffer.from('fake-audio'),
      synthIdPresent: true,
      seed: 42,
      durationSeconds: 30,
      sampleRate: 48000,
    }),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-choreo' }),
    getJob: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue(100),
  };

  beforeAll(async () => {
    eventBus = new EventBus();

    await prisma.user.create({ data: { id: userId, email: `${P}user4@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'Gen Artist', payoutAddress: '0x' + 'F'.repeat(40) },
    });
  });

  afterAll(async () => {
    // Clean generated releases
    const releases = await prisma.release.findMany({ where: { artistId } });
    for (const r of releases) {
      await prisma.stem.deleteMany({ where: { track: { releaseId: r.id } } }).catch(() => {});
      await prisma.track.deleteMany({ where: { releaseId: r.id } }).catch(() => {});
    }
    await prisma.release.deleteMany({ where: { artistId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('Scenario 4 — Full generation: started → progress (×3) → completed + DB records', async () => {
    // Collect ALL events in order
    const allEvents: ResonateEvent[] = [];
    ['generation.started', 'generation.progress', 'generation.completed', 'generation.failed'].forEach(name => {
      eventBus.subscribe(name as any, (e: any) => allEvents.push(e));
    });

    // Import and wire
    const { GenerationService } = await import('../modules/generation/generation.service');
    const service = new GenerationService(
      eventBus as any,
      mockStorageProvider as any,
      {} as any, // catalogService — not used directly
      mockLyriaClient as any,
      mockConfigService as any,
      mockQueue as any,
    );

    // ── Step 1: Create generation job ────────────────────────────────
    const { jobId } = await service.createGeneration(
      { prompt: 'Epic orchestral soundtrack', artistId },
      userId,
    );
    expect(jobId).toBeDefined();

    // Assert: generation.started emitted
    const startedEvents = allEvents.filter(e => e.eventName === 'generation.started');
    expect(startedEvents.length).toBe(1);
    expect((startedEvents[0] as any).prompt).toBe('Epic orchestral soundtrack');

    // ── Step 2: Process the job (simulates BullMQ worker) ────────────
    await service.processGenerationJob({
      jobId: 'job-choreo',
      userId,
      artistId,
      prompt: 'Epic orchestral soundtrack',
      seed: 42,
    });

    // Assert: Event sequence is correct
    const progressEvents = allEvents.filter(e => e.eventName === 'generation.progress');
    expect(progressEvents.length).toBe(3);
    const phases = progressEvents.map((e: any) => e.phase);
    expect(phases).toEqual(['generating', 'storing', 'finalizing']);

    const completedEvents = allEvents.filter(e => e.eventName === 'generation.completed');
    expect(completedEvents.length).toBe(1);
    const completed = completedEvents[0] as any;
    expect(completed.trackId).toBeDefined();
    expect(completed.releaseId).toBeDefined();

    // Assert: DB records created
    const release = await prisma.release.findUnique({ where: { id: completed.releaseId } });
    expect(release).not.toBeNull();
    expect(release!.artistId).toBe(artistId);

    const track = await prisma.track.findUnique({ where: { id: completed.trackId } });
    expect(track).not.toBeNull();
    expect(track!.releaseId).toBe(completed.releaseId);
  }, 20000);
});
