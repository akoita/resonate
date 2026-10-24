import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Logger, NotFoundException, Optional, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import type { Prisma } from "@prisma/client";
import { IsString, MaxLength } from "class-validator";
import { prisma } from "../../db/prisma";
import { normalizeUserId } from "../identity/user_id";
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
import { AgentSoundsService } from "./agent_sounds.service";
import { resolveAllowExplicit } from "./agent_explicit_preference";
import { sessionFilterSummary } from "./agent_session_filters";
import { resolveSessionSeed } from "./agent_session_seed_resolver";
import {
  AGENT_SESSION_REQUEST_PARSER,
  describeCoverageGaps,
  listeningRequestFromCrateParse,
  requestRankingPreferences,
  type AgentSessionRequest,
  type AgentSessionParseResponse,
} from "./agent_session_request";
import { AllowWhileSuspended } from "../accounts/allow_while_suspended.decorator";
import { EventBus } from "../shared/event_bus";
import { minutes } from "../shared/rate_limits";
import { CRATE_REQUEST_MAX_TEXT_LENGTH } from "../crates/crate.types";
import type { CrateRequestParser } from "../crates/crate_request_parser";
import { AgentSessionArtistResolver } from "./agent_session_artist_resolver";
import { createAgentSessionRequestParser } from "./agent_session_parser";
import { getAgentSessionHistoryLimit, getAgentTrackLimit } from "./agent_runtime.config";
import { UnmetDemandService } from "../scene_scout/unmet_demand.service";
import { TASTE_EDIT_GENRES, TASTE_EDIT_MOODS } from "../recommendations/taste_edit_vocabulary";
import { resolveMyMixPlan } from "./agent_my_mix";
import type { MyMixPreferences } from "./agent_my_mix";
import { resolveListeningLanes } from "./listening_lanes.service";
import { historyRecommendation, pickNoteColumns, pickNoteFromRow, pickNotesFromRunResult } from "./agent_pick_notes";
import type { PickNote } from "./agent_pick_notes";

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
        @Optional()
        sounds?: AgentSoundsService,
    ) {
        this.sounds = sounds ?? new AgentSoundsService();
    }

    private readonly sounds: AgentSoundsService;

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
        const ensuredUserId = normalizeUserId(req.user.userId);
        await prisma.user.upsert({
            where: { id: ensuredUserId },
            update: {},
            create: {
                id: ensuredUserId,
                email: `${ensuredUserId}@wallet.local`,
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
        @Body() body: { name?: string; vibes?: string[]; stemTypes?: string[]; sessionMode?: string; monthlyCapUsd?: number; isActive?: boolean; allowExplicit?: boolean }
    ) {
        const allowedData: {
            name?: string;
            vibes?: string[];
            stemTypes?: string[];
            sessionMode?: string;
            monthlyCapUsd?: number;
            isActive?: boolean;
            allowExplicit?: boolean;
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
        if (body.allowExplicit !== undefined) {
            if (typeof body.allowExplicit !== "boolean") {
                throw new BadRequestException({ reason: "invalid_allow_explicit" });
            }
            allowedData.allowExplicit = body.allowExplicit;
        }

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

    @Get("session/mix-vocabulary")
    @UseGuards(AuthGuard("jwt"))
    getMixVocabulary() {
        return { genres: [...TASTE_EDIT_GENRES], moods: [...TASTE_EDIT_MOODS] };
    }

    /**
     * The Sounds row (#2249): genre families the catalog can fill, for this
     * listener. Counts come from one cached catalog aggregate (never a query
     * per render); the explicit preference (`allowExplicit` query value, else
     * the saved choice) selects the count, families below
     * `AGENT_SOUNDS_MIN_TRACKS` are omitted, and the rest follow the listener's
     * learned taste, then catalog size.
     */
    @Get("session/sounds")
    @UseGuards(AuthGuard("jwt"))
    async getSessionSounds(@Req() req: any, @Query("allowExplicit") allowExplicitQuery?: string) {
        const userId = req.user.userId;
        const config = await prisma.agentConfig.findUnique({
            where: { userId },
            select: { allowExplicit: true, vibes: true },
        });
        const requested =
            allowExplicitQuery === "true" ? true : allowExplicitQuery === "false" ? false : undefined;
        const allowExplicit = resolveAllowExplicit(requested, config?.allowExplicit);
        // Taste only orders the row: a failure to read it falls back to catalog size.
        const profile = await this.learningService
            .resolveTasteProfile(userId, config?.vibes ?? [])
            .catch((error) => {
                this.logger.warn(`Sounds taste unavailable: ${error instanceof Error ? error.message : String(error)}`);
                return null;
            });
        return this.sounds.getForListener({ allowExplicit, genreWeights: profile?.genreWeights });
    }

    @Get("session/:sessionId/mix-coverage")
    @UseGuards(AuthGuard("jwt"))
    async getMixCoverage(@Req() req: any, @Param("sessionId") sessionId: string) {
        const session = await prisma.session.findFirst({
            where: { id: sessionId, userId: req.user.userId },
            select: { id: true },
        });
        if (!session) throw new NotFoundException("Session not found");
        const mixCoverage = this.runtimeService.getInitialMixCoverage(req.user.userId, sessionId);
        return mixCoverage ? { mixCoverage } : {};
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
    async parseSession(@Body() body: ParseSessionRequestDto, @Req() req?: any): Promise<AgentSessionParseResponse> {
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text) {
            throw new BadRequestException({ reason: "text_required" });
        }
        this.requestParser ??= createAgentSessionRequestParser(new AgentSessionArtistResolver());
        // The user id only keys the model-assisted parser's per-user budget; the
        // throttle above sees the IP, because global guards run before the JWT one.
        const userId = typeof req?.user?.userId === "string" ? req.user.userId : undefined;
        return listeningRequestFromCrateParse(
            await this.requestParser.parse(text, userId ? { userId } : undefined),
        );
    }

    @AllowWhileSuspended()
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
                /**
                 * The listener's sentence (#2241): joins this session's semantic query only.
                 * Bounded here; never stored, logged or published.
                 */
                requestText?: unknown;
                /** Catalog artists the sentence named (#2241); seed neighbours for retrieval. */
                artists?: unknown;
                /**
                 * What the session starts from (#2244): `{ kind: "track" | "artist" | "playlist", id, label }`.
                 * Resolved here: a playlist the caller neither owns nor may see is refused (403).
                 */
                seed?: unknown;
                myMix?: MyMixPreferences | null;
            };
        }
    ) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        if (!config) {
            return { status: "not_configured" };
        }
        if (body?.preferences?.myMix != null) {
            resolveMyMixPlan(
                body.preferences.myMix,
                await resolveListeningLanes(req.user.userId),
                getAgentTrackLimit(),
            );
        }
        // The seed (#2244) is resolved, and a playlist access-checked, before anything is written.
        const seed = body?.preferences?.seed != null
            ? await resolveSessionSeed(req.user.userId, body.preferences.seed)
            : undefined;
        // The described session (#2037): invalid fields are dropped, and with
        // no request every derived value below is exactly what it was before.
        const requested = requestRankingPreferences({
            mood: body?.preferences?.mood,
            energy: body?.preferences?.energy,
            request: body?.preferences?.request,
            requestText: body?.preferences?.requestText,
            artists: body?.preferences?.artists,
        });
        // Request genres count as session genres, after the ones sent.
        const sessionGenres = requested.request
            ? [...(body?.preferences?.genres ?? []), ...requested.sessionGenres]
            : body?.preferences?.genres;
        // The persisted listener choice applies unless this session sends its own (#2088).
        const allowExplicit = resolveAllowExplicit(body?.preferences?.allowExplicit, config.allowExplicit);
        const sessionPreferences = {
            genres: requested.request
                ? [...(body?.preferences?.genres ?? config.vibes), ...requested.sessionGenres]
                : body?.preferences?.genres ?? config.vibes,
            stemTypes: config.stemTypes,
            mood: requested.mood,
            energy: requested.energy,
            allowExplicit,
            licenseType: body?.preferences?.licenseType ?? "personal",
            sessionIntent: body?.preferences?.sessionIntent,
            sessionIntentName: body?.preferences?.sessionIntentName,
            queueStyle: body?.preferences?.queueStyle,
            source: body?.preferences?.source,
            myMix: body?.preferences?.myMix,
            // Published as its kind only: the id may name a private playlist.
            ...(seed ? { seedKind: seed.kind } : {}),
        };

        // Create a persistent Session record
        const session = await prisma.session.create({
            data: {
                userId: req.user.userId,
                budgetCapUsd: config.monthlyCapUsd,
                // The session's OWN filters for Session History (#2096): never
                // the vibes fallback, never free text.
                filters: sessionFilterSummary({
                    sessionIntentName: body?.preferences?.sessionIntentName,
                    sessionGenres,
                    moods: requested.moods,
                    mood: requested.mood,
                    energy: requested.energy,
                    tempoBpm: requested.tempoBpm,
                    myMix: body?.preferences?.myMix,
                    seed,
                    allowExplicit,
                }) as unknown as Prisma.InputJsonValue,
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
                preferences: publicSessionPreferences(sessionPreferences),
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
                    // What this session asked for itself, so it outranks learned taste (#2059).
                    ...(sessionGenres?.length ? { sessionGenres } : {}),
                    mood: sessionPreferences.mood,
                    energy: sessionPreferences.energy,
                    allowExplicit: sessionPreferences.allowExplicit,
                    licenseType: sessionPreferences.licenseType,
                    sessionIntent: sessionPreferences.sessionIntent,
                    sessionIntentName: sessionPreferences.sessionIntentName,
                    queueStyle: sessionPreferences.queueStyle,
                    source: sessionPreferences.source,
                    myMix: sessionPreferences.myMix,
                    // The sentence and the artists it named (#2241): in memory for this
                    // run only, read by the semantic query and the artist seeds.
                    ...(requested.requestText ? { requestText: requested.requestText } : {}),
                    ...(requested.artists.length > 0 ? { artists: requested.artists } : {}),
                    // What the session started from (#2244), resolved above; in memory for this run only.
                    ...(seed ? { seed } : {}),
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
                    // Each pick's explanation is stored with its License (#2299), so
                    // Session History shows it from any instance, and before play.
                    let pickNotes = new Map<string, PickNote>();
                    try {
                        pickNotes = pickNotesFromRunResult(result);
                    } catch {
                        this.logger.warn("Pick explanations were skipped after an agent session result.");
                    }
                    const pickNoteFor = (trackId: string) => {
                        const note = pickNotes.get(trackId);
                        return note
                            ? { pickNote: { create: { userId: req.user.userId, ...pickNoteColumns(note) } } }
                            : {};
                    };
                    const resultStatus = typeof result.status === "string" ? result.status : "";
                    const foundTrackIds = "tracks" in result
                        ? result.tracks.map((track) => track.trackId)
                        : (result.picks ?? (result.trackId ? [{ trackId: result.trackId }] : []))
                            .map((pick) => pick.trackId);
                    if (sessionPreferences.myMix != null) {
                        await this.recordMyMixDemand(req.user.userId, session.id);
                    }
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
                                requestCoverage: result.requestCoverage,
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
                                        ...pickNoteFor(track.trackId),
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
                                        ...pickNoteFor(pick.trackId),
                                    },
                                });
                            } catch (err) {
                                this.logger.error(`Failed to persist pick for ${pick.trackId}:`, err);
                            }
                        }
                        const coverageSummary = requested.request && result.requestCoverage
                            ? describeCoverageGaps(requested.request, result.requestCoverage)
                            : "";
                        // Publish the decision with the LLM reasoning: one event per
                        // pick, as analytics expects (#2317). The envelope subject is
                        // one track (200 characters at most), so a comma-joined list
                        // of a 12-track batch was rejected and the decision was lost.
                        // The batch-level fields (reasoning, latency, coverage) ride
                        // on the first event only; the live feed shows one line per
                        // batch (pickIndex > 0 is skipped there).
                        const batchFields = {
                            reasoning: result.reasoning,
                            latencyMs: result.latencyMs,
                            ...(result.requestCoverage
                                ? {
                                    coverage: result.requestCoverage,
                                    ...(coverageSummary ? { coverageSummary } : {}),
                                }
                                : {}),
                        };
                        const decisionBase = () => ({
                            eventName: "agent.decision_made" as const,
                            eventVersion: 1,
                            occurredAt: new Date().toISOString(),
                            sessionId: session.id,
                            reason: result.reason ?? "llm",
                            curatedBy: "llm" as const,
                        });
                        if (picks.length === 0) {
                            this.eventBus.publish({ ...decisionBase(), trackId: "", ...batchFields });
                        }
                        picks.forEach((pick, pickIndex) => {
                            this.eventBus.publish({
                                ...decisionBase(),
                                trackId: pick.trackId,
                                licenseType: pick.licenseType,
                                pickIndex,
                                pickCount: picks.length,
                                ...(pickIndex === 0 ? batchFields : {}),
                            });
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

    @AllowWhileSuspended()
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
            this.runtimeService.clearMyMixSession(req.user.userId, openSession.id);
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

    private async recordMyMixDemand(userId: string, sessionId: string) {
        if (!this.unmetDemand) return;
        const observations = this.runtimeService.takeMyMixDemandObservations(userId, sessionId);
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
     * Lifetime totals across every session. `history` returns only the most
     * recent `AGENT_SESSION_HISTORY_LIMIT` sessions, so page stats come from here.
     */
    @Get("history/summary")
    @UseGuards(AuthGuard("jwt"))
    async getHistorySummary(@Req() req: any) {
        const userId: string = req.user.userId;
        const [sessionCount, sessionsWithTracks, trackCount] = await Promise.all([
            prisma.session.count({ where: { userId } }),
            prisma.session.count({ where: { userId, licenses: { some: {} } } }),
            prisma.license.count({ where: { session: { userId } } }),
        ]);
        return {
            sessionCount,
            sessionsWithTracks,
            trackCount,
            historyLimit: getAgentSessionHistoryLimit(),
        };
    }

    @Get("history")
    @UseGuards(AuthGuard("jwt"))
    async getHistory(@Req() req: any) {
        const sessions = await prisma.session.findMany({
            where: { userId: req.user.userId },
            orderBy: { startedAt: "desc" },
            take: getAgentSessionHistoryLimit(),
            include: {
                licenses: {
                    include: {
                        pickNote: true,
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
            // Initial playback must use the ordered batch, not unordered pick-log rows.
            const mixTrackIds = this.runtimeService.getMyMixTrackOrder?.(req.user.userId, session.id);
            if (mixTrackIds) Object.assign(session, { mixTrackIds });
            const signalByTrack = new Map(session.agentSignals.map((signal) => [signal.trackId, signal.metadata]));
            // A pick the listener has not played has no signal yet: fall back to
            // the explanation stored with the pick (#2299; absent on older picks).
            // @ts-ignore - hydrating dynamic props for frontend
            session.licenses = session.licenses.map((license) => {
                const signal = signalByTrack.get(license.trackId) as Record<string, unknown> | null | undefined;
                const { pickNote, ...rest } = license;
                const note = pickNoteFromRow(pickNote);
                return {
                    ...rest,
                    recommendation: historyRecommendation(note, signal),
                };
            });
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

function publicSessionPreferences(preferences: Record<string, unknown>): Record<string, unknown> {
    // The sentence and the artists it named stay inside the request (#2241).
    const { myMix: _myMix, requestText: _requestText, artists: _artists, ...safePreferences } = preferences;
    return safePreferences;
}
