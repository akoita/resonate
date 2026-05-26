import { Injectable } from "@nestjs/common";
import { WalletService } from "../identity/wallet.service";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { AgentPurchaseService } from "../agents/agent_purchase.service";
import { AgentRuntimeCommerceResult } from "../agents/agent_runtime.types";
import { AgentRuntimeService } from "../agents/agent_runtime.service";

export interface AgentPreferences {
  mood?: string;
  energy?: "low" | "medium" | "high";
  genres?: string[];
  stemTypes?: string[];
  allowExplicit?: boolean;
  licenseType?: "personal" | "remix" | "commercial";
  learnedGenreWeights?: Record<string, number>;
  sessionIntent?: string;
  sessionIntentName?: string;
  queueStyle?: string;
  source?: string;
}

@Injectable()
export class SessionsService {
  private playlistCache = new Map<string, { items: unknown[]; cachedAt: number }>();
  private readonly playlistTtlMs = 15_000;
  private agentPreferences = new Map<string, AgentPreferences>();
  private recentTrackIds = new Map<string, string[]>();

  constructor(
    private readonly walletService: WalletService,
    private readonly eventBus: EventBus,
    private readonly agentRuntimeService: AgentRuntimeService,
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
      this.agentPreferences.set(session.id, input.preferences);
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
      input.listingId !== undefined;

    if (isOnChain) {
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

    const licensedTrack = await prisma.track.findUnique({
      where: { id: input.trackId },
      select: {
        title: true,
        releaseId: true,
        release: { select: { artistId: true } },
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
      artistId: licensedTrack?.release.artistId,
      releaseId: licensedTrack?.releaseId,
      title: licensedTrack?.title,
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
    const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
    if (!session || session.endedAt) {
      return { status: "session_inactive" };
    }

    const preferences = this.mergeAgentPreferences(input.sessionId, input.preferences);
    const recentTrackIds = this.recentTrackIds.get(input.sessionId) ?? [];
    const budgetRemainingUsd = Math.max(0, session.budgetCapUsd - session.spentUsd);
    const result = await this.agentRuntimeService.runCommerce({
      sessionId: input.sessionId,
      userId: session.userId,
      recentTrackIds,
      budgetRemainingUsd,
      preferences,
    });

    return this.toAgentNextResponse(input.sessionId, result);
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

  private mergeAgentPreferences(
    sessionId: string,
    incoming?: AgentPreferences,
  ): AgentPreferences {
    const merged = {
      ...(this.agentPreferences.get(sessionId) ?? {}),
      ...(incoming ?? {}),
    };
    this.agentPreferences.set(sessionId, merged);
    return merged;
  }

  private async toAgentNextResponse(
    sessionId: string,
    result: AgentRuntimeCommerceResult,
  ) {
    const selected = result.primaryTrack;
    if (!selected) {
      return {
        status: result.status,
        tracks: [],
        reason: result.reason,
        generationsUsed: result.generationsUsed,
        generationSpendUsd: result.generationSpendUsd,
      };
    }

    const track = await prisma.track.findUnique({
      where: { id: selected.trackId },
      include: { release: { select: { artistId: true } } },
    });
    if (!track) {
      return {
        status: "no_tracks",
        tracks: [],
        reason: "selected_track_not_found",
      };
    }

    this.rememberRecentTrack(sessionId, track.id);
    this.eventBus.publish({
      eventName: "agent.track_selected",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId,
      trackId: track.id,
      strategy: "runtime",
      preferences: (this.agentPreferences.get(sessionId) ?? {}) as Record<string, unknown>,
    });

    return {
      status: "ok",
      track: {
        id: track.id,
        title: track.title,
        artistId: track.release.artistId,
      },
      licenseType: selected.licenseType,
      priceUsd: selected.priceUsd,
      score: selected.score,
      explanation: selected.explanation,
      signals: selected.signals,
      audioFeatures: selected.audioFeatures,
      runtimeStatus: result.status,
      tracks: result.tracks.map((item) => ({
        trackId: item.trackId,
        licenseType: item.licenseType,
        priceUsd: item.priceUsd,
        reason: item.reason,
        score: item.score,
        explanation: item.explanation,
        signals: item.signals,
      })),
      generationsUsed: result.generationsUsed,
      generationSpendUsd: result.generationSpendUsd,
    };
  }

  private rememberRecentTrack(sessionId: string, trackId: string) {
    const recent = this.recentTrackIds.get(sessionId) ?? [];
    this.recentTrackIds.set(
      sessionId,
      [trackId, ...recent.filter((id) => id !== trackId)].slice(0, 20),
    );
  }
}
