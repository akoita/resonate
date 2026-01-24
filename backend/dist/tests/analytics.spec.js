"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const analytics_ingest_service_1 = require("../modules/analytics/analytics_ingest.service");
const analytics_service_1 = require("../modules/analytics/analytics.service");
describe("analytics", () => {
    it("aggregates plays and payouts by artist", () => {
        const ingest = new analytics_ingest_service_1.AnalyticsIngestService();
        const analytics = new analytics_service_1.AnalyticsService(ingest);
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
    it("builds v1 dashboard breakdowns", () => {
        const ingest = new analytics_ingest_service_1.AnalyticsIngestService();
        const analytics = new analytics_service_1.AnalyticsService(ingest);
        ingest.ingest({
            eventName: "license.granted",
            occurredAt: new Date().toISOString(),
            payload: {
                artistId: "artist-2",
                trackId: "track-9",
                title: "Pulse",
                sessionId: "session-9",
                source: "agent",
            },
        });
        ingest.ingest({
            eventName: "payment.settled",
            occurredAt: new Date().toISOString(),
            payload: {
                artistId: "artist-2",
                trackId: "track-9",
                title: "Pulse",
                sessionId: "session-9",
                source: "agent",
                amountUsd: 2,
            },
        });
        const result = analytics.getArtistDashboard("artist-2", 30);
        expect(result.summary.totalPlays).toBe(1);
        expect(result.sessions[0].payoutUsd).toBe(2);
        expect(result.sources[0].source).toBe("agent");
    });
});
