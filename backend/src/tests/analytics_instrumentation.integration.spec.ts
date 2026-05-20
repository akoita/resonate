import { prisma } from "../db/prisma";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { buildAnalyticsWarehouseExport } from "../modules/analytics/analytics_warehouse";

const TEST_PREFIX = `analytics_instrumentation_${Date.now()}_`;

describe("Analytics instrumentation integration", () => {
  const ingest = new AnalyticsIngestService(new PrismaAnalyticsEventStore());
  const instrumentation = new AnalyticsInstrumentationService(ingest);

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({
      where: {
        OR: [
          { subjectId: { startsWith: TEST_PREFIX } },
          { actorId: { startsWith: TEST_PREFIX } },
          { eventId: { startsWith: TEST_PREFIX } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  it("emits representative playback, library, commerce, rights, agent, and generation events", async () => {
    await instrumentation.recordPlaybackCompleted({
      trackId: `${TEST_PREFIX}track`,
      artistId: `${TEST_PREFIX}artist`,
      sessionId: `${TEST_PREFIX}session`,
      source: "agent",
      completionRatio: 1,
      durationMs: 180000,
    });
    await instrumentation.recordLibrarySaved({
      userCohortId: `${TEST_PREFIX}cohort`,
      trackId: `${TEST_PREFIX}track`,
      releaseId: `${TEST_PREFIX}release`,
      source: "release_page",
    });
    await instrumentation.recordCommerceSettled({
      paymentId: `${TEST_PREFIX}payment`,
      artistId: `${TEST_PREFIX}artist`,
      trackId: `${TEST_PREFIX}track`,
      sessionId: `${TEST_PREFIX}session`,
      canonicalAmountUsd: 3.5,
      settlementAsset: "base-sepolia:usdc",
      txHash: `${TEST_PREFIX}tx`,
    });
    await instrumentation.recordRightsRouteDecided({
      releaseId: `${TEST_PREFIX}release`,
      artistId: `${TEST_PREFIX}artist`,
      route: "trusted_creator",
      evidenceTypes: ["wallet_attestation"],
      decisionReason: "creator has clean history",
    });
    await instrumentation.recordAgentRecommendationSelected({
      agentId: `${TEST_PREFIX}agent`,
      sessionId: `${TEST_PREFIX}session`,
      trackId: `${TEST_PREFIX}track`,
      strategy: "model-assisted",
      candidateCount: 8,
    });
    await instrumentation.recordGenerationCreated({
      generationId: `${TEST_PREFIX}generation`,
      userId: `${TEST_PREFIX}user`,
      trackId: `${TEST_PREFIX}track`,
      artistId: `${TEST_PREFIX}artist`,
      model: "lyria",
      promptPolicy: "accepted",
    });

    const rows = await prisma.analyticsEvent.findMany({
      where: {
        OR: [
          { subjectId: { startsWith: TEST_PREFIX } },
          { actorId: { startsWith: TEST_PREFIX } },
        ],
      },
      orderBy: { eventName: "asc" },
    });

    expect(rows.map((row) => row.eventName).sort()).toEqual([
      "agent.recommendation_selected",
      "commerce.settled",
      "generation.created",
      "library.saved",
      "playback.completed",
      "rights.route_decided",
    ]);
    expect(rows.find((row) => row.eventName === "generation.created")).toEqual(
      expect.objectContaining({
        privacyTier: "personal",
        consentBasis: "platform_analytics:v1",
      }),
    );

    const exportPayload = buildAnalyticsWarehouseExport(await ingest.listEvents());
    expect(exportPayload.analyticsQuarantine).toHaveLength(0);
    expect(exportPayload.eventsClean.map((row) => row.eventName)).toEqual(
      expect.arrayContaining([
        "playback.completed",
        "library.saved",
        "commerce.settled",
        "rights.route_decided",
        "agent.recommendation_selected",
        "generation.created",
      ]),
    );
  });
});
