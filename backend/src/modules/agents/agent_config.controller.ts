import { BadRequestException, Body, Controller, Get, Logger, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRuntimeService } from "./agent_runtime.service";
import { PaymentRouterService } from "./payment_router.service";
import { AgentNegotiatorService } from "./agent_negotiator.service";
import { AgentIdentityService } from "./agent_identity.service";
import { AgentLearningService, isAgentSignalAction, type AgentSignalAction } from "./agent_learning.service";
import { AgentStemQualityService } from "./agent_stem_quality.service";
import { EventBus } from "../shared/event_bus";
import type { NegotiationResult } from "./agent_negotiator.service";

@Controller("agents/config")
export class AgentConfigController {
    private readonly logger = new Logger(AgentConfigController.name);

    constructor(
        private readonly orchestrator: AgentOrchestratorService,
        private readonly runtimeService: AgentRuntimeService,
        private readonly paymentRouter: PaymentRouterService,
        private readonly negotiatorService: AgentNegotiatorService,
        private readonly identityService: AgentIdentityService,
        private readonly learningService: AgentLearningService,
        private readonly stemQualityService: AgentStemQualityService,
        private readonly eventBus: EventBus
    ) { }

    @Get()
    @UseGuards(AuthGuard("jwt"))
    async get(@Req() req: any) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        return config ? this.identityService.enrichConfig(config) : null;
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
        if (body.sessionMode !== undefined) allowedData.sessionMode = body.sessionMode;
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
        if (!body.trackId || !isAgentSignalAction(body.action)) {
            throw new BadRequestException({
                reason: "trackId and valid action are required",
                acceptedActions: ["accept", "skip", "replay", "add_to_playlist", "purchase"],
            });
        }

