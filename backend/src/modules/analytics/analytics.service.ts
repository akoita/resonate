import { Injectable } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics_ingest.service";

interface TrackStats {
  trackId: string;
  title: string;
  plays: number;
  payoutUsd: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly ingestService: AnalyticsIngestService) {}

  getArtistStats(artistId: string, days: number) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = this.ingestService
      .listEvents()
      .filter((event) => new Date(event.occurredAt).getTime() >= since);
    const filtered = events.filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return payload.artistId === artistId;
    });

    const summary = {
      artistId,
      days,
      totalPlays: 0,
      totalPayoutUsd: 0,
    };
    const tracks: TrackStats[] = [];
    const trackMap = new Map<string, TrackStats>();

    filtered.forEach((event) => {
      const payload = event.payload as Record<string, any>;
      const trackId = payload.trackId ?? "unknown";
      const title = payload.title ?? "Unknown Track";
      const stats =
        trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0 };
      if (event.eventName === "license.granted") {
        stats.plays += 1;
        summary.totalPlays += 1;
      }
      if (event.eventName === "payment.settled") {
        const amount = Number(payload.amountUsd ?? 0);
        stats.payoutUsd += amount;
        summary.totalPayoutUsd += amount;
      }
      trackMap.set(trackId, stats);
    });

    tracks.push(...trackMap.values());
    return { summary, tracks };
  }
}
