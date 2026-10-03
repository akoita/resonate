import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Logger, Optional, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { IsString, MaxLength } from "class-validator";
import { prisma } from "../../db/prisma";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRuntimeService } from "./agent_runtime.service";
import { AgentIdentityService } from "./agent_identity.service";
import {
    AgentLearningService,
    buildAgentSignalMetadata,
    isAgentSignalAction,
    type AgentSignalAction,
} from "./agent_learning.service";
import { mergeSessionGenres } from "./agent_session_genres";
import {
    AGENT_SESSION_REQUEST_PARSER,
    listeningRequestFromCrateParse,
    requestRankingPreferences,
    type AgentSessionParseResponse,
} from "./agent_session_request";
import { EventBus } from "../shared/event_bus";
import { minutes } from "../shared/rate_limits";
import { CRATE_REQUEST_MAX_TEXT_LENGTH } from "../crates/crate.types";
import type { CrateRequestParser } from "../crates/crate_request_parser";
import { createCrateRequestParser } from "../crates/model_crate_request_parser";
import { getAgentTrackLimit } from "./agent_runtime.config";
import { UnmetDemandService } from "../scene_scout/unmet_demand.service";

/** Tracked per signed-in person where the guard has resolved them, else per IP. */
const trackByUser = (req: Record<string, any>) => req.user?.userId ?? req.ip;

/**
 * Body of `POST /agents/config/session/parse` (#2037): the listener's own words.
 * The text is read, parsed and dropped: never stored, logged or published.
 */
export class ParseSessionRequestDto {
    @IsString()
    @MaxLength(CRATE_REQUEST_MAX_TEXT_LENGTH)
    text!: string;
}

@Controller("agents/config")
export class AgentConfigController {
    private readonly logger = new Logger(AgentConfigController.name);

    constructor(
        private readonly orchestrator: AgentOrchestratorService,
        private readonly runtimeService: AgentRuntimeService,
        private readonly identityService: AgentIdentityService,
        private readonly learningService: AgentLearningService,
        private readonly eventBus: EventBus,
        @Optional()
        @Inject(AGENT_SESSION_REQUEST_PARSER)
        private requestParser?: CrateRequestParser,
        @Optional()
        private readonly unmetDemand?: UnmetDemandService,
    ) { }

