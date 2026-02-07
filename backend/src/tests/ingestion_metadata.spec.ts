import { EventBus } from "../modules/shared/event_bus";
import { IngestionService } from "../modules/ingestion/ingestion.service";

// Mock dependencies
const mockStorageProvider = { upload: jest.fn(), delete: jest.fn() };
const mockEncryptionService = { encrypt: jest.fn().mockResolvedValue(null), isReady: true };
const mockArtistService = { findById: jest.fn().mockResolvedValue(null) };
const mockQueue = { add: jest.fn() };

describe("IngestionService metadata", () => {
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
});
