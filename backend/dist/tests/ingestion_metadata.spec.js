"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const event_bus_1 = require("../modules/shared/event_bus");
const ingestion_service_1 = require("../modules/ingestion/ingestion.service");
// Mock dependencies
const mockStorageProvider = { upload: jest.fn(), delete: jest.fn() };
const mockEncryptionService = { encrypt: jest.fn().mockResolvedValue(null), isReady: true };
const mockArtistService = { findById: jest.fn().mockResolvedValue(null) };
const mockQueue = { add: jest.fn() };
describe("IngestionService metadata", () => {
    it("publishes metadata on stems.uploaded", () => {
        const eventBus = new event_bus_1.EventBus();
        const mockCatalogService = {};
        const service = new ingestion_service_1.IngestionService(eventBus, mockStorageProvider, mockEncryptionService, mockArtistService, mockCatalogService, mockQueue);
        let received;
        eventBus.subscribe("stems.uploaded", (event) => {
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
        const eventBus = new event_bus_1.EventBus();
        const mockCatalogService = {};
        const service = new ingestion_service_1.IngestionService(eventBus, mockStorageProvider, mockEncryptionService, mockArtistService, mockCatalogService, mockQueue);
        const processedPromise = new Promise((resolve) => {
            eventBus.subscribe("stems.processed", (event) => {
                resolve(event);
            });
        });
        const result = service.enqueueUpload({
            artistId: "artist_1",
            fileUris: ["gs://bucket/vocals.wav", "gs://bucket/drums.wav"],
        });
        const processed = await processedPromise;
        const status = service.getStatus(result.trackId);
        expect(status.status).toBe("complete");
        expect(processed?.tracks?.[0]?.stems?.length).toBe(2);
    });
});
