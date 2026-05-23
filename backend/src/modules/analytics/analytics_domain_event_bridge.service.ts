import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Subscription } from "rxjs";
import {
  CatalogReleaseReadyEvent,
  CatalogTrackStatusEvent,
  StemsFailedEvent,
  StemsProcessedEvent,
  StemsUploadedEvent,
} from "../../events/event_types";
import { EventBus } from "../shared/event_bus";
import { AnalyticsEventInput } from "./analytics_event";
import { AnalyticsIngestService } from "./analytics_ingest.service";

@Injectable()
export class AnalyticsDomainEventBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsDomainEventBridgeService.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly ingestService: AnalyticsIngestService,
  ) {}

  onModuleInit() {
    this.subscriptions.push(
      this.eventBus.subscribe<StemsUploadedEvent>("stems.uploaded", (event) => this.recordStemsUploaded(event)),
      this.eventBus.subscribe<StemsProcessedEvent>("stems.processed", (event) => this.recordStemsProcessed(event)),
      this.eventBus.subscribe<StemsFailedEvent>("stems.failed", (event) => this.recordStemsFailed(event)),
      this.eventBus.subscribe<CatalogTrackStatusEvent>("catalog.track_status", (event) =>
        this.recordCatalogTrackStatus(event),
      ),
      this.eventBus.subscribe<CatalogReleaseReadyEvent>("catalog.release_ready", (event) =>
        this.recordCatalogReleaseReady(event),
      ),
    );
  }

  onModuleDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions.length = 0;
  }

  private recordStemsUploaded(event: StemsUploadedEvent) {
    const tracks = event.metadata?.tracks ?? [];
    const trackIds = extractTrackIds(tracks);

    return this.ingest({
      eventName: "stems.uploaded",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "ingestion-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: removeUndefined({
        releaseId: event.releaseId,
        artistId: event.artistId,
        sourceType: event.sourceType ?? "direct_upload",
        trackIds,
        trackCount: tracks.length,
        stemCount: countUploadedStems(tracks),
        retry: event.checksum === "retry",
      }),
      sourceRefs: removeUndefined({
        releaseId: event.releaseId,
        artistId: event.artistId,
      }),
    });
  }

  private recordStemsProcessed(event: StemsProcessedEvent) {
    const trackIds = event.tracks.map((track) => track.id);
    const stemIds = event.tracks.flatMap((track) => track.stems.map((stem) => stem.id));

    return this.ingest({
      eventName: "stems.processed",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "ingestion-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        modelVersion: event.modelVersion,
        trackIds,
        stemIds,
        trackCount: event.tracks.length,
        stemCount: stemIds.length,
      },
      sourceRefs: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        modelVersion: event.modelVersion,
      },
    });
  }

  private recordStemsFailed(event: StemsFailedEvent) {
    return this.ingest({
      eventName: "stems.failed",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "ingestion-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        status: "failed",
        error: truncateError(event.error),
      },
      sourceRefs: {
        releaseId: event.releaseId,
        artistId: event.artistId,
      },
    });
  }

  private recordCatalogTrackStatus(event: CatalogTrackStatusEvent) {
    return this.ingest({
      eventName: "catalog.track_status",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "catalog-service",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: event.trackId,
      payload: removeUndefined({
        releaseId: event.releaseId,
        trackId: event.trackId,
        status: event.status,
        error: truncateError(event.error),
      }),
      sourceRefs: {
        releaseId: event.releaseId,
        trackId: event.trackId,
        status: event.status,
      },
    });
  }

  private recordCatalogReleaseReady(event: CatalogReleaseReadyEvent) {
    const tracks = Array.isArray(event.metadata?.tracks) ? event.metadata.tracks : [];

    return this.ingest({
      eventName: "catalog.release_ready",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "catalog-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        status: "ready",
        trackIds: extractTrackIds(tracks),
        trackCount: tracks.length,
        stemCount: countUploadedStems(tracks),
      },
      sourceRefs: {
        releaseId: event.releaseId,
        artistId: event.artistId,
      },
    });
  }

  private async ingest(input: AnalyticsEventInput) {
    try {
      await this.ingestService.ingest(input);
    } catch (error) {
      this.logger.warn(
        `Failed to bridge ${input.eventName ?? "unknown"} into analytics: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function extractTrackIds(tracks: Array<Record<string, unknown>>): string[] {
  return tracks.map((track) => track.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

function countUploadedStems(tracks: Array<{ stems?: unknown }>) {
  return tracks.reduce((count, track) => count + (Array.isArray(track.stems) ? track.stems.length : 0), 0);
}

function truncateError(error: string | undefined) {
  if (!error) {
    return undefined;
  }
  return error.length > 240 ? `${error.slice(0, 237)}...` : error;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
