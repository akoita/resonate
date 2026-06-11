import { RemixService } from "../modules/remix/remix.service";
import { EventBus } from "../modules/shared/event_bus";

describe("remix", () => {
  it("creates a remix record with tx hash", () => {
    const service = new RemixService(new EventBus());
    const result = service.createRemix({
      creatorId: "user-1",
      sourceTrackId: "track-1",
      stemIds: ["stem-1", "stem-2"],
      title: "Neon Drift (Remix)",
    });

    expect(result.remixId).toBeDefined();
    expect(result.txHash).toBeDefined();
    expect(result.status).toBe("submitted");
  });
});

import {
  draftMimeTypeFromMetadata,
  draftMimeTypeFromUri,
} from "../modules/remix/remix-project.service";

describe("draftMimeTypeFromUri (#1165 review fix)", () => {
  it("derives the stored draft's mime from its URI instead of assuming mpeg", () => {
    // D2's Lyria provider writes .wav files.
    expect(draftMimeTypeFromUri("/storage/remix-draft-p1-j1.wav")).toBe("audio/wav");
    expect(draftMimeTypeFromUri("/storage/remix-drafts/playable.mp3")).toBe("audio/mpeg");
    // The local provider's URIs end in a /blob segment, not the filename.
    expect(draftMimeTypeFromUri("/catalog/stems/remix-draft-p1-j1.wav/blob")).toBe("audio/wav");
    expect(draftMimeTypeFromUri("/storage/unknown-format")).toBe("application/octet-stream");
  });
});

describe("draftMimeTypeFromMetadata (#1166 review port)", () => {
  it("prefers the provider-recorded mime over any URI heuristic", () => {
    expect(
      draftMimeTypeFromMetadata({ output: { mimeType: "audio/wav", outputUri: "/x.mp3" } }),
    ).toBe("audio/wav");
  });

  it("returns null for drafts stored before mimeType was recorded", () => {
    expect(draftMimeTypeFromMetadata({ output: { outputUri: "/x.wav" } })).toBeNull();
    expect(draftMimeTypeFromMetadata({ output: { mimeType: "  " } })).toBeNull();
    expect(draftMimeTypeFromMetadata(null)).toBeNull();
  });
});
