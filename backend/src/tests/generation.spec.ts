import { EventBus } from '../modules/shared/event_bus';
import { GenerationService } from '../modules/generation/generation.service';

// Mock Prisma
jest.mock('../db/prisma', () => ({
  prisma: {
    release: {
      create: jest.fn().mockResolvedValue({
        id: 'release-1',
        tracks: [{ id: 'track-1' }],
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    artist: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

// Mock dependencies
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

describe('GenerationService', () => {
  let service: GenerationService;
  let eventBus: EventBus;

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
        { prompt: 'Chill lo-fi beats', artistId: 'artist-1' },
        'user-1',
      );

      expect(result.jobId).toBeDefined();
      expect(typeof result.jobId).toBe('string');
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'generate',
        expect.objectContaining({
          userId: 'user-1',
          artistId: 'artist-1',
          prompt: 'Chill lo-fi beats',
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });

    it('emits generation.started event', async () => {
      let receivedEvent: any;
      eventBus.subscribe('generation.started', (event: any) => {
        receivedEvent = event;
      });

      await service.createGeneration(
        { prompt: 'Ambient space music', artistId: 'artist-1' },
        'user-1',
      );

      expect(receivedEvent).toBeDefined();
      expect(receivedEvent.eventName).toBe('generation.started');
      expect(receivedEvent.prompt).toBe('Ambient space music');
      expect(receivedEvent.userId).toBe('user-1');
    });

    it('enforces rate limiting after max generations', async () => {
      // Use up the rate limit (5 per hour)
      for (let i = 0; i < 5; i++) {
        await service.createGeneration(
          { prompt: `Track ${i}`, artistId: 'artist-1' },
          'rate-limit-user',
        );
      }

      // 6th should throw
      await expect(
        service.createGeneration(
          { prompt: 'One too many', artistId: 'artist-1' },
          'rate-limit-user',
        ),
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('allows different users independently', async () => {
      for (let i = 0; i < 5; i++) {
        await service.createGeneration(
          { prompt: `Track ${i}`, artistId: 'artist-1' },
          'user-a',
        );
      }

      // Different user should still be allowed
      const result = await service.createGeneration(
        { prompt: 'Different user track', artistId: 'artist-1' },
        'user-b',
      );
      expect(result.jobId).toBeDefined();
    });
  });

  describe('processGenerationJob', () => {
    it('calls LyriaClient, stores audio, creates DB records, and emits events', async () => {
      const events: any[] = [];
      eventBus.subscribe('generation.progress', (e: any) => events.push(e));
      eventBus.subscribe('generation.completed', (e: any) => events.push(e));

      await service.processGenerationJob({
        jobId: 'job-1',
        userId: 'user-1',
        artistId: 'artist-1',
        prompt: 'Epic orchestral',
        seed: 42,
      });

      // Verify Lyria was called
      expect(mockLyriaClient.generate).toHaveBeenCalledWith({
        prompt: 'Epic orchestral',
        negativePrompt: undefined,
        seed: 42,
      });

      // Verify storage
      expect(mockStorageProvider.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringContaining('generated-'),
        'audio/wav',
      );

      // Verify progress and completion events
      const progressEvents = events.filter(e => e.eventName === 'generation.progress');
      expect(progressEvents.length).toBe(3); // generating, storing, finalizing

      const completedEvent = events.find(e => e.eventName === 'generation.completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent.trackId).toBe('track-1');
      expect(completedEvent.releaseId).toBe('release-1');
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
          userId: 'user-1',
          artistId: 'artist-1',
          prompt: 'Test failure',
        }),
      ).rejects.toThrow('Quota exceeded');

      expect(failedEvent).toBeDefined();
      expect(failedEvent.eventName).toBe('generation.failed');
      expect(failedEvent.error).toBe('Quota exceeded');
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
      expect(status.trackId).toBe('track-1');
      expect(status.releaseId).toBe('release-1');
    });

    it('returns failed status for unknown job', async () => {
      mockQueue.getJob.mockResolvedValueOnce(null);

      const status = await service.getStatus('nonexistent');
      expect(status.status).toBe('failed');
      expect(status.error).toBe('Job not found');
    });
  });

  describe('listUserGenerations', () => {
    // Access the mocked prisma via require (avoids hoisting issues)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prisma: mockedPrisma } = require('../db/prisma');

    it('returns flattened track list for a user with generations', async () => {
      mockedPrisma.artist.findFirst.mockResolvedValueOnce({ id: 'artist-1' });
      mockedPrisma.release.findMany.mockResolvedValueOnce([
        {
          id: 'release-10',
          createdAt: new Date('2026-02-18T12:00:00Z'),
          tracks: [
            {
              id: 'track-10',
              title: 'Ambient forest vibes',
              generationMetadata: {
                prompt: 'Ambient forest vibes',
                negativePrompt: 'drums',
                seed: 99,
                provider: 'lyria-002',
                generatedAt: '2026-02-18T12:00:00Z',
                durationSeconds: 30,
                cost: 0.06,
              },
              stems: [{ type: 'master', uri: 'local://gen-10.wav' }],
            },
          ],
        },
      ]);

      const result = await service.listUserGenerations('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        releaseId: 'release-10',
        trackId: 'track-10',
        prompt: 'Ambient forest vibes',
        negativePrompt: 'drums',
        seed: 99,
        audioUri: 'local://gen-10.wav',
      });
    });

    it('returns empty array when user has no artist', async () => {
      mockedPrisma.artist.findFirst.mockResolvedValueOnce(null);

      const result = await service.listUserGenerations('no-artist-user');
      expect(result).toEqual([]);
    });
  });

  describe('getAnalytics', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prisma: analyticsPrisma } = require('../db/prisma');

    it('returns totals and full rate limit for user with generations', async () => {
      analyticsPrisma.artist.findFirst.mockResolvedValueOnce({ id: 'artist-1' });
      analyticsPrisma.release.count.mockResolvedValueOnce(10);

      const result = await service.getAnalytics('user-1');

      expect(result.totalGenerations).toBe(10);
      expect(result.totalCost).toBe(0.6);
      expect(result.rateLimit.limit).toBe(5);
      expect(result.rateLimit.remaining).toBe(5); // no in-memory usage
      expect(result.rateLimit.resetsAt).toBeNull();
    });

    it('returns zeros when user has no artist', async () => {
      analyticsPrisma.artist.findFirst.mockResolvedValueOnce(null);

      const result = await service.getAnalytics('no-artist-user');

      expect(result.totalGenerations).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.rateLimit.remaining).toBe(5);
    });

    it('tracks rate limit after active generations', async () => {
      analyticsPrisma.artist.findFirst.mockResolvedValueOnce({ id: 'artist-1' });
      analyticsPrisma.release.count.mockResolvedValueOnce(3);

      // Simulate 2 recent generations in the rate limiter
      await service.createGeneration({ prompt: 'test-a', artistId: 'artist-1' }, 'rl-user');
      await service.createGeneration({ prompt: 'test-b', artistId: 'artist-1' }, 'rl-user');

      analyticsPrisma.artist.findFirst.mockResolvedValueOnce({ id: 'artist-1' });
      analyticsPrisma.release.count.mockResolvedValueOnce(3);
      const result = await service.getAnalytics('rl-user');

      expect(result.rateLimit.remaining).toBe(3); // 5 - 2
      expect(result.rateLimit.resetsAt).toBeDefined();
    });
  });
});
