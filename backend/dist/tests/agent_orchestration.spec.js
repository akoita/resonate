"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const agent_orchestration_service_1 = require("../modules/sessions/agent_orchestration.service");
const event_bus_1 = require("../modules/shared/event_bus");
jest.mock("../db/prisma", () => {
    return {
        prisma: {
            track: {
                findMany: async () => [
                    {
                        id: "track-1",
                        title: "Nebula Loop",
                        artistId: "artist-1",
                        genre: "ambient",
                        explicit: false,
                    },
                ],
            },
        },
    };
});
describe("agent orchestration", () => {
    it("selects a track and returns price decision", async () => {
        const eventBus = new event_bus_1.EventBus();
        const service = new agent_orchestration_service_1.AgentOrchestrationService(eventBus);
        const result = await service.selectNextTrack({
            sessionId: "session-1",
            preferences: { genres: ["ambient"], licenseType: "personal" },
        });
        expect(result.status).toBe("ok");
        expect(result.track?.id).toBe("track-1");
        expect(result.priceUsd).toBeGreaterThan(0);
    });
});
