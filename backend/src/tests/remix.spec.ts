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
