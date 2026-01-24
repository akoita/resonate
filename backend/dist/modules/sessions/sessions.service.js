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
exports.SessionsService = void 0;
const common_1 = require("@nestjs/common");
const wallet_service_1 = require("../identity/wallet.service");
const prisma_1 = require("../../db/prisma");
const event_bus_1 = require("../shared/event_bus");
const agent_orchestration_service_1 = require("./agent_orchestration.service");
let SessionsService = class SessionsService {
    walletService;
    eventBus;
    agentService;
    playlistCache = new Map();
    playlistTtlMs = 15_000;
    constructor(walletService, eventBus, agentService) {
        this.walletService = walletService;
        this.eventBus = eventBus;
        this.agentService = agentService;
    }
    async startSession(input) {
        await this.walletService.setBudget({
            userId: input.userId,
            monthlyCapUsd: input.budgetCapUsd,
        });
        const session = await prisma_1.prisma.session.create({
            data: {
                userId: input.userId,
                budgetCapUsd: input.budgetCapUsd,
                spentUsd: 0,
            },
        });
        if (input.preferences) {
            this.agentService.configureSession(session.id, input.preferences);
        }
        this.eventBus.publish({
            eventName: "session.started",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: session.id,
            userId: input.userId,
            budgetCapUsd: input.budgetCapUsd,
            preferences: (input.preferences ?? {}),
        });
        return session;
    }
    async stopSession(sessionId) {
        const session = await prisma_1.prisma.session.findUnique({ where: { id: sessionId } });
        if (!session) {
            return { sessionId, status: "not_found" };
        }
        await prisma_1.prisma.session.update({
            where: { id: sessionId },
            data: { endedAt: new Date() },
        });
        this.eventBus.publish({
            eventName: "session.ended",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId,
            spentTotalUsd: session.spentUsd,
            reason: "user_stop",
        });
        return {
            sessionId,
            status: "stopped",
            spentUsd: session.spentUsd,
            remaining: session.budgetCapUsd - session.spentUsd,
        };
    }
    async playTrack(input) {
        const session = await prisma_1.prisma.session.findUnique({ where: { id: input.sessionId } });
        if (!session || session.endedAt) {
            return { allowed: false, reason: "session_inactive" };
        }
        const spend = await this.walletService.spend(session.userId, input.priceUsd);
        if (!spend.allowed) {
            return { allowed: false, reason: "budget_exceeded", remaining: spend.remaining };
        }
        const updated = await prisma_1.prisma.session.update({
            where: { id: input.sessionId },
            data: { spentUsd: session.spentUsd + input.priceUsd },
        });
        const license = await prisma_1.prisma.license.create({
            data: {
                sessionId: input.sessionId,
                trackId: input.trackId,
                type: "personal",
                priceUsd: input.priceUsd,
                durationSeconds: 30,
            },
        });
        const payment = await prisma_1.prisma.payment.create({
            data: {
                sessionId: input.sessionId,
                amountUsd: input.priceUsd,
                status: "settled",
                txHash: `tx_${Date.now()}`,
            },
        });
        this.eventBus.publish({
            eventName: "license.granted",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            licenseId: license.id,
            type: "personal",
            priceUsd: input.priceUsd,
            sessionId: input.sessionId,
            trackId: input.trackId,
        });
        return {
            allowed: true,
            trackId: input.trackId,
            spentUsd: updated.spentUsd,
            remaining: spend.remaining,
            licenseId: license.id,
            paymentId: payment.id,
        };
    }
    async agentNext(input) {
        return this.agentService.selectNextTrack(input);
    }
    async getPlaylist(limit = 10) {
        const cappedLimit = Math.min(Math.max(limit, 1), 50);
        const cacheKey = `playlist:${cappedLimit}`;
        const cached = this.playlistCache.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < this.playlistTtlMs) {
            return { items: cached.items };
        }
        const items = await prisma_1.prisma.track.findMany({
            orderBy: { createdAt: "desc" },
            take: cappedLimit,
            include: { stems: true },
        });
        this.playlistCache.set(cacheKey, { items, cachedAt: Date.now() });
        return { items };
    }
};
exports.SessionsService = SessionsService;
exports.SessionsService = SessionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [wallet_service_1.WalletService,
        event_bus_1.EventBus,
        agent_orchestration_service_1.AgentOrchestrationService])
], SessionsService);
