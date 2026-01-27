import { Injectable } from "@nestjs/common";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { EventBus } from "../shared/event_bus";

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

@Injectable()
export class IngestionService {
  private uploads = new Map<string, UploadRecord>();

  constructor(private readonly eventBus: EventBus) { }

  async handleFileUpload(input: {
    artistId: string;
    files: Express.Multer.File[];
    artwork?: Express.Multer.File;
    metadata?: any;
  }) {
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
        tracks: tracks.map((t: any) => ({
          ...t,
          stems: t.stems.map((s: any) => ({ ...s, data: undefined })) // Don't log buffers
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
          tracks: tracks.map((t: any) => ({
            ...t,
            stems: t.stems.map((s: any) => ({ ...s, data: undefined }))
          }))
        },
        tracks: tracks.map((t: any) => ({
          ...t,
          stems: t.stems.map((s: any) => ({
            ...s,
            // Only send necessary fields for processing
          }))
        })),
      });
    }, 1000);

    return { releaseId, status: "processing" };
  }

  enqueueUpload(input: {
    artistId: string;
    fileUris: string[];
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

  getStatus(trackId: string) {
    const record = this.uploads.get(trackId);
    if (!record) {
      return { trackId, status: "failed" as UploadStatus, error: "Not found" };
    }
    return { trackId, status: record.status, stems: record.stems ?? [] };
  }

  private async processUpload(trackId: string) {
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

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  private inferStemType(uri: string) {
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
}
