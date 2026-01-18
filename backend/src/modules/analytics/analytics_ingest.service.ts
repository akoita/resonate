import { Injectable } from "@nestjs/common";

interface AnalyticsEvent {
  eventName: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class AnalyticsIngestService {
  private events: AnalyticsEvent[] = [];

  ingest(event: AnalyticsEvent) {
    this.events.push(event);
    return { status: "ok", ingested: this.events.length };
  }

  dailyRollup() {
    return { totalEvents: this.events.length };
  }
}
