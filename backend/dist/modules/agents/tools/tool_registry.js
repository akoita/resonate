"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRegistry = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../../db/prisma");
const pricing_1 = require("../../../pricing/pricing");
const embedding_service_1 = require("../../embeddings/embedding.service");
const embedding_store_1 = require("../../embeddings/embedding.store");
let ToolRegistry = class ToolRegistry {
    embeddingService;
    embeddingStore;
    tools = new Map();
    constructor(embeddingService, embeddingStore) {
        this.embeddingService = embeddingService;
        this.embeddingStore = embeddingStore;
        this.register({
            name: "catalog.search",
            run: async (input) => {
                const query = String(input.query ?? "");
                const limit = Number(input.limit ?? 20);
                const explicitAllowed = Boolean(input.allowExplicit ?? false);
                const take = Math.min(Math.max(limit, 1), 50);
                // Search by genre on the release, OR by title
                const whereBase = explicitAllowed ? {} : { explicit: false };
                let items = await prisma_1.prisma.track.findMany({
                    where: {
                        ...whereBase,
                        ...(query
                            ? {
                                OR: [
                                    { release: { genre: { contains: query, mode: "insensitive" } } },
                                    { title: { contains: query, mode: "insensitive" } },
                                ],
                            }
                            : {}),
                    },
                    include: {
                        release: { select: { title: true, genre: true, artworkUrl: true } },
                        stems: {
                            select: {
                                listings: {
                                    where: { status: "active" },
                                    select: { id: true },
                                    take: 1,
                                },
                            },
                        },
                    },
                    orderBy: { createdAt: "desc" },
                    take,
                });
                // Fallback: if no genre/title match, return the most recent tracks
                if (items.length === 0 && query) {
                    items = await prisma_1.prisma.track.findMany({
                        where: whereBase,
                        include: {
                            release: { select: { title: true, genre: true, artworkUrl: true } },
                            stems: {
                                select: {
                                    listings: {
                                        where: { status: "active" },
                                        select: { id: true },
                                        take: 1,
                                    },
                                },
                            },
                        },
                        orderBy: { createdAt: "desc" },
                        take,
                    });
                }
                // Annotate and sort: listed tracks first
                const annotated = items.map((t) => {
                    const hasListing = (t.stems ?? []).some((s) => s.listings.length > 0);
                    const { stems, ...rest } = t;
                    return { ...rest, hasListing };
                });
                annotated.sort((a, b) => (a.hasListing === b.hasListing ? 0 : a.hasListing ? -1 : 1));
                return { items: annotated };
            },
        });
        this.register({
            name: "pricing.quote",
            run: async (input) => {
                const licenseType = input.licenseType ?? "personal";
                const base = {
                    basePlayPriceUsd: 0.02,
                    remixSurchargeMultiplier: 3,
                    commercialMultiplier: 5,
                    volumeDiscountPercent: 5,
                    floorUsd: 0.01,
                    ceilingUsd: 1,
                };
                const priceUsd = (0, pricing_1.calculatePrice)(licenseType, base, Boolean(input.volume));
                return { priceUsd };
            },
        });
        this.register({
            name: "analytics.signal",
            run: async (input) => {
                return {
                    trackId: input.trackId,
                    plays: 0,
                    score: 0,
                };
            },
        });
        this.register({
            name: "embeddings.similarity",
            run: async (input) => {
                const query = String(input.query ?? "");
                const candidateIds = input.candidates ?? [];
                const queryVector = this.embeddingService.embed(query);
                for (const trackId of candidateIds) {
                    if (this.embeddingStore.get(trackId)) {
                        continue;
                    }
                    const track = await prisma_1.prisma.track.findUnique({
                        where: { id: trackId },
                        include: { release: true }
                    });
                    const text = `${track?.title ?? ""} ${track?.release?.genre ?? ""}`.trim();
                    if (text) {
                        this.embeddingStore.upsert(trackId, this.embeddingService.embed(text));
                    }
                }
                return {
                    ranked: this.embeddingStore.similarity(queryVector, candidateIds),
                };
            },
        });
    }
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    get(name) {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }
        return tool;
    }
};
exports.ToolRegistry = ToolRegistry;
exports.ToolRegistry = ToolRegistry = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [embedding_service_1.EmbeddingService,
        embedding_store_1.EmbeddingStore])
], ToolRegistry);
