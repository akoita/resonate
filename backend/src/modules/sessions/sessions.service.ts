import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { WalletService } from "../identity/wallet.service";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { AgentPurchaseService } from "../agents/agent_purchase.service";
import { AgentRuntimeCommerceResult } from "../agents/agent_runtime.types";
import { AgentRuntimeService } from "../agents/agent_runtime.service";
import type { MyMixPreferences } from "../agents/agent_my_mix";
import { djPickVariantFields } from "./dj_pick_variant";
import { AgentLearningService } from "../agents/agent_learning.service";
import { getAgentTrackLimit } from "../agents/agent_runtime.config";
import { resolveListeningLanes } from "../agents/listening_lanes.service";
import { resolveMyMixPlan } from "../agents/agent_my_mix";
import { UnmetDemandService } from "../scene_scout/unmet_demand.service";
import { mergeSessionGenres } from "../agents/agent_session_genres";
import {
  requestRankingPreferences,
  sanitizeSessionRequest,
  type AgentSessionRequest,
} from "../agents/agent_session_request";

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
  /**
   * Listening filters parsed from the listener's own words (#2037). Never the
   * text itself. Sent again on a mid-session edit, it replaces the old request.
   */
  request?: AgentSessionRequest;
  /** Session-only preference; explicit null clears it on the next request. */
  myMix?: MyMixPreferences | null;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private playlistCache = new Map<string, { items: unknown[]; cachedAt: number }>();
  private readonly playlistTtlMs = 15_000;
  private agentPreferences = new Map<string, AgentPreferences>();
  private recentTrackIds = new Map<string, string[]>();

  constructor(
    private readonly walletService: WalletService,
    private readonly eventBus: EventBus,
    private readonly agentRuntimeService: AgentRuntimeService,
    private readonly agentPurchaseService: AgentPurchaseService,
    private readonly agentLearningService?: AgentLearningService,
    private readonly unmetDemand?: UnmetDemandService,
  ) {}

  async startSession(input: {
    userId: string;
    budgetCapUsd: number;
    preferences?: AgentPreferences;
  }) {
    if (input.preferences?.myMix != null) {
      resolveMyMixPlan(
        input.preferences.myMix,
        await resolveListeningLanes(input.userId),
        getAgentTrackLimit(),
      );
    }
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
      preferences: publicSessionPreferences(input.preferences ?? {}),
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
    this.agentRuntimeService.clearMyMixSession?.(session.userId, sessionId);
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

  async agentNext(input: { sessionId: string; userId: string; preferences?: AgentPreferences }) {
    const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
    if (!session || session.userId !== input.userId) {
      throw new NotFoundException("Session not found");
    }
    if (session.endedAt) {
      return { status: "session_inactive" };
    }

    // Validate edits before remembering them so a rejected request cannot
    // poison this session's preferences for a later continuation.
    if (input.preferences?.myMix != null) {
      resolveMyMixPlan(
        input.preferences.myMix,
        await resolveListeningLanes(session.userId),
        getAgentTrackLimit(),
      );
    }

    const preferences = this.mergeAgentPreferences(
      input.sessionId,
      sanitizeIncomingRequest(input.preferences),
    );
    // The described session (#2037); without a request nothing below changes.
    const requested = requestRankingPreferences(preferences);
    const sessionGenres = requested.request
      ? [...(preferences.genres ?? []), ...requested.sessionGenres]
      : preferences.genres;
    const recentTrackIds = await this.sessionTrackIds(input.sessionId);
    // Wire-contract field only: listening runs are not budget-limited
    // (ADR-TE-1), so the remaining budget never reduces the picks.
    const budgetRemainingUsd = Math.max(0, session.budgetCapUsd - session.spentUsd);
    const result = await this.agentRuntimeService.runCommerce({
      sessionId: input.sessionId,
      userId: session.userId,
      recentTrackIds,
      budgetRemainingUsd,
      preferences: {
        ...preferences,
        genres: await this.withLearnedGenres(session.userId, sessionGenres),
        // What this session asked for itself, so it outranks learned taste (#2059).
        ...(sessionGenres?.length ? { sessionGenres } : {}),
        ...(requested.request
          ? {
              mood: requested.mood,
              energy: requested.energy,
              moods: requested.moods,
              ...(requested.tempoBpm ? { tempoBpm: requested.tempoBpm } : {}),
              request: requested.request,
            }
          : {}),
      },
    });

    await this.recordMyMixDemand(input.sessionId, session.userId);

    if (this.unmetDemand && requested.request && (result.status === "approved" || result.status === "no_tracks")) {
      try {
        await this.unmetDemand.recordSessionShortfall({
          userId: session.userId,
          sessionId: input.sessionId,
          resultStatus: result.status,
          observedAt: new Date(),
          request: requested.request,
          requestedCount: getAgentTrackLimit(),
          foundTrackIds: [
            ...(result.primaryTrack ? [result.primaryTrack.trackId] : []),
            ...result.tracks.map((track) => track.trackId),
          ],
          requestCoverage: result.requestCoverage,
        });
      } catch {
        this.logger.warn("Unmet-demand observation was skipped after an agent session result.");
      }
    }

    return this.toAgentNextResponse(input.sessionId, session.userId, result);
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
      include: { stems: { where: { isCurrent: true } } },
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
    userId: string,
    result: AgentRuntimeCommerceResult,
  ) {
    const selected = result.primaryTrack;
    if (!selected) {
      return {
        status: result.status,
        tracks: [],
        reason: result.reason,
        shortfall: result.shortfall,
        ...(result.mixCoverage ? { mixCoverage: result.mixCoverage } : {}),
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
        ...(result.mixCoverage ? { mixCoverage: result.mixCoverage } : {}),
      };
    }

    this.rememberRecentTrack(sessionId, track.id);
    await this.recordSessionPicks(sessionId, [selected, ...result.tracks]);
    // No taste signal here: the DJ queueing a track says nothing about whether
    // the listener likes it, and the web refills the queue without any user
    // action. Play, complete, skip, and save are the only signals.
    this.eventBus.publish({
      eventName: "agent.track_selected",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId,
      trackId: track.id,
      strategy: "runtime",
      preferences: publicSessionPreferences(this.agentPreferences.get(sessionId) ?? {}),
      cohortInfluence: cohortInfluenceFromSignals(selected.signals),
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
      reasonCode: selected.reasonCode,
      signals: selected.signals,
      audioFeatures: selected.audioFeatures,
      runtimeStatus: result.status,
      // #2005: the listener's ranker variant, so the web can attribute the
      // play, skip and save of this pick to it. Additive; labels only.
      ...djPickVariantFields(userId),
      tracks: result.tracks.map((item) => ({
        trackId: item.trackId,
        licenseType: item.licenseType,
        priceUsd: item.priceUsd,
        reason: item.reason,
        score: item.score,
        explanation: item.explanation,
        reasonCode: item.reasonCode,
        signals: item.signals,
      })),
      shortfall: result.shortfall,
      // #2037: how well the picks matched the described session; deterministic path only.
      ...(result.requestCoverage ? { requestCoverage: result.requestCoverage } : {}),
      ...(result.mixCoverage ? { mixCoverage: result.mixCoverage } : {}),
    };
  }

  private async recordMyMixDemand(sessionId: string, userId: string) {
    if (!this.unmetDemand) return;
    const observations = this.agentRuntimeService.takeMyMixDemandObservations?.(userId, sessionId) ?? [];
    for (const observation of observations) {
      if (observation.requested <= 0 || observation.matchedTrackIds.length >= observation.requested) continue;
      const request: AgentSessionRequest = {
        genres: observation.genres,
        moods: observation.moods,
        energy: null,
        bpm: null,
      };
      try {
        await this.unmetDemand.recordSessionShortfall({
          userId,
          sessionId,
          resultStatus: observation.matchedTrackIds.length > 0 ? "approved" : "no_tracks",
          observedAt: new Date(),
          request,
          requestedCount: observation.requested,
          foundTrackIds: observation.matchedTrackIds,
        });
      } catch {
        this.logger.warn("My Mix unmet-demand observation was skipped after an agent session result.");
      }
    }
  }

  /**
   * The genres a next pick searches: the listener's learned favorites, their
   * saved vibes, and the session's own genres, merged exactly as session start
   * does (`AgentConfigController.startSession`). Without the learned genres a
   * preset whose genres the catalog lacks finds nothing, although the session
   * start found picks. Fails open to saved vibes plus the session's genres.
   */
  private async withLearnedGenres(userId: string, sessionGenres: string[] = []) {
    const vibes = await prisma.agentConfig
      .findUnique({ where: { userId }, select: { vibes: true } })
      .then((config) => config?.vibes ?? [])
      .catch(() => [] as string[]);
    const fallback = mergeSessionGenres({ vibes, sessionGenres });
    if (!this.agentLearningService) return fallback;
    try {
      const profile = await this.agentLearningService.resolveTasteProfile(userId, fallback);
      return this.agentLearningService.mergeLearnedGenres(vibes, profile, sessionGenres);
    } catch {
      return fallback;
    }
  }

  /**
   * Tracks this session already holds, newest first: next picks remembered in
   * memory, then the picks session start recorded as licenses. The selector
   * excludes these, so a next pick never repeats one of the session's tracks,
   * even after a restart or on another instance.
   */
  private async sessionTrackIds(sessionId: string): Promise<string[]> {
    const remembered = this.recentTrackIds.get(sessionId) ?? [];
    const licensed = await prisma.license.findMany({
      where: { sessionId },
      select: { trackId: true },
    });
    return [...new Set([...remembered, ...licensed.map((license) => license.trackId)])];
  }

  /**
   * Record a next pick's tracks on the session, as session start records its
   * picks (`AgentConfigController.startSession`): the web plays the whole
   * shortlist, so session history counts every track the DJ queued, and
   * `sessionTrackIds` excludes them from the next refill. Curate-only, no
   * purchase: rows are the DJ pick log, never priced. Ids the catalog does not hold (an LLM pick can name one) are
   * skipped; a write failure never fails the pick.
   */
  private async recordSessionPicks(
    sessionId: string,
    picks: AgentRuntimeCommerceResult["tracks"],
  ) {
    const ids = [...new Set(picks.map((pick) => pick.trackId).filter(Boolean))];
    if (ids.length === 0) return;
    try {
      const [known, recorded] = await Promise.all([
        prisma.track.findMany({ where: { id: { in: ids } }, select: { id: true } }),
        prisma.license.findMany({
          where: { sessionId, trackId: { in: ids } },
          select: { trackId: true },
        }),
      ]);
      const knownIds = new Set(known.map((row) => row.id));
      const recordedIds = new Set(recorded.map((row) => row.trackId));
      const fresh = picks.filter(
        (pick, index) =>
          knownIds.has(pick.trackId) &&
          !recordedIds.has(pick.trackId) &&
          picks.findIndex((other) => other.trackId === pick.trackId) === index,
      );
      if (fresh.length === 0) return;
      // The DJ pick log, not a purchase: always priceUsd 0.
      await prisma.license.createMany({
        data: fresh.map((pick) => ({
          sessionId,
          trackId: pick.trackId,
          type: pick.licenseType ?? "personal",
          priceUsd: 0,
          durationSeconds: 0,
        })),
      });
    } catch {
      // History is a record of the set, not a gate on it.
    }
  }

  private rememberRecentTrack(sessionId: string, trackId: string) {
    const recent = this.recentTrackIds.get(sessionId) ?? [];
    this.recentTrackIds.set(
      sessionId,
      [trackId, ...recent.filter((id) => id !== trackId)].slice(0, 20),
    );
  }
}

/**
 * Sanitizes `preferences.request` before it is merged and remembered (#2037).
 * A request sent without any valid filter clears the session's request (the
 * listener removed every filter); omitting the key leaves it as it was.
 */
function sanitizeIncomingRequest(preferences?: AgentPreferences): AgentPreferences | undefined {
  if (!preferences || !("request" in preferences)) return preferences;
  return { ...preferences, request: sanitizeSessionRequest(preferences.request) };
}

function cohortInfluenceFromSignals(signals?: Array<{ label: string; reason: string }>) {
  const reasonCodes = [...new Set((signals ?? [])
    .filter((signal) => signal.label === "cohort_context")
    .map((signal) => signal.reason)
    .filter(Boolean))];
  return {
    appliedCount: reasonCodes.length,
    cohortIds: [],
    cohortTypes: [...new Set(reasonCodes.map((reason) => reason.split(":", 1)[0]).filter(Boolean))],
    reasonCodes,
  };
}

function publicSessionPreferences(preferences: AgentPreferences): Record<string, unknown> {
  const { myMix: _myMix, ...publicPreferences } = preferences;
  return publicPreferences;
}
