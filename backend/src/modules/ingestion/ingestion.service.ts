import { Injectable } from "@nestjs/common";
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

  constructor(private readonly eventBus: EventBus) {}

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
    record.status = "processing";
    const stems = record.fileUris.map((uri) => ({
      id: this.generateId("stem"),
      uri,
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
