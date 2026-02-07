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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionService = void 0;
const common_1 = require("@nestjs/common");
const path_1 = require("path");
const fs_1 = require("fs");
const bullmq_1 = require("bullmq");
const bullmq_2 = require("@nestjs/bullmq");
const event_bus_1 = require("../shared/event_bus");
const storage_provider_1 = require("../storage/storage_provider");
const encryption_service_1 = require("../encryption/encryption.service");
const artist_service_1 = require("../artist/artist.service");
let IngestionService = class IngestionService {
    eventBus;
    storageProvider;
    encryptionService;
    artistService;
    stemsQueue;
    uploads = new Map();
    CONCURRENCY = 1;
    constructor(eventBus, storageProvider, encryptionService, artistService, stemsQueue) {
        this.eventBus = eventBus;
        this.storageProvider = storageProvider;
        this.encryptionService = encryptionService;
        this.artistService = artistService;
        this.stemsQueue = stemsQueue;
    }
    async handleFileUpload(input) {
        const mm = await Promise.resolve().then(() => __importStar(require("music-metadata")));
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
        let extractedReleaseLabel;
        let extractedReleaseDate;
        for (const [index, file] of input.files.entries()) {
            const trackId = this.generateId("trk");
            const stemId = this.generateId("stem");
            const trackMeta = input.metadata?.tracks?.[index];
            // Extraction metadata from buffer
            let durationSeconds;
            let extractedTitle;
            let extractedArtist;
            try {
                const metadata = await mm.parseBuffer(file.buffer, { mimeType: file.mimetype });
                durationSeconds = metadata.format.duration;
                extractedTitle = metadata.common.title;
                extractedArtist = metadata.common.artist;
                // Try to get release-level info from first track if not provided
                if (index === 0) {
                    extractedReleaseLabel = metadata.common.label?.[0];
                    extractedReleaseDate = metadata.common.date ? new Date(metadata.common.date).toISOString() : undefined;
                }
            }
            catch (err) {
                console.warn(`[Ingestion] Failed to parse metadata for ${file.originalname}:`, err);
            }
            // Intelligent filename parsing fallback
            if (!extractedTitle) {
                const fileName = file.originalname.split('.')[0];
                extractedTitle = fileName;
                if (fileName.includes(" - ")) {
                    const parts = fileName.split(" - ");
                    extractedArtist = parts[0].trim();
                    extractedTitle = parts[1].trim();
                }
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
                        durationSeconds: durationSeconds,
                    }]
            });
        }
        // Merge metadata
        const finalMetadata = {
            ...input.metadata,
            label: input.metadata?.label || extractedReleaseLabel,
            releaseDate: input.metadata?.releaseDate || extractedReleaseDate,
            tracks: tracks.map((t) => ({
                ...t,
                stems: t.stems.map((s) => ({ ...s, data: undefined })) // Don't log buffers
            }))
        };
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
            metadata: finalMetadata,
        });
        console.log(`[Ingestion] Emitted stems.uploaded for ${releaseId}. Buffers nuked in metadata for logging safety.`);
        // 2. Process stems (Real implementation) via BullMQ
        await this.stemsQueue.add("process-stems", { releaseId, artistId: input.artistId, tracks });
        return { releaseId, status: "processing" };
    }
    handleProgress(releaseId, trackId, progress) {
        this.eventBus.publish({
            eventName: "stems.progress",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId,
            trackId,
            progress,
        });
        console.log(`[Ingestion] Progress for ${trackId}: ${progress}%`);
    }
    async processStemsJob(input) {
        console.log(`[Ingestion] Starting real stem processing for release ${input.releaseId}`);
        // Fetch artist profile to get the wallet address for encryption
        const artistProfile = await this.artistService.findById(input.artistId);
        const encryptionAddress = artistProfile?.payoutAddress || input.artistId; // Fallback to ID if address not found (though unlikely for valid artists)
        const processedTracks = [];
        const MAX_RETRIES = 3;
        // Process tracks one by one for worker stability
        for (const track of input.tracks) {
            // Yield event loop to allow heartbeats (important for large files)
            await new Promise(resolve => setImmediate(resolve));
            let attempt = 0;
            let lastError = null;
            while (attempt < MAX_RETRIES) {
                try {
                    const originalStem = track.stems[0];
                    if (!originalStem || !originalStem.data)
                        break;
                    // Crucial: BullMQ (JSON) converts Buffers to {type: 'Buffer', data: []}
                    // We must convert it back to a real Buffer or Prisma will blow the stack
                    if (!(originalStem.data instanceof Buffer)) {
                        originalStem.data = Buffer.from(originalStem.data);
                    }
                    const formData = new FormData();
                    const buffer = originalStem.data;
                    const blob = new Blob([buffer], { type: originalStem.mimeType });
                    formData.append("file", blob, `track_${track.id}.wav`);
                    console.log(`[Ingestion] Sending track ${track.id} to Demucs worker...`);
                    const response = await fetch(`http://localhost:8000/separate/${input.releaseId}/${track.id}`, {
                        method: "POST",
                        body: formData,
                        // @ts-ignore
                        signal: AbortSignal.timeout(600000), // 10 minutes
                    });
                    if (!response.ok) {
                        throw new Error(`Demucs worker returned ${response.status}`);
                    }
                    const result = await response.json();
                    const stems = [];
                    // 1. Process and upload the Original Stem first
                    const originalStorage = await this.storageProvider.upload(originalStem.data, `original_${track.id}.mp3`, originalStem.mimeType);
                    stems.push({
                        ...originalStem,
                        uri: originalStorage.uri,
                        storageProvider: originalStorage.provider,
                        isEncrypted: false, // Original is usually public for discovery
                    });
                    // 2. Process, Encrypt, and Upload the AI-generated Stems
                    for (const [type, relativePath] of Object.entries(result.stems)) {
                        const absolutePath = (0, path_1.join)(process.cwd(), "uploads", "stems", relativePath);
                        if ((0, fs_1.existsSync)(absolutePath)) {
                            let data = (0, fs_1.readFileSync)(absolutePath);
                            const stemId = this.generateId("stem");
                            let isEncrypted = false;
                            let encryptionMetadata = null;
                            // Encrypt stems - skipped if ENCRYPTION_ENABLED=false or provider returns null
                            try {
                                const encryptionContext = {
                                    contentId: stemId,
                                    ownerAddress: encryptionAddress,
                                    allowedAddresses: [], // Future: Add NFT holders, collaborators, etc.
                                };
                                const encrypted = await this.encryptionService.encrypt(data, encryptionContext);
                                if (encrypted) {
                                    data = Buffer.from(encrypted.encryptedData);
                                    encryptionMetadata = encrypted.metadata;
                                    isEncrypted = true;
                                    console.log(`[Ingestion] Encrypted stem ${stemId} with provider: ${encrypted.provider}`);
                                }
                                // If encrypted is null, encryption is disabled - data stays plaintext
                            }
                            catch (encErr) {
                                console.warn(`[Ingestion] Encryption failed for ${type}, falling back to plaintext:`, encErr);
                            }
                            const storage = await this.storageProvider.upload(data, `${stemId}.mp3`, "audio/mpeg");
                            stems.push({
                                id: stemId,
                                uri: storage.uri,
                                type: type,
                                data: data,
                                mimeType: "audio/mpeg",
                                durationSeconds: originalStem.durationSeconds,
                                isEncrypted,
                                encryptionMetadata,
                                storageProvider: storage.provider,
                            });
                        }
                    }
                    processedTracks.push({
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        position: track.position,
                        stems: stems,
                    });
                    break; // Success
                }
                catch (err) {
                    attempt++;
                    lastError = err;
                    if (attempt < MAX_RETRIES) {
                        await new Promise(r => setTimeout(r, 2000 * attempt));
                    }
                }
            }
        }
        if (processedTracks.length > 0) {
            // Final yield before publishing large event
            await new Promise(resolve => setImmediate(resolve));
            this.eventBus.publish({
                eventName: "stems.processed",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                releaseId: input.releaseId,
                artistId: input.artistId,
                modelVersion: "demucs-htdemucs-6s",
                tracks: processedTracks,
            });
        }
        else {
            throw new Error(`Failed to process any tracks for release ${input.releaseId}`);
        }
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
            releaseId: trackId,
            artistId: input.artistId,
            checksum: "pending",
            metadata: {
                ...input.metadata,
                tracks: [{
                        title: input.metadata?.releaseTitle || "Unknown Track",
                        artist: input.metadata?.primaryArtist,
                        position: 1,
                        stems: input.fileUris.map(uri => ({
                            id: this.generateId("stem"),
                            uri,
                            type: "ORIGINAL",
                            durationSeconds: 241
                        }))
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
        if (!record)
            return;
        await new Promise((resolve) => setTimeout(resolve, 500));
        record.status = "processing";
        const stems = record.fileUris.map((uri) => ({
            id: this.generateId("stem"),
            uri: uri.startsWith("http") ? uri : "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
            type: this.inferStemType(uri),
            durationSeconds: 241,
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
        if (normalized.includes("drum"))
            return "drums";
        if (normalized.includes("vocal"))
            return "vocals";
        if (normalized.includes("bass"))
            return "bass";
        if (normalized.includes("piano"))
            return "piano";
        if (normalized.includes("guitar"))
            return "guitar";
        return "ORIGINAL";
    }
};
exports.IngestionService = IngestionService;
exports.IngestionService = IngestionService = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, bullmq_2.InjectQueue)("stems")),
    __metadata("design:paramtypes", [event_bus_1.EventBus,
        storage_provider_1.StorageProvider,
        encryption_service_1.EncryptionService,
        artist_service_1.ArtistService,
        bullmq_1.Queue])
], IngestionService);
