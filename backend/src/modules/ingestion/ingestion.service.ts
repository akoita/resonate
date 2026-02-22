import { Injectable } from "@nestjs/common";
import { join } from "path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { Agent } from "undici";
import { EventBus } from "../shared/event_bus";
import { StorageProvider } from "../storage/storage_provider";
import { EncryptionService } from "../encryption/encryption.service";
import { ArtistService } from "../artist/artist.service";
import { CatalogService } from "../catalog/catalog.service";
import { prisma } from "../../db/prisma";

type UploadStatus = "queued" | "processing" | "complete" | "failed";

interface UploadRecord {
  trackId: string;
  artistId: string;
  fileUris: string[];
  status: UploadStatus;
  metadata?: {
    releaseType?: string;
    releaseTitle?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
    isrc?: string;
    label?: string;
    releaseDate?: string;
    explicit?: boolean;
  };
  stems?: { id: string; uri: string; type: string }[];
}

interface StemAudioProps {
  stem: {
    uri: string;
    type: string;
    isEncrypted?: boolean;
    encryptionMetadata?: string | null;
  };
  masterAudio: HTMLAudioElement | null;
  isPlaying: boolean;
  volume: number;
  mixerVolume: number;
  onMount: (type: string, el: HTMLAudioElement) => void;
  onUnmount: (type: string) => void;
}

@Injectable()
export class IngestionService {
  private uploads = new Map<string, UploadRecord>();
  private readonly CONCURRENCY = 1;
  private readonly useSyncProcessing: boolean;

  constructor(
    private readonly eventBus: EventBus,
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
    private readonly artistService: ArtistService,
    private readonly catalogService: CatalogService,
    @InjectQueue("stems") private readonly stemsQueue: Queue,
  ) {
    // In test mode, process synchronously instead of through BullMQ queue
    this.useSyncProcessing = process.env.NODE_ENV === "test" || process.env.USE_SYNC_PROCESSING === "true";
  }

