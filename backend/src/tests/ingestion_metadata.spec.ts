import { EventBus } from "../modules/shared/event_bus";
import { IngestionService } from "../modules/ingestion/ingestion.service";

// Mock dependencies
const mockStorageProvider = { upload: jest.fn(), delete: jest.fn() };
const mockEncryptionService = { encrypt: jest.fn().mockResolvedValue(null), isReady: true };
const mockArtistService = { findById: jest.fn().mockResolvedValue(null) };
const mockQueue = { add: jest.fn() };

describe("IngestionService metadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("publishes metadata on stems.uploaded", () => {
    const eventBus = new EventBus();
    const mockCatalogService = {} as any;
    const service = new IngestionService(
      eventBus,
      mockStorageProvider as any,
      mockEncryptionService as any,
      mockArtistService as any,
      mockCatalogService as any,
      mockQueue as any,
    );
    let received: any;

    eventBus.subscribe("stems.uploaded", (event: any) => {
      received = event;
    });

    const metadata = {
      releaseType: "single",
      releaseTitle: "Night Drive",
      primaryArtist: "Aya Lune",
      featuredArtists: ["Kiro"],
      genre: "Electronic",
      isrc: "US-XYZ-24-00001",
      label: "Resonate Records",
      releaseDate: "2026-01-18",
      explicit: true,
    };

    service.enqueueUpload({
      artistId: "artist_1",
      fileUris: ["gs://bucket/audio.wav"],
      metadata,
    });

    // Verify metadata (ignore auto-generated tracks array)
    const { tracks: _, ...receivedMeta } = received?.metadata || {};
    expect(receivedMeta).toEqual(metadata);
  });

  it("emits stems.processed and updates status", async () => {
    const eventBus = new EventBus();
    const mockCatalogService = {} as any;
    const service = new IngestionService(
      eventBus,
      mockStorageProvider as any,
      mockEncryptionService as any,
      mockArtistService as any,
      mockCatalogService as any,
      mockQueue as any,
    );

    const processedPromise = new Promise((resolve) => {
      eventBus.subscribe("stems.processed", (event: any) => {
        resolve(event);
      });
    });

    const result = service.enqueueUpload({
      artistId: "artist_1",
      fileUris: ["gs://bucket/vocals.wav", "gs://bucket/drums.wav"],
    });

    const processed: any = await processedPromise;
    const status = service.getStatus(result.trackId);
    expect(status.status).toBe("complete");
    expect(processed?.tracks?.[0]?.stems?.length).toBe(2);
  });

  it("uses edited release artist as the track artist when embedded metadata is stale", async () => {
    const eventBus = new EventBus();
    const mockCatalogService = {} as any;
    const service = new IngestionService(
      eventBus,
      mockStorageProvider as any,
      mockEncryptionService as any,
      mockArtistService as any,
      mockCatalogService as any,
      mockQueue as any,
    );
    const uploadedPromise = new Promise<any>((resolve) => {
      eventBus.subscribe("stems.uploaded", resolve);
    });
    const mockFile: Express.Multer.File = {
      buffer: Buffer.from("not real audio"),
      originalname: "Wrong Embedded Artist - Correct Title.mp3",
      mimetype: "audio/mpeg",
      fieldname: "files",
      encoding: "7bit",
      size: 14,
      destination: "",
      filename: "",
      path: "",
      stream: null as any,
    };

    await service.handleFileUpload({
      artistId: "artist_1",
      files: [mockFile],
      metadata: {
        title: "Correct Release",
        primaryArtist: "Correct Artist",
        tracks: [{ title: "Correct Title" }],
      },
    });

    const uploaded = await uploadedPromise;
    expect(uploaded.metadata.tracks[0].artist).toBe("Correct Artist");
  });

  it("queues an existing ready AI-generated release that only has a master stem", async () => {
    const eventBus = new EventBus();
    const mockCatalogService = {
      getRelease: jest.fn().mockResolvedValue({
        id: "rel_ai_1",
        artistId: "artist_1",
        artist: { userId: "user_1" },
        title: "AI Single",
        status: "ready",
        type: "ai_generated",
        primaryArtist: "AI (Lyria)",
        featuredArtists: null,
        genre: "Electronic",
        label: "Resonate Records",
        releaseDate: new Date("2026-04-24T00:00:00.000Z"),
        explicit: false,
        tracks: [{
          id: "trk_ai_1",
          title: "AI Single",
          artist: "AI (Lyria)",
          position: 1,
          explicit: false,
          stems: [{
            id: "stem_master_1",
            uri: "gs://bucket/generated.mp3",
            type: "master",
            durationSeconds: 32,
            storageProvider: "gcs",
          }],
        }],
      }),
      getStemBlob: jest.fn().mockResolvedValue({
        data: Buffer.from("generated audio"),
        mimeType: "audio/mpeg",
      }),
    };
    const service = new IngestionService(
      eventBus,
      mockStorageProvider as any,
      mockEncryptionService as any,
      mockArtistService as any,
      mockCatalogService as any,
      mockQueue as any,
    );
    const uploadedEvents: any[] = [];
    eventBus.subscribe("stems.uploaded", (event: any) => uploadedEvents.push(event));

    const result = await service.retryRelease("rel_ai_1", "user_1");

    expect(result).toEqual({ success: true, releaseId: "rel_ai_1" });
    expect(uploadedEvents).toHaveLength(1);
    expect(uploadedEvents[0].releaseId).toBe("rel_ai_1");
    expect(uploadedEvents[0].metadata.tracks[0].id).toBe("trk_ai_1");
    expect(mockQueue.add).toHaveBeenCalledWith(
      "process-stems",
      expect.objectContaining({
        releaseId: "rel_ai_1",
        artistId: "artist_1",
        tracks: [expect.objectContaining({ id: "trk_ai_1" })],
      }),
      expect.any(Object),
    );
  });

  it("does not queue an existing release that already has separated stems", async () => {
    const eventBus = new EventBus();
    const queue = { add: jest.fn() };
    const mockCatalogService = {
      getRelease: jest.fn().mockResolvedValue({
        id: "rel_ready_1",
        artistId: "artist_1",
        artist: { userId: "user_1" },
        title: "Separated Single",
        status: "ready",
        type: "single",
        tracks: [{
          id: "trk_ready_1",
          title: "Separated Single",
          artist: "Artist",
          position: 1,
          stems: [
            { id: "stem_original_1", uri: "gs://bucket/original.mp3", type: "original" },
            { id: "stem_vocals_1", uri: "gs://bucket/vocals.mp3", type: "vocals" },
          ],
        }],
      }),
      getStemBlob: jest.fn(),
    };
    const service = new IngestionService(
      eventBus,
      mockStorageProvider as any,
      mockEncryptionService as any,
      mockArtistService as any,
      mockCatalogService as any,
      queue as any,
    );

    const result = await service.retryRelease("rel_ready_1", "user_1");

    expect(result).toEqual({
      success: true,
      message: "Release already has separated stems",
      releaseId: "rel_ready_1",
    });
    expect(queue.add).not.toHaveBeenCalled();
    expect(mockCatalogService.getStemBlob).not.toHaveBeenCalled();
  });

  it("rejects retry attempts from non-owners", async () => {
    const eventBus = new EventBus();
    const queue = { add: jest.fn() };
    const mockCatalogService = {
      getRelease: jest.fn().mockResolvedValue({
        id: "rel_other_owner",
        artistId: "artist_1",
        artist: { userId: "owner_user" },
        title: "Owner Only",
        status: "ready",
        type: "ai_generated",
        tracks: [{
          id: "trk_owner_1",
          title: "Owner Only",
          artist: "AI",
          position: 1,
          stems: [{ id: "stem_master_1", uri: "gs://bucket/master.mp3", type: "master" }],
        }],
      }),
      getStemBlob: jest.fn(),
    };
    const service = new IngestionService(
      eventBus,
      mockStorageProvider as any,
      mockEncryptionService as any,
      mockArtistService as any,
      mockCatalogService as any,
      queue as any,
    );

    await expect(service.retryRelease("rel_other_owner", "intruder_user")).rejects.toThrow(
      "Not authorized to retry this release",
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(mockCatalogService.getStemBlob).not.toHaveBeenCalled();
  });
});
