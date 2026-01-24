"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sessions_service_1 = require("../modules/sessions/sessions.service");
const event_bus_1 = require("../modules/shared/event_bus");
const agent_orchestration_service_1 = require("../modules/sessions/agent_orchestration.service");
const sessionStore = {
    "session-1": {
        id: "session-1",
        userId: "user-1",
        budgetCapUsd: 10,
        spentUsd: 0,
        endedAt: null,
    },
};
jest.mock("../db/prisma", () => {
    return {
        prisma: {
            session: {
                create: async ({ data }) => ({
                    id: "session-1",
                    endedAt: null,
                    ...data,
                }),
                findUnique: async ({ where }) => sessionStore[where.id] ?? null,
                update: async ({ where, data }) => {
                    const existing = sessionStore[where.id];
                    const updated = { ...existing, ...data };
                    sessionStore[where.id] = updated;
                    return updated;
                },
            },
            license: {
                create: async () => ({ id: "license-1" }),
            },
            payment: {
                create: async () => ({ id: "payment-1" }),
            },
            track: {
                findMany: async () => [],
            },
        },
    };
});
describe("sessions", () => {
    it("creates license and payment on play", async () => {
        const walletService = {
            spend: async () => ({ allowed: true, remaining: 4 }),
            setBudget: async () => ({}),
        };
        const eventBus = new event_bus_1.EventBus();
        const agentService = new agent_orchestration_service_1.AgentOrchestrationService(eventBus);
        const service = new sessions_service_1.SessionsService(walletService, eventBus, agentService);
        const result = await service.playTrack({
            sessionId: "session-1",
            trackId: "track-1",
            priceUsd: 6,
        });
        expect(result.allowed).toBe(true);
        expect(result.licenseId).toBe("license-1");
        expect(result.paymentId).toBe("payment-1");
    });
});
