/**
 * Pub/Sub Publisher Tests
 *
 * Verifies that StemPubSubPublisher correctly:
 * - Creates topics when they don't exist
 * - Creates the `stem-separate-worker` subscription
 * - Publishes separation jobs with correct format
 */

// Mock @google-cloud/pubsub before importing anything
const mockPublishMessage = jest.fn().mockResolvedValue("msg-123");
const mockTopicExists = jest.fn();
const mockSubExists = jest.fn();
const mockCreateTopic = jest.fn().mockResolvedValue([{}]);
const mockCreateSubscription = jest.fn().mockResolvedValue([{}]);

const mockTopic = jest.fn().mockReturnValue({
  exists: mockTopicExists,
  publishMessage: mockPublishMessage,
  createSubscription: mockCreateSubscription,
});

const mockSubscription = jest.fn().mockReturnValue({
  exists: mockSubExists,
});

jest.mock("@google-cloud/pubsub", () => ({
  PubSub: jest.fn().mockImplementation(() => ({
    topic: mockTopic,
    subscription: mockSubscription,
    createTopic: mockCreateTopic,
  })),
}));

import { StemPubSubPublisher } from "../modules/ingestion/stem-pubsub.publisher";

describe("StemPubSubPublisher", () => {
  let publisher: StemPubSubPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set emulator host so the graceful-skip guard doesn't trigger
    process.env.PUBSUB_EMULATOR_HOST = "localhost:8085";
    publisher = new StemPubSubPublisher();
  });

  afterEach(() => {
    delete process.env.PUBSUB_EMULATOR_HOST;
  });

  describe("onModuleInit", () => {
    it("creates topics when they don't exist", async () => {
      mockTopicExists.mockResolvedValue([false]);
      mockSubExists.mockResolvedValue([false]);

      await publisher.onModuleInit();

      // Should create both stem-separate and stem-results topics
      expect(mockCreateTopic).toHaveBeenCalledWith("stem-separate");
      expect(mockCreateTopic).toHaveBeenCalledWith("stem-results");
    });

    it("skips topic creation when topics already exist", async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([true]);

      await publisher.onModuleInit();

      expect(mockCreateTopic).not.toHaveBeenCalled();
    });

    it("creates stem-separate-worker subscription when missing", async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([false]);

      await publisher.onModuleInit();

      expect(mockCreateSubscription).toHaveBeenCalledWith(
        "stem-separate-worker",
        expect.objectContaining({ ackDeadlineSeconds: 600 })
      );
    });

    it("skips subscription creation when it already exists", async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([true]);

      await publisher.onModuleInit();

      expect(mockCreateSubscription).not.toHaveBeenCalled();
    });

    it("handles Pub/Sub errors gracefully without throwing", async () => {
      mockTopicExists.mockRejectedValue(new Error("Emulator unreachable"));

      // Should not throw
      await expect(publisher.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe("publishSeparationJob", () => {
    beforeEach(async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([true]);
      await publisher.onModuleInit();
    });

    it("publishes message with correct attributes", async () => {
      const message = {
        jobId: "sep_rel123_trk456",
        releaseId: "rel123",
        artistId: "artist1",
        trackId: "trk456",
        originalStemUri: "http://host.docker.internal:3000/catalog/stems/test.m4a/blob",
        mimeType: "audio/mp4",
      };

      const messageId = await publisher.publishSeparationJob(message);

      expect(messageId).toBe("msg-123");
      expect(mockPublishMessage).toHaveBeenCalledWith({
        data: expect.any(Buffer),
        attributes: {
          jobId: "sep_rel123_trk456",
          releaseId: "rel123",
          trackId: "trk456",
        },
      });

      // Verify the data payload is valid JSON with all fields
      const publishedData = JSON.parse(
        mockPublishMessage.mock.calls[0][0].data.toString()
      );
      expect(publishedData.jobId).toBe("sep_rel123_trk456");
      expect(publishedData.originalStemUri).toContain("host.docker.internal");
    });

    it("includes optional fields when provided", async () => {
      const message = {
        jobId: "sep_rel123_trk456",
        releaseId: "rel123",
        artistId: "artist1",
        trackId: "trk456",
        trackTitle: "My Track",
        trackPosition: 1,
        originalStemUri: "http://host.docker.internal:3000/test.mp3",
        mimeType: "audio/mpeg",
        callbackUrl: "http://host.docker.internal:3000",
        originalStemMeta: { id: "stem1", durationSeconds: 180 },
      };

      await publisher.publishSeparationJob(message);

      const publishedData = JSON.parse(
        mockPublishMessage.mock.calls[0][0].data.toString()
      );
      expect(publishedData.trackTitle).toBe("My Track");
      expect(publishedData.callbackUrl).toBe("http://host.docker.internal:3000");
      expect(publishedData.originalStemMeta.durationSeconds).toBe(180);
    });
  });
});
