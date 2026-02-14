import { Body, Controller, Get, Logger, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { prisma } from "../../db/prisma";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRuntimeService } from "./agent_runtime.service";
import { AgentPurchaseService } from "./agent_purchase.service";
import { AgentNegotiatorService } from "./agent_negotiator.service";
import { EventBus } from "../shared/event_bus";
import type { NegotiationResult } from "./agent_negotiator.service";

@Controller("agents/config")
export class AgentConfigController {
    private readonly logger = new Logger(AgentConfigController.name);

    constructor(
        private readonly orchestrator: AgentOrchestratorService,
        private readonly runtimeService: AgentRuntimeService,
        private readonly purchaseService: AgentPurchaseService,
        private readonly negotiatorService: AgentNegotiatorService,
        private readonly eventBus: EventBus
    ) { }

    @Get()
    @UseGuards(AuthGuard("jwt"))
    async get(@Req() req: any) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        return config ?? null;
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

        return prisma.agentConfig.upsert({
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
    }

    @Patch()
    @UseGuards(AuthGuard("jwt"))
    async update(
        @Req() req: any,
        @Body() body: { name?: string; vibes?: string[]; stemTypes?: string[]; sessionMode?: string; monthlyCapUsd?: number; isActive?: boolean }
    ) {
        return prisma.agentConfig.update({
            where: { userId: req.user.userId },
            data: body,
        });
    }

    @Post("session")
    @UseGuards(AuthGuard("jwt"))
    async startSession(@Req() req: any) {
        const config = await prisma.agentConfig.findUnique({
            where: { userId: req.user.userId },
        });
        if (!config) {
            return { status: "not_configured" };
        }

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
                preferences: { genres: config.vibes },
            });

            // Kick off orchestration — route through LLM when AGENT_RUNTIME is set
            const runtimeInput = {
                sessionId: session.id,
                userId: req.user.userId,
                recentTrackIds: [] as string[],
                budgetRemainingUsd: config.monthlyCapUsd,
                preferences: {
                    genres: config.vibes,
                    stemTypes: config.stemTypes,
                    licenseType: "personal" as const,
                },
            };

            this.runtimeService
                .run(runtimeInput)
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
                }
            },
        });

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

        for (const listing of listings) {
            try {
                this.logger.log(`[Agent] Purchasing listing ${listing.listingId} price=${listing.pricePerUnit}`);
                const result = await this.purchaseService.purchase({
                    sessionId,
                    userId,
                    listingId: listing.listingId,
                    tokenId: listing.tokenId,
                    amount: 1n,
                    totalPriceWei: listing.pricePerUnit,
                    priceUsd: negotiation.priceUsd,
                });
                if (!result.success) {
                    this.logger.warn(
                        `Purchase failed for listing ${listing.listingId} (${listing.stemType}): ${result.reason}`,
                    );
                } else {
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
