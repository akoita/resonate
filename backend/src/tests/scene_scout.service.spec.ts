import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import {
  aggregateSceneScoutEvents,
  sceneScoutMeetsAudienceThreshold,
  sceneScoutMeetsServingThreshold,
  sceneScoutMinimumAudience,
  type SceneScoutCityDemandRow,
} from "../modules/scene_scout/scene_scout.service";

type AggregateInput = Parameters<typeof aggregateSceneScoutEvents>[0];
type AggregateEvent = AggregateInput["events"][number];

const NOW = new Date("2026-10-03T12:00:00.000Z");
const TRACK = "scene-scout-track";
const RELEASE = "scene-scout-release";
const ARTIST = "scene-scout-artist";
const CITY = {
  countryCode: "CA",
  citySlug: "montreal",
  source: "user_declared",
  precision: "city",
};

function event(input: {
  id: string;
  actorId: string;
  eventName: string;
  occurredAt: Date;
  consentBasis?: string;
  geo?: unknown;
  payload?: Record<string, unknown>;
}): AggregateEvent {
  return {
    eventId: input.id,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    producer: "playback-service",
    actorId: input.actorId,
    sessionId: null,
    consentBasis: input.consentBasis ?? null,
    payload: { trackId: TRACK, ...(input.payload ?? {}) },
    envelope: { geo: input.geo ?? CITY },
  };
}

function identityContext(userIds: string[]): AggregateInput["identity"] {
  const canonicalActorIds = new Map<string, string>();
  const grantedConsentActors = new Set<string>();
  for (const userId of userIds) {
    const canonical = `user:${userId}`;
    canonicalActorIds.set(userId, canonical);
    canonicalActorIds.set(pseudonymousAnalyticsActorId(userId)!, canonical);
    grantedConsentActors.add(canonical);
  }
  canonicalActorIds.set("owner", "user:owner");
  canonicalActorIds.set(pseudonymousAnalyticsActorId("owner")!, "user:owner");
  grantedConsentActors.add("user:owner");
  return {
    canonicalActorIds,
    grantedConsentActors,
    tastePolicies: new Map(),
    ownerActorId: "user:owner",
  };
}

function aggregate(events: AggregateEvent[], users: string[]) {
  const catalogTracks = new Map([[TRACK, { releaseId: RELEASE, releaseTitle: "Northern Lights" }]]);
  return aggregateSceneScoutEvents({
    artistId: ARTIST,
    events,
    catalogTracks,
    identity: identityContext(users),
    canonicalPurchases: new Map(),
    now: NOW,
  });
}

