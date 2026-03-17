/**
 * Generation Service — Integration Test (Testcontainers)
 *
 * Tests GenerationService against real Postgres and real BullMQ/Redis.
 * LyriaClient stays mocked — external Google AI service (no local container).
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { GenerationService } from '../modules/generation/generation.service';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

const TEST_PREFIX = `gen_${Date.now()}_`;

// Real storage provider — writes to local filesystem (no external deps)
const storageProvider = new LocalStorageProvider();

// LyriaClient must stay mocked — external Google AI service (no local container)
const mockLyriaClient = {
  generate: jest.fn().mockResolvedValue({
    audioBytes: Buffer.from('fake-audio-data'),
    synthIdPresent: true,
    seed: 42,
    durationSeconds: 30,
    sampleRate: 48000,
  }),
};

// Real ConfigService with test defaults
const configService = new ConfigService({
  STRIKE_RATE_LIMIT: 5,
});

describe('GenerationService (integration)', () => {
  let service: GenerationService;
  let eventBus: EventBus;
  let generationQueue: Queue | null = null;

  const isIgnorableQueueError = (error: Error) =>
    error.message.includes('Connection is closed') ||
    error.message.includes('ECONNREFUSED');

  const cleanupQueue = async () => {
    if (!generationQueue) return;

    const queue = generationQueue;
    generationQueue = null;

    await queue.disconnect().catch((error: Error) => {
      if (!isIgnorableQueueError(error)) {
        throw error;
      }
    });
  };

  beforeAll(async () => {
    // Seed user + artist for generation tests
    await prisma.user.create({ data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, userId: `${TEST_PREFIX}user`, displayName: 'Gen Artist', payoutAddress: '0x' + 'G'.repeat(40) },
    });
  });

  afterAll(async () => {
    // Clean up generated releases
    const releases = await prisma.release.findMany({ where: { artistId: `${TEST_PREFIX}artist` } });
    for (const r of releases) {
      await prisma.stem.deleteMany({ where: { track: { releaseId: r.id } } }).catch(() => {});
      await prisma.track.deleteMany({ where: { releaseId: r.id } }).catch(() => {});
    }
    await prisma.release.deleteMany({ where: { artistId: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
    await cleanupQueue();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    eventBus = new EventBus();

    // Real BullMQ Queue backed by Testcontainers Redis
    const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
    generationQueue = new Queue(`generation_test_${Date.now()}`, {
      connection: { host: redisUrl.hostname, port: parseInt(redisUrl.port || '6379') },
    });
    generationQueue.on('error', (error) => {
      if (!isIgnorableQueueError(error)) {
        // Surface unexpected BullMQ failures without crashing Jest teardown.
        console.error(error);
      }
    });

    service = new GenerationService(
      eventBus,
      storageProvider as any,
      {} as any,  // CatalogService — not called in create/process paths
      mockLyriaClient as any,
      configService as any,
      generationQueue as any,
    );
  });

  afterEach(async () => {
    await cleanupQueue();
  });

  describe('createGeneration', () => {
    it('enqueues a BullMQ job and returns a jobId', async () => {
      const result = await service.createGeneration(
        { prompt: 'Chill lo-fi beats', artistId: `${TEST_PREFIX}artist` },
        `${TEST_PREFIX}user`,
      );
      expect(result.jobId).toBeDefined();
      expect(typeof result.jobId).toBe('string');

      // Verify job was actually enqueued in real Redis
      expect(generationQueue).not.toBeNull();
      const job = await generationQueue!.getJob(result.jobId);
      expect(job).not.toBeNull();
    });

    it('emits generation.started event', async () => {
      let receivedEvent: any;
      eventBus.subscribe('generation.started', (event: any) => {
        receivedEvent = event;
      });

      await service.createGeneration(
        { prompt: 'Ambient space music', artistId: `${TEST_PREFIX}artist` },
        `${TEST_PREFIX}user`,
      );

      expect(receivedEvent).toBeDefined();
      expect(receivedEvent.eventName).toBe('generation.started');
      expect(receivedEvent.prompt).toBe('Ambient space music');
    });

    it('enforces rate limiting after max generations', async () => {
      for (let i = 0; i < 5; i++) {
        await service.createGeneration(
          { prompt: `Track ${i}`, artistId: `${TEST_PREFIX}artist` },
          'rate-limit-user',
        );
      }
      await expect(
        service.createGeneration(
          { prompt: 'One too many', artistId: `${TEST_PREFIX}artist` },
          'rate-limit-user',
        ),
      ).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('processGenerationJob', () => {
    it('calls LyriaClient, stores audio, creates DB records, and emits events', async () => {
      const events: any[] = [];
      eventBus.subscribe('generation.progress', (e: any) => events.push(e));
      eventBus.subscribe('generation.completed', (e: any) => events.push(e));

      await service.processGenerationJob({
        jobId: 'job-1',
        userId: `${TEST_PREFIX}user`,
        artistId: `${TEST_PREFIX}artist`,
        prompt: 'Epic orchestral',
        seed: 42,
      });

      expect(mockLyriaClient.generate).toHaveBeenCalled();

      const progressEvents = events.filter(e => e.eventName === 'generation.progress');
      expect(progressEvents.length).toBe(3);

      const completedEvent = events.find(e => e.eventName === 'generation.completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent.trackId).toBeDefined();
      expect(completedEvent.releaseId).toBeDefined();

      // Verify real release was created in DB
      const release = await prisma.release.findUnique({ where: { id: completedEvent.releaseId } });
      expect(release).not.toBeNull();
    });

    it('emits generation.failed on LyriaClient error', async () => {
      mockLyriaClient.generate.mockRejectedValueOnce(new Error('Quota exceeded'));

      let failedEvent: any;
      eventBus.subscribe('generation.failed', (e: any) => {
        failedEvent = e;
      });

      await expect(
        service.processGenerationJob({
          jobId: 'job-fail',
          userId: `${TEST_PREFIX}user`,
          artistId: `${TEST_PREFIX}artist`,
          prompt: 'Test failure',
        }),
      ).rejects.toThrow('Quota exceeded');

      expect(failedEvent).toBeDefined();
      expect(failedEvent.eventName).toBe('generation.failed');
    });
  });

  describe('getStatus', () => {
    it('returns job status from real BullMQ', async () => {
      // Enqueue a real job first
      const result = await service.createGeneration(
        { prompt: 'Status check track', artistId: `${TEST_PREFIX}artist` },
        `${TEST_PREFIX}user`,
      );

      const status = await service.getStatus(result.jobId);
      // Job is waiting (no worker to process it)
      expect(['waiting', 'delayed', 'active', 'queued']).toContain(status.status);
    });

    it('returns failed status for unknown job', async () => {
      const status = await service.getStatus('nonexistent');
      expect(status.status).toBe('failed');
      expect(status.error).toBe('Job not found');
    });
  });

  describe('listUserGenerations', () => {
    it('returns empty array when user has no artist', async () => {
      const result = await service.listUserGenerations('no-artist-user');
      expect(result).toEqual([]);
    });
  });
});
