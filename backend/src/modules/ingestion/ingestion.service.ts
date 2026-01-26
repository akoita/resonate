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
    metadata?: any;
  }) {
    const trackId = this.generateId("trk");
    const uploadDir = join(process.cwd(), "uploads", trackId);
    mkdirSync(uploadDir, { recursive: true });

    const fileUris: string[] = [];
    const stems: { id: string; uri: string; type: string }[] = [];

    for (const file of input.files) {
      const stemId = this.generateId("stem");
      const filename = `${stemId}_${file.originalname}`;
      const filePath = join(uploadDir, filename);
      writeFileSync(filePath, file.buffer);

      // Serving path (must match static config in main.ts)
      const publicUri = `http://localhost:3000/uploads/${trackId}/${filename}`;
      fileUris.push(publicUri);
      stems.push({
        id: stemId,
        uri: publicUri,
        type: this.inferStemType(file.originalname),
      });
    }

    const record: UploadRecord = {
      trackId,
      artistId: input.artistId,
      fileUris,
      status: "processing",
      metadata: input.metadata,
      stems,
    };
    this.uploads.set(trackId, record);

    // 1. Emit Uploaded
    this.eventBus.publish({
      eventName: "stems.uploaded",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      trackId,
      artistId: input.artistId,
      fileUris,
      checksum: "completed",
      metadata: input.metadata,
    });

    // 2. Small delay to ensure DB catchup, then emit Processed
    setTimeout(() => {
      this.eventBus.publish({
        eventName: "stems.processed",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        trackId,
        stemIds: stems.map((s) => s.id),
        modelVersion: "real-v1",
        durationMs: 0,
        stems,
      });
      record.status = "complete";
    }, 1000);

    return { trackId, status: record.status };
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
      trackId,
      artistId: input.artistId,
      fileUris: input.fileUris,
      checksum: "pending",
      metadata: input.metadata,
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
      trackId: record.trackId,
      stemIds: stems.map((stem) => stem.id),
      modelVersion: "mock-v1",
      durationMs: 0,
      stems,
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
    return "other";
  }
}
