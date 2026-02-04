"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const recommendations_service_1 = require("../modules/recommendations/recommendations.service");
const event_bus_1 = require("../modules/shared/event_bus");
jest.mock("../db/prisma", () => {
    return {
        prisma: {
            track: {
                findMany: async () => [
                    { id: "track-1", title: "Pulse", artistId: "artist-1", explicit: false, release: { artistId: "artist-1" } },
                    { id: "track-2", title: "Glow", artistId: "artist-2", explicit: false, release: { artistId: "artist-2" } },
                ],
            },
        },
    };
});
describe("recommendations", () => {
    it("returns recommended tracks with preferences", async () => {
        const service = new recommendations_service_1.RecommendationsService(new event_bus_1.EventBus());
        service.setPreferences("user-1", { genres: ["electronic"], energy: "high" });
        const result = await service.getRecommendations("user-1", 1);
        expect(result.items.length).toBe(1);
        expect(result.preferences.energy).toBe("high");
    });
});
