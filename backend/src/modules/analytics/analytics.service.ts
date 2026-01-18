import { Injectable } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics_ingest.service";

interface TrackStats {
  trackId: string;
  title: string;
  plays: number;
  payoutUsd: number;
}

interface SessionStats {
  sessionId: string;
  plays: number;
  payoutUsd: number;
}

interface SourceStats {
  source: string;
  plays: number;
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

  getArtistDashboard(artistId: string, days: number) {
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
    const trackMap = new Map<string, TrackStats>();
    const sessionMap = new Map<string, SessionStats>();
    const sourceMap = new Map<string, SourceStats>();

    filtered.forEach((event) => {
      const payload = event.payload as Record<string, any>;
      const trackId = payload.trackId ?? "unknown";
      const title = payload.title ?? "Unknown Track";
      const sessionId = payload.sessionId ?? "unknown";
      const source = payload.source ?? "unknown";

      const trackStats =
        trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0 };
      const sessionStats =
        sessionMap.get(sessionId) ?? { sessionId, plays: 0, payoutUsd: 0 };
      const sourceStats = sourceMap.get(source) ?? { source, plays: 0 };

      if (event.eventName === "license.granted") {
        trackStats.plays += 1;
        sessionStats.plays += 1;
        sourceStats.plays += 1;
        summary.totalPlays += 1;
      }
      if (event.eventName === "payment.settled") {
        const amount = Number(payload.amountUsd ?? 0);
        trackStats.payoutUsd += amount;
        sessionStats.payoutUsd += amount;
        summary.totalPayoutUsd += amount;
      }

      trackMap.set(trackId, trackStats);
      sessionMap.set(sessionId, sessionStats);
      sourceMap.set(source, sourceStats);
    });

    const exportPayload = {
      artistId,
      days,
      totalPlays: summary.totalPlays,
      totalPayoutUsd: summary.totalPayoutUsd,
      generatedAt: new Date().toISOString(),
    };

    return {
      summary,
      tracks: [...trackMap.values()],
      sessions: [...sessionMap.values()],
      sources: [...sourceMap.values()],
      export: exportPayload,
    };
  }
}
