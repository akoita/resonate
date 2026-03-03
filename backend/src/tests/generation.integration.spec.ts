/**
 * Generation Service — Integration Test (Testcontainers)
 *
 * Tests GenerationService against real Postgres for artist/release creation.
 * External services (Lyria AI, storage, BullMQ) stay mocked per policy.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { GenerationService } from '../modules/generation/generation.service';

const TEST_PREFIX = `gen_${Date.now()}_`;

const mockStorageProvider = {
  upload: jest.fn().mockResolvedValue({ uri: 'local://generated-test.wav', provider: 'local' }),
  download: jest.fn(),
  delete: jest.fn(),
};

const mockLyriaClient = {
  generate: jest.fn().mockResolvedValue({
    audioBytes: Buffer.from('fake-audio-data'),
    synthIdPresent: true,
    seed: 42,
    durationSeconds: 30,
    sampleRate: 48000,
  }),
};

const mockCatalogService = {} as any;

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  getJob: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultValue: any) => {
    if (key === 'STRIKE_RATE_LIMIT') return 5;
    return defaultValue;
  }),
};

describe('GenerationService (integration)', () => {
  let service: GenerationService;
  let eventBus: EventBus;

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
  });

  beforeEach(() => {
    jest.clearAllMocks();
    eventBus = new EventBus();
    service = new GenerationService(
      eventBus,
      mockStorageProvider as any,
      mockCatalogService,
      mockLyriaClient as any,
      mockConfigService as any,
      mockQueue as any,
    );
  });

  describe('createGeneration', () => {
    it('enqueues a BullMQ job and returns a jobId', async () => {
      const result = await service.createGeneration(
        { prompt: 'Chill lo-fi beats', artistId: `${TEST_PREFIX}artist` },
        `${TEST_PREFIX}user`,
      );
      expect(result.jobId).toBeDefined();
      expect(typeof result.jobId).toBe('string');
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
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
      expect(mockStorageProvider.upload).toHaveBeenCalled();

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
    it('returns job status from BullMQ', async () => {
      mockQueue.getJob.mockResolvedValueOnce({
        getState: jest.fn().mockResolvedValue('completed'),
        timestamp: Date.now(),
        returnvalue: { trackId: 'track-1', releaseId: 'release-1' },
      });

      const status = await service.getStatus('job-1');
      expect(status.status).toBe('completed');
    });

    it('returns failed status for unknown job', async () => {
      mockQueue.getJob.mockResolvedValueOnce(null);
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
