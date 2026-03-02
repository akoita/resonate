/**
 * StemsProcessor Tests
 *
 * Verifies that the StemsProcessor correctly:
 * - Resolves relative URIs to absolute URLs for Docker worker
 * - Publishes Pub/Sub jobs with correct message shape
 * - Handles edge cases (no stems, inline data)
 * - Updates DB status after publishing
 */

const mockPublishSeparationJob = jest.fn().mockResolvedValue("msg-456");
const mockUploadToStorage = jest.fn().mockResolvedValue({ uri: "/catalog/stems/uploaded.mp3" });

// Mock prisma
const mockPrismaUpdate = jest.fn().mockResolvedValue({});
const mockPrismaUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

jest.mock("../db/prisma", () => ({
  prisma: {
    release: { update: (...args: any[]) => mockPrismaUpdate(...args) },
    track: { updateMany: (...args: any[]) => mockPrismaUpdateMany(...args) },
  },
}));

import { StemsProcessor } from "../modules/ingestion/stems.processor";

describe("StemsProcessor", () => {
  let processor: StemsProcessor;
  const mockIngestionService = {
    processStemsJob: jest.fn().mockResolvedValue(undefined),
    uploadToStorage: mockUploadToStorage,
  } as any;

  const mockStemPublisher = {
    publishSeparationJob: mockPublishSeparationJob,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STEM_PROCESSING_MODE = "pubsub";
    process.env.BACKEND_URL = "http://host.docker.internal:3000";
    processor = new StemsProcessor(mockIngestionService, mockStemPublisher);
  });

  afterEach(() => {
    delete process.env.STEM_PROCESSING_MODE;
    delete process.env.BACKEND_URL;
  });

  const makeJob = (overrides: Record<string, any> = {}) => ({
    id: "job-1",
    data: {
      releaseId: "rel_test_123",
      artistId: "artist_1",
      tracks: [
        {
          id: "trk_test_456",
          title: "Test Track",
          position: 1,
          stems: [
            {
              id: "stem_orig_1",
              uri: "/catalog/stems/original.m4a/blob",
              mimeType: "audio/mp4",
              durationSeconds: 180,
            },
          ],
        },
      ],
      ...overrides,
    },
  });

  describe("URI resolution", () => {
    it("resolves relative URI to absolute URL with BACKEND_URL", async () => {
      const job = makeJob();
      await processor.process(job as any);

      expect(mockPublishSeparationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          originalStemUri: "http://host.docker.internal:3000/catalog/stems/original.m4a/blob",
        })
      );
    });

    it("passes through already-absolute URIs unchanged", async () => {
      const job = makeJob({
        tracks: [{
          id: "trk_1",
          title: "Test",
          position: 1,
          stems: [{
            id: "stem_1",
            uri: "http://example.com/audio.mp3",
            mimeType: "audio/mpeg",
          }],
        }],
      });

      await processor.process(job as any);

      expect(mockPublishSeparationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          originalStemUri: "http://example.com/audio.mp3",
        })
      );
    });

    it("uses default BACKEND_URL when env var not set", async () => {
      delete process.env.BACKEND_URL;
      const job = makeJob();
      await processor.process(job as any);

      expect(mockPublishSeparationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          originalStemUri: expect.stringContaining("host.docker.internal:3000"),
        })
      );
    });
  });

  describe("job publishing", () => {
    it("publishes one job per track", async () => {
      const job = makeJob({
        tracks: [
          { id: "trk_1", title: "Track 1", position: 1, stems: [{ id: "s1", uri: "/a.mp3", mimeType: "audio/mpeg" }] },
          { id: "trk_2", title: "Track 2", position: 2, stems: [{ id: "s2", uri: "/b.mp3", mimeType: "audio/mpeg" }] },
        ],
      });

      await processor.process(job as any);

      expect(mockPublishSeparationJob).toHaveBeenCalledTimes(2);
    });

    it("includes correct jobId format", async () => {
      const job = makeJob();
      await processor.process(job as any);

      expect(mockPublishSeparationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "sep_rel_test_123_trk_test_456",
        })
      );
    });

    it("passes originalStemMeta through", async () => {
      const job = makeJob();
      await processor.process(job as any);

      expect(mockPublishSeparationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          originalStemMeta: expect.objectContaining({
            id: "stem_orig_1",
            durationSeconds: 180,
          }),
        })
      );
    });
  });

  describe("edge cases", () => {
    it("skips tracks with no stems", async () => {
      const job = makeJob({
        tracks: [{ id: "trk_empty", title: "Empty", position: 1, stems: [] }],
      });

      await processor.process(job as any);

      expect(mockPublishSeparationJob).not.toHaveBeenCalled();
    });

    it("uploads inline data when no URI is provided", async () => {
      const job = makeJob({
        tracks: [{
          id: "trk_inline",
          title: "Inline",
          position: 1,
          stems: [{
            id: "stem_inline",
            data: Buffer.from("fake audio"),
            mimeType: "audio/mpeg",
          }],
        }],
      });

      await processor.process(job as any);

      expect(mockUploadToStorage).toHaveBeenCalled();
      expect(mockPublishSeparationJob).toHaveBeenCalled();
    });
  });

  describe("DB status updates", () => {
    it("updates release status to 'processing'", async () => {
      const job = makeJob();
      await processor.process(job as any);

      expect(mockPrismaUpdate).toHaveBeenCalledWith({
        where: { id: "rel_test_123" },
        data: { status: "processing" },
      });
    });

    it("updates track status to 'separating'", async () => {
      const job = makeJob();
      await processor.process(job as any);

      expect(mockPrismaUpdateMany).toHaveBeenCalledWith({
        where: { id: "trk_test_456" },
        data: { processingStatus: "separating" },
      });
    });
  });

  describe("sync mode", () => {
    it("calls processStemsJob directly in sync mode", async () => {
      process.env.STEM_PROCESSING_MODE = "sync";
      const job = makeJob();
      await processor.process(job as any);

      expect(mockIngestionService.processStemsJob).toHaveBeenCalledWith(job.data);
      expect(mockPublishSeparationJob).not.toHaveBeenCalled();
    });
  });
});
