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
const undici_1 = require("undici");
const event_bus_1 = require("../shared/event_bus");
const storage_provider_1 = require("../storage/storage_provider");
const encryption_service_1 = require("../encryption/encryption.service");
const artist_service_1 = require("../artist/artist.service");
const catalog_service_1 = require("../catalog/catalog.service");
const prisma_1 = require("../../db/prisma");
let IngestionService = class IngestionService {
    eventBus;
    storageProvider;
    encryptionService;
    artistService;
    catalogService;
    stemsQueue;
    uploads = new Map();
    CONCURRENCY = 1;
    useSyncProcessing;
    constructor(eventBus, storageProvider, encryptionService, artistService, catalogService, stemsQueue) {
        this.eventBus = eventBus;
        this.storageProvider = storageProvider;
        this.encryptionService = encryptionService;
        this.artistService = artistService;
        this.catalogService = catalogService;
        this.stemsQueue = stemsQueue;
        // In test mode, process synchronously instead of through BullMQ queue
        this.useSyncProcessing = process.env.NODE_ENV === "test" || process.env.USE_SYNC_PROCESSING === "true";
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
            // Upload original stem to storage provider immediately
            let storageResult;
            try {
                storageResult = await this.storageProvider.upload(file.buffer, `original_${stemId}.${file.originalname.split('.').pop() || 'mp3'}`, file.mimetype);
            }
            catch (err) {
                console.error(`[Ingestion] Failed to upload original stem ${stemId} to storage:`, err);
            }
            const publicUri = storageResult?.uri || `http://localhost:3000/catalog/stems/${stemId}/blob`;
            tracks.push({
                id: trackId,
                title: trackMeta?.title || extractedTitle,
                artist: trackMeta?.artist || extractedArtist,
                position: index + 1,
                stems: [{
                        id: stemId,
                        uri: publicUri,
                        storageProvider: storageResult?.provider || 'local',
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
                stems: t.stems.map((s) => ({
                    ...s,
                    data: undefined, // Don't log buffers
                    buffer: undefined, // Type compatibility
                }))
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
        // 2. Process stems
        if (this.useSyncProcessing) {
            // In test mode, emit mock stems.processed immediately (skip actual Demucs processing)
            console.log(`[Ingestion] Test mode: emitting mock stems.processed for ${releaseId}`);
            const mockProcessedTracks = tracks.map((track) => ({
                id: track.id,
                title: track.title,
                artist: track.artist,
                position: track.position,
                stems: track.stems.map((stem) => ({
                    ...stem,
                    data: stem.data, // Keep the original data for tests
                    uri: `mock://stems/${stem.id}`,
                    storageProvider: "local",
                    isEncrypted: false,
                })),
            }));
            this.eventBus.publish({
                eventName: "stems.processed",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                releaseId,
                artistId: input.artistId,
                modelVersion: "test-mock-v1",
                tracks: mockProcessedTracks,
            });
            return { releaseId, status: "processing" };
        }
        // Production: queue for async processing via BullMQ
        // CRITICAL: Strip Buffer data from job payload to avoid JSON serialization failures
        // (BullMQ can't serialize payloads > ~512MB, and albums with many tracks blow this limit)
        // The processor will fetch audio data from the storage URIs instead.
        const serializableTracks = tracks.map((track) => ({
            ...track,
            stems: track.stems.map((stem) => ({
                ...stem,
                data: undefined, // Remove Buffer - it's already uploaded to storage
            })),
        }));
        await this.stemsQueue.add("process-stems", { releaseId, artistId: input.artistId, tracks: serializableTracks });
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
            // Emit 'separating' stage when starting to process this track
            await this.emitTrackStage(input.releaseId, track.id, 'separating');
            while (attempt < MAX_RETRIES) {
                try {
                    const originalStem = track.stems[0];
                    if (!originalStem)
                        break;
                    // Get audio data - either from job payload or fetch from storage URI
                    let audioBuffer;
                    if (originalStem.data) {
                        // Crucial: BullMQ (JSON) converts Buffers to {type: 'Buffer', data: []}
                        // We must convert it back to a real Buffer or Prisma will blow the stack
                        if (!(originalStem.data instanceof Buffer)) {
                            audioBuffer = Buffer.from(originalStem.data);
                        }
                        else {
                            audioBuffer = originalStem.data;
                        }
                    }
                    else if (originalStem.uri) {
                        // Data stripped from job payload - fetch from storage URI
                        console.log(`[Ingestion] Fetching audio from storage for track ${track.id}: ${originalStem.uri}`);
                        const fetchedData = await this.storageProvider.download(originalStem.uri);
                        if (!fetchedData) {
                            throw new Error(`Failed to fetch audio from storage: ${originalStem.uri}`);
                        }
                        audioBuffer = fetchedData;
                    }
                    else {
                        console.warn(`[Ingestion] Track ${track.id} has no data or URI, skipping`);
                        break;
                    }
                    const formData = new FormData();
                    // Convert Buffer to Uint8Array for Blob compatibility (TS strictness)
                    const blob = new Blob([new Uint8Array(audioBuffer)], { type: originalStem.mimeType });
                    formData.append("file", blob, `track_${track.id}.wav`);
                    // Configurable worker URL — no longer hardcoded to localhost
                    const workerUrl = process.env.DEMUCS_WORKER_URL || 'http://localhost:8000';
                    // Pass callback URL so worker can report progress without hardcoded backend address
                    const backendUrl = process.env.BACKEND_URL || 'http://host.docker.internal:3000';
                    const callbackParam = `?callback_url=${encodeURIComponent(backendUrl)}`;
                    console.log(`[Ingestion] Sending track ${track.id} to Demucs worker at ${workerUrl}...`);
                    // Use custom undici Agent to override the default headersTimeout (300s).
                    // Without this, long-running Demucs separations hit UND_ERR_HEADERS_TIMEOUT
                    // before the 10-minute AbortSignal fires.
                    const demucsAgent = new undici_1.Agent({
                        headersTimeout: 600_000, // 10 minutes — matches AbortSignal
                        bodyTimeout: 0, // unlimited — response body can be large
                    });
                    const response = await fetch(`${workerUrl}/separate/${input.releaseId}/${track.id}${callbackParam}`, {
                        method: "POST",
                        body: formData,
                        signal: AbortSignal.timeout(600_000), // 10 minutes
                        // @ts-ignore — Node fetch accepts dispatcher but TS doesn't know about it
                        dispatcher: demucsAgent,
                    });
                    if (!response.ok) {
                        throw new Error(`Demucs worker returned ${response.status}`);
                    }
                    const result = await response.json();
                    const stems = [];
                    // 1. Process and upload the Original Stem first
                    // If already uploaded (production), reuse URI. Otherwise (mock) it might be different.
                    let finalOriginalUri = originalStem.uri;
                    let finalOriginalProvider = originalStem.storageProvider || 'local';
                    if (originalStem.data && (!originalStem.uri || originalStem.uri.includes('localhost:3000'))) {
                        // Re-upload only if we have the buffer (sync/test mode) AND the URI is a local placeholder
                        const originalStorage = await this.storageProvider.upload(originalStem.data, `original_${track.id}.mp3`, originalStem.mimeType);
                        finalOriginalUri = originalStorage.uri;
                        finalOriginalProvider = originalStorage.provider;
                    }
                    // Otherwise, keep the existing URI — the original was already uploaded during handleFileUpload
                    stems.push({
                        ...originalStem,
                        uri: finalOriginalUri,
                        storageProvider: finalOriginalProvider,
                        isEncrypted: false, // Original is usually public for discovery
                    });
                    // Emit 'encrypting' stage before processing AI-generated stems
                    await this.emitTrackStage(input.releaseId, track.id, 'encrypting');
                    // 2. Process, Encrypt, and Upload the AI-generated Stems
                    for (const [type, stemUri] of Object.entries(result.stems)) {
                        // Download stem data — supports both HTTPS URLs (GCS mode) and local paths
                        let data = null;
                        const stemUriStr = stemUri;
                        if (stemUriStr.startsWith('http://') || stemUriStr.startsWith('https://')) {
                            // GCS/remote mode: download from URL
                            console.log(`[Ingestion] Downloading stem from URL: ${stemUriStr}`);
                            try {
                                const stemResponse = await fetch(stemUriStr, { signal: AbortSignal.timeout(120_000) });
                                if (stemResponse.ok) {
                                    const arrayBuffer = await stemResponse.arrayBuffer();
                                    data = Buffer.from(new Uint8Array(arrayBuffer));
                                }
                                else {
                                    console.error(`[Ingestion] Failed to download stem: HTTP ${stemResponse.status}`);
                                }
                            }
                            catch (dlErr) {
                                console.error(`[Ingestion] Failed to download stem from ${stemUriStr}:`, dlErr);
                            }
                        }
                        else {
                            // Local mode: read from shared volume (backward compatible)
                            const absolutePath = (0, path_1.join)(process.cwd(), "uploads", "stems", stemUriStr);
                            if ((0, fs_1.existsSync)(absolutePath)) {
                                data = (0, fs_1.readFileSync)(absolutePath);
                            }
                        }
                        if (data) {
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
                                // NOTE: Removed 'data' buffer from event - already uploaded to storage at 'uri'
                                // Passing Buffer in events causes Prisma formatting stack overflow on large files
                                mimeType: "audio/mpeg",
                                durationSeconds: originalStem.durationSeconds,
                                isEncrypted,
                                encryptionMetadata,
                                storageProvider: storage.provider,
                            });
                        }
                        else {
                            console.warn(`[Ingestion] Could not load stem data for ${type} (${stemUriStr}), skipping`);
                        }
                    }
                    processedTracks.push({
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        position: track.position,
                        stems: stems,
                    });
                    // Emit 'complete' stage for this track
                    await this.emitTrackStage(input.releaseId, track.id, 'complete');
                    break; // Success
                }
                catch (err) {
                    console.error(`[Ingestion] Attempt ${attempt + 1}/${MAX_RETRIES} failed for track ${track.id}:`, err);
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
            const errorMsg = `Failed to process any tracks for release ${input.releaseId}`;
            console.error(`[Ingestion] ${errorMsg}`);
            this.eventBus.publish({
                eventName: "stems.failed",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                releaseId: input.releaseId,
                artistId: input.artistId,
                error: errorMsg,
            });
            throw new Error(errorMsg);
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
    async emitTrackStage(releaseId, trackId, stage) {
        // Persist the status to database so it's available on page load
        // Retry logic to handle race condition where Track record may not exist yet
        const MAX_RETRIES = 5;
        const RETRY_DELAY = 500;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await prisma_1.prisma.track.update({
                    where: { id: trackId },
                    data: { processingStatus: stage }
                });
                break; // Success
            }
            catch (err) {
                // P2025 = Record not found (Prisma error code)
                if (err?.code === 'P2025' && attempt < MAX_RETRIES) {
                    console.warn(`[Ingestion] Track ${trackId} not found yet (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms...`);
                    await new Promise(r => setTimeout(r, RETRY_DELAY));
                }
                else {
                    console.error(`[Ingestion] Failed to update track ${trackId} status to ${stage}:`, err);
                    break;
                }
            }
        }
        // Emit WebSocket event for real-time updates
        this.eventBus.publish({
            eventName: "catalog.track_status",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId,
            trackId,
            status: stage,
        });
        console.log(`[Ingestion] Track ${trackId} stage: ${stage}`);
    }
    async retryRelease(releaseId) {
        console.log(`[Ingestion] Retrying release ${releaseId}`);
        // 1. Fetch release details from Catalog
        const release = await this.catalogService.getRelease(releaseId);
        if (!release) {
            throw new Error(`Release ${releaseId} not found`);
        }
        if (release.status === 'ready') {
            throw new Error(`Release ${releaseId} is already ready`);
        }
        // 2. Re-emit Uploaded event to reset status to processing
        // We map the tracks back to the format expected by the event
        const tracks = release.tracks.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            position: t.position,
            stems: t.stems.map((s) => ({
                id: s.id,
                uri: s.uri,
                type: s.type,
                // Note: For a retry, we assume the Buffer is no longer available in memory.
                // The worker needs to fetch from the URI.
                // If s.storageProvider is 'local', URI is a file path or localhost URL.
                // We might need to ensure the worker can handle fetching from URI if data is null.
                // Currently processStemsJob expects 'data' prop on stems.
                // This is a limitation: we can't fully retry if we didn't persist the raw upload buffer.
                // But for local fs, we could potentially re-read it if we knew the path.
                // For now, let's assume we can't easily re-read raw buffers unless we stored them.
                // However, the demucs-worker fetches from URI anyway if data is missing?
                // Checking processStemsJob...
                // It checks: if (!originalStem || !originalStem.data) break;
                // So we strictly need the data buffer.
                // If we don't have it, we can't retry the separation.
                // Wait, the original upload flow:
                // 1. handleFileUpload receives Files (Buffers).
                // 2. It creates 'tracks' object WITH buffers.
                // 3. It adds to Queue.
                // If we want to retry LATER, those buffers are gone from RAM.
                // We saved the 'original' stem to storage (local/ipfs).
                // So we need to fetch the original file content back into a buffer.
            }))
        }));
        // For a robust retry, we need to re-download the original file.
        // Let's implement that.
        const tracksWithData = await Promise.all(release.tracks.map(async (t) => {
            const originalStem = t.stems.find(s => s.type === 'ORIGINAL' || s.type === 'original');
            if (!originalStem)
                return null;
            const dbStem = await this.catalogService.getStemBlob(originalStem.id);
            let buffer;
            if (dbStem && dbStem.data) {
                buffer = dbStem.data;
            }
            else {
                console.error(`[Ingestion] Could not re-hydrate data for stem ${originalStem.id}`);
                return null;
            }
            return {
                ...t,
                stems: [{
                        ...originalStem,
                        data: buffer
                    }]
            };
        }));
        const validTracks = tracksWithData.filter((t) => t !== null);
        if (validTracks.length === 0) {
            throw new Error(`Could not re-hydrate any tracks for release ${releaseId}`);
        }
        // 3. Re-emit Uploaded event to reset status to processing
        this.eventBus.publish({
            eventName: "stems.uploaded",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId: release.id,
            artistId: release.artistId,
            checksum: "retry",
            metadata: {
                title: release.title || "Unknown",
                tracks: validTracks.map(t => ({
                    title: t.title,
                    artist: t.artist,
                    position: t.position,
                    stems: t.stems.map((s) => ({
                        id: s.id,
                        uri: s.uri,
                        type: s.type
                    }))
                }))
            }
        });
        // 4. Re-queue for processing
        await this.stemsQueue.add("process-stems", {
            releaseId: release.id,
            artistId: release.artistId,
            tracks: validTracks,
        }, {
            jobId: release.id,
            removeOnComplete: true,
            attempts: 3,
            backoff: {
                type: "exponential",
                delay: 5000,
            },
        });
        return { success: true };
    }
    async cancelProcessing(releaseId) {
        console.log(`[Ingestion] Cancelling processing for release ${releaseId}`);
        // 1. Remove any waiting/delayed jobs for this release from the BullMQ queue
        const waitingJobs = await this.stemsQueue.getJobs(['waiting', 'delayed', 'active']);
        for (const job of waitingJobs) {
            if (job.data?.releaseId === releaseId) {
                try {
                    await job.remove();
                    console.log(`[Ingestion] Removed job ${job.id} for release ${releaseId}`);
                }
                catch (err) {
                    // Job might be active and can't be removed — that's ok, we'll mark it failed
                    console.warn(`[Ingestion] Could not remove job ${job.id}:`, err);
                }
            }
        }
        // 2. Emit stems.failed event so catalog service updates DB status
        this.eventBus.publish({
            eventName: "stems.failed",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId,
            artistId: "cancelled",
            error: "Processing cancelled by user",
        });
        return { success: true, message: "Processing cancelled" };
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
    __param(5, (0, bullmq_2.InjectQueue)("stems")),
    __metadata("design:paramtypes", [event_bus_1.EventBus,
        storage_provider_1.StorageProvider,
        encryption_service_1.EncryptionService,
        artist_service_1.ArtistService,
        catalog_service_1.CatalogService,
        bullmq_1.Queue])
], IngestionService);
