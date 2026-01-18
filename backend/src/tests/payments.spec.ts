import { PaymentsService } from "../modules/payments/payments.service";
import { EventBus } from "../modules/shared/event_bus";

describe("payments", () => {
  it("applies split config and settles", () => {
    const eventBus = new EventBus();
    const service = new PaymentsService(eventBus);
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