  async handleFileUpload(input: {
    artistId: string;
    files: Express.Multer.File[];
    artwork?: Express.Multer.File;
    metadata?: any;
  }) {
    const mm = await import("music-metadata");
    const releaseId = this.generateId("rel");

    // Prepare artwork
    let artworkUrl: string | undefined;
    let artworkData: Buffer | undefined;
    let artworkMimeType: string | undefined;

    if (input.artwork) {
      artworkData = input.artwork.buffer;
      artworkMimeType = input.artwork.mimetype;
      artworkUrl = `${process.env.BACKEND_URL || 'http://localhost:3000'}/catalog/releases/${releaseId}/artwork`;
    }

    const tracks: any[] = [];
    let extractedReleaseLabel: string | undefined;
    let extractedReleaseDate: string | undefined;

    for (const [index, file] of input.files.entries()) {
      const trackId = this.generateId("trk");
      const stemId = this.generateId("stem");
      const trackMeta = input.metadata?.tracks?.[index];

      // Extraction metadata from buffer
      let durationSeconds: number | undefined;
      let extractedTitle: string | undefined;
      let extractedArtist: string | undefined;

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
      } catch (err) {
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
        storageResult = await this.storageProvider.upload(
          file.buffer,
          `original_${stemId}.${file.originalname.split('.').pop() || 'mp3'}`,
          file.mimetype
        );
      } catch (err) {
        console.error(`[Ingestion] Failed to upload original stem ${stemId} to storage:`, err);
      }

      const publicUri = storageResult?.uri || `${process.env.BACKEND_URL || 'http://localhost:3000'}/catalog/stems/${stemId}/blob`;

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
      tracks: tracks.map((t: any) => ({
        ...t,
        stems: t.stems.map((s: any) => ({
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
      const mockProcessedTracks = tracks.map((track: any) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        position: track.position,
        stems: track.stems.map((stem: any) => ({
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
        tracks: mockProcessedTracks as any,
      });
      return { releaseId, status: "processing" };
    }

    // Production: queue for async processing via BullMQ
    // CRITICAL: Strip Buffer data from job payload to avoid JSON serialization failures
    // (BullMQ can't serialize payloads > ~512MB, and albums with many tracks blow this limit)
    // The processor will fetch audio data from the storage URIs instead.
    const serializableTracks = tracks.map((track: any) => ({
      ...track,
      stems: track.stems.map((stem: any) => ({
        ...stem,
        data: undefined, // Remove Buffer - it's already uploaded to storage
      })),
    }));
    await this.stemsQueue.add("process-stems", { releaseId, artistId: input.artistId, tracks: serializableTracks });

    return { releaseId, status: "processing" };
  }

  handleProgress(releaseId: string, trackId: string, progress: number) {
    this.eventBus.publish({
      eventName: "stems.progress" as any,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId,
      trackId,
      progress,
    });
    console.log(`[Ingestion] Progress for ${trackId}: ${progress}%`);
  }

  async processStemsJob(input: { releaseId: string; artistId: string; tracks: any[] }) {
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
          if (!originalStem) break;

          // Get audio data - either from job payload or fetch from storage URI
          let audioBuffer: Buffer;
          if (originalStem.data) {
            // Crucial: BullMQ (JSON) converts Buffers to {type: 'Buffer', data: []}
            // We must convert it back to a real Buffer or Prisma will blow the stack
            if (!(originalStem.data instanceof Buffer)) {
              audioBuffer = Buffer.from(originalStem.data);
            } else {
              audioBuffer = originalStem.data;
            }
          } else if (originalStem.uri) {
            // Data stripped from job payload - fetch from storage URI
            console.log(`[Ingestion] Fetching audio from storage for track ${track.id}: ${originalStem.uri}`);
            const fetchedData = await this.storageProvider.download(originalStem.uri);
            if (!fetchedData) {
              throw new Error(`Failed to fetch audio from storage: ${originalStem.uri}`);
            }
            audioBuffer = fetchedData;
          } else {
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
          const demucsAgent = new Agent({
            headersTimeout: 600_000,  // 10 minutes — matches AbortSignal
            bodyTimeout: 0,           // unlimited — response body can be large
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

          const result = await response.json() as { stems: Record<string, string> };
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
            let data: Buffer | null = null;
            const stemUriStr = stemUri as string;

            if (stemUriStr.startsWith('http://') || stemUriStr.startsWith('https://')) {
              // GCS/remote mode: download from URL
              console.log(`[Ingestion] Downloading stem from URL: ${stemUriStr}`);
              try {
                const stemResponse = await fetch(stemUriStr, { signal: AbortSignal.timeout(120_000) });
                if (stemResponse.ok) {
                  const arrayBuffer = await stemResponse.arrayBuffer();
                  data = Buffer.from(new Uint8Array(arrayBuffer));
                } else {
                  console.error(`[Ingestion] Failed to download stem: HTTP ${stemResponse.status}`);
                }
              } catch (dlErr) {
                console.error(`[Ingestion] Failed to download stem from ${stemUriStr}:`, dlErr);
              }
            } else {
              // Local mode: read from shared volume (backward compatible)
              const absolutePath = join(process.cwd(), "uploads", "stems", stemUriStr);
              if (existsSync(absolutePath)) {
                data = readFileSync(absolutePath);
              }
            }

            if (data) {
              const stemId = this.generateId("stem");

              let isEncrypted = false;
              let encryptionMetadata: string | null = null;

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
              } catch (encErr) {
                console.warn(`[Ingestion] Encryption failed for ${type}, falling back to plaintext:`, encErr);
              }

              const storage = await this.storageProvider.upload(data, `${stemId}.mp3`, "audio/mpeg");

              stems.push({
                id: stemId,
                uri: storage.uri,
                type: type,
                data: data, // Include encrypted data for Prisma persistence (Cloud Run ephemeral FS)
                mimeType: "audio/mpeg",
                durationSeconds: originalStem.durationSeconds,
                isEncrypted,
                encryptionMetadata,
                storageProvider: storage.provider,
              });
            } else {
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
        } catch (err) {
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
        tracks: processedTracks as any,
      });
    } else {
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

  enqueueUpload(input: {
    artistId: string;
    fileUris: string[];
    metadata?: any;
  }) {
    const trackId = this.generateId("trk");
    const record: UploadRecord = {
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

  getStatus(trackId: string) {
    const record = this.uploads.get(trackId);
    if (!record) {
      return { trackId, status: "failed" as UploadStatus, error: "Not found" };
    }
    return { trackId, status: record.status, stems: record.stems ?? [] };
  }

  private async processUpload(trackId: string) {
    const record = this.uploads.get(trackId);
    if (!record) return;
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

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  private async emitTrackStage(releaseId: string, trackId: string, stage: 'pending' | 'separating' | 'encrypting' | 'storing' | 'complete' | 'failed') {
    // Persist the status to database so it's available on page load
    // Retry logic to handle race condition where Track record may not exist yet
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await prisma.track.update({
          where: { id: trackId },
          data: { processingStatus: stage }
        });
        break; // Success
      } catch (err: any) {
        // P2025 = Record not found (Prisma error code)
        if (err?.code === 'P2025' && attempt < MAX_RETRIES) {
          console.warn(`[Ingestion] Track ${trackId} not found yet (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        } else {
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
    } as any);
    console.log(`[Ingestion] Track ${trackId} stage: ${stage}`);
  }

  async retryRelease(releaseId: string) {
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
      stems: t.stems.map((s: any) => ({
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
      if (!originalStem) return null;

      const dbStem = await this.catalogService.getStemBlob(originalStem.id);
      let buffer: Buffer;

      if (dbStem && dbStem.data) {
        buffer = dbStem.data;
      } else {
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

    const validTracks = tracksWithData.filter((t): t is any => t !== null);

    if (validTracks.length === 0) {
      // Fallback: if separation already completed but DB write failed,
      // re-download stems from GCS and persist them directly
      console.log(`[Ingestion] Original audio unavailable. Checking GCS for already-separated stems...`);

      const stemTypes = ["vocals", "drums", "bass", "piano", "guitar", "other"];
      const bucket = process.env.GCS_STEMS_BUCKET || "resonate-stems-dev";
      let recovered = false;

      for (const track of release.tracks) {
        const stems: Array<{
          id: string; type: string; uri: string; data: Buffer;
          mimeType: string; durationSeconds: number; isEncrypted: boolean;
          storageProvider: string;
        }> = [];

        // Keep the original stem as-is (even without data)
        const originalStem = track.stems.find(s => s.type === "ORIGINAL" || s.type === "original");

        for (const stemType of stemTypes) {
          const gcsPath = `stems/${releaseId}/${track.id}/${stemType}.mp3`;
          const gcsUrl = `https://storage.googleapis.com/${bucket}/${gcsPath}`;

          try {
            const response = await fetch(gcsUrl, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) continue;

            const buffer = Buffer.from(await response.arrayBuffer());
            const stemId = `stem_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

            stems.push({
              id: stemId,
              type: stemType,
              uri: gcsUrl,
              data: buffer,
              mimeType: "audio/mpeg",
              durationSeconds: originalStem?.durationSeconds ?? 0,
              isEncrypted: false,
              storageProvider: "gcs",
            });

            console.log(`[Ingestion] Recovered ${stemType} stem from GCS for track ${track.id}`);
          } catch (e) {
            // Stem doesn't exist in GCS, skip
          }
        }

        if (stems.length > 0) {
          recovered = true;

          // Emit stems.processed to redo the DB write
          this.eventBus.publish({
            eventName: "stems.processed",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId,
            artistId: release.artistId,
            modelVersion: "htdemucs_6s",
            tracks: [{
              id: track.id,
              title: track.title,
              artist: track.artist ?? undefined,
              position: track.position,
              stems: [
                // Include original stem if exists
                ...(originalStem ? [{
                  id: originalStem.id,
                  type: originalStem.type,
                  uri: originalStem.uri,
                  mimeType: "audio/mpeg",
                  durationSeconds: originalStem.durationSeconds ?? 0,
                  isEncrypted: false,
                  storageProvider: originalStem.storageProvider || "local",
                }] : []),
                ...stems,
              ],
            }],
          });
        }
      }

      if (!recovered) {
        throw new Error(`Could not re-hydrate any tracks for release ${releaseId}. Original audio and separated stems are both unavailable. Please delete and re-upload.`);
      }

      return { message: "Recovered stems from cloud storage and re-processing" };
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
        title: (release as any).title || "Unknown",
        tracks: validTracks.map(t => ({
          title: t.title,
          artist: t.artist,
          position: t.position,
          stems: t.stems.map((s: any) => ({
            id: s.id,
            uri: s.uri,
            type: s.type
          }))
        }))
      }
    });

    // 4. Re-queue for processing
    await this.stemsQueue.add(
      "process-stems",
      {
        releaseId: release.id,
        artistId: release.artistId,
        tracks: validTracks,
      },
      {
        jobId: release.id,
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );

    return { success: true };
  }

  async cancelProcessing(releaseId: string) {
    console.log(`[Ingestion] Cancelling processing for release ${releaseId}`);

    // 1. Remove any waiting/delayed jobs for this release from the BullMQ queue
    const waitingJobs = await this.stemsQueue.getJobs(['waiting', 'delayed', 'active']);
    for (const job of waitingJobs) {
      if (job.data?.releaseId === releaseId) {
        try {
          await job.remove();
          console.log(`[Ingestion] Removed job ${job.id} for release ${releaseId}`);
        } catch (err) {
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

  private inferStemType(uri: string) {
    const normalized = uri.toLowerCase();
    if (normalized.includes("drum")) return "drums";
    if (normalized.includes("vocal")) return "vocals";
    if (normalized.includes("bass")) return "bass";
    if (normalized.includes("piano")) return "piano";
    if (normalized.includes("guitar")) return "guitar";
    return "ORIGINAL";
  }
}