    @Get()
    @UseGuards(AuthGuard("jwt"))
    async get(@Req() req: any) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        if (!config) return null;
        return this.identityService.enrichConfig(config);
    }

    @Post()
    @UseGuards(AuthGuard("jwt"))
    async create(
        @Req() req: any,
        @Body() body: { name: string; vibes: string[]; monthlyCapUsd: number }
    ) {
        // Ensure User record exists (JWT userId = wallet address)
        await prisma.user.upsert({
            where: { id: req.user.userId },
            update: {},
            create: {
                id: req.user.userId,
                email: `${req.user.userId}@wallet.local`,
            },
        });

        const config = await prisma.agentConfig.upsert({
            where: { userId: req.user.userId },
            update: {
                name: body.name,
                vibes: body.vibes,
                monthlyCapUsd: body.monthlyCapUsd,
            },
            create: {
                userId: req.user.userId,
                name: body.name,
                vibes: body.vibes,
                monthlyCapUsd: body.monthlyCapUsd,
            },
        });
        return this.identityService.mintIdentity(req.user.userId).catch((error) => {
            this.logger.warn(`Agent identity mint skipped after config create: ${error instanceof Error ? error.message : error}`);
            return this.identityService.enrichConfig(config);
        });
    }

    @Patch()
    @UseGuards(AuthGuard("jwt"))
    async update(
        @Req() req: any,
        @Body() body: { name?: string; vibes?: string[]; stemTypes?: string[]; sessionMode?: string; monthlyCapUsd?: number; isActive?: boolean }
    ) {
        const allowedData: {
            name?: string;
            vibes?: string[];
            stemTypes?: string[];
            sessionMode?: string;
            monthlyCapUsd?: number;
            isActive?: boolean;
        } = {};
        if (body.name !== undefined) allowedData.name = body.name;
        if (body.vibes !== undefined) allowedData.vibes = body.vibes;
        if (body.stemTypes !== undefined) allowedData.stemTypes = body.stemTypes;
        if (body.sessionMode !== undefined) {
            if (body.sessionMode !== "curate" && body.sessionMode !== "buy") {
                throw new BadRequestException({ reason: "invalid_session_mode" });
            }
            // Autonomous stem buying was removed (ADR-TE-1.4); purchases go
            // through Crate Digger quotes. "buy" stays a recognised, rejected value.
            if (body.sessionMode === "buy") {
                throw new BadRequestException({ reason: "buy_mode_disabled" });
            }
            allowedData.sessionMode = body.sessionMode;
        }
        if (body.monthlyCapUsd !== undefined) allowedData.monthlyCapUsd = body.monthlyCapUsd;
        if (body.isActive !== undefined) allowedData.isActive = body.isActive;

        const config = await prisma.agentConfig.update({
            where: { userId: req.user.userId },
            data: allowedData,
        });
        return this.identityService.enrichConfig(config);
    }

    @Post("identity/mint")
    @UseGuards(AuthGuard("jwt"))
    async mintIdentity(@Req() req: any) {
        return this.identityService.mintIdentity(req.user.userId);
    }

    @Post("identity/attest")
    @UseGuards(AuthGuard("jwt"))
    async attestIdentity(@Req() req: any) {
        return this.identityService.attestReputation(req.user.userId);
    }

    @Get("identity/reputation-attestation")
    @UseGuards(AuthGuard("jwt"))
    async getReputationAttestation(@Req() req: any) {
        return this.identityService.buildReputationAttestation(req.user.userId);
    }

    @Get("identity/registration-file")
    @UseGuards(AuthGuard("jwt"))
    async getRegistrationFile(@Req() req: any) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        if (!config) {
            throw new BadRequestException("Agent config is required before exporting registration file");
        }
        return this.identityService.buildRegistrationFile(config);
    }

    @Post("signals")
    @UseGuards(AuthGuard("jwt"))
    async recordSignal(
        @Req() req: any,
        @Body() body: { trackId: string; action: string; sessionId?: string; metadata?: Record<string, unknown> }
    ) {
        // Habit-only actions enter through consented analytics instrumentation,
        // where browser-session deduplication and training controls are enforced.
        if (!body.trackId || !isAgentSignalAction(body.action) || body.action === "loop" || body.action === "unsave") {
            throw new BadRequestException({
                reason: "trackId and valid action are required",
                acceptedActions: ["accept", "skip", "complete", "save", "replay", "add_to_playlist", "purchase"],
            });
        }

        const profile = await this.learningService.recordSignal({
            userId: req.user.userId,
            sessionId: body.sessionId,
            trackId: body.trackId,
            action: body.action as AgentSignalAction,
            metadata: buildAgentSignalMetadata({
                ...(body.metadata ?? {}),
                outcome: {
                    ...(typeof body.metadata?.outcome === "object" && body.metadata.outcome && !Array.isArray(body.metadata.outcome)
                        ? body.metadata.outcome
                        : {}),
                    type: body.action,
                },
            }),
        });
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });

        return {
            status: "recorded",
            profile,
            config: config ? await this.identityService.enrichConfig(config) : null,
        };
    }

    /**
     * Reads the listener's own description of a session (#2037) into visible,
     * editable listening filters with the Crate Digger parser. Nothing is
     * stored, logged or published: the text exists only in this request.
     */
    @Post("session/parse")
    @HttpCode(200)
    @UseGuards(AuthGuard("jwt"))
    @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
    async parseSession(@Body() body: ParseSessionRequestDto): Promise<AgentSessionParseResponse> {
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text) {
            throw new BadRequestException({ reason: "text_required" });
        }
        this.requestParser ??= createCrateRequestParser();
        return listeningRequestFromCrateParse(await this.requestParser.parse(text));
    }

    @Post("session")
    @UseGuards(AuthGuard("jwt"))
    async startSession(
        @Req() req: any,
        @Body() body?: {
            preferences?: {
                mood?: string;
                energy?: "low" | "medium" | "high";
                genres?: string[];
                allowExplicit?: boolean;
                licenseType?: "personal" | "remix" | "commercial";
                sessionIntent?: string;
                sessionIntentName?: string;
                queueStyle?: string;
                source?: string;
                /** Listening filters parsed from the listener's own words (#2037). Sanitized here. */
                request?: unknown;
            };
        }
    ) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        if (!config) {
            return { status: "not_configured" };
        }
        // The described session (#2037): invalid fields are dropped, and with
        // no request every derived value below is exactly what it was before.
        const requested = requestRankingPreferences({
            mood: body?.preferences?.mood,
            energy: body?.preferences?.energy,
            request: body?.preferences?.request,
        });
        // Request genres count as session genres, after the ones sent.
        const sessionGenres = requested.request
            ? [...(body?.preferences?.genres ?? []), ...requested.sessionGenres]
            : body?.preferences?.genres;
        const sessionPreferences = {
            genres: requested.request
                ? [...(body?.preferences?.genres ?? config.vibes), ...requested.sessionGenres]
                : body?.preferences?.genres ?? config.vibes,
            stemTypes: config.stemTypes,
            mood: requested.mood,
            energy: requested.energy,
            allowExplicit: body?.preferences?.allowExplicit,
            licenseType: body?.preferences?.licenseType ?? "personal",
            sessionIntent: body?.preferences?.sessionIntent,
            sessionIntentName: body?.preferences?.sessionIntentName,
            queueStyle: body?.preferences?.queueStyle,
            source: body?.preferences?.source,
        };

        // Create a persistent Session record
        const session = await prisma.session.create({
            data: {
                userId: req.user.userId,
                budgetCapUsd: config.monthlyCapUsd,
            },
        });

        // Mark agent as active
        await prisma.agentConfig.update({
            where: { userId: req.user.userId },
            data: { isActive: true },
        });

        // Sync wallet budget from AgentConfig so spend() has the correct cap
        const wallet = await prisma.wallet.findFirst({
            where: { userId: req.user.userId },
        });
        if (wallet && wallet.monthlyCapUsd !== config.monthlyCapUsd) {
            await prisma.wallet.update({
                where: { id: wallet.id },
                data: {
                    monthlyCapUsd: config.monthlyCapUsd,
                    balanceUsd: Math.max(0, config.monthlyCapUsd - wallet.spentUsd),
                },
            });
        }

        // Delay orchestration slightly to let the WebSocket client connect
        // after receiving the HTTP response. This fixes the event race condition.
        setTimeout(() => {
            // Publish session.started so the gateway can broadcast to the frontend
            this.eventBus.publish({
                eventName: "session.started",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                sessionId: session.id,
                userId: req.user.userId,
                budgetCapUsd: config.monthlyCapUsd,
                preferences: sessionPreferences,
            });

            // Kick off orchestration — route through LLM when AGENT_RUNTIME is set
            // One taste profile for every discovery surface (#1456): the same
            // persisted profile Home and the DJ selector resolve.
            const tasteProfilePromise = this.learningService.resolveTasteProfile(req.user.userId, config.vibes).catch((error) => {
                this.logger.warn(`Failed to compute learned taste profile: ${error}`);
                return null;
            });
            const runtimeInput = {
                sessionId: session.id,
                userId: req.user.userId,
                recentTrackIds: [] as string[],
                // Wire-contract field only: listening sessions are not
                // budget-limited (ADR-TE-1), so this never reduces the picks.
                budgetRemainingUsd: config.monthlyCapUsd,
                preferences: {
                    // Saved vibes plus this session's genres; learned favorites
                    // are merged in below once the taste profile resolves.
                    genres: mergeSessionGenres({
                        vibes: config.vibes,
                        sessionGenres,
                    }),
                    stemTypes: config.stemTypes,
                    learnedGenreWeights: {} as Record<string, number>,
                    mood: sessionPreferences.mood,
                    energy: sessionPreferences.energy,
                    allowExplicit: sessionPreferences.allowExplicit,
                    licenseType: sessionPreferences.licenseType,
                    sessionIntent: sessionPreferences.sessionIntent,
                    sessionIntentName: sessionPreferences.sessionIntentName,
                    queueStyle: sessionPreferences.queueStyle,
                    source: sessionPreferences.source,
                    // The described session (#2037); absent without a request.
                    ...(requested.request
                        ? {
                            moods: requested.moods,
                            ...(requested.tempoBpm ? { tempoBpm: requested.tempoBpm } : {}),
                            request: requested.request,
                        }
                        : {}),
                },
            };

            tasteProfilePromise
                .then((profile) => {
                    if (profile) {
                        runtimeInput.preferences.genres = this.learningService.mergeLearnedGenres(
                            config.vibes,
                            profile,
                            sessionGenres ?? [],
                        );
                        runtimeInput.preferences.learnedGenreWeights = profile.genreWeights;
                    }
                    return this.runtimeService.run(runtimeInput);
                })
                .then(async (result) => {
                    const resultStatus = typeof result.status === "string" ? result.status : "";
                    const foundTrackIds = "tracks" in result
                        ? result.tracks.map((track) => track.trackId)
                        : (result.picks ?? (result.trackId ? [{ trackId: result.trackId }] : []))
                            .map((pick) => pick.trackId);
                    if (
                        this.unmetDemand && requested.request &&
                        (resultStatus === "approved" || resultStatus === "no_tracks")
                    ) {
                        try {
                            await this.unmetDemand.recordSessionShortfall({
                                userId: req.user.userId,
                                sessionId: session.id,
                                resultStatus,
                                observedAt: new Date(),
                                request: requested.request,
                                requestedCount: getAgentTrackLimit(),
                                foundTrackIds,
                                requestCoverage: "tracks" in result ? result.requestCoverage : undefined,
                            });
                        } catch {
                            this.logger.warn("Unmet-demand observation was skipped after an agent session result.");
                        }
                    }
                    if ("tracks" in result) {
                        // Orchestrator pipeline result (local mode)
                        for (const track of result.tracks) {
                            try {
                                // The DJ pick log, not a purchase: a License row
                                // records "this session holds this track" for
                                // history, dedupe, and next-pick exclusion. It
                                // never carries a price, and the DJ records no
                                // taste signal for a pick; only the listener's
                                // own play, skip, and save actions do.
                                await prisma.license.create({
                                    data: {
                                        sessionId: session.id,
                                        trackId: track.trackId,
                                        type: track.pick?.licenseType ?? "personal",
                                        priceUsd: 0,
                                        durationSeconds: 0,
                                    },
                                });
                                this.logger.log(`[Agent] Recorded pick ${track.trackId} (curate session; no purchase)`);
                            } catch (err) {
                                this.logger.error(`Failed to persist pick for ${track.trackId}:`, err);
                            }
                        }
                    } else {
                        // LLM adapter result (vertex/langgraph mode)
                        const picks = result.picks ?? (result.trackId ? [{
                          trackId: result.trackId,
                          licenseType: result.licenseType ?? "personal",
                          priceUsd: result.priceUsd ?? 0,
                        }] : []);
                        this.logger.log(
                            `LLM decision: ${result.status} ${picks.length} track(s) reason=${result.reason} (${result.latencyMs}ms)`
                        );
                        for (const pick of picks) {
                            try {
                                // DJ pick log, not a purchase (see above): never
                                // priced, and no taste signal until the listener acts.
                                await prisma.license.create({
                                    data: {
                                        sessionId: session.id,
                                        trackId: pick.trackId,
                                        type: pick.licenseType,
                                        priceUsd: 0,
                                        durationSeconds: 0,
                                    },
                                });
                            } catch (err) {
                                this.logger.error(`Failed to persist pick for ${pick.trackId}:`, err);
                            }
                        }
                        // Publish decision event with LLM reasoning
                        this.eventBus.publish({
                            eventName: "agent.decision_made",
                            eventVersion: 1,
                            occurredAt: new Date().toISOString(),
                            sessionId: session.id,
                            trackId: picks.map(p => p.trackId).join(","),
                            licenseType: picks[0]?.licenseType,
                            reason: result.reason ?? "llm",
                            reasoning: result.reasoning,
                            latencyMs: result.latencyMs,
                        });
                    }
                })
                .catch((err) => {
                    this.logger.error(`Orchestration failed for session ${session.id}:`, err);
                    this.eventBus.publish({
                        eventName: "agent.decision_made",
                        eventVersion: 1,
                        occurredAt: new Date().toISOString(),
                        sessionId: session.id,
                        trackId: "",
                        reason: "error",
                    });
                });
        }, 500); // 500ms delay for WebSocket race fix

        return { status: "started", sessionId: session.id };
    }

    @Post("session/stop")
    @UseGuards(AuthGuard("jwt"))
    async stopSession(@Req() req: any) {
        await prisma.agentConfig.update({
            where: { userId: req.user.userId },
            data: { isActive: false },
        });

        // Close the most recent open session
        const openSession = await prisma.session.findFirst({
            where: { userId: req.user.userId, endedAt: null },
            orderBy: { startedAt: "desc" },
        });

        if (openSession) {
            await prisma.session.update({
                where: { id: openSession.id },
                data: { endedAt: new Date() },
            });
            await this.learningService.annotateSessionOutcome({
                userId: req.user.userId,
                sessionId: openSession.id,
                outcome: {
                    type: "ended",
                    sessionDurationMs: Date.now() - openSession.startedAt.getTime(),
                    status: "stopped",
                },
            });
        }

        this.eventBus.publish({
            eventName: "session.ended",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: openSession?.id ?? "unknown",
            spentTotalUsd: openSession?.spentUsd ?? 0,
            reason: "user_stopped",
        });

        return { status: "stopped" };
    }

    @Get("history")
    @UseGuards(AuthGuard("jwt"))
    async getHistory(@Req() req: any) {
        const sessions = await prisma.session.findMany({
            where: { userId: req.user.userId },
            orderBy: { startedAt: "desc" },
            take: 20,
            include: {
                licenses: {
                    include: {
                        track: {
                            select: {
                                id: true,
                                title: true,
                                artist: true,
                                releaseId: true,
                                release: { select: { id: true, artworkMimeType: true, artworkRevision: true, title: true } },
                            },
                        },
                    },
                },
                agentTransactions: {
                    orderBy: { createdAt: "desc" }
                },
                agentSignals: {
                    where: { action: "accept" },
                    orderBy: { createdAt: "desc" },
                    select: {
                        trackId: true,
                        metadata: true,
                    },
                },
            },
        });

        for (const session of sessions) {
            const signalByTrack = new Map(session.agentSignals.map((signal) => [signal.trackId, signal.metadata]));
            // @ts-ignore - hydrating dynamic props for frontend
            session.licenses = session.licenses.map((license) => ({
                ...license,
                recommendation: signalByTrack.get(license.trackId) ?? null,
            }));
        }

        // Hydrate transactions with Stem info (same pattern as AgentPurchaseService)
        const allTx = sessions.flatMap(s => s.agentTransactions);
        const tokenIds = [...new Set(allTx.map((tx) => tx.tokenId))];
        
        if (tokenIds.length > 0) {
            const mints = await prisma.stemNftMint.findMany({
                where: { tokenId: { in: tokenIds } },
                include: {
                    stem: {
                        include: {
                            track: { select: { id: true, title: true, artist: true } },
                        },
                    },
                },
            });
            const mintMap = new Map(mints.map((m) => [m.tokenId.toString(), m]));

            // Mutate session objects to add hydrated fields to transactions
            // Note: Prisma objects are plain JS objects so we can attach props
            for (const session of sessions) {
                // @ts-ignore - hydrating dynamic props for frontend
                session.agentTransactions = session.agentTransactions.map(tx => {
                    const mint = mintMap.get(tx.tokenId.toString());
                    return {
                        ...tx,
                        listingId: String(tx.listingId),
                        tokenId: String(tx.tokenId),
                        amount: String(tx.amount),
                        stemName: mint?.stem?.type ?? null,
                        trackId: mint?.stem?.track?.id ?? null,
                        trackTitle: mint?.stem?.track?.title ?? null,
                        trackArtist: mint?.stem?.track?.artist ?? null,
                    };
                });
            }
        }

        return sessions;
    }
}