describe("SceneScout city aggregation", () => {
  it("shares the journal resonance rule, counts exact seven-day boundaries, and deduplicates listener identities and saves", () => {
    const listeners = ["listener-a", "listener-b", "listener-c"];
    const events: AggregateEvent[] = [];
    for (const [index, userId] of listeners.entries()) {
      const actor = pseudonymousAnalyticsActorId(userId)!;
      const completionAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
      events.push(
        event({
          id: `complete-first-${index}`,
          actorId: actor,
          eventName: "playback.completed",
          occurredAt: completionAt,
          consentBasis: "consent",
          payload: { completionRatio: 0.95, artistId: "untrusted-artist", releaseId: "untrusted-release" },
        }),
        event({
          id: `complete-followup-${index}`,
          actorId: actor,
          eventName: "playback.completed",
          occurredAt: new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000),
          consentBasis: "consent",
          payload: { completionRatio: 0.95 },
        }),
        event({
          id: `save-hashed-${index}`,
          actorId: actor,
          eventName: "playlist.track_added",
          occurredAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
          consentBasis: "consent",
        }),
      );
    }
    // The same listener appears under their raw and pseudonymous identities.
    // The contribution still counts once because both aliases map to one key.
    events.push(
      event({
        id: "save-raw-duplicate",
        actorId: listeners[0],
        eventName: "library.saved",
        occurredAt: new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
      }),
      event({
        id: "owner-completion",
        actorId: pseudonymousAnalyticsActorId("owner")!,
        eventName: "playback.completed",
        occurredAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
        payload: { completionRatio: 1 },
      }),
      event({
        id: "owner-save",
        actorId: "owner",
        eventName: "playlist.track_added",
        occurredAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
      }),
      // Explicit event consent without a current grant is not enough.
      event({
        id: "missing-current-consent",
        actorId: pseudonymousAnalyticsActorId("listener-no-consent")!,
        eventName: "playlist.track_added",
        occurredAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
      }),
      event({
        id: "unknown-consent-basis",
        actorId: pseudonymousAnalyticsActorId(listeners[1])!,
        eventName: "playlist.track_added",
        occurredAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
        consentBasis: "unknown",
      }),
      event({
        id: "campaign-target-geo",
        actorId: pseudonymousAnalyticsActorId(listeners[0])!,
        eventName: "playlist.track_added",
        occurredAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
        geo: { ...CITY, source: "campaign_target" },
      }),
      event({
        id: "non-city-geo",
        actorId: pseudonymousAnalyticsActorId(listeners[0])!,
        eventName: "playlist.track_added",
        occurredAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
        geo: { countryCode: "CA", regionCode: "QC", precision: "region", source: "user_declared" },
      }),
      event({
        id: "malformed-geo",
        actorId: pseudonymousAnalyticsActorId(listeners[0])!,
        eventName: "playlist.track_added",
        occurredAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
        geo: { countryCode: { invalid: true }, citySlug: 4, precision: "city", source: "user_declared" },
      }),
      event({
        id: "future-save",
        actorId: pseudonymousAnalyticsActorId(listeners[0])!,
        eventName: "playlist.track_added",
        occurredAt: new Date(NOW.getTime() + 1),
        consentBasis: "consent",
      }),
    );

    const rows = aggregate(events, listeners);
    const week = rows.find((row) => row.windowDays === 7 && row.citySlug === "montreal");
    const month = rows.find((row) => row.windowDays === 28 && row.citySlug === "montreal");
    expect(week).toEqual(expect.objectContaining({
      releaseId: RELEASE,
      releaseTitle: "Northern Lights",
      resonantListeners: 3,
      saves: 3,
      uniqueListeners: 3,
      signalCount: 6,
    }));
    expect(month).toEqual(expect.objectContaining({ resonantListeners: 3, saves: 3, uniqueListeners: 3 }));
    expect(JSON.stringify(rows)).not.toContain("listener-a");
    expect(sceneScoutMeetsServingThreshold(week as SceneScoutCityDemandRow)).toBe(true);
  });

  it("keeps exact twenty-eight-day saves out of the seven-day window", () => {
    const listeners = ["listener-a", "listener-b", "listener-c"];
    const events = listeners.map((userId, index) =>
      event({
        id: `month-boundary-${index}`,
        actorId: pseudonymousAnalyticsActorId(userId)!,
        eventName: "library.saved",
        occurredAt: new Date(NOW.getTime() - 28 * 24 * 60 * 60 * 1000),
        consentBasis: "consent",
        geo: { ...CITY, citySlug: "quebec-city" },
      }),
    );
    const rows = aggregate(events, listeners);
    expect(rows).toEqual([
      expect.objectContaining({ windowDays: 28, citySlug: "quebec-city", saves: 3, uniqueListeners: 3 }),
    ]);
    expect(sceneScoutMeetsServingThreshold(rows[0])).toBe(false);
  });

  it("uses a strict positive integer privacy threshold", () => {
    const previous = process.env.DISCOVERY_MIN_AUDIENCE;
    try {
      process.env.DISCOVERY_MIN_AUDIENCE = "3.5";
      expect(sceneScoutMinimumAudience()).toBe(3);
      expect(sceneScoutMeetsAudienceThreshold(3)).toBe(true);
      expect(sceneScoutMeetsAudienceThreshold(2)).toBe(false);
      expect(sceneScoutMeetsAudienceThreshold(3.5)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
      else process.env.DISCOVERY_MIN_AUDIENCE = previous;
    }
  });
});
