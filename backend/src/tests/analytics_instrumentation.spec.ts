import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";

describe("AnalyticsInstrumentationService", () => {
  it("emits generation events with the required personal-data consent basis", async () => {
    const ingest = new AnalyticsIngestService();
    const instrumentation = new AnalyticsInstrumentationService(ingest);

    await instrumentation.recordGenerationCreated({
      generationId: "generation-1",
      userId: "user-1",
      model: "lyria",
    });

    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "generation.created",
        privacyTier: "personal",
        consentBasis: "platform_analytics:v1",
        payload: expect.objectContaining({
          generationId: "generation-1",
          userId: "user-1",
          model: "lyria",
        }),
      }),
    ]);
  });
});
