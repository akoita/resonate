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

@Injectable()
export class AnalyticsIngestService {
  private readonly eventStore: AnalyticsEventStore;

  constructor(
    @Optional()
    @Inject(ANALYTICS_EVENT_STORE)
    eventStore?: AnalyticsEventStore,
  ) {
    this.eventStore = eventStore ?? new InMemoryAnalyticsEventStore();
  }

  async ingest(input: AnalyticsEventInput) {
    const event = this.normalize(input);
    const stored = await this.eventStore.ingest(event);
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
