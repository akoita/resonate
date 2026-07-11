import { BadRequestException } from "@nestjs/common";
import {
  ANALYTICS_EVENT_SCHEMA_EXAMPLES,
  AnalyticsEventValidationError,
  buildAnalyticsEventId,
  normalizeAnalyticsEventInput,
  parseAnalyticsEventEnvelope,
} from "../modules/analytics/analytics_event";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";

describe("analytics event envelope", () => {
  const now = new Date("2026-05-20T12:00:00.000Z");

  it("normalizes legacy analytics ingest payloads into canonical envelopes", () => {
    const event = normalizeAnalyticsEventInput(
      {
        eventName: "license.granted",
        payload: { artistId: "artist-1", trackId: "track-1" },
      },
      {
        now,
        defaultProducer: "test-producer",
        defaultEnvironment: "local",
      },
    );

    expect(event).toEqual(
      expect.objectContaining({
        eventName: "license.granted",
        eventVersion: 1,
        occurredAt: now.toISOString(),
        receivedAt: now.toISOString(),
        producer: "test-producer",
        environment: "local",
        privacyTier: "pseudonymous",
        schemaUri: "analytics://license.granted/v1",
        payload: { artistId: "artist-1", trackId: "track-1" },
      }),
    );
    expect(event.eventId).toMatch(/^evt_/);
  });

  it("accepts snake_case producer payloads from external event sources", () => {
    const event = normalizeAnalyticsEventInput({
      event_id: "evt_external_1",
      event_name: "playback.completed",
      event_version: 2,
      occurred_at: "2026-05-20T10:00:00.000Z",
      received_at: "2026-05-20T10:00:01.000Z",
      producer: "playback-service",
      environment: "prod",
      privacy_tier: "anonymous",
      subject_type: "track",
      subject_id: "track-1",
      source_refs: { requestId: "req-1" },
      payload: { completionRatio: 1 },
    });

    expect(event).toEqual(
      expect.objectContaining({
        eventId: "evt_external_1",
        eventName: "playback.completed",
        eventVersion: 2,
        occurredAt: "2026-05-20T10:00:00.000Z",
        receivedAt: "2026-05-20T10:00:01.000Z",
        privacyTier: "anonymous",
        subjectType: "track",
        subjectId: "track-1",
        sourceRefs: { requestId: "req-1" },
      }),
    );
  });

  it("requires consent basis for personal or sensitive events", () => {
    expect(() =>
      normalizeAnalyticsEventInput(
        {
          eventName: "generation.created",
          privacyTier: "personal",
          payload: { userId: "user-1" },
        },
        {
          now,
          defaultEnvironment: "local",
        },
      ),
    ).toThrow(AnalyticsEventValidationError);

    expect(() =>
      normalizeAnalyticsEventInput(
        {
          eventName: "generation.created",
          privacyTier: "personal",
          consentBasis: "user_consent:v1",
          payload: { userId: "user-1" },
        },
        {
          now,
          defaultEnvironment: "local",
        },
      ),
    ).not.toThrow();
  });

  it("normalizes coarse geo dimensions without accepting location tracking fields", () => {
    const event = normalizeAnalyticsEventInput(
      {
        eventName: "shows.pledge_intent_created",
        payload: { campaignId: "campaign-1" },
        geo: {
          countryCode: "fr",
          regionCode: "idf",
          citySlug: "Paris",
          source: "campaign_target",
          precision: "city",
          rawIp: "203.0.113.1",
        } as any,
      },
      {
        now,
        defaultProducer: "shows-service",
        defaultEnvironment: "local",
      },
    );

    expect(event.geo).toEqual({
      countryCode: "FR",
      regionCode: "IDF",
      citySlug: "paris",
      source: "campaign_target",
      precision: "city",
    });
    expect(event.geo).not.toHaveProperty("rawIp");
  });

  it("rejects malformed geo dimensions on canonical envelopes", () => {
    expect(() =>
      parseAnalyticsEventEnvelope({
        eventId: "evt_bad_geo",
        eventName: "shows.pledge_intent_created",
        eventVersion: 1,
        occurredAt: now.toISOString(),
        receivedAt: now.toISOString(),
        producer: "shows-service",
        environment: "local",
        privacyTier: "pseudonymous",
        geo: {
          countryCode: "FR",
          source: "campaign_target",
          precision: "city",
        },
        payload: {},
      }),
    ).toThrow(/citySlug/);
  });

  it("rejects malformed event names and incomplete subject references", () => {
    expect(() =>
      parseAnalyticsEventEnvelope({
        eventId: "evt_bad",
        eventName: "Playback Completed",
        eventVersion: 1,
        occurredAt: now.toISOString(),
        receivedAt: now.toISOString(),
        producer: "test",
        environment: "local",
        privacyTier: "anonymous",
        subjectId: "track-1",
        payload: {},
      }),
    ).toThrow(/eventName|subjectType/);
  });

  it("builds stable idempotency keys when source references are stable", () => {
    const input = {
      eventName: "commerce.settled",
      eventVersion: 1,
      occurredAt: now.toISOString(),
      producer: "payments-service",
      sourceRefs: { txHash: "0xabc", logIndex: "7" },
    };

    expect(buildAnalyticsEventId(input)).toBe(buildAnalyticsEventId(input));
    expect(buildAnalyticsEventId({ ...input, sourceRefs: undefined })).not.toBe(
      buildAnalyticsEventId({ ...input, sourceRefs: undefined }),
    );
  });

  it("exposes sample schemas for the initial event families", () => {
    expect(ANALYTICS_EVENT_SCHEMA_EXAMPLES.map((schema) => schema.eventName)).toEqual([
      "playback.completed",
      "playback.started",
      "playback.heartbeat",
      "onboarding.step_completed",
      "playlist.track_added",
      "artist.upload_step_completed",
      "shows.pledge_intent_created",
      "shows.campaign_visuals_updated",
      "shows.campaign_settled",
      "community.campaign_update_viewed",
      "community.cohort_suggested",
      "community.cohort_joined",
      "community.cohort_left",
      "community.cohort_hidden",
      "commerce.settled",
      "rights.route_decided",
      "agent.recommendation_selected",
      "generation.created",
      "generation.credits_debited",
      "generation.credits_insufficient",
      "generation.credits_granted",
      "generation.credits_requested",
      "generation.cost_recorded",
      "punchline.drop_published",
      "punchline.moment_collected",
      "punchline.set_completed",
      "punchline.unlock_granted",
      "punchline.drop_viewed",
      "punchline.preview_played",
      "punchline.collect_started",
      "punchline.collect_completed",
      "recommendation.generated",
      "stems.uploaded",
      "stems.processed",
      "catalog.track_status",
      "catalog.release_ready",
    ]);
  });
});

describe("AnalyticsIngestService envelope validation", () => {
  it("stores validated canonical envelopes", async () => {
    const service = new AnalyticsIngestService();

    await service.ingest({
      eventName: "license.granted",
      payload: { artistId: "artist-1" },
    });

    expect((await service.listEvents())[0]).toEqual(
      expect.objectContaining({
        eventName: "license.granted",
        eventVersion: 1,
        privacyTier: "pseudonymous",
        payload: { artistId: "artist-1" },
      }),
    );
  });

  it("fails invalid events with BadRequestException", async () => {
    const service = new AnalyticsIngestService();

    await expect(
      service.ingest({
        eventName: "bad event",
        payload: {},
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
