import { Injectable } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";

interface PaymentRecord {
  id: string;
  sessionId: string;
  trackId?: string;
  amountUsd: number;
  status: "initiated" | "settled" | "failed";
  split?: { artistPct: number; mixerPct: number; platformPct: number };
  txHash?: string;
}

@Injectable()
export class PaymentsService {
  private payments = new Map<string, PaymentRecord>();
  private splitConfigByTrack = new Map<
    string,
    { artistPct: number; mixerPct: number }
  >();

  constructor(private readonly eventBus: EventBus) {}

  initiatePayment(input: { sessionId: string; amountUsd: number; trackId?: string }) {
    const payment: PaymentRecord = {
      id: this.generateId("pay"),
      sessionId: input.sessionId,
      trackId: input.trackId,
      amountUsd: input.amountUsd,
      status: "initiated",
    };
    if (input.trackId) {
      const config = this.splitConfigByTrack.get(input.trackId);
      if (config) {
        const platformPct = Math.max(0, 100 - config.artistPct - config.mixerPct);
        payment.split = { ...config, platformPct };
      }
    }
    this.payments.set(payment.id, payment);
    this.eventBus.publish({
      eventName: "payment.initiated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      paymentId: payment.id,
      amountUsd: payment.amountUsd,
      sessionId: payment.sessionId,
      chainId: 0,
    });
    return payment;
  }

  setSplitConfig(input: { trackId: string; artistPct: number; mixerPct: number }) {
    if (input.artistPct + input.mixerPct > 100) {
      return { trackId: input.trackId, status: "invalid_split" };
    }
    this.splitConfigByTrack.set(input.trackId, {
      artistPct: input.artistPct,
      mixerPct: input.mixerPct,
    });
    return { trackId: input.trackId, status: "ok" };
  }

  splitPayment(input: { paymentId: string; artistPct: number; mixerPct: number }) {
    const payment = this.payments.get(input.paymentId);
    if (!payment) {
      return { paymentId: input.paymentId, status: "not_found" };
    }
    if (input.artistPct + input.mixerPct > 100) {
      return { paymentId: input.paymentId, status: "invalid_split" };
    }
    const platformPct = Math.max(0, 100 - input.artistPct - input.mixerPct);
    payment.split = {
      artistPct: input.artistPct,
      mixerPct: input.mixerPct,
      platformPct,
    };
    payment.status = "settled";
    payment.txHash = this.generateId("tx");
    this.eventBus.publish({
      eventName: "payment.settled",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      paymentId: payment.id,
      txHash: payment.txHash,
      status: payment.status,
    });
    return payment;
  }

  confirmOnChain(paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return { paymentId, status: "not_found" };
    }
    return {
      paymentId,
      status: payment.status,
      txHash: payment.txHash ?? null,
    };
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }
}
