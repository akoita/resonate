import { Injectable } from "@nestjs/common";
import { WalletService } from "../identity/wallet.service";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { AgentOrchestrationService, AgentPreferences } from "./agent_orchestration.service";

@Injectable()
export class SessionsService {
  constructor(
    private readonly walletService: WalletService,
    private readonly eventBus: EventBus,
    private readonly agentService: AgentOrchestrationService
  ) {}

  async startSession(input: {
    userId: string;
    budgetCapUsd: number;
    preferences?: AgentPreferences;
  }) {
    await this.walletService.setBudget({
      userId: input.userId,
      monthlyCapUsd: input.budgetCapUsd,
    });
    const session = await prisma.session.create({
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
      preferences: (input.preferences ?? {}) as Record<string, unknown>,
    });
    return session;
  }

  async stopSession(sessionId: string) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return { sessionId, status: "not_found" };
    }
    await prisma.session.update({
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

  async playTrack(input: { sessionId: string; trackId: string; priceUsd: number }) {
    const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
    if (!session || session.endedAt) {
      return { allowed: false, reason: "session_inactive" };
    }
    const spend = await this.walletService.spend(session.userId, input.priceUsd);
    if (!spend.allowed) {
      return { allowed: false, reason: "budget_exceeded", remaining: spend.remaining };
    }
    const updated = await prisma.session.update({
      where: { id: input.sessionId },
      data: { spentUsd: session.spentUsd + input.priceUsd },
    });
    const license = await prisma.license.create({
      data: {
        sessionId: input.sessionId,
        trackId: input.trackId,
        type: "personal",
        priceUsd: input.priceUsd,
        durationSeconds: 30,
      },
    });
    const payment = await prisma.payment.create({
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

  async agentNext(input: { sessionId: string; preferences?: AgentPreferences }) {
    return this.agentService.selectNextTrack(input);
  }

  async getPlaylist(limit = 10) {
    const items = await prisma.track.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { stems: true },
    });
    return { items };
  }
}
