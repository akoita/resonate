import {
  audienceActorId,
  discoveryPopularityConfigFromEnv,
  eventHasTrustedPopularityMetadata,
  linearPopularityDecay,
  scorePopularitySignals,
} from "../modules/catalog/discovery-popularity.math";

describe("discovery popularity math and trust contract", () => {
  const now = new Date("2026-10-03T12:00:00.000Z");

  it("weights completed plays, saves, and deduplicated settled purchases with linear decay", () => {
    const contribution = scorePopularitySignals(
      [
        { kind: "play", occurredAt: new Date("2026-10-03T11:00:00.000Z"), completionRatio: 0.5 },
        { kind: "save", occurredAt: new Date("2026-10-03T11:00:00.000Z") },
        { kind: "purchase", occurredAt: new Date("2026-10-03T11:00:00.000Z"), purchaseId: "p1" },
        { kind: "purchase", occurredAt: new Date("2026-10-03T11:00:00.000Z"), purchaseId: "p1" },
      ],
      "24h",
      now,
    );

    expect(contribution).toEqual({ plays: 1, saves: 1, purchases: 1, score: 7.1875 });
    expect(linearPopularityDecay(new Date("2026-10-02T12:00:00.000Z"), now, "24h")).toBe(0.1);
  });

  it("accepts only canonical pseudonymous actors and the approved legal bases", () => {
    const trusted = {
      eventName: "playback.completed",
      privacyTier: "pseudonymous",
      actorId: "user_0123456789abcdef0123456789abcdef",
      consentBasis: "consent",
      payload: { selfEngagement: false, aiDisclosureLevel: "PARTLY" },
    };
    expect(eventHasTrustedPopularityMetadata(trusted)).toBe(true);
    expect(audienceActorId("user_0123456789abcdef0123456789abcdef")).toBe(trusted.actorId);
    expect(audienceActorId("anonymous")).toBeNull();
    expect(eventHasTrustedPopularityMetadata({ ...trusted, consentBasis: "platform_analytics:v1" })).toBe(false);
    expect(eventHasTrustedPopularityMetadata({ ...trusted, actorId: "user_some-session" })).toBe(false);
    expect(eventHasTrustedPopularityMetadata({ ...trusted, payload: { selfEngagement: true, aiDisclosureLevel: "NONE" } })).toBe(false);
    expect(eventHasTrustedPopularityMetadata({ ...trusted, payload: { selfEngagement: false } })).toBe(false);
    expect(eventHasTrustedPopularityMetadata({ ...trusted, payload: { selfEngagement: false, aiDisclosureLevel: "ALL" } })).toBe(false);
  });

  it("allows contract bases only for canonical settled-purchase event names", () => {
    const purchase = {
      eventName: "commerce.settled",
      privacyTier: "pseudonymous",
      actorId: "user_0123456789abcdef0123456789abcdef",
      consentBasis: "performance_of_contract",
      payload: { selfEngagement: false, aiDisclosureLevel: "NONE" },
    };
    expect(eventHasTrustedPopularityMetadata(purchase)).toBe(true);
    expect(eventHasTrustedPopularityMetadata({ ...purchase, eventName: "track.downloaded" })).toBe(false);
    expect(eventHasTrustedPopularityMetadata({ ...purchase, consentBasis: "consent" })).toBe(false);
  });

  it("keeps a zero refresh cadence disabled and rejects malformed integer configuration", () => {
    expect(discoveryPopularityConfigFromEnv({ DISCOVERY_POPULARITY_REFRESH_MINUTES: "0" }).refreshIntervalMs).toBe(0);
    expect(discoveryPopularityConfigFromEnv({}).snapshotMaxAgeMinutes).toBe(120);
    expect(() => discoveryPopularityConfigFromEnv({ DISCOVERY_POPULARITY_REFRESH_MINUTES: "15minutes" })).toThrow();
    expect(() => discoveryPopularityConfigFromEnv({ DISCOVERY_POPULARITY_SNAPSHOT_MAX_AGE_MINUTES: "120x" })).toThrow();
  });
});
