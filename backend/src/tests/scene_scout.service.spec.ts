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

  it("counts confirmed pledge IDs while deduplicating people across signals and applying consent/reset gates", () => {
    const days = 24 * 60 * 60 * 1000;
    const identity = identityContext(["listener-a", "listener-b", "listener-c", "listener-reset"]);
    identity.tastePolicies.set("user:listener-reset", {
      resetAt: new Date(NOW.getTime() - 2 * days),
      agentPlaybackTrainingEnabled: true,
    });
    const pledges: NonNullable<AggregateInput["pledges"]> = [
      {
        pledgeId: "pledge-a1",
        userId: "listener-a",
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        declaredAt: new Date(NOW.getTime() - 8 * days),
        confirmedAt: new Date(NOW.getTime() - 7 * days),
      },
      {
        pledgeId: "pledge-a2",
        userId: "listener-a",
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        declaredAt: new Date(NOW.getTime() - 3 * days),
        confirmedAt: new Date(NOW.getTime() - 2 * days),
      },
      {
        pledgeId: "pledge-b1",
        userId: "listener-b",
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        declaredAt: new Date(NOW.getTime() - 9 * days),
        confirmedAt: new Date(NOW.getTime() - 8 * days),
      },
      {
        pledgeId: "pledge-c1",
        userId: "listener-c",
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        declaredAt: new Date(NOW.getTime() - 1 * days),
        confirmedAt: new Date(NOW.getTime() - 1 * days),
      },
      {
        pledgeId: "pledge-reset",
        userId: "listener-reset",
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        declaredAt: new Date(NOW.getTime() - 3 * days),
        confirmedAt: new Date(NOW.getTime() - 1 * days),
      },
      {
        pledgeId: "pledge-no-consent",
        userId: "listener-no-consent",
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        declaredAt: new Date(NOW.getTime() - 1 * days),
        confirmedAt: new Date(NOW.getTime() - 1 * days),
      },
      {
        pledgeId: "pledge-owner",
        userId: "owner",
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        declaredAt: new Date(NOW.getTime() - 1 * days),
        confirmedAt: new Date(NOW.getTime() - 1 * days),
      },
    ];
    const rows = aggregateSceneScoutEvents({
      artistId: ARTIST,
      events: [],
      pledges,
      catalogTracks: new Map([[TRACK, { releaseId: RELEASE, releaseTitle: "Northern Lights" }]]),
      identity,
      canonicalPurchases: new Map(),
      now: NOW,
    });
    const week = rows.find((row) => row.windowDays === 7);
    const month = rows.find((row) => row.windowDays === 28);
    expect(week).toEqual(expect.objectContaining({ uniqueListeners: 2, pledges: 3, signalCount: 3 }));
    expect(month).toEqual(expect.objectContaining({ uniqueListeners: 3, pledges: 4, signalCount: 4 }));
    expect(JSON.stringify(rows)).not.toContain("pledge-a1");
    expect(JSON.stringify(rows)).not.toContain("listener-a");
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

describe("SceneScout follow demand (#1968)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const FOLLOWED_AT = new Date(NOW.getTime() - 3 * DAY);

  function followEvent(input: {
    id: string;
    userId: string;
    occurredAt?: Date;
    consentBasis?: string | null;
    geo?: unknown;
    payload?: Record<string, unknown>;
  }): AggregateEvent {
    return {
      ...event({
        id: input.id,
        actorId: pseudonymousAnalyticsActorId(input.userId)!,
        eventName: "artist.followed",
        occurredAt: input.occurredAt ?? FOLLOWED_AT,
        consentBasis: input.consentBasis === null ? undefined : input.consentBasis ?? "consent",
        geo: input.geo,
      }),
      // Follow events are artist-scoped and carry no trackId unless the listener was on a track.
      payload: { artistId: ARTIST, releaseId: RELEASE, ...(input.payload ?? {}) },
    };
  }

  function aggregateFollows(
    events: AggregateEvent[],
    users: string[],
    active: Record<string, Date>,
    tastePolicies: AggregateInput["identity"]["tastePolicies"] = new Map(),
  ) {
    const identity = { ...identityContext(users), tastePolicies };
    return aggregateSceneScoutEvents({
      artistId: ARTIST,
      events,
      catalogTracks: new Map([[TRACK, { releaseId: RELEASE, releaseTitle: "Northern Lights" }]]),
      identity,
      canonicalPurchases: new Map(),
      activeFollows: new Map(Object.entries(active).map(([userId, at]) => [`user:${userId}`, at])),
      now: NOW,
    });
  }

  it("counts an active, consented follow once per listener and release without making it a resonance signal", () => {
    const rows = aggregateFollows(
      [
        followEvent({ id: "a-release", userId: "listener-a" }),
        // The same person following again from another page is still one contribution.
        followEvent({ id: "a-track", userId: "listener-a", payload: { releaseId: undefined, trackId: TRACK } }),
        followEvent({ id: "b", userId: "listener-b" }),
        followEvent({ id: "c", userId: "listener-c", occurredAt: new Date(NOW.getTime() - 27 * DAY) }),
      ],
      ["listener-a", "listener-b", "listener-c"],
      { "listener-a": FOLLOWED_AT, "listener-b": FOLLOWED_AT, "listener-c": new Date(NOW.getTime() - 27 * DAY) },
    );
    const week = rows.find((row) => row.windowDays === 7)!;
    const month = rows.find((row) => row.windowDays === 28)!;
    expect(week).toEqual(expect.objectContaining({
      follows: 2, uniqueListeners: 2, resonantListeners: 0, saves: 0, signalCount: 2,
    }));
    expect(month).toEqual(expect.objectContaining({ follows: 3, uniqueListeners: 3, signalCount: 3 }));
    expect(JSON.stringify(rows)).not.toContain("listener-a");
  });

  it("ignores follows that are not active, consented, local, in this catalog, or after a taste reset", () => {
    const users = ["listener-a", "listener-b", "listener-c", "listener-d", "listener-e", "listener-f", "listener-g"];
    const active = Object.fromEntries(users.map((userId) => [userId, FOLLOWED_AT]));
    const rows = aggregateFollows(
      [
        followEvent({ id: "ok", userId: "listener-a" }),
        // Unfollowed: no active row, so the historical event is not demand.
        followEvent({ id: "unfollowed", userId: "listener-z" }),
        followEvent({ id: "no-basis", userId: "listener-b", consentBasis: null }),
        followEvent({ id: "other-artist", userId: "listener-c", payload: { artistId: "someone-else" } }),
        followEvent({ id: "other-release", userId: "listener-d", payload: { releaseId: "foreign-release" } }),
        followEvent({ id: "no-release", userId: "listener-e", payload: { releaseId: undefined } }),
        followEvent({ id: "campaign-geo", userId: "listener-f", geo: { ...CITY, source: "campaign_target" } }),
        followEvent({ id: "reset", userId: "listener-g" }),
        followEvent({ id: "owner", userId: "owner" }),
      ],
      [...users, "listener-z"],
      { ...active, owner: FOLLOWED_AT },
      new Map([["user:listener-g", { resetAt: new Date(FOLLOWED_AT.getTime() + 1000), agentPlaybackTrainingEnabled: true }]]),
    );
    expect(rows.find((row) => row.windowDays === 7)).toEqual(
      expect.objectContaining({ follows: 1, uniqueListeners: 1, signalCount: 1 }),
    );
  });

  it("drops an event that predates the current follow of the listener, allowing only clock skew", () => {
    const refollowedAt = new Date(NOW.getTime() - DAY);
    const rows = aggregateFollows(
      [
        // Consented follow, later unfollowed; the current follow was made without consent.
        followEvent({ id: "stale", userId: "listener-a", occurredAt: new Date(NOW.getTime() - 3 * DAY) }),
        followEvent({ id: "skewed", userId: "listener-b", occurredAt: new Date(refollowedAt.getTime() - 5_000) }),
      ],
      ["listener-a", "listener-b"],
      { "listener-a": refollowedAt, "listener-b": refollowedAt },
    );
    expect(rows.find((row) => row.windowDays === 7)).toEqual(
      expect.objectContaining({ follows: 1, uniqueListeners: 1 }),
    );
  });

  it("counts nothing when the active-follow set is not supplied", () => {
    const rows = aggregateSceneScoutEvents({
      artistId: ARTIST,
      events: [followEvent({ id: "a", userId: "listener-a" })],
      catalogTracks: new Map([[TRACK, { releaseId: RELEASE, releaseTitle: "Northern Lights" }]]),
      identity: identityContext(["listener-a"]),
      canonicalPurchases: new Map(),
      now: NOW,
    });
    expect(rows).toEqual([]);
  });
});
