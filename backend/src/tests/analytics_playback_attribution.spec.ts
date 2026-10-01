import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { buildAnalyticsWarehouseExport } from "../modules/analytics/analytics_warehouse";

describe("playback events carry rail and variant labels (#1455)", () => {
  it("stores railId, rankerVariant and reason on the payload and as fact dimensions", async () => {
    const ingest = new AnalyticsIngestService();
    const instrumentation = new AnalyticsInstrumentationService(ingest);

    await instrumentation.recordPlaybackLifecycle({
      action: "skipped",
      trackId: "track-1",
      artistId: "artist-1",
      source: "web_player",
      reason: "next_clicked",
      railId: "because_genre",
      rankerVariant: "candidate",
    });
    await instrumentation.recordPlaybackCompleted({
      trackId: "track-1",
      artistId: "artist-1",
      source: "web_player",
      completionRatio: 1,
      railId: "because_genre",
      rankerVariant: "candidate",
    });
    await instrumentation.recordPlaybackCompleted({
      trackId: "track-2",
      artistId: "artist-1",
      source: "web_player",
      completionRatio: 1,
    });

    const events = await ingest.listEvents();
    expect(events[0].payload).toEqual(
      expect.objectContaining({ reason: "next_clicked", railId: "because_genre", rankerVariant: "candidate" }),
    );
    expect(events[2].payload).not.toHaveProperty("railId");
    expect(events[2].payload).not.toHaveProperty("rankerVariant");

    const facts = buildAnalyticsWarehouseExport(events).analyticsFacts;
    expect(facts[0].dimensions).toEqual(
      expect.objectContaining({ railId: "because_genre", rankerVariant: "candidate", reason: "next_clicked" }),
    );
    // No listener-level bucket or identity is added by the variant dimensions.
    expect(Object.keys(facts[0].dimensions)).not.toContain("bucket");
  });

  it("maps served impressions to an item count dimension", async () => {
    const ingest = new AnalyticsIngestService();
    await ingest.ingest({
      eventName: "recommendation.served",
      occurredAt: new Date().toISOString(),
      payload: { requestId: "r1", railId: "exploration", count: 4, source: "home", rankerVariant: "baseline", experimentKey: "exp" },
    });
    const [served] = buildAnalyticsWarehouseExport(await ingest.listEvents()).analyticsFacts;
    expect(served.dimensions).toEqual(
      expect.objectContaining({
        railId: "exploration",
        itemCount: 4,
        rankerVariant: "baseline",
        experimentKey: "exp",
      }),
    );
  });
});
