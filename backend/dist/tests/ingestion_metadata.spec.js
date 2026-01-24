"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const event_bus_1 = require("../modules/shared/event_bus");
const ingestion_service_1 = require("../modules/ingestion/ingestion.service");
describe("IngestionService metadata", () => {
    it("publishes metadata on stems.uploaded", () => {
        const eventBus = new event_bus_1.EventBus();
        const service = new ingestion_service_1.IngestionService(eventBus);
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
        expect(received?.metadata).toEqual(metadata);
    });
    it("emits stems.processed and updates status", () => {
        const eventBus = new event_bus_1.EventBus();
        const service = new ingestion_service_1.IngestionService(eventBus);
        let processed;
        eventBus.subscribe("stems.processed", (event) => {
            processed = event;
        });
        const result = service.enqueueUpload({
            artistId: "artist_1",
            fileUris: ["gs://bucket/vocals.wav", "gs://bucket/drums.wav"],
        });
        const status = service.getStatus(result.trackId);
        expect(status.status).toBe("complete");
        expect(processed?.stems?.length).toBe(2);
    });
});
