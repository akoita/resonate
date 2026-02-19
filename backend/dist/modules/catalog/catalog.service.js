"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
const prisma_1 = require("../../db/prisma");
const encryption_service_1 = require("../encryption/encryption.service");
const storage_provider_1 = require("../storage/storage_provider");
let CatalogService = class CatalogService {
    eventBus;
    encryptionService;
    storageProvider;
    searchCache = new Map();
    cacheTtlMs = 30_000;
    constructor(eventBus, encryptionService, storageProvider) {
        this.eventBus = eventBus;
        this.encryptionService = encryptionService;
        this.storageProvider = storageProvider;
    }
    onModuleInit() {
        this.eventBus.subscribe("stems.uploaded", async (event) => {
            console.log(`[Catalog] Received stems.uploaded for release ${event.releaseId} (artist: ${event.artistId})`);
            this.clearCache();
            try {
                await prisma_1.prisma.release.upsert({
                    where: { id: event.releaseId },
                    update: {
                        artistId: event.artistId,
                        status: "processing",
                        artworkData: event.artworkData,
                        artworkMimeType: event.artworkMimeType,
                        title: event.metadata?.title ?? undefined,
                        type: event.metadata?.type ?? undefined,
                        primaryArtist: event.metadata?.primaryArtist ?? undefined,
                        featuredArtists: event.metadata?.featuredArtists?.join(", ") ?? undefined,
                        genre: event.metadata?.genre ?? undefined,
                        label: event.metadata?.label ?? undefined,
                        releaseDate: event.metadata?.releaseDate ? new Date(event.metadata.releaseDate) : undefined,
                        explicit: event.metadata?.explicit ?? undefined,
                        tracks: event.checksum === "retry" ? {
                            updateMany: {
                                where: { releaseId: event.releaseId },
                                data: { processingStatus: "pending" }
                            }
                        } : undefined
                    },
                    create: {
                        id: event.releaseId,
                        artistId: event.artistId,
                        title: event.metadata?.title || "Untitled Release",
                        status: "processing",
                        type: event.metadata?.type || "single",
                        primaryArtist: event.metadata?.primaryArtist,
                        featuredArtists: event.metadata?.featuredArtists?.join(", "),
                        genre: event.metadata?.genre,
                        label: event.metadata?.label,
                        releaseDate: event.metadata?.releaseDate
                            ? new Date(event.metadata.releaseDate)
                            : undefined,
                        explicit: event.metadata?.explicit ?? false,
                        artworkData: event.artworkData,
                        artworkMimeType: event.artworkMimeType,
                        tracks: {
                            create: event.metadata?.tracks?.map((t) => ({
                                id: t.id,
                                title: t.title,
                                artist: t.artist,
                                position: t.position,
                                explicit: t.explicit ?? false,
                                isrc: t.isrc,
                                stems: {
                                    create: t.stems?.map((s) => ({
                                        id: s.id,
                                        type: s.type,
                                        uri: s.uri,
                                        storageProvider: s.storageProvider || "local"
                                    }))
                                }
                            })),
                        },
                    },
                });
                console.log(`[Catalog] Created/Updated release ${event.releaseId} with ${event.metadata?.tracks?.length} tracks`);
            }
            catch (err) {
                console.error(`[Catalog] Failed to create/update release ${event.releaseId}:`, err);
            }
        });
        this.eventBus.subscribe("stems.processed", async (event) => {
            console.log(`[Catalog] Received stems.processed for release ${event.releaseId}`);
            this.clearCache();
            let release = await prisma_1.prisma.release.findUnique({ where: { id: event.releaseId } });
            let attempts = 0;
            const maxAttempts = 5;
            while (!release && attempts < maxAttempts) {
                attempts++;
                console.warn(`[Catalog] Release ${event.releaseId} not found yet (attempt ${attempts}/${maxAttempts}). Retrying in 1s...`);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                release = await prisma_1.prisma.release.findUnique({ where: { id: event.releaseId } });
            }
            if (!release) {
                console.error(`[Catalog] Release ${event.releaseId} still not found after ${maxAttempts} attempts. Dropping stems.`);
                return;
            }
            try {
                if (event.tracks?.length) {
                    for (const trackData of event.tracks) {
                        // Ensure track exists (it should from stems.uploaded)
                        await prisma_1.prisma.track.upsert({
                            where: { id: trackData.id },
                            create: {
                                id: trackData.id,
                                releaseId: event.releaseId,
                                title: trackData.title,
                                artist: trackData.artist,
                                position: trackData.position,
                                processingStatus: "complete", // Mark as complete when processed
                            },
                            update: {
                                title: trackData.title,
                                artist: trackData.artist,
                                position: trackData.position,
                                processingStatus: "complete", // Mark as complete when processed
                            },
                        });
                        // Emit track status change event
                        this.eventBus.publish({
                            eventName: "catalog.track_status",
                            eventVersion: 1,
                            occurredAt: new Date().toISOString(),
                            releaseId: event.releaseId,
                            trackId: trackData.id,
                            status: "complete",
                        });
                        for (const stem of trackData.stems) {
                            console.log(`[Catalog] Upserting stem ${stem.id} for track ${trackData.id}`);
                            await prisma_1.prisma.stem.upsert({
                                where: { id: stem.id },
                                create: {
                                    id: stem.id,
                                    trackId: trackData.id,
                                    type: stem.type,
                                    uri: stem.uri,
                                    data: stem.data, // Present in sync/test mode, undefined in production (fetched from storage URI)
                                    mimeType: stem.mimeType,
                                    durationSeconds: stem.durationSeconds,
                                    isEncrypted: stem.isEncrypted ?? false,
                                    encryptionMetadata: stem.encryptionMetadata,
                                    storageProvider: stem.storageProvider ?? "local",
                                },
                                update: {
                                    type: stem.type,
                                    uri: stem.uri,
                                    data: stem.data, // Present in sync/test mode, undefined in production
                                    mimeType: stem.mimeType,
                                    durationSeconds: stem.durationSeconds,
                                    isEncrypted: stem.isEncrypted ?? false,
                                    encryptionMetadata: stem.encryptionMetadata,
                                    storageProvider: stem.storageProvider ?? "local",
                                },
                            });
                        }
                    }
                }
                await prisma_1.prisma.release.update({
                    where: { id: event.releaseId },
                    data: { status: "ready" },
                });
                console.log(`[Catalog] Release ${event.releaseId} updated to ready`);
                this.eventBus.publish({
                    eventName: "catalog.release_ready",
                    eventVersion: 1,
                    occurredAt: new Date().toISOString(),
                    releaseId: event.releaseId,
                    artistId: event.artistId,
                    metadata: event.metadata,
                });
            }
            catch (err) {
                // Extract error message only - Prisma errors can have circular refs that cause stack overflow
                const errMsg = err instanceof Error ? err.message : String(err);
                console.error(`[Catalog] Failed to finalise release ${event.releaseId}: ${errMsg}`);
            }
        });
        // Note: stems.progress status updates are now handled by IngestionService.emitTrackStage()
        // which persists granular statuses (separating, encrypting, storing) directly
        this.eventBus.subscribe("ipnft.minted", async (event) => {
            this.clearCache();
            await prisma_1.prisma.stem
                .update({
                where: { id: event.stemId },
                data: { ipnftId: event.tokenId },
            })
                .catch(() => null);
        });
        this.eventBus.subscribe("stems.failed", async (event) => {
            console.log(`[Catalog] Received stems.failed for release ${event.releaseId}: ${event.error}`);
            this.clearCache();
            try {
                await prisma_1.prisma.release.update({
                    where: { id: event.releaseId },
                    data: { status: "failed" },
                });
                // Also update all non-complete tracks to failed
                const tracksToFail = await prisma_1.prisma.track.findMany({
                    where: {
                        releaseId: event.releaseId,
                        processingStatus: { in: ["pending", "separating", "encrypting", "storing"] }
                    },
                    select: { id: true }
                });
                await prisma_1.prisma.track.updateMany({
                    where: {
                        releaseId: event.releaseId,
                        processingStatus: { in: ["pending", "separating", "encrypting", "storing"] }
                    },
                    data: { processingStatus: "failed" }
                });
                // Emit status event for each failed track
                for (const track of tracksToFail) {
                    this.eventBus.publish({
                        eventName: "catalog.track_status",
                        eventVersion: 1,
                        occurredAt: new Date().toISOString(),
                        releaseId: event.releaseId,
                        trackId: track.id,
                        status: "failed",
                    });
                }
            }
            catch (err) {
                console.error(`[Catalog] Failed to update release status to failed for ${event.releaseId}:`, err);
            }
        });
    }
    async listPublished(limit = 20) {
        return prisma_1.prisma.release.findMany({
            where: { status: "ready" },
            select: {
                id: true,
                artistId: true,
                title: true,
                status: true,
                type: true,
                primaryArtist: true,
                featuredArtists: true,
                genre: true,
                label: true,
                releaseDate: true,
                explicit: true,
                createdAt: true,
                artworkMimeType: true, // Useful for frontend to know, but DATA must be excluded
                artist: {
                    select: { id: true, displayName: true, userId: true, payoutAddress: true }
                },
                tracks: {
                    orderBy: { position: "asc" },
                    select: {
                        id: true,
                        title: true,
                        artist: true,
                        position: true,
                        explicit: true,
                        isrc: true,
                        createdAt: true,
                        processingStatus: true,
                        stems: {
                            select: {
                                id: true,
                                type: true,
                                uri: true,
                                ipnftId: true,
                                checksum: true,
                                durationSeconds: true,
                                isEncrypted: true,
                                encryptionMetadata: true,
                                // Exclude data and mimeType (huge blobs)
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
    }
    async createRelease(input) {
        const artist = await prisma_1.prisma.artist.findUnique({
            where: { userId: input.userId },
        });
        if (!artist) {
            throw new common_1.BadRequestException("User is not a registered artist");
        }
        this.clearCache();
        return prisma_1.prisma.release.create({
            data: {
                artistId: artist.id,
                title: input.title,
                status: "draft",
                type: input.type ?? "single",
                primaryArtist: input.primaryArtist,
                featuredArtists: input.featuredArtists?.join(", "),
                genre: input.genre,
                label: input.label,
                releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined,
                explicit: input.explicit ?? false,
                tracks: {
                    create: input.tracks?.map(t => ({
                        title: t.title,
                        position: t.position,
                        explicit: t.explicit ?? false,
                    }))
                }
            },
            // Return lightweight object
            select: {
                id: true,
                title: true,
                status: true,
                tracks: {
                    select: { id: true, title: true, position: true }
                }
            }
        });
    }
    async getTrack(trackId) {
        return prisma_1.prisma.track.findUnique({
            where: { id: trackId },
            select: {
                id: true,
                releaseId: true,
                title: true,
                position: true,
                explicit: true,
                isrc: true,
                createdAt: true,
                stems: {
                    select: {
                        id: true,
                        type: true,
                        uri: true,
                        ipnftId: true,
                        durationSeconds: true,
                        isEncrypted: true,
                        encryptionMetadata: true,
                        // Exclude data
                    }
                },
                release: {
                    select: {
                        id: true,
                        title: true,
                        primaryArtist: true,
                        artworkMimeType: true,
                        artist: { select: { id: true, displayName: true, userId: true } }
                    }
                }
            }
        });
    }
    async getRelease(releaseId) {
        return prisma_1.prisma.release.findUnique({
            where: { id: releaseId },
            select: {
                id: true,
                artistId: true,
                title: true,
                status: true,
                type: true,
                primaryArtist: true,
                featuredArtists: true,
                genre: true,
                label: true,
                releaseDate: true,
                explicit: true,
                createdAt: true,
                artworkMimeType: true,
                artist: {
                    select: { id: true, displayName: true, userId: true }
                },
                tracks: {
                    orderBy: { position: "asc" },
                    select: {
                        id: true,
                        title: true,
                        artist: true,
                        position: true,
                        explicit: true,
                        isrc: true,
                        createdAt: true,
                        processingStatus: true,
                        stems: {
                            select: {
                                id: true,
                                type: true,
                                uri: true,
                                ipnftId: true,
                                durationSeconds: true,
                                isEncrypted: true,
                                encryptionMetadata: true,
                                storageProvider: true,
                                // Exclude data
                            }
                        }
                    }
                }
            }
        });
    }
    async listByArtist(artistId) {
        return prisma_1.prisma.release.findMany({
            where: { artistId },
            select: {
                id: true,
                artistId: true,
                artist: {
                    select: { id: true, displayName: true, userId: true }
                },
                title: true,
                status: true,
                type: true,
                primaryArtist: true,
                featuredArtists: true,
                genre: true,
                label: true,
                releaseDate: true,
                explicit: true,
                createdAt: true,
                artworkMimeType: true,
                tracks: {
                    orderBy: { position: "asc" },
                    select: {
                        id: true,
                        title: true,
                        position: true,
                        explicit: true,
                        processingStatus: true,
                        stems: {
                            select: {
                                id: true,
                                type: true,
                                uri: true,
                                durationSeconds: true,
                                isEncrypted: true,
                                encryptionMetadata: true,
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: "desc" },
        });
    }
    async listByUserId(userId) {
        const artist = await prisma_1.prisma.artist.findUnique({
            where: { userId },
        });
        if (!artist)
            return [];
        return this.listByArtist(artist.id);
    }
    async updateRelease(releaseId, input) {
        this.clearCache();
        return prisma_1.prisma.release.update({
            where: { id: releaseId },
            data: input,
            include: { tracks: true },
        });
    }
    async deleteRelease(releaseId, userId) {
        // 1. Verify release exists and ownership
        const release = await prisma_1.prisma.release.findUnique({
            where: { id: releaseId },
            include: {
                artist: true,
                tracks: {
                    include: { stems: { select: { id: true } } }
                }
            }
        });
        if (!release) {
            throw new common_1.NotFoundException("Release not found");
        }
        if (release.artist?.userId !== userId) {
            throw new common_1.BadRequestException("Not authorized to delete this release");
        }
        // 2. Cascade delete: stems → tracks → release (no cascade in schema)
        const stemIds = release.tracks.flatMap(t => t.stems.map(s => s.id));
        const trackIds = release.tracks.map(t => t.id);
        if (stemIds.length > 0) {
            // Delete any listings/mints associated with stems first
            await prisma_1.prisma.stemListing.deleteMany({ where: { stemId: { in: stemIds } } });
            await prisma_1.prisma.stemNftMint.deleteMany({ where: { stemId: { in: stemIds } } });
            await prisma_1.prisma.stem.deleteMany({ where: { id: { in: stemIds } } });
        }
        if (trackIds.length > 0) {
            // Delete any licenses associated with tracks
            await prisma_1.prisma.license.deleteMany({ where: { trackId: { in: trackIds } } });
            await prisma_1.prisma.track.deleteMany({ where: { id: { in: trackIds } } });
        }
        await prisma_1.prisma.release.delete({ where: { id: releaseId } });
        this.clearCache();
        console.log(`[Catalog] Deleted release ${releaseId} with ${trackIds.length} tracks and ${stemIds.length} stems`);
        return { success: true };
    }
    async updateReleaseArtwork(releaseId, userId, artwork) {
        const release = await prisma_1.prisma.release.findUnique({
            where: { id: releaseId },
            include: { artist: true }
        });
        if (!release)
            throw new common_1.BadRequestException("Release not found");
        if (release.artist?.userId !== userId) {
            throw new common_1.BadRequestException("Not authorized to update this release");
        }
        const updated = await prisma_1.prisma.release.update({
            where: { id: releaseId },
            data: {
                artworkData: artwork.buffer,
                artworkMimeType: artwork.mimetype
            },
            select: { id: true, artworkMimeType: true }
        });
        this.clearCache();
        return {
            success: true,
            id: updated.id,
            artworkUrl: `/catalog/releases/${releaseId}/artwork?t=${Date.now()}`
        };
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
        // Search releases by title OR tracks by title
        const items = await prisma_1.prisma.release.findMany({
            where: {
                OR: [
                    { title: { contains: query, mode: "insensitive" } },
                    { primaryArtist: { contains: query, mode: "insensitive" } },
                    { featuredArtists: { contains: query, mode: "insensitive" } },
                    { tracks: { some: { title: { contains: query, mode: "insensitive" } } } },
                    { tracks: { some: { artist: { contains: query, mode: "insensitive" } } } }
                ],
                status: "ready"
            },
            select: {
                id: true,
                artistId: true,
                title: true,
                status: true,
                type: true,
                primaryArtist: true,
                featuredArtists: true,
                genre: true,
                label: true,
                releaseDate: true,
                explicit: true,
                createdAt: true,
                artworkMimeType: true,
                artist: {
                    select: { id: true, displayName: true }
                },
                tracks: {
                    orderBy: { position: "asc" },
                    select: {
                        id: true,
                        title: true,
                        position: true,
                        explicit: true,
                        stems: {
                            select: {
                                id: true,
                                type: true,
                                uri: true,
                                durationSeconds: true,
                                isEncrypted: true,
                                encryptionMetadata: true,
                            }
                        }
                    }
                }
            },
            take: cappedLimit,
        });
        this.searchCache.set(cacheKey, { items, cachedAt: Date.now() });
        return { items };
    }
    async getReleaseArtwork(releaseId) {
        const release = await prisma_1.prisma.release.findUnique({
            where: { id: releaseId },
            select: { artworkData: true, artworkMimeType: true },
        });
        if (!release || !release.artworkData)
            return null;
        return { data: release.artworkData, mimeType: release.artworkMimeType || "image/jpeg" };
    }
    async getStemBlob(stemId) {
        // Try finding by exact ID first
        let stem = await prisma_1.prisma.stem.findUnique({
            where: { id: stemId },
            select: { id: true, data: true, mimeType: true, uri: true, storageProvider: true },
        });
        // Fallback: if stemId looks like a filename (e.g. from a mockup URI), try searching by URI
        if (!stem) {
            stem = await prisma_1.prisma.stem.findFirst({
                where: { uri: { contains: stemId } },
                select: { id: true, data: true, mimeType: true, uri: true, storageProvider: true },
            });
        }
        if (!stem)
            return null;
        // 1. Data is stored in DB
        if (stem.data) {
            return { data: stem.data, mimeType: stem.mimeType || "audio/mpeg" };
        }
        // 2. Local storage provider - try to read from disk
        if (stem.storageProvider === "local") {
            try {
                const { join } = await Promise.resolve().then(() => __importStar(require("path")));
                const { existsSync, readFileSync } = await Promise.resolve().then(() => __importStar(require("fs")));
                // Extract filename from URI or ID
                const filename = stem.uri.split("/").slice(-2, -1)[0] || stem.id;
                const uploadDir = join(process.cwd(), "uploads", "stems");
                const absolutePath = join(uploadDir, filename);
                if (existsSync(absolutePath)) {
                    console.log(`[Catalog] Serving stem ${stem.id} from disk: ${absolutePath}`);
                    return {
                        data: readFileSync(absolutePath),
                        mimeType: stem.mimeType || "audio/mpeg"
                    };
                }
            }
            catch (err) {
                console.error(`[Catalog] Failed to read stem ${stem.id} from disk:`, err);
            }
        }
        // 3. Remote storage (IPFS/Lighthouse) - fetch from URI
        if (stem.uri && (stem.storageProvider === "ipfs" || stem.uri.includes("ipfs") || stem.uri.includes("lighthouse"))) {
            try {
                console.log(`[Catalog] Fetching stem ${stem.id} from remote URI: ${stem.uri}`);
                const fetchedData = await this.storageProvider.download(stem.uri);
                if (fetchedData) {
                    return { data: fetchedData, mimeType: stem.mimeType || "audio/mpeg" };
                }
            }
            catch (err) {
                console.error(`[Catalog] Failed to fetch stem ${stem.id} from remote:`, err);
            }
        }
        // 4. Generic HTTP URI fallback
        if (stem.uri && stem.uri.startsWith("http")) {
            try {
                console.log(`[Catalog] Fetching stem ${stem.id} from HTTP URI: ${stem.uri}`);
                const response = await fetch(stem.uri, {
                    signal: AbortSignal.timeout(120000), // 2 minutes for large files
                });
                if (response.ok) {
                    const buffer = Buffer.from(await response.arrayBuffer());
                    return { data: buffer, mimeType: stem.mimeType || "audio/mpeg" };
                }
            }
            catch (err) {
                console.error(`[Catalog] Failed to fetch stem ${stem.id} from HTTP:`, err);
            }
        }
        return null;
    }
    async getStemPreview(stemId) {
        const stem = await prisma_1.prisma.stem.findUnique({
            where: { id: stemId },
            select: { uri: true, encryptionMetadata: true, data: true, mimeType: true },
        });
        if (!stem)
            throw new common_1.NotFoundException("Stem not found");
        if (!stem.uri && !stem.data)
            throw new common_1.BadRequestException("Stem has no source URI or data");
        // Handle encrypted content from IPFS/Lighthouse
        // We prioritize this over stem.data because stem.data might contain the encrypted blob
        if (stem.encryptionMetadata) {
            // For preview, we use a public/mock authSig or bypass check if backend is allowed
            const authSig = {
                address: "0x0000000000000000000000000000000000000000",
                sig: "preview-authorized",
                signedMessage: "Marketplace preview authorization",
            };
            const decryptedBuffer = await this.encryptionService.decrypt(stem.uri, stem.encryptionMetadata, [], // No specific access conditions for public preview if we want to bypass Lit checks on backend
            authSig);
            return { data: decryptedBuffer, mimeType: stem.mimeType || "audio/mpeg" };
        }
        // Unencrypted external content
        const response = await fetch(stem.uri);
        if (!response.ok)
            throw new Error(`Failed to fetch stem content: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        return { data: buffer, mimeType: stem.mimeType || "audio/mpeg" };
    }
    clearCache() {
        this.searchCache.clear();
    }
};
exports.CatalogService = CatalogService;
exports.CatalogService = CatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus,
        encryption_service_1.EncryptionService,
        storage_provider_1.StorageProvider])
], CatalogService);
