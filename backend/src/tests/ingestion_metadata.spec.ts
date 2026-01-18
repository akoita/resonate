import { EventBus } from "../modules/shared/event_bus";
import { IngestionService } from "../modules/ingestion/ingestion.service";

describe("IngestionService metadata", () => {
  it("publishes metadata on stems.uploaded", () => {
    const eventBus = new EventBus();
    const service = new IngestionService(eventBus);
    let received: any;

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
});