        const profile = await this.learningService.recordSignal({
            userId: req.user.userId,
            sessionId: body.sessionId,
            trackId: body.trackId,
            action: body.action as AgentSignalAction,
            metadata: body.metadata as Prisma.InputJsonObject | undefined,
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
            };
        }
    ) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        if (!config) {
            return { status: "not_configured" };
        }
        const sessionPreferences = {
            genres: body?.preferences?.genres ?? config.vibes,
            stemTypes: config.stemTypes,
            mood: body?.preferences?.mood,
            energy: body?.preferences?.energy,
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
            const generationBudgetUsd = parseFloat(process.env.AGENT_GENERATION_BUDGET ?? "1.00");
            const tasteProfilePromise = this.learningService.computeTasteProfile(req.user.userId, config.vibes).catch((error) => {
                this.logger.warn(`Failed to compute learned taste profile: ${error}`);
                return null;
            });
            const runtimeInput = {
                sessionId: session.id,
                userId: req.user.userId,
                recentTrackIds: [] as string[],
                budgetRemainingUsd: config.monthlyCapUsd,
                generationBudgetUsd,
                preferences: {
                    genres: sessionPreferences.genres,
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
                },
            };

            tasteProfilePromise
                .then((profile) => {
                    if (profile) {
                        runtimeInput.preferences.genres = this.learningService.mergeLearnedGenres(config.vibes, profile);
                        runtimeInput.preferences.learnedGenreWeights = profile.genreWeights;
                    }
                    return this.runtimeService.run(runtimeInput);
                })
                .then(async (result) => {
                    if ("tracks" in result) {
                        // Orchestrator pipeline result (local mode)
                        for (const track of result.tracks) {
                            try {
                                await prisma.license.create({
                                    data: {
                                        sessionId: session.id,
                                        trackId: track.trackId,
                                        type: track.negotiation.licenseType,
                                        priceUsd: track.negotiation.priceUsd,
                                        durationSeconds: 0,
                                    },
                                });
                                await this.learningService.recordSignal({
                                    userId: req.user.userId,
                                    sessionId: session.id,
                                    trackId: track.trackId,
                                    action: "accept",
                                    metadata: {
                                        source: "agent_session",
                                        sessionIntent: sessionPreferences.sessionIntent,
                                        sessionIntentName: sessionPreferences.sessionIntentName,
                                        queueStyle: sessionPreferences.queueStyle,
                                        recommendation: track.negotiation.recommendation ?? null,
                                        reason: track.negotiation.reason,
                                    },
                                });
                                this.logger.log(`[Agent] Processing track ${track.trackId} in mode ${config.sessionMode}`);
                                if (config.sessionMode === "buy") {
                                    await this.recordPurchase(
                                        session.id,
                                        req.user.userId,
                                        track.trackId,
                                        track.negotiation,
                                    );
                                } else {
                                    this.logger.log(`[Agent] Skipping purchase for ${track.trackId} (mode: ${config.sessionMode})`);
                                }
                            } catch (err) {
                                this.logger.error(`Failed to persist license for ${track.trackId}:`, err);
                            }
                        }
                        const totalSpend = result.tracks.reduce(
                            (sum, t) => sum + t.negotiation.priceUsd,
                            0
                        );
                        if (totalSpend > 0) {
                            await prisma.session.update({
                                where: { id: session.id },
                                data: { spentUsd: totalSpend },
                            });
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
                        let totalSpend = 0;
                        for (const pick of picks) {
                            try {
                                await prisma.license.create({
                                    data: {
                                        sessionId: session.id,
                                        trackId: pick.trackId,
                                        type: pick.licenseType,
                                        priceUsd: pick.priceUsd,
                                        durationSeconds: 0,
                                    },
                                });
                                await this.learningService.recordSignal({
                                    userId: req.user.userId,
                                    sessionId: session.id,
                                    trackId: pick.trackId,
                                    action: "accept",
                                    metadata: {
                                        source: "agent_session",
                                        sessionIntent: sessionPreferences.sessionIntent,
                                        sessionIntentName: sessionPreferences.sessionIntentName,
                                        queueStyle: sessionPreferences.queueStyle,
                                        runtime: "llm",
                                        reason: result.reason ?? "llm",
                                        reasoning: result.reasoning,
                                    },
                                });
                                if (config.sessionMode === "buy") {
                                    // Fetch actual listings to ensure we can buy
                                    const negotiation = await this.negotiatorService.negotiate({
                                        trackId: pick.trackId,
                                        licenseType: pick.licenseType,
                                        budgetRemainingUsd: config.monthlyCapUsd, // We use cap here, actual spend check happens in service
                                        stemTypes: config.stemTypes,
                                    });

                                    if (negotiation.allowed) {
                                        await this.recordPurchase(
                                            session.id,
                                            req.user.userId,
                                            pick.trackId,
                                            negotiation,
                                        );
                                    } else {
                                        this.logger.warn(`[Agent] LLM picked track ${pick.trackId} but negotiation failed: ${negotiation.reason}`);
                                    }
                                }
                                totalSpend += pick.priceUsd;
                            } catch (err) {
                                this.logger.error(`Failed to persist license for ${pick.trackId}:`, err);
                            }
                        }
                        if (totalSpend > 0) {
                            await prisma.session.update({
                                where: { id: session.id },
                                data: { spentUsd: totalSpend },
                            });
                        }
                        // Publish decision event with LLM reasoning
                        this.eventBus.publish({
                            eventName: "agent.decision_made",
                            eventVersion: 1,
                            occurredAt: new Date().toISOString(),
                            sessionId: session.id,
                            trackId: picks.map(p => p.trackId).join(","),
                            licenseType: picks[0]?.licenseType,
                            priceUsd: totalSpend,
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
                                release: { select: { id: true, artworkMimeType: true, title: true } },
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

    /**
     * Purchase all active on-chain listings for a track via the bundler.
     * Tracks without listings are skipped — no mock records.
     */
    private async recordPurchase(
        sessionId: string,
        userId: string,
        trackId: string,
        negotiation: NegotiationResult,
    ) {
        const listings = negotiation.listings ?? [];
        this.logger.log(`[Agent] recordPurchase: track=${trackId} user=${userId} listings=${listings.length}`);

        if (listings.length === 0) {
            this.logger.warn(`[Agent] No active listings for track ${trackId} — skipping purchase`);
            return;
        }

        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            select: { budgetCapUsd: true, spentUsd: true },
        });
        let budgetRemainingUsd = Math.max(
            0,
            (session?.budgetCapUsd ?? negotiation.priceUsd) - (session?.spentUsd ?? 0),
        );
        let purchaseSignalRecorded = false;
        for (const listing of listings) {
            try {
                this.logger.log(`[Agent] Purchasing listing ${listing.listingId} price=${listing.pricePerUnit}`);
                const result = await this.paymentRouter.purchase({
                    sessionId,
                    userId,
                    rail: "erc4337_marketplace",
                    licenseType: negotiation.licenseType,
                    listingId: listing.listingId,
                    tokenId: listing.tokenId,
                    amount: 1n,
                    totalPriceWei: listing.pricePerUnit,
                    priceUsd: negotiation.priceUsd,
                    budgetRemainingUsd,
                });
                if (!result.success) {
                    this.logger.warn(
                        `Purchase failed for listing ${listing.listingId} (${listing.stemType}): ${result.reason}`,
                    );
                } else {
                    budgetRemainingUsd = result.remaining ?? Math.max(0, budgetRemainingUsd - negotiation.priceUsd);
                    if (!purchaseSignalRecorded) {
                        await this.learningService.recordSignal({
                            userId,
                            sessionId,
                            trackId,
                            action: "purchase",
                            metadata: {
                                source: "agent_purchase",
                                listingId: String(listing.listingId),
                                stemType: listing.stemType,
                                qualityScore: listing.qualityScore ?? null,
                                qualityRatingId: listing.qualityRatingId ?? null,
                                priceUsd: negotiation.priceUsd,
                            },
                        });
                        purchaseSignalRecorded = true;
                    }
                    if (listing.stemId) {
                        await this.stemQualityService.recordValidation({
                            stemId: listing.stemId,
                            validation: "purchase",
                        });
                    }
                    this.logger.log(`[Agent] Purchase success: tx=${result.txHash}`);
                }
            } catch (err) {
                this.logger.error(
                    `Purchase error for listing ${listing.listingId}: ${err}`,
                );
            }
        }
    }
}
