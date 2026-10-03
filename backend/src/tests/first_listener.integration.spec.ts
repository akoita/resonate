import { PassThrough } from "stream";
import { prisma } from "../db/prisma";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { PersonalDataExportService } from "../modules/privacy/personal_data_export.service";
import { applyDiscoveryPolicy } from "../modules/recommendations/discovery-policy";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { FirstListenerDiscoveryService } from "../modules/recommendations/first_listener_discovery.service";
import { FirstListenerReceptionService } from "../modules/recommendations/first_listener_reception.service";

const TEST_PREFIX = `first_listener_${Date.now()}_`;
const DAY = 24 * 60 * 60 * 1_000;
const NOW = new Date("2026-09-01T12:00:00.000Z");

function id(value: string) {
  return `${TEST_PREFIX}${value}`;
}

async function createUser(value: string) {
  const userId = id(value);
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
  return userId;
}

async function createArtist(value: string, userId?: string | null) {
  const artistId = id(value);
  await prisma.artist.create({
    data: { id: artistId, userId: userId ?? null, displayName: value },
  });
  return artistId;
}

async function createRelease(input: {
  value: string;
  artistId: string;
  createdAt: Date;
  releaseDate?: Date | null;
  status?: string;
  withdrawnAt?: Date | null;
  rightsRoute?: string | null;
  managementOwnerUserId?: string | null;
}) {
  const releaseId = id(input.value);
  await prisma.release.create({
    data: {
      id: releaseId,
      artistId: input.artistId,
      title: input.value,
      status: input.status ?? "ready",
      createdAt: input.createdAt,
      releaseDate: input.releaseDate ?? null,
      withdrawnAt: input.withdrawnAt ?? null,
      rightsRoute: input.rightsRoute ?? null,
      managementOwnerUserId: input.managementOwnerUserId ?? null,
    },
  });
  return releaseId;
}

async function createTrack(input: {
  value: string;
  releaseId: string;
  explicit?: boolean;
  processingStatus?: string;
  contentStatus?: string;
  aiDisclosureLevel?: "UNDECLARED" | "NONE" | "PARTLY" | "ALL";
}) {
  const trackId = id(input.value);
  await prisma.track.create({
    data: {
      id: trackId,
      releaseId: input.releaseId,
      title: input.value,
      position: 1,
      explicit: input.explicit ?? false,
      processingStatus: input.processingStatus ?? "complete",
      contentStatus: input.contentStatus ?? "clean",
      aiDisclosureLevel: input.aiDisclosureLevel ?? "NONE",
    },
  });
  return trackId;
}

