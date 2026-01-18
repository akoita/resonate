import { Injectable } from "@nestjs/common";

interface PaymentRecord {
  id: string;
  sessionId: string;
  amountUsd: number;
  status: "initiated" | "settled" | "failed";
  split?: { artistPct: number; mixerPct: number; platformPct: number };
}

@Injectable()
export class PaymentsService {
  private payments = new Map<string, PaymentRecord>();

  initiatePayment(input: { sessionId: string; amountUsd: number }) {
    const payment: PaymentRecord = {
      id: this.generateId("pay"),
      sessionId: input.sessionId,
      amountUsd: input.amountUsd,
      status: "initiated",
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  splitPayment(input: { paymentId: string; artistPct: number; mixerPct: number }) {
    const payment = this.payments.get(input.paymentId);
    if (!payment) {
      return { paymentId: input.paymentId, status: "not_found" };
    }
    const platformPct = Math.max(0, 100 - input.artistPct - input.mixerPct);
    payment.split = {
      artistPct: input.artistPct,
      mixerPct: input.mixerPct,
      platformPct,
    };
    payment.status = "settled";
    return payment;
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }
}
