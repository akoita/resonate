import { Injectable } from "@nestjs/common";
import { WalletService } from "../identity/wallet.service";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { AgentOrchestrationService, AgentPreferences } from "./agent_orchestration.service";
import { AgentPurchaseService } from "../agents/agent_purchase.service";

@Injectable()
export class SessionsService {
  private playlistCache = new Map<string, { items: unknown[]; cachedAt: number }>();
  private readonly playlistTtlMs = 15_000;
  constructor(
    private readonly walletService: WalletService,
    private readonly eventBus: EventBus,
    private readonly agentService: AgentOrchestrationService,
    private readonly agentPurchaseService: AgentPurchaseService
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

  async playTrack(input: {
    sessionId: string;
    trackId: string;
    priceUsd: number;
    listingId?: bigint;
    tokenId?: bigint;
    amount?: bigint;
    totalPriceWei?: string;
  }) {
    const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
    if (!session || session.endedAt) {
      return { allowed: false, reason: "session_inactive" };
    }

    // Check if agent wallet supports on-chain purchases
    const wallet = await this.walletService.getWallet(session.userId);
    const isOnChain =
      (wallet as any)?.accountType === "erc4337" &&
      process.env.AA_SKIP_BUNDLER !== "true" &&
      input.listingId !== undefined;

    if (isOnChain || (input.listingId !== undefined && process.env.AA_SKIP_BUNDLER === "true")) {
      // Delegate to AgentPurchaseService for on-chain (or mock on-chain) purchase
      const result = await this.agentPurchaseService.purchase({
        sessionId: input.sessionId,
        userId: session.userId,
        listingId: input.listingId!,
        tokenId: input.tokenId ?? BigInt(0),
        amount: input.amount ?? BigInt(1),
        totalPriceWei: input.totalPriceWei ?? "0",
        priceUsd: input.priceUsd,
      });

      if (result.success) {
        await prisma.session.update({
          where: { id: input.sessionId },
          data: { spentUsd: session.spentUsd + input.priceUsd },
        });
      }

      return {
        allowed: result.success,
        reason: result.success ? undefined : (result as any).reason,
        trackId: input.trackId,
        txHash: (result as any).txHash,
        transactionId: (result as any).transactionId,
        remaining: (result as any).remaining,
        mode: (result as any).mode,
      };
    }

    // Fallback: off-chain mock purchase (local wallet or no listing info)
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
    const mockTxHash = `tx_${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        sessionId: input.sessionId,
        amountUsd: input.priceUsd,
        status: "settled",
        txHash: mockTxHash,
      },
    });

    // Also record as AgentTransaction so wallet card surfaces it
    await prisma.agentTransaction.create({
      data: {
        sessionId: input.sessionId,
        userId: session.userId,
        listingId: input.listingId ?? BigInt(0),
        tokenId: input.tokenId ?? BigInt(0),
        amount: input.amount ?? BigInt(1),
        totalPriceWei: input.totalPriceWei ?? "0",
        priceUsd: input.priceUsd,
        status: "confirmed",
        txHash: mockTxHash,
        confirmedAt: new Date(),
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
    const cappedLimit = Math.min(Math.max(limit, 1), 50);
    const cacheKey = `playlist:${cappedLimit}`;
    const cached = this.playlistCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.playlistTtlMs) {
      return { items: cached.items };
    }
    const items = await prisma.track.findMany({
      orderBy: { createdAt: "desc" },
      take: cappedLimit,
      include: { stems: true },
    });
    this.playlistCache.set(cacheKey, { items, cachedAt: Date.now() });
    return { items };
  }
}
