import { Injectable } from "@nestjs/common";
import { join } from "path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { EventBus } from "../shared/event_bus";
import { StorageProvider } from "../storage/storage_provider";
import { EncryptionService } from "../encryption/encryption.service";
import { ArtistService } from "../artist/artist.service";

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

  constructor(
    private readonly eventBus: EventBus,
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
    private readonly artistService: ArtistService,
    @InjectQueue("stems") private readonly stemsQueue: Queue,
  ) { }

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
      artworkUrl = `http://localhost:3000/catalog/releases/${releaseId}/artwork`;
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
      tracks: tracks.map((t: any) => ({
        ...t,
        stems: t.stems.map((s: any) => ({ ...s, data: undefined })) // Don't log buffers
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

      while (attempt < MAX_RETRIES) {
        try {
          const originalStem = track.stems[0];
          if (!originalStem || !originalStem.data) break;

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

          const result = await response.json() as { stems: Record<string, string> };
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
            const absolutePath = join(process.cwd(), "uploads", "stems", relativePath);
            if (existsSync(absolutePath)) {
              let data: Buffer = readFileSync(absolutePath);
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
        } catch (err) {
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
      throw new Error(`Failed to process any tracks for release ${input.releaseId}`);
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
