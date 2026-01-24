"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const remix_service_1 = require("../modules/remix/remix.service");
const event_bus_1 = require("../modules/shared/event_bus");
describe("remix", () => {
    it("creates a remix record with tx hash", () => {
        const service = new remix_service_1.RemixService(new event_bus_1.EventBus());
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
