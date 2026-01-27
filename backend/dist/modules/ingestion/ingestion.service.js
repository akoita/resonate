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
exports.IngestionService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
let IngestionService = class IngestionService {
    eventBus;
    uploads = new Map();
    constructor(eventBus) {
        this.eventBus = eventBus;
    }
    async handleFileUpload(input) {
        const releaseId = this.generateId("rel");
        // Prepare artwork
        let artworkUrl;
        let artworkData;
        let artworkMimeType;
        if (input.artwork) {
            artworkData = input.artwork.buffer;
            artworkMimeType = input.artwork.mimetype;
            artworkUrl = `http://localhost:3000/catalog/releases/${releaseId}/artwork`;
        }
        const tracks = [];
        input.files.forEach((file, index) => {
            const trackId = this.generateId("trk");
            const stemId = this.generateId("stem");
            const trackMeta = input.metadata?.tracks?.[index];
            // Intelligent filename parsing
            const fileName = file.originalname.split('.')[0];
            let extractedTitle = fileName;
            let extractedArtist = undefined;
            if (fileName.includes(" - ")) {
                const parts = fileName.split(" - ");
                extractedArtist = parts[0].trim();
                extractedTitle = parts[1].trim();
            }
            const publicUri = `http://localhost:3000/catalog/stems/${stemId}/blob`;
            tracks.push({
                id: trackId,
                title: trackMeta?.title || extractedTitle,
                artist: trackMeta?.artist || extractedArtist,
                position: index + 1,
                stems: [{
                        id: stemId,
                        uri: publicUri,
                        type: this.inferStemType(file.originalname),
                        data: file.buffer,
                        mimeType: file.mimetype,
                    }]
            });
        });
        // 1. Emit Uploaded
        this.eventBus.publish({
            eventName: "stems.uploaded",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId,
            artistId: input.artistId,
            checksum: "completed",
            artworkData,
            artworkMimeType,
            metadata: {
                ...input.metadata,
                tracks: tracks.map((t) => ({
                    ...t,
                    stems: t.stems.map((s) => ({ ...s, data: undefined })) // Don't log buffers
                }))
            },
        });
        // 2. Emit Processed
        setTimeout(() => {
            this.eventBus.publish({
                eventName: "stems.processed",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                releaseId,
                artistId: input.artistId,
                modelVersion: "resonate-v1",
                metadata: {
                    ...input.metadata,
                    tracks: tracks.map((t) => ({
                        ...t,
                        stems: t.stems.map((s) => ({ ...s, data: undefined }))
                    }))
                },
                tracks: tracks.map((t) => ({
                    ...t,
                    stems: t.stems.map((s) => ({
                        ...s,
                        // Only send necessary fields for processing
                    }))
                })),
            });
        }, 1000);
        return { releaseId, status: "processing" };
    }
    enqueueUpload(input) {
        const trackId = this.generateId("trk");
        const record = {
            trackId,
            artistId: input.artistId,
            fileUris: input.fileUris,
            status: "queued",
            metadata: input.metadata,
        };
        this.uploads.set(trackId, record);
        this.eventBus.publish({
            eventName: "stems.uploaded",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId: trackId, // Using trackId as releaseId for mock simplicity
            artistId: input.artistId,
            checksum: "pending",
            metadata: {
                ...input.metadata,
                tracks: [{
                        title: input.metadata?.releaseTitle || "Unknown Track",
                        artist: input.metadata?.primaryArtist,
                        position: 1,
                        stems: input.fileUris.map(uri => ({ id: this.generateId("stem"), uri, type: "ORIGINAL" }))
                    }]
            },
        });
        void this.processUpload(trackId);
        return { trackId, status: record.status };
    }
    getStatus(trackId) {
        const record = this.uploads.get(trackId);
        if (!record) {
            return { trackId, status: "failed", error: "Not found" };
        }
        return { trackId, status: record.status, stems: record.stems ?? [] };
    }
    async processUpload(trackId) {
        const record = this.uploads.get(trackId);
        if (!record) {
            return;
        }
        // Mock processing delay to avoid event race conditions
        await new Promise((resolve) => setTimeout(resolve, 500));
        record.status = "processing";
        // Use the user's provided URI if it looks like a playable URL, otherwise fallback to sample
        const sampleUri = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
        const stems = record.fileUris.map((uri, index) => ({
            id: this.generateId("stem"),
            uri: (uri.startsWith("http") || uri.startsWith("blob:")) ? uri : sampleUri,
            type: this.inferStemType(uri),
        }));
        record.stems = stems;
        this.eventBus.publish({
            eventName: "stems.processed",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId: record.trackId,
            artistId: record.artistId,
            modelVersion: "mock-v1",
            tracks: [{
                    id: record.trackId,
                    title: record.metadata?.releaseTitle || "Unknown Track",
                    artist: record.metadata?.primaryArtist,
                    position: 1,
                    stems: stems.map(s => ({ ...s, mimeType: "audio/mpeg" }))
                }]
        });
        record.status = "complete";
    }
    generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }
    inferStemType(uri) {
        const normalized = uri.toLowerCase();
        if (normalized.includes("drum")) {
            return "drums";
        }
        if (normalized.includes("vocal")) {
            return "vocals";
        }
        if (normalized.includes("bass")) {
            return "bass";
        }
        return "ORIGINAL";
    }
};
exports.IngestionService = IngestionService;
exports.IngestionService = IngestionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus])
], IngestionService);
