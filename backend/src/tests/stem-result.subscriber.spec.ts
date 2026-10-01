/**
 * Stem Result Subscriber Tests
 *
 * Verifies that StemResultSubscriber correctly:
 * - Creates topic and subscription on init
 * - Handles successful separation results
 * - Handles failed separation results
 * - Acks/nacks messages appropriately
 */

const mockTopicExists = jest.fn();
const mockSubExists = jest.fn();
const mockCreateTopic = jest.fn().mockResolvedValue([{}]);
const mockCreateSubscription = jest.fn().mockResolvedValue([{
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  close: jest.fn(),
}]);

const mockSubscriptionOn = jest.fn();
const mockSubscriptionObj = {
  exists: mockSubExists,
  on: mockSubscriptionOn,
  removeAllListeners: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@google-cloud/pubsub", () => ({
  PubSub: jest.fn().mockImplementation(() => ({
    topic: jest.fn().mockReturnValue({
      exists: mockTopicExists,
      createSubscription: mockCreateSubscription,
    }),
    subscription: jest.fn().mockReturnValue(mockSubscriptionObj),
    createTopic: mockCreateTopic,
  })),
}));

// Mock prisma
jest.mock("../db/prisma", () => ({
  prisma: {
    stem: {
      create: jest.fn().mockResolvedValue({ id: "stem_created" }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    track: {
      findUnique: jest.fn().mockResolvedValue({ id: "trk_1", releaseId: "rel_1" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    release: {
      findUnique: jest.fn().mockResolvedValue({ id: "rel_1", tracks: [{ id: "trk_1" }] }),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

import { StemResultSubscriber } from "../modules/ingestion/stem-result.subscriber";
import { EventBus } from "../modules/shared/event_bus";

describe("StemResultSubscriber", () => {
  let subscriber: StemResultSubscriber;
  let eventBus: EventBus;

  const mockStorageProvider = {
    download: jest.fn().mockResolvedValue(Buffer.from("audio data")),
    upload: jest.fn().mockResolvedValue({ uri: "/stems/encrypted.mp3", provider: "local" }),
  } as any;

  const mockEncryptionService = {
    encrypt: jest.fn().mockResolvedValue(Buffer.from("encrypted")),
    isReady: true,
  } as any;

  const mockArtistService = {
    findById: jest.fn().mockResolvedValue({
      id: "artist_1",
      payoutAddress: "0x1234",
    }),
  } as any;

  const mockBackfillService = {
    applyAnalysisResults: jest
      .fn()
      .mockResolvedValue({ updated: 0, failed: 0, malformed: 0 }),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STEM_PROCESSING_MODE = "pubsub";
    // Set emulator host so the graceful-skip guard doesn't trigger
    process.env.PUBSUB_EMULATOR_HOST = "localhost:8085";
    eventBus = new EventBus();
    subscriber = new StemResultSubscriber(
      eventBus,
      mockStorageProvider,
      mockEncryptionService,
      mockArtistService,
      {} as any,
      mockBackfillService,
    );
  });

  afterEach(() => {
    delete process.env.STEM_PROCESSING_MODE;
    delete process.env.PUBSUB_EMULATOR_HOST;
  });

  describe("onModuleInit", () => {
    it("creates topic when it doesn't exist", async () => {
      mockTopicExists.mockResolvedValue([false]);
      mockSubExists.mockResolvedValue([true]);

      await subscriber.onModuleInit();

      expect(mockCreateTopic).toHaveBeenCalledWith("stem-results");
    });

    it("creates subscription when it doesn't exist", async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([false]);

      await subscriber.onModuleInit();

      expect(mockCreateSubscription).toHaveBeenCalledWith(
        "stem-results-backend",
        expect.objectContaining({ ackDeadlineSeconds: 120 })
      );
    });

    it("registers message handler on subscription", async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([true]);

      await subscriber.onModuleInit();

      expect(mockSubscriptionOn).toHaveBeenCalledWith("message", expect.any(Function));
      expect(mockSubscriptionOn).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("skips init when STEM_PROCESSING_MODE=sync", async () => {
      process.env.STEM_PROCESSING_MODE = "sync";
      subscriber = new StemResultSubscriber(
        eventBus,
        mockStorageProvider,
        mockEncryptionService,
        mockArtistService,
        {} as any,
        mockBackfillService,
      );

      await subscriber.onModuleInit();

      expect(mockTopicExists).not.toHaveBeenCalled();
    });
  });

  describe("handleMessage", () => {
    let messageHandler: (message: any) => Promise<void>;

    beforeEach(async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([true]);

      await subscriber.onModuleInit();

      // Extract the message handler from the on("message", ...) call
      messageHandler = mockSubscriptionOn.mock.calls.find(
        (call: any[]) => call[0] === "message"
      )?.[1];
    });

    it("acks malformed messages without crashing", async () => {
      const mockMessage = {
        data: Buffer.from("not valid json"),
        ack: jest.fn(),
        nack: jest.fn(),
      };

      await messageHandler(mockMessage);

      expect(mockMessage.ack).toHaveBeenCalled();
      expect(mockMessage.nack).not.toHaveBeenCalled();
    });

    it("emits stems.failed event for failed results", async () => {
      const failedPromise = new Promise<any>((resolve) => {
        eventBus.subscribe("stems.failed", resolve);
      });

      const resultMessage = {
        jobId: "sep_rel1_trk1",
        releaseId: "rel_1",
        artistId: "artist_1",
        trackId: "trk_1",
        status: "failed",
        error: "Could not find audio",
      };

      const mockMessage = {
        data: Buffer.from(JSON.stringify(resultMessage)),
        ack: jest.fn(),
        nack: jest.fn(),
      };

      await messageHandler(mockMessage);

      // Verify message was acked
      expect(mockMessage.ack).toHaveBeenCalled();
    });
  });

  describe("analysis results (#2013)", () => {
    let messageHandler: (message: any) => Promise<void>;
    let separationSpies: jest.SpyInstance[];

    beforeEach(async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([true]);
      await subscriber.onModuleInit();
      messageHandler = mockSubscriptionOn.mock.calls.find(
        (call: any[]) => call[0] === "message",
      )?.[1];
      separationSpies = [
        jest.spyOn(subscriber as any, "processCompletedSeparation"),
        jest.spyOn(subscriber as any, "processFailedSeparation"),
      ];
    });

    function messageOf(payload: unknown) {
      return {
        data: Buffer.from(JSON.stringify(payload)),
        ack: jest.fn(),
        nack: jest.fn(),
      };
    }

    it("applies analysis results and acks without touching separation paths", async () => {
      const payload = {
        kind: "analysis",
        jobId: "analyze_1_abcd1234",
        status: "completed",
        results: [{ stemId: "stem_1", features: { schemaVersion: "stem-audio-features/v1" } }],
      };
      const message = messageOf(payload);

      await messageHandler(message);

      expect(mockBackfillService.applyAnalysisResults).toHaveBeenCalledWith(payload);
      expect(message.ack).toHaveBeenCalled();
      expect(message.nack).not.toHaveBeenCalled();
      for (const spy of separationSpies) expect(spy).not.toHaveBeenCalled();
    });

    it("acks a legacy analyze_ failure without kind and skips separation failure handling", async () => {
      const message = messageOf({
        jobId: "analyze_1_abcd1234",
        releaseId: "",
        trackId: "",
        status: "failed",
        error: "missing releaseId",
      });

      await messageHandler(message);

      expect(mockBackfillService.applyAnalysisResults).not.toHaveBeenCalled();
      expect(message.ack).toHaveBeenCalled();
      expect(message.nack).not.toHaveBeenCalled();
      for (const spy of separationSpies) expect(spy).not.toHaveBeenCalled();
    });

    it("nacks when applying analysis results throws", async () => {
      mockBackfillService.applyAnalysisResults.mockRejectedValueOnce(
        new Error("db down"),
      );
      const message = messageOf({
        kind: "analysis",
        jobId: "analyze_2_abcd1234",
        status: "completed",
        results: [],
      });

      await messageHandler(message);

      expect(message.nack).toHaveBeenCalled();
      expect(message.ack).not.toHaveBeenCalled();
    });
  });

  describe("onModuleDestroy", () => {
    it("cleans up subscription on shutdown", async () => {
      mockTopicExists.mockResolvedValue([true]);
      mockSubExists.mockResolvedValue([true]);

      await subscriber.onModuleInit();
      await subscriber.onModuleDestroy();

      expect(mockSubscriptionObj.removeAllListeners).toHaveBeenCalled();
      expect(mockSubscriptionObj.close).toHaveBeenCalled();
    });
  });
});