async function grantAnalyticsConsent(userId: string, policyVersion = ANALYTICS_CONSENT_POLICY_VERSION) {
  await prisma.analyticsConsent.create({
    data: {
      userId,
      productAnalytics: true,
      policyVersion,
      decidedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  });
}

async function createPlaybackEvent(input: {
  value: string;
  actorUserId: string;
  trackId: string;
  occurredAt: Date;
  eventName: "playback.started" | "playback.completed" | "library.saved";
  consentBasis?: string | null;
  releaseId?: string;
  completionRatio?: number;
  agentOriginated?: boolean;
  rawActorId?: boolean;
}) {
  const actorId = input.rawActorId
    ? input.actorUserId.trim().toLowerCase()
    : pseudonymousAnalyticsActorId(input.actorUserId);
  if (!actorId) throw new Error("Integration test actor id did not hash");
  const payload = {
    trackId: input.trackId,
    // Reception must use Track.releaseId, even when the event claims another
    // release here.
    releaseId: input.releaseId,
    completionRatio: input.completionRatio,
    agentOriginated: input.agentOriginated,
  };
  const eventId = id(`event_${input.value}`);
  await prisma.analyticsEvent.create({
    data: {
      eventId,
      eventName: input.eventName,
      eventVersion: 1,
      occurredAt: input.occurredAt,
      receivedAt: new Date(input.occurredAt.getTime() + 1000),
      producer: "first-listener-integration-test",
      environment: "test",
      privacyTier: "pseudonymous",
      actorId,
      consentBasis: input.consentBasis === undefined ? "consent" : input.consentBasis,
      payload,
      envelope: { eventId, eventName: input.eventName, payload },
    },
  });
}

async function createHeardSet(input: {
  listenerId: string;
  trackId: string;
  releaseId: string;
  value: string;
  placementAt: Date;
  eventAt: Date;
  save?: boolean;
  fullPlay?: boolean;
}) {
  await prisma.firstListenerExposure.create({
    data: {
      id: id(`exposure_${input.value}_${input.releaseId}`),
      userId: input.listenerId,
      releaseId: input.releaseId,
      placedAt: input.placementAt,
    },
  });
  await createPlaybackEvent({
    value: `${input.value}_started_${input.releaseId}`,
    actorUserId: input.listenerId,
    trackId: input.trackId,
    occurredAt: input.eventAt,
    eventName: "playback.started",
    releaseId: input.releaseId,
  });
  if (input.fullPlay) {
    await createPlaybackEvent({
      value: `${input.value}_completed_${input.releaseId}`,
      actorUserId: input.listenerId,
      trackId: input.trackId,
      occurredAt: new Date(input.eventAt.getTime() + 10_000),
      eventName: "playback.completed",
      releaseId: input.releaseId,
      completionRatio: 0.95,
    });
  }
  if (input.save) {
    await createPlaybackEvent({
      value: `${input.value}_saved_${input.releaseId}`,
      actorUserId: input.listenerId,
      trackId: input.trackId,
      occurredAt: new Date(input.eventAt.getTime() + 20_000),
      eventName: "library.saved",
      releaseId: input.releaseId,
    });
  }
}

describe("first-listener discovery and reception (integration)", () => {
  const discovery = new FirstListenerDiscoveryService();

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: TEST_PREFIX } } });
    await prisma.firstListenerExposure.deleteMany({
      where: {
        OR: [
          { userId: { startsWith: TEST_PREFIX } },
          { releaseId: { startsWith: TEST_PREFIX } },
        ],
      },
    });
    await prisma.agentSignal.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.curatorReputation.deleteMany({
      where: { walletAddress: { startsWith: TEST_PREFIX.toLowerCase() } },
    });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it("returns only fresh public playable releases and requires verified-human taste fit", async () => {
    const listener = await createUser("eligibility_listener");
    const creator = await createUser("eligibility_creator");
    const owner = await createUser("eligibility_owner");
    const artistId = await createArtist("eligibility_artist", creator);
    await prisma.curatorReputation.create({
      data: {
        walletAddress: creator.toLowerCase(),
        humanVerificationStatus: "human_verified",
        humanVerifiedAt: NOW,
      },
    });

    const exactBoundary = new Date(NOW.getTime() - 7 * DAY);
    const fresh = await createRelease({
      value: "fresh_boundary_release",
      artistId,
      createdAt: exactBoundary,
      releaseDate: NOW,
    });
    const freshTrack = await createTrack({ value: "fresh_boundary_track", releaseId: fresh });
    await createRelease({
      value: "stale_release",
      artistId,
      createdAt: new Date(exactBoundary.getTime() - 1),
    }).then((releaseId) => createTrack({ value: "stale_track", releaseId }));
    await createRelease({
      value: "future_created_release",
      artistId,
      createdAt: new Date(NOW.getTime() + 1),
    }).then((releaseId) => createTrack({ value: "future_created_track", releaseId }));
    await createRelease({
      value: "future_release_date_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
      releaseDate: new Date(NOW.getTime() + 1),
    }).then((releaseId) => createTrack({ value: "future_release_date_track", releaseId }));
    await createRelease({
      value: "unpublished_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
      status: "processing",
    }).then((releaseId) => createTrack({ value: "unpublished_track", releaseId }));
    await createRelease({
      value: "withdrawn_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
      withdrawnAt: new Date(NOW.getTime() - 1000),
    }).then((releaseId) => createTrack({ value: "withdrawn_track", releaseId }));
    await createRelease({
      value: "restricted_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
      rightsRoute: "BLOCKED",
    }).then((releaseId) => createTrack({ value: "restricted_track", releaseId }));
    const incomplete = await createRelease({
      value: "incomplete_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
    });
    await createTrack({ value: "incomplete_track", releaseId: incomplete, processingStatus: "pending" });
    const allAi = await createRelease({
      value: "all_ai_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
    });
    await createTrack({ value: "all_ai_track", releaseId: allAi, aiDisclosureLevel: "ALL" });
    const explicitRelease = await createRelease({
      value: "explicit_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
    });
    await createTrack({ value: "explicit_track", releaseId: explicitRelease, explicit: true });
    const ownerRelease = await createRelease({
      value: "owner_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
      managementOwnerUserId: owner,
    });
    const ownerTrack = await createTrack({ value: "owner_track", releaseId: ownerRelease });

    const candidates = await discovery.getFreshCandidates({ userId: listener, allowExplicit: false, now: NOW });
    expect(candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining([freshTrack, ownerTrack]),
    );
    expect(candidates).toHaveLength(2);
    expect(JSON.stringify(candidates)).not.toContain(owner);
    expect(candidates[0].release).not.toHaveProperty("managementOwnerUserId");
    await expect(
      discovery.getFreshCandidates({ userId: creator, allowExplicit: false, now: NOW }),
    ).resolves.toEqual([]);
    const ownerCandidates = await discovery.getFreshCandidates({ userId: owner, allowExplicit: false, now: NOW });
    expect(ownerCandidates.map((candidate) => candidate.id)).not.toContain(ownerTrack);

    const context = await new DiscoveryPolicyContextService().loadContext(listener, [artistId]);
    const ranked = {
      id: freshTrack,
      title: "fresh boundary track",
      score: 10,
      artistId,
      releaseId: fresh,
      firstListenerEligible: true,
      aiDisclosureLevel: "NONE",
      signals: [{ label: "taste_match", weight: 1, reason: "matches listener taste" }],
      explanation: ["Selected vibe match"],
      reasonCode: "taste_match" as const,
      recentlyPlayed: false,
    };
    const tasteMatched = applyDiscoveryPolicy([ranked], {
      limit: 1,
      verifiedHumanArtistIds: context.verifiedHumanArtistIds,
      playedArtistIds: context.playedArtistIds,
    });
    expect(context.verifiedHumanArtistIds.has(artistId)).toBe(true);
    expect(tasteMatched.items[0]?.reasonCode).toBe("discovery_pick");

    const noTaste = applyDiscoveryPolicy([{ ...ranked, signals: [] }], {
      limit: 1,
      verifiedHumanArtistIds: context.verifiedHumanArtistIds,
      playedArtistIds: context.playedArtistIds,
    });
    expect(noTaste.items[0]?.reasonCode).not.toBe("discovery_pick");

    const placement = { trackId: freshTrack, releaseId: fresh };
    await expect(discovery.reservePlacements(listener, [placement], { now: NOW })).resolves.toEqual(
      new Set([fresh]),
    );
    await expect(discovery.reservePlacements(listener, [placement], { now: NOW })).resolves.toEqual(
      new Set(),
    );
    await expect(
      prisma.firstListenerExposure.count({ where: { userId: listener, releaseId: fresh } }),
    ).resolves.toBe(1);
  });

  it("serializes concurrent reservations at the 1,000-placement release cap", async () => {
    const creator = await createUser("cap_creator");
    const artistId = await createArtist("cap_artist", creator);
    await prisma.curatorReputation.create({
      data: {
        walletAddress: creator.toLowerCase(),
        humanVerificationStatus: "human_verified",
        humanVerifiedAt: NOW,
      },
    });
    const releaseId = await createRelease({
      value: "cap_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
    });
    const trackId = await createTrack({ value: "cap_track", releaseId });
    const seededUsers = Array.from({ length: 999 }, (_, index) => id(`cap_listener_${index}`));
    await prisma.user.createMany({
      data: seededUsers.map((userId) => ({ id: userId, email: `${userId}@test.resonate` })),
    });
    await prisma.firstListenerExposure.createMany({
      data: seededUsers.map((userId, index) => ({
        id: id(`cap_exposure_${index}`),
        userId,
        releaseId,
        placedAt: new Date(NOW.getTime() - 1000),
      })),
    });
    const raceUsers = [await createUser("cap_racer_a"), await createUser("cap_racer_b")];
    const attempts = await Promise.all(
      raceUsers.map((userId) =>
        discovery.reservePlacements(userId, [{ trackId, releaseId }], { now: NOW }),
      ),
    );

    expect(attempts.filter((reserved) => reserved.has(releaseId))).toHaveLength(1);
    await expect(prisma.firstListenerExposure.count({ where: { releaseId } })).resolves.toBe(1000);
    await expect(
      prisma.release.findUnique({
        where: { id: releaseId },
        select: { firstListenerPlacementsUsed: true },
      }),
    ).resolves.toMatchObject({ firstListenerPlacementsUsed: 1000 });

    // The exposure rows are identity-linked and can be deleted on account
    // erasure. That must not replenish the anonymous release budget.
    await prisma.user.deleteMany({ where: { id: { in: [...seededUsers, ...raceUsers] } } });
    await expect(prisma.firstListenerExposure.count({ where: { releaseId } })).resolves.toBe(0);
    const afterErasure = await createUser("cap_after_erasure");
    await expect(
      discovery.reservePlacements(afterErasure, [{ trackId, releaseId }], { now: NOW }),
    ).resolves.toEqual(new Set());
    await expect(
      prisma.release.findUnique({
        where: { id: releaseId },
        select: { firstListenerPlacementsUsed: true },
      }),
    ).resolves.toMatchObject({ firstListenerPlacementsUsed: 1000 });
  });

  it("reports only actual, current-consent hearing after day seven without exposing listeners", async () => {
    const oldThreshold = process.env.DISCOVERY_MIN_AUDIENCE;
    const oldSalt = process.env.ANALYTICS_ACTOR_ID_SALT;
    process.env.DISCOVERY_MIN_AUDIENCE = "3";
    process.env.ANALYTICS_ACTOR_ID_SALT = "first-listener-integration-salt";
    try {
      const artistOwner = await createUser("reception_artist_owner");
      const managementOwner = await createUser("reception_management_owner");
      const artistId = await createArtist("reception_artist", artistOwner);
      const releaseOneCreated = new Date(NOW.getTime() - 9 * DAY);
      const releaseOne = await createRelease({
        value: "reception_release_one",
        artistId,
        createdAt: releaseOneCreated,
        managementOwnerUserId: managementOwner,
      });
      const trackOne = await createTrack({ value: "reception_track_one", releaseId: releaseOne });
      const releaseTwoCreated = new Date(NOW.getTime() - 8 * DAY);
      const releaseTwo = await createRelease({
        value: "reception_release_two",
        artistId,
        createdAt: releaseTwoCreated,
      });
      const trackTwo = await createTrack({ value: "reception_track_two", releaseId: releaseTwo });
      const exactDaySeven = await createRelease({
        value: "reception_exact_day_seven",
        artistId,
        createdAt: new Date(NOW.getTime() - 7 * DAY),
      });
      const underDaySeven = await createRelease({
        value: "reception_under_day_seven",
        artistId,
        createdAt: new Date(NOW.getTime() - 7 * DAY + 1),
      });
      await createTrack({ value: "reception_exact_day_seven_track", releaseId: exactDaySeven });
      await createTrack({ value: "reception_under_day_seven_track", releaseId: underDaySeven });
      const listeners = await Promise.all([
        createUser("reception_listener_a"),
        createUser("reception_listener_b"),
        createUser("reception_listener_c"),
      ]);
      for (const listener of listeners) await grantAnalyticsConsent(listener);
      const placementOne = new Date(releaseOneCreated.getTime() + DAY);
      const heardAtOne = new Date(releaseOneCreated.getTime() + 2 * DAY);
      for (let index = 0; index < listeners.length; index += 1) {
        await createHeardSet({
          listenerId: listeners[index],
          trackId: trackOne,
          releaseId: releaseOne,
          value: `release_one_listener_${index}`,
          placementAt: placementOne,
          eventAt: heardAtOne,
          fullPlay: true,
          save: index < 2,
        });
      }
      // Some legacy bridge events store a raw user id. It must map to the same
      // canonical listener as hashed events and never increase the audience.
      await createPlaybackEvent({
        value: "release_one_listener_a_raw_actor",
        actorUserId: listeners[0],
        trackId: trackOne,
        occurredAt: heardAtOne,
        eventName: "playback.started",
        releaseId: releaseOne,
        rawActorId: true,
      });
      const placementTwo = new Date(releaseTwoCreated.getTime() + DAY);
      const heardAtTwo = new Date(releaseTwoCreated.getTime() + 2 * DAY);
      for (let index = 0; index < listeners.length; index += 1) {
        await createHeardSet({
          listenerId: listeners[index],
          trackId: trackTwo,
          releaseId: releaseTwo,
          value: `release_two_listener_${index}`,
          placementAt: placementTwo,
          eventAt: heardAtTwo,
          fullPlay: true,
          save: true,
        });
      }

      const noConsent = await createUser("reception_no_consent");
      await createHeardSet({
        listenerId: noConsent,
        trackId: trackOne,
        releaseId: releaseOne,
        value: "no_consent",
        placementAt: placementOne,
        eventAt: heardAtOne,
        fullPlay: true,
      });
      const staleConsent = await createUser("reception_stale_consent");
      await grantAnalyticsConsent(staleConsent, "analytics-consent:old-policy");
      await createHeardSet({
        listenerId: staleConsent,
        trackId: trackOne,
        releaseId: releaseOne,
        value: "stale_consent",
        placementAt: placementOne,
        eventAt: heardAtOne,
        fullPlay: true,
      });

      const noEventBasis = await createUser("reception_no_event_basis");
      await grantAnalyticsConsent(noEventBasis);
      await prisma.firstListenerExposure.create({
        data: {
          id: id("exposure_no_event_basis"),
          userId: noEventBasis,
          releaseId: releaseOne,
          placedAt: placementOne,
        },
      });
      await createPlaybackEvent({
        value: "no_event_basis_started",
        actorUserId: noEventBasis,
        trackId: trackOne,
        occurredAt: heardAtOne,
        eventName: "playback.started",
        releaseId: releaseOne,
        consentBasis: null,
      });

      const forgedRelease = await createUser("reception_forged_release");
      await grantAnalyticsConsent(forgedRelease);
      await prisma.firstListenerExposure.create({
        data: {
          id: id("exposure_forged_release"),
          userId: forgedRelease,
          releaseId: releaseOne,
          placedAt: placementOne,
        },
      });
      await createPlaybackEvent({
        value: "forged_release_started",
        actorUserId: forgedRelease,
        trackId: trackTwo,
        occurredAt: heardAtOne,
        eventName: "playback.started",
        releaseId: releaseOne,
      });

      const futureHeard = await createUser("reception_future_heard");
      await grantAnalyticsConsent(futureHeard);
      const afterFirstWeek = new Date(releaseOneCreated.getTime() + 7 * DAY + 1000);
      await prisma.firstListenerExposure.create({
        data: {
          id: id("exposure_future_heard"),
          userId: futureHeard,
          releaseId: releaseOne,
          placedAt: placementOne,
        },
      });
      await createPlaybackEvent({
        value: "future_heard_started",
        actorUserId: futureHeard,
        trackId: trackOne,
        occurredAt: afterFirstWeek,
        eventName: "playback.started",
        releaseId: releaseOne,
      });

      const agentOptOut = await createUser("reception_agent_opt_out");
      await grantAnalyticsConsent(agentOptOut);
      await prisma.listenerTasteMemorySettings.create({
        data: { userId: agentOptOut, agentPlaybackTrainingEnabled: false },
      });
      await prisma.firstListenerExposure.create({
        data: {
          id: id("exposure_agent_opt_out"),
          userId: agentOptOut,
          releaseId: releaseOne,
          placedAt: placementOne,
        },
      });
      await createPlaybackEvent({
        value: "agent_opt_out_started",
        actorUserId: agentOptOut,
        trackId: trackOne,
        occurredAt: heardAtOne,
        eventName: "playback.started",
        releaseId: releaseOne,
        agentOriginated: true,
      });

      const tasteReset = await createUser("reception_taste_reset");
      await grantAnalyticsConsent(tasteReset);
      await prisma.listenerTasteMemorySettings.create({
        data: { userId: tasteReset, resetAt: new Date(heardAtOne.getTime() + 60_000) },
      });
      await prisma.firstListenerExposure.create({
        data: {
          id: id("exposure_taste_reset"),
          userId: tasteReset,
          releaseId: releaseOne,
          placedAt: placementOne,
        },
      });
      await createPlaybackEvent({
        value: "taste_reset_started",
        actorUserId: tasteReset,
        trackId: trackOne,
        occurredAt: heardAtOne,
        eventName: "playback.started",
        releaseId: releaseOne,
      });

      for (const [value, ownerId] of [
        ["artist_owner", artistOwner],
        ["management_owner", managementOwner],
      ] as const) {
        await grantAnalyticsConsent(ownerId);
        await createHeardSet({
          listenerId: ownerId,
          trackId: trackOne,
          releaseId: releaseOne,
          value,
          placementAt: placementOne,
          eventAt: heardAtOne,
          fullPlay: true,
          save: true,
        });
      }

      const reception = await new FirstListenerReceptionService().getArtistReception(artistId, { now: NOW });
      expect(reception.available).toBe(true);
      expect(reception.minimumAudience).toBe(3);
      expect(reception.releases).toHaveLength(3);
      const byId = new Map(reception.releases.map((release) => [release.releaseId, release]));
      expect(byId.get(releaseOne)).toMatchObject({ heard: 3, fullPlays: 3, saves: null });
      expect(byId.get(releaseTwo)).toMatchObject({ heard: 3, fullPlays: 3, saves: 3 });
      expect(byId.get(exactDaySeven)).toMatchObject({ heard: null, fullPlays: null, saves: null });
      expect(byId.has(underDaySeven)).toBe(false);
      expect(JSON.stringify(reception)).not.toContain(listeners[0]);
      expect(JSON.stringify(reception)).not.toContain("actorId");
    } finally {
      if (oldThreshold === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
      else process.env.DISCOVERY_MIN_AUDIENCE = oldThreshold;
      if (oldSalt === undefined) delete process.env.ANALYTICS_ACTOR_ID_SALT;
      else process.env.ANALYTICS_ACTOR_ID_SALT = oldSalt;
    }
  });

  it("exports only the requesting listener's own exposure rows", async () => {
    const listener = await createUser("export_listener");
    const otherListener = await createUser("export_other_listener");
    const artistId = await createArtist("export_artist");
    const releaseId = await createRelease({
      value: "export_release",
      artistId,
      createdAt: new Date(NOW.getTime() - DAY),
    });
    const ownExposureId = id("export_own_exposure");
    const otherExposureId = id("export_other_exposure");
    await prisma.firstListenerExposure.createMany({
      data: [
        { id: ownExposureId, userId: listener, releaseId, placedAt: NOW },
        { id: otherExposureId, userId: otherListener, releaseId, placedAt: NOW },
      ],
    });

    const prepared = await new PersonalDataExportService(new PersonalDataResolverService()).prepare(listener);
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    const finished = new Promise<void>((resolve) => output.on("end", resolve));
    await prepared.writeTo(output);
    output.end();
    await finished;
    const document = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      data: Record<string, Array<{ id: string }>>;
    };

    expect(document.data.FirstListenerExposure.map((row) => row.id)).toEqual([ownExposureId]);
    expect(document.data.FirstListenerExposure.map((row) => row.id)).not.toContain(otherExposureId);
  });

  it("fails closed when the bounded playback-ledger read exceeds its cap", async () => {
    const listener = await createUser("ledger_cap_listener");
    await grantAnalyticsConsent(listener);
    const artistId = await createArtist("ledger_cap_artist");
    const releaseCreatedAt = new Date(NOW.getTime() - 9 * DAY);
    const releaseId = await createRelease({
      value: "ledger_cap_release",
      artistId,
      createdAt: releaseCreatedAt,
    });
    const trackId = await createTrack({ value: "ledger_cap_track", releaseId });
    const placedAt = new Date(releaseCreatedAt.getTime() + DAY);
    const eventAt = new Date(releaseCreatedAt.getTime() + 2 * DAY);
    await prisma.firstListenerExposure.create({
      data: {
        id: id("ledger_cap_exposure"),
        userId: listener,
        releaseId,
        placedAt,
      },
    });
    const actorId = pseudonymousAnalyticsActorId(listener);
    if (!actorId) throw new Error("Integration test actor id did not hash");
    const totalEvents = 10_001;
    for (let offset = 0; offset < totalEvents; offset += 1000) {
      const batch = Array.from(
        { length: Math.min(1000, totalEvents - offset) },
        (_unused, index) => {
          const eventId = id(`ledger_cap_event_${offset + index}`);
          const payload = { trackId, releaseId };
          return {
            eventId,
            eventName: "playback.started",
            eventVersion: 1,
            occurredAt: eventAt,
            receivedAt: eventAt,
            producer: "first-listener-integration-test",
            environment: "test",
            privacyTier: "pseudonymous",
            actorId,
            consentBasis: "consent",
            payload,
            envelope: { eventId, eventName: "playback.started", payload },
          };
        },
      );
      await prisma.analyticsEvent.createMany({ data: batch });
    }

    const reception = await new FirstListenerReceptionService().getArtistReception(artistId, { now: NOW });
    expect(reception).toMatchObject({ available: false, releases: [] });
  });
});
