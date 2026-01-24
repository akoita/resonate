"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentsService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
let PaymentsService = class PaymentsService {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.payments = new Map();
        this.splitConfigByTrack = new Map();
    }
    initiatePayment(input) {
        const payment = {
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
    setSplitConfig(input) {
        if (input.artistPct + input.mixerPct > 100) {
            return { trackId: input.trackId, status: "invalid_split" };
        }
        this.splitConfigByTrack.set(input.trackId, {
            artistPct: input.artistPct,
            mixerPct: input.mixerPct,
        });
        return { trackId: input.trackId, status: "ok" };
    }
    splitPayment(input) {
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
    confirmOnChain(paymentId) {
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
    generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }
};
exports.PaymentsService = PaymentsService;
exports.PaymentsService = PaymentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus])
], PaymentsService);
