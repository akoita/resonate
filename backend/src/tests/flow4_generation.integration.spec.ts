/**
 * Choreography Flow 4 — AI Generation Pipeline
 *
 * Tests the event chain: GenerationService.createGeneration → generation.started
 * → processGenerationJob → generation.progress (×3) → generation.completed + DB records
 *
 * LyriaClient is mocked (external Google AI service — cannot use Testcontainer).
 * StorageProvider is mocked (not testing storage layer here — tested in storage.integration).
 * BullMQ queue is mocked (infrastructure scheduling — not the flow under test).
 * Everything else is real: EventBus, GenerationService, Postgres.
 *
 * See: backend/CHOREOGRAPHY.md (Flow 4) for sequence diagrams.
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { GenerationService } from '../modules/generation/generation.service';
import type { ResonateEvent } from '../events/event_types';

const P = `cf4_${Date.now()}_`;

describe('Choreography Flow 4: AI Generation Pipeline', () => {
  let eventBus: EventBus;
  let service: GenerationService;

  const userId = `${P}user`;
  const artistId = `${P}artist`;

  // External Google AI client — must be mocked (no local Testcontainer available)
  const lyriaClient = {
    generate: jest.fn().mockResolvedValue({
      audioBytes: Buffer.from('fake-audio'),
      synthIdPresent: true,
      seed: 42,
      durationSeconds: 30,
      sampleRate: 48000,
    }),
  };

  // Storage — mocked (separately tested in storage.integration.spec.ts)
  const storageProvider = {
    upload: jest.fn().mockResolvedValue({ uri: 'local://gen-flow4.wav', provider: 'local' }),
    download: jest.fn(),
    delete: jest.fn(),
  };

  // BullMQ queue — mock job scheduling (infrastructure, not the flow under test)
  const queue = {
    add: jest.fn().mockResolvedValue({ id: 'flow4-job' }),
    getJob: jest.fn(),
  };

  const configService = { get: jest.fn().mockReturnValue(100) };

  beforeAll(async () => {
    eventBus = new EventBus();

    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'Gen Artist', payoutAddress: '0x' + 'F'.repeat(40) },
    });

    service = new GenerationService(
      eventBus as any,
      storageProvider as any,
      {} as any,
      lyriaClient as any,
      configService as any,
      queue as any,
    );
  });

  afterAll(async () => {
    const releases = await prisma.release.findMany({ where: { artistId } });
    for (const r of releases) {
      await prisma.stem.deleteMany({ where: { track: { releaseId: r.id } } }).catch(() => {});
      await prisma.track.deleteMany({ where: { releaseId: r.id } }).catch(() => {});
    }
    await prisma.release.deleteMany({ where: { artistId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('Full generation: started → progress (×3) → completed + DB records', async () => {
    // Collect ALL events in order
    const allEvents: ResonateEvent[] = [];
    ['generation.started', 'generation.progress', 'generation.completed', 'generation.failed'].forEach(name => {
      eventBus.subscribe(name as any, (e: any) => allEvents.push(e));
    });

    // Step 1: Create generation job
    const { jobId } = await service.createGeneration(
      { prompt: 'Epic orchestral soundtrack', artistId },
      userId,
    );
    expect(jobId).toBeDefined();

    // Assert: generation.started emitted
    const startedEvents = allEvents.filter(e => e.eventName === 'generation.started');
    expect(startedEvents.length).toBe(1);
    expect((startedEvents[0] as any).prompt).toBe('Epic orchestral soundtrack');

    // Step 2: Process the job (simulates BullMQ worker picking up the job)
    await service.processGenerationJob({
      jobId: 'flow4-job',
      userId,
      artistId,
      prompt: 'Epic orchestral soundtrack',
      seed: 42,
    });

    // Assert: Event sequence is correct
    const progressEvents = allEvents.filter(e => e.eventName === 'generation.progress');
    expect(progressEvents.length).toBe(3);
    expect(progressEvents.map((e: any) => e.phase)).toEqual(['generating', 'storing', 'finalizing']);

    const completedEvents = allEvents.filter(e => e.eventName === 'generation.completed');
    expect(completedEvents.length).toBe(1);
    const completed = completedEvents[0] as any;
    expect(completed.trackId).toBeDefined();
    expect(completed.releaseId).toBeDefined();

    // Assert: DB records created (real Postgres)
    const release = await prisma.release.findUnique({ where: { id: completed.releaseId } });
    expect(release).not.toBeNull();
    expect(release!.artistId).toBe(artistId);

    const track = await prisma.track.findUnique({ where: { id: completed.trackId } });
    expect(track).not.toBeNull();
    expect(track!.releaseId).toBe(completed.releaseId);
  }, 20000);
});
