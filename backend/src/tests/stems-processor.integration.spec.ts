/**
 * StemsProcessor — Integration Test (Testcontainers)
 *
 * Tests StemsProcessor against real Postgres for DB status updates.
 * Pub/Sub publisher and storage mocked (tested separately).
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { StemsProcessor } from '../modules/ingestion/stems.processor';

const TEST_PREFIX = `sp_${Date.now()}_`;

const mockPublishSeparationJob = jest.fn().mockResolvedValue('msg-456');
const mockUploadToStorage = jest.fn().mockResolvedValue({ uri: '/catalog/stems/uploaded.mp3' });

describe('StemsProcessor (integration)', () => {
  let processor: StemsProcessor;
  let releaseId: string;
  let trackId: string;

  const mockIngestionService = {
    processStemsJob: jest.fn().mockResolvedValue(undefined),
    uploadToStorage: mockUploadToStorage,
  } as any;

  const mockStemPublisher = {
    publishSeparationJob: mockPublishSeparationJob,
  } as any;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, userId: `${TEST_PREFIX}user`, displayName: 'SP Artist', payoutAddress: '0x' + 'S'.repeat(40) },
    });
    releaseId = `${TEST_PREFIX}release`;
    await prisma.release.create({
      data: { id: releaseId, title: 'SP Release', artistId: `${TEST_PREFIX}artist`, status: 'uploaded' },
    });
    trackId = `${TEST_PREFIX}track`;
    await prisma.track.create({
      data: { id: trackId, title: 'SP Track', releaseId, position: 1 },
    });
    const stem = await prisma.stem.create({
      data: { trackId, type: 'master', uri: '/catalog/stems/original.m4a' },
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STEM_PROCESSING_MODE = 'pubsub';
    process.env.BACKEND_URL = 'http://host.docker.internal:3000';
    processor = new StemsProcessor(mockIngestionService, mockStemPublisher);
  });

  afterEach(() => {
    delete process.env.STEM_PROCESSING_MODE;
    delete process.env.BACKEND_URL;
  });

  const makeJob = (overrides: Record<string, any> = {}) => ({
    id: 'job-1',
    data: {
      releaseId,
      artistId: `${TEST_PREFIX}artist`,
      tracks: [
        {
          id: trackId,
          title: 'SP Track',
          position: 1,
          stems: [
            {
              id: 'stem_orig_1',
              uri: '/catalog/stems/original.m4a/blob',
              storageProvider: 'local',
              mimeType: 'audio/mp4',
              durationSeconds: 180,
            },
          ],
        },
      ],
      ...overrides,
    },
  });

  describe('URI resolution', () => {
    it('uses the shared-volume filename for local catalog stems', async () => {
      await processor.process(makeJob() as any);
      expect(mockPublishSeparationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          originalStemUri: 'original.m4a',
        }),
      );
    });

    it('passes through already-absolute URIs unchanged', async () => {
      const job = makeJob({
        tracks: [{
          id: trackId,
          title: 'Test',
          position: 1,
          stems: [{ id: 'stem_1', uri: 'http://example.com/audio.mp3', mimeType: 'audio/mpeg' }],
        }],
      });
      await processor.process(job as any);
      expect(mockPublishSeparationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          originalStemUri: 'http://example.com/audio.mp3',
        }),
      );
    });
  });

  describe('DB status updates', () => {
    it('updates release status to processing in real DB', async () => {
      await processor.process(makeJob() as any);

      const release = await prisma.release.findUnique({ where: { id: releaseId } });
      expect(release!.status).toBe('processing');
    });
  });

  describe('edge cases', () => {
    it('skips tracks with no stems', async () => {
      const job = makeJob({
        tracks: [{ id: 'trk_empty', title: 'Empty', position: 1, stems: [] }],
      });
      await processor.process(job as any);
      expect(mockPublishSeparationJob).not.toHaveBeenCalled();
    });
  });

  describe('sync mode', () => {
    it('calls processStemsJob directly in sync mode', async () => {
      process.env.STEM_PROCESSING_MODE = 'sync';
      const job = makeJob();
      await processor.process(job as any);

      expect(mockIngestionService.processStemsJob).toHaveBeenCalledWith(job.data);
      expect(mockPublishSeparationJob).not.toHaveBeenCalled();
    });
  });
});
