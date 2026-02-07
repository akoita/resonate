import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { prisma } from "../../db/prisma";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { EventBus } from "../shared/event_bus";

@Controller("agents/config")
export class AgentConfigController {
    constructor(
        private readonly orchestrator: AgentOrchestratorService,
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
        @Body() body: { name?: string; vibes?: string[]; monthlyCapUsd?: number; isActive?: boolean }
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

            // Kick off orchestration
            this.orchestrator
                .orchestrate({
                    sessionId: session.id,
                    userId: req.user.userId,
                    recentTrackIds: [],
                    budgetRemainingUsd: config.monthlyCapUsd,
                    preferences: {
                        genres: config.vibes,
                        licenseType: "personal",
                    },
                })
                .then(async (result) => {
                    // Persist each approved track as a License
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
                        } catch (err) {
                            console.error(`[AgentConfig] Failed to persist license for ${track.trackId}:`, err);
                        }
                    }

                    // Update session spend
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
                })
                .catch((err) => {
                    console.error(`[AgentConfig] Orchestration failed for session ${session.id}:`, err);
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
                                release: { select: { artworkUrl: true, title: true } },
                            },
                        },
                    },
                },
            },
        });
        return sessions;
    }
}
