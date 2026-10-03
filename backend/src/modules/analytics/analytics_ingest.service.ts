import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import {
  AnalyticsEventEnvelope,
  AnalyticsEventInput,
  AnalyticsEventValidationError,
  normalizeAnalyticsEventInput,
} from "./analytics_event";
import {
  ANALYTICS_EVENT_STORE,
  AnalyticsEventStore,
  InMemoryAnalyticsEventStore,
} from "./analytics_event_store";
import {
  ANALYTICS_EVENT_PUBLISHER,
  AnalyticsEventPublisher,
  DisabledAnalyticsEventPublisher,
} from "./analytics_event_publisher";
import { AnalyticsDiscoveryMetadataService } from "./analytics_discovery_metadata.service";

@Injectable()
export class AnalyticsIngestService {
  private readonly eventStore: AnalyticsEventStore;
  private readonly eventPublisher: AnalyticsEventPublisher;

  constructor(
    @Optional()
    @Inject(ANALYTICS_EVENT_STORE)
    eventStore?: AnalyticsEventStore,
    @Optional()
    @Inject(ANALYTICS_EVENT_PUBLISHER)
    eventPublisher?: AnalyticsEventPublisher,
    @Optional() private readonly discoveryMetadata?: AnalyticsDiscoveryMetadataService,
  ) {
    this.eventStore = eventStore ?? new InMemoryAnalyticsEventStore();
    this.eventPublisher = eventPublisher ?? new DisabledAnalyticsEventPublisher();
  }

  async ingest(input: AnalyticsEventInput) {
    const normalized = this.normalize(input);
    const event = this.discoveryMetadata ? await this.discoveryMetadata.enrich(normalized) : normalized;
    const stored = await this.eventStore.ingest(event);
    await this.eventPublisher.publish(stored);
    const count = await this.eventStore.countEvents();
    return { status: "ok", eventId: stored.eventId, ingested: count };
  }

  async listEvents() {
    return this.eventStore.listEvents();
  }

  async dailyRollup() {
    return { totalEvents: await this.eventStore.countEvents() };
  }

  private normalize(input: AnalyticsEventInput) {
    try {
      return normalizeAnalyticsEventInput(input);
    } catch (error) {
      if (error instanceof AnalyticsEventValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
