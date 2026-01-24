"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const payments_service_1 = require("../modules/payments/payments.service");
const event_bus_1 = require("../modules/shared/event_bus");
describe("payments", () => {
    it("applies split config and settles", () => {
        const eventBus = new event_bus_1.EventBus();
        const service = new payments_service_1.PaymentsService(eventBus);
        service.setSplitConfig({ trackId: "track-1", artistPct: 70, mixerPct: 20 });
        const payment = service.initiatePayment({
            sessionId: "session-1",
            amountUsd: 1.5,
            trackId: "track-1",
        });
        const settled = service.splitPayment({
            paymentId: payment.id,
            artistPct: 70,
            mixerPct: 20,
        });
        expect(settled.status).toBe("settled");
        if ("split" in settled) {
            expect(settled.split?.platformPct).toBe(10);
            expect(settled.txHash).toBeDefined();
        }
    });
});
