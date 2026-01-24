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
exports.CatalogService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
const prisma_1 = require("../../db/prisma");
let CatalogService = class CatalogService {
    eventBus;
    searchCache = new Map();
    cacheTtlMs = 30_000;
    constructor(eventBus) {
        this.eventBus = eventBus;
    }
    onModuleInit() {
        this.eventBus.subscribe("stems.uploaded", (event) => {
            this.clearCache();
            prisma_1.prisma.track
                .create({
                data: {
                    id: event.trackId,
                    artistId: event.artistId,
                    title: event.metadata?.releaseTitle ?? "Untitled Track",
                    status: "processing",
                    releaseType: event.metadata?.releaseType ?? "single",
                    releaseTitle: event.metadata?.releaseTitle,
                    primaryArtist: event.metadata?.primaryArtist,
                    featuredArtists: event.metadata?.featuredArtists?.join(", "),
                    genre: event.metadata?.genre,
                    isrc: event.metadata?.isrc,
                    label: event.metadata?.label,
                    releaseDate: event.metadata?.releaseDate
                        ? new Date(event.metadata.releaseDate)
                        : undefined,
                    explicit: event.metadata?.explicit ?? false,
                },
            })
                .catch(() => null);
        });
        this.eventBus.subscribe("stems.processed", async (event) => {
            this.clearCache();
            if (event.stems?.length) {
                await prisma_1.prisma.stem.createMany({
                    data: event.stems.map((stem) => ({
                        id: stem.id,
                        trackId: event.trackId,
                        type: stem.type,
                        uri: stem.uri,
                    })),
                    skipDuplicates: true,
                });
            }
            await prisma_1.prisma.track
                .update({
                where: { id: event.trackId },
                data: { status: "ready" },
            })
                .catch(() => null);
        });
        this.eventBus.subscribe("ipnft.minted", async (event) => {
            this.clearCache();
            await prisma_1.prisma.stem
                .update({
                where: { id: event.stemId },
                data: { ipnftId: event.tokenId },
            })
                .catch(() => null);
        });
    }
    async createTrack(input) {
        this.clearCache();
        return prisma_1.prisma.track.create({
            data: {
                artistId: input.artistId,
                title: input.title,
                status: "draft",
                releaseType: input.releaseType ?? "single",
                releaseTitle: input.releaseTitle,
                primaryArtist: input.primaryArtist,
                featuredArtists: input.featuredArtists?.join(", "),
                genre: input.genre,
                isrc: input.isrc,
                label: input.label,
                releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined,
                explicit: input.explicit ?? false,
            },
            include: { stems: true },
        });
    }
    async getTrack(trackId) {
        return prisma_1.prisma.track.findUnique({
            where: { id: trackId },
            include: { stems: true },
        });
    }
    async listByArtist(artistId) {
        return prisma_1.prisma.track.findMany({
            where: { artistId },
            include: { stems: true },
            orderBy: { createdAt: "desc" },
        });
    }
    async listPublished(limit = 20) {
        return prisma_1.prisma.track.findMany({
            where: { status: "ready" },
            include: { stems: true, artist: true },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
    }
    async updateTrack(trackId, input) {
        this.clearCache();
        return prisma_1.prisma.track.update({
            where: { id: trackId },
            data: input,
            include: { stems: true },
        });
    }
    async search(query, filters) {
        const cacheKey = JSON.stringify({
            query,
            stemType: filters?.stemType ?? null,
            hasIpnft: filters?.hasIpnft ?? null,
            limit: filters?.limit ?? null,
        });
        const cached = this.searchCache.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
            return { items: cached.items };
        }
        const cappedLimit = Math.min(Math.max(filters?.limit ?? 50, 1), 100);
        const stemsWhere = filters?.hasIpnft === undefined && !filters?.stemType
            ? undefined
            : {
                ...(filters?.hasIpnft === true
                    ? {
                        some: {
                            ...(filters?.stemType ? { type: filters.stemType } : {}),
                            ipnftId: { not: null },
                        },
                    }
                    : {}),
                ...(filters?.hasIpnft === false ? { every: { ipnftId: null } } : {}),
                ...(filters?.hasIpnft !== true && filters?.stemType
                    ? { some: { type: filters.stemType } }
                    : {}),
            };
        const items = await prisma_1.prisma.track.findMany({
            where: {
                title: { contains: query, mode: "insensitive" },
                stems: stemsWhere,
            },
            include: { stems: true },
            take: cappedLimit,
        });
        this.searchCache.set(cacheKey, { items, cachedAt: Date.now() });
        return { items };
    }
    clearCache() {
        this.searchCache.clear();
    }
};
exports.CatalogService = CatalogService;
exports.CatalogService = CatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus])
], CatalogService);
