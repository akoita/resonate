import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WalletService } from "../identity/wallet.service";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { AgentPurchaseService } from "../agents/agent_purchase.service";
import { AgentRuntimeCommerceResult } from "../agents/agent_runtime.types";
import { AgentRuntimeService } from "../agents/agent_runtime.service";
import type { MyMixContext, MyMixPreferences } from "../agents/agent_my_mix";
import { djPickVariantFields } from "./dj_pick_variant";
import { AgentLearningService } from "../agents/agent_learning.service";
import { getAgentTrackLimit } from "../agents/agent_runtime.config";
import { resolveListeningLanes } from "../agents/listening_lanes.service";
import { resolveMyMixPlan } from "../agents/agent_my_mix";
import { UnmetDemandService } from "../scene_scout/unmet_demand.service";
import { isDiscoveryLevel, type DiscoveryLevel } from "../recommendations/discovery-policy";
import { mergeSessionGenres } from "../agents/agent_session_genres";
import { pickCurator, pickNoteColumns, shapePickNote } from "../agents/agent_pick_notes";
import type { PickNote } from "../agents/agent_pick_notes";
import { resolveAllowExplicit } from "../agents/agent_explicit_preference";
import { sanitizeArtistNames } from "../agents/agent_session_artists";
import { rememberedSessionSeed, type SessionSeed } from "../agents/agent_session_seed";
import { resolveSessionSeed } from "../agents/agent_session_seed_resolver";
import { sameSessionFilters, sessionFilterSummary } from "../agents/agent_session_filters";
import {
  requestRankingPreferences,
  sanitizeRequestText,
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
  /**
   * The listener's sentence (#2241). Held in memory for this session's picks so
   * the semantic query stays the same; never persisted, published or logged.
   */
  requestText?: string;
  /** Catalog artists the sentence named (#2241); seed neighbours for retrieval. */
  artists?: string[];
  /** Session-only preference; explicit null clears it on the next request. */
  myMix?: MyMixPreferences | null;
  /**
   * "Right now" (#2245): the client's coarse time/day bucket (one of eight; no
   * timezone, timestamp or place). Remembered for the live session so a pick that
   * omits it still follows the last bucket, but read only while the session has
   * no filters; never published.
   */
  listeningContext?: MyMixContext;
  /**
   * Request-first selection (#2316): "Fill with similar sounds". When true, a
   * batch the catalog cannot fill with matches of the request is padded with
   * marked off-request tracks. Off by default; remembered for the live session.
   */
  fillSimilar?: boolean;
  /**
   * "New artists" (#2249): play only artists the listener has never interacted
   * with (e.g. the For you starter "New artists in <family>"). Remembered for the
   * live session; only `true` turns it on, so a pick that sends `false` turns it off.
   */
  newArtists?: boolean;
  /**
   * The Discovery control (#2327): "familiar" reserves no exploration slot, "mixed" is the
   * default share, "new" a larger one. Remembered for the live session; anything else is dropped.
   */
  discovery?: DiscoveryLevel;
  /** "More like this" (#2243): one request's seed track; never remembered or published. */
  seedTrackId?: string;
  /**
   * What the session started from (#2244): a track, an artist or a playlist.
   * Resolved and access-checked by the service, then remembered for the live
   * session; explicit null clears it. Its id is never published.
   */
  seed?: { kind: SessionSeed["kind"]; id: string; label?: string } | null;
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
    // The seed is resolved (and a playlist access-checked) before anything is written.
    input = { ...input, preferences: await this.withResolvedSeed(input.userId, input.preferences) };
    await this.walletService.setBudget({
      userId: input.userId,
      monthlyCapUsd: input.budgetCapUsd,
    });
    const filters = await this.startFilters(input.userId, input.preferences);
    const session = await prisma.session.create({
      data: {
        userId: input.userId,
        budgetCapUsd: input.budgetCapUsd,
        spentUsd: 0,
        // The session's own filters for Session History (#2096).
        ...(filters ? { filters } : {}),
      },
    });
    if (input.preferences) {
      this.agentPreferences.set(
        session.id,
        sanitizeIncomingRequest(withoutSeed(input.preferences)) ?? {},
      );
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

  async stopSession(userId: string, sessionId: string) {
    if (typeof sessionId !== "string" || !sessionId) {
      throw new BadRequestException("sessionId is required");
    }
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    // Another user's session reads as missing, as in agentNext.
    if (!session || session.userId !== userId) {
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

  async playTrack(userId: string, input: {
    sessionId: string;
    trackId: string;
    priceUsd: number;
    listingId?: bigint;
    tokenId?: bigint;
    amount?: bigint;
    totalPriceWei?: string;
  }) {
    if (typeof input.sessionId !== "string" || !input.sessionId) {
      throw new BadRequestException("sessionId is required");
    }
    if (typeof input.trackId !== "string" || !input.trackId) {
      throw new BadRequestException("trackId is required");
    }
    if (typeof input.priceUsd !== "number" || !Number.isFinite(input.priceUsd) || input.priceUsd < 0) {
      throw new BadRequestException("priceUsd must be a non-negative number");
    }
    const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
    // Another user's session reads as inactive: no spend against someone else's budget.
    if (!session || session.endedAt || session.userId !== userId) {
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

    // A seed sent again that the session already holds is not looked up again; a new one is
    // resolved (and a playlist access-checked) before it is remembered, like myMix above.
    const incoming = await this.withResolvedSeed(
      session.userId,
      input.preferences,
      rememberedSessionSeed(this.agentPreferences.get(input.sessionId)?.seed),
    );
    const preferences = this.mergeAgentPreferences(
      input.sessionId,
      sanitizeIncomingRequest(withoutSeed(incoming)),
    );
    const seed = rememberedSessionSeed(preferences.seed);
    // The described session (#2037); without a request nothing below changes.
    const requested = requestRankingPreferences(preferences);
    const sessionGenres = requested.request
      ? [...(preferences.genres ?? []), ...requested.sessionGenres]
      : preferences.genres;
    // Explicit tracks follow the listener's saved choice unless this session
    // sent its own; the config-derived value is not remembered, so a later
    // toggle takes effect on the next pick (#2088).
    const allowExplicit = await this.resolveAllowExplicit(session.userId, preferences.allowExplicit);
    // A pick request with no chosen filters falls back to the saved vibes as its
    // genres. Those are the listener's taste, not a request (#2316): they stay
    // searched as taste but do not turn the session into a request-first one.
    const ownSessionGenres = await this.ownGenres(session.userId, {
      sessionGenres,
      sessionIntentName: preferences.sessionIntentName,
      mood: requested.mood,
      moods: requested.moods,
      energy: requested.energy,
      tempoBpm: requested.tempoBpm,
      allowExplicit,
    });
    if (input.preferences) {
      await this.refreshSessionFilters(session.id, session.userId, session.filters, {
        sessionIntentName: preferences.sessionIntentName,
        sessionGenres,
        moods: requested.moods,
        mood: requested.mood,
        energy: requested.energy,
        tempoBpm: requested.tempoBpm,
        myMix: preferences.myMix,
        seed,
        allowExplicit,
      });
    }
    const recentTrackIds = await this.sessionTrackIds(input.sessionId);
    // "More like this" (#2243): only a track this session already picked can be
    // a seed, and it steers this request alone (it is never merged above).
    const seedTrackId =
      typeof input.preferences?.seedTrackId === "string" &&
      recentTrackIds.includes(input.preferences.seedTrackId)
        ? input.preferences.seedTrackId
        : undefined;
    // Wire-contract field only: listening runs are not budget-limited
    // (ADR-TE-1), so the remaining budget never reduces the picks.
    const budgetRemainingUsd = Math.max(0, session.budgetCapUsd - session.spentUsd);
    const result = await this.agentRuntimeService.runCommerce({
      sessionId: input.sessionId,
      userId: session.userId,
      recentTrackIds,
      budgetRemainingUsd,
      preferences: {
        ...withoutSessionSeed(preferences),
        // The session's seed (#2244) stays in force for every pick of the live session.
        ...(seed ? { seed } : {}),
        allowExplicit,
        genres: await this.withLearnedGenres(session.userId, sessionGenres),
        // What this session asked for itself, so it outranks learned taste (#2059).
        ...(ownSessionGenres.length ? { sessionGenres: ownSessionGenres } : {}),
        ...(seedTrackId ? { seedTrackId } : {}),
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

  /**
   * The preferences with `seed` resolved for `userId` (#2244): a new seed is
   * looked up and a playlist the caller may not use is refused (403); a seed
   * equal to the `remembered` one is kept as it was; `null` clears the seed;
   * an absent key leaves the session's seed alone.
   */
  private async withResolvedSeed(
    userId: string,
    preferences: AgentPreferences | undefined,
    remembered?: SessionSeed,
  ): Promise<AgentPreferences | undefined> {
    if (!preferences || !("seed" in preferences) || preferences.seed === undefined) return preferences;
    if (preferences.seed === null) return preferences;
    const sent = rememberedSessionSeed(preferences.seed);
    if (sent && remembered && sent.kind === remembered.kind && sent.id === remembered.id) {
      return { ...preferences, seed: remembered };
    }
    return { ...preferences, seed: await resolveSessionSeed(userId, preferences.seed) };
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
    // #2075: who curated, and categorically why the rules stepped in.
    const curation = {
      curatedBy: result.curatedBy,
      ...(result.runtimeFallback ? { runtimeFallback: result.runtimeFallback } : {}),
    };
    if (!selected) {
      return {
        status: result.status,
        tracks: [],
        reason: result.reason,
        shortfall: result.shortfall,
        ...curation,
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
        ...curation,
        ...(result.mixCoverage ? { mixCoverage: result.mixCoverage } : {}),
      };
    }

    this.rememberRecentTrack(sessionId, track.id);
    await this.recordSessionPicks(sessionId, userId, [selected, ...result.tracks], pickCurator(result));
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
      ...curation,
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
        // #2312: whether the pick satisfies every filter of the described session; absent without filters.
        ...(typeof item.requestMatch === "boolean" ? { requestMatch: item.requestMatch } : {}),
      })),
      shortfall: result.shortfall,
      // #2037: how well the picks matched the described session, on both curation paths.
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
   * The Session History summary a new session starts with (#2096). Best
   * effort: without it the session still starts, as it did before.
   */
  private async startFilters(
    userId: string,
    preferences?: AgentPreferences,
  ): Promise<Prisma.InputJsonValue | undefined> {
    try {
      const requested = requestRankingPreferences(preferences ?? {});
      const sessionGenres = requested.request
        ? [...(preferences?.genres ?? []), ...requested.sessionGenres]
        : preferences?.genres;
      return sessionFilterSummary({
        sessionIntentName: preferences?.sessionIntentName,
        sessionGenres,
        moods: requested.moods,
        mood: requested.mood,
        energy: requested.energy,
        tempoBpm: requested.tempoBpm,
        myMix: preferences?.myMix,
        seed: preferences?.seed,
        allowExplicit: await this.resolveAllowExplicit(userId, preferences?.allowExplicit),
      }) as unknown as Prisma.InputJsonValue;
    } catch {
      this.logger.warn("Session filter summary was not recorded at session start.");
      return undefined;
    }
  }

  /**
   * Keeps the Session History filter summary in step with a mid-session edit
   * (#2096). Best effort: a failed write is logged and never fails the pick.
   */
  private async refreshSessionFilters(
    sessionId: string,
    userId: string,
    stored: unknown,
    input: Parameters<typeof sessionFilterSummary>[0],
  ) {
    try {
      const filters = sessionFilterSummary({
        ...input,
        sessionGenres: await this.ownGenres(userId, input),
      });
      if (sameSessionFilters(stored, filters)) return;
      await prisma.session.update({
        where: { id: sessionId },
        data: { filters: filters as unknown as Prisma.InputJsonValue },
      });
    } catch {
      this.logger.warn("Session filter summary was not updated after a preference change.");
    }
  }

  /**
   * A pick request with no chosen filters falls back to the saved vibes as its
   * genres (the web's plain "Next Pick"). Those are the listener's saved taste,
   * not this session's own filters, so they stay out of the summary.
   */
  private async ownGenres(userId: string, input: Parameters<typeof sessionFilterSummary>[0]) {
    const genres = input.sessionGenres ?? [];
    if (genres.length === 0 || input.sessionIntentName || input.mood || input.moods?.length || input.energy || input.tempoBpm) {
      return genres;
    }
    const config = await prisma.agentConfig.findUnique({ where: { userId }, select: { vibes: true } });
    const vibes = new Set((config?.vibes ?? []).map((vibe) => vibe.trim().toLowerCase()));
    const sameAsVibes =
      vibes.size > 0 && genres.every((genre) => vibes.has(genre.trim().toLowerCase()));
    return sameAsVibes ? [] : genres;
  }

  /** The session's own boolean wins; otherwise the listener's saved choice, defaulting to off. */
  private async resolveAllowExplicit(userId: string, requested: unknown): Promise<boolean> {
    if (typeof requested === "boolean") return requested;
    const config = await prisma.agentConfig
      .findUnique({ where: { userId }, select: { allowExplicit: true } })
      .catch(() => null);
    return resolveAllowExplicit(requested, config?.allowExplicit);
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
    userId: string,
    picks: AgentRuntimeCommerceResult["tracks"],
    curatedBy: PickNote["curatedBy"],
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
      // The DJ pick log, not a purchase: always priceUsd 0. Each pick keeps its
      // bounded explanation (#2299), written with the License or not at all.
      await prisma.$transaction(
        fresh.map((pick) =>
          prisma.license.create({
            data: {
              sessionId,
              trackId: pick.trackId,
              type: pick.licenseType ?? "personal",
              priceUsd: 0,
              durationSeconds: 0,
              pickNote: { create: { userId, ...pickNoteColumns(shapePickNote(pick, curatedBy)) } },
            },
          }),
        ),
      );
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
  if (!preferences) return preferences;
  const sanitized: AgentPreferences = { ...preferences };
  if ("request" in preferences) sanitized.request = sanitizeSessionRequest(preferences.request);
  // The sentence and its artists are replaced as sent (an empty sentence clears them).
  if ("requestText" in preferences) sanitized.requestText = sanitizeRequestText(preferences.requestText);
  if ("artists" in preferences) sanitized.artists = sanitizeArtistNames(preferences.artists);
  // Only an explicit `true` allows padding (#2316); anything else is off.
  if ("fillSimilar" in preferences) sanitized.fillSimilar = preferences.fillSimilar === true;
  if ("newArtists" in preferences) sanitized.newArtists = preferences.newArtists === true;
  // Only a known level counts; an unknown value falls back to Mixed (#2327).
  if ("discovery" in preferences) sanitized.discovery = isDiscoveryLevel(preferences.discovery) ? preferences.discovery : undefined;
  return sanitized;
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
  // The sentence and the artists it named never leave the session (#2241); nor does a one-request seed (#2243).
  // A session seed (#2244) is published as its kind only: its id may name a private playlist.
  const {
    myMix: _myMix,
    listeningContext: _listeningContext,
    seedTrackId: _seedTrackId,
    requestText: _requestText,
    artists: _artists,
    seed,
    ...publicPreferences
  } = preferences;
  const seedKind = rememberedSessionSeed(seed)?.kind;
  return seedKind ? { ...publicPreferences, seedKind } : publicPreferences;
}

/** The preferences a session remembers: a seed track belongs to one request only (#2243). */
function withoutSeed(preferences?: AgentPreferences): AgentPreferences | undefined {
  if (!preferences || !("seedTrackId" in preferences)) return preferences;
  const { seedTrackId: _seedTrackId, ...remembered } = preferences;
  return remembered;
}

/** The preferences without the `seed` key, which the caller re-adds only when it holds a valid one. */
function withoutSessionSeed(preferences: AgentPreferences): Omit<AgentPreferences, "seed"> {
  const { seed: _seed, ...rest } = preferences;
  return rest;
}
