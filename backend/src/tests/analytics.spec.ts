import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";

describe("analytics", () => {
  it("aggregates plays and payouts by artist", () => {
    const ingest = new AnalyticsIngestService();
    const analytics = new AnalyticsService(ingest);

    ingest.ingest({
      eventName: "license.granted",
      occurredAt: new Date().toISOString(),
      payload: { artistId: "artist-1", trackId: "track-1", title: "Neon Drift" },
    });
    ingest.ingest({
      eventName: "payment.settled",
      occurredAt: new Date().toISOString(),
      payload: {
        artistId: "artist-1",
        trackId: "track-1",
        title: "Neon Drift",
        amountUsd: 1.5,
      },
    });

    const result = analytics.getArtistStats("artist-1", 7);
    expect(result.summary.totalPlays).toBe(1);
    expect(result.summary.totalPayoutUsd).toBe(1.5);
    expect(result.tracks[0].payoutUsd).toBe(1.5);
  });
});
