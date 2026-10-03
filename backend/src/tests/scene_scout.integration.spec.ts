import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  ANALYTICS_CONSENT_POLICY_VERSION,
} from "../modules/analytics/analytics_consent.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import {
  SCENE_SCOUT_READ_CAP,
  SceneScoutService,
} from "../modules/scene_scout/scene_scout.service";

const TEST_PREFIX = `scout_${Date.now()}_`;
const OWNER = `${TEST_PREFIX}owner`;
const LISTENER_A = `${TEST_PREFIX}listener_a`;
const LISTENER_B = `${TEST_PREFIX}listener_b`;
const LISTENER_C = `${TEST_PREFIX}listener_c`;
const LISTENER_MISSING_CONSENT = `${TEST_PREFIX}listener_missing_consent`;
const LISTENER_DENIED = `${TEST_PREFIX}listener_denied`;
const LISTENER_STALE = `${TEST_PREFIX}listener_stale`;
const LISTENER_RESET = `${TEST_PREFIX}listener_reset`;
const LISTENER_AGENT = `${TEST_PREFIX}listener_agent`;
const BUYER_WITHOUT_ANALYTICS_CONSENT = `${TEST_PREFIX}buyer_without_consent`;
const BUYER_WALLET = "0x00000000000000000000000000000000000000b1";
const OWNER_WALLET = "0x00000000000000000000000000000000000000b2";
const UNKNOWN_WALLET = "0x00000000000000000000000000000000000000b3";
const ARTIST = `${TEST_PREFIX}artist`;
const RELEASE = `${TEST_PREFIX}release`;
const TRACK = `${TEST_PREFIX}track`;
const SMALL_RELEASE = `${TEST_PREFIX}small_release`;
const SMALL_TRACK = `${TEST_PREFIX}small_track`;
const FOREIGN_ARTIST = `${TEST_PREFIX}foreign_artist`;
const FOREIGN_RELEASE = `${TEST_PREFIX}foreign_release`;
const FOREIGN_TRACK = `${TEST_PREFIX}foreign_track`;
const CAP_OWNER = `${TEST_PREFIX}cap_owner`;
const CAP_ARTIST = `${TEST_PREFIX}cap_artist`;
const CAP_RELEASE = `${TEST_PREFIX}cap_release`;
const CAP_TRACK = `${TEST_PREFIX}cap_track`;
const NOW = new Date("2026-10-03T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const CITY = {
  countryCode: "CA",
  citySlug: "montreal",
  source: "user_declared",
  precision: "city",
};

const service = new SceneScoutService();
let eventSeq = 0;
let previousAudienceFloor: string | undefined;

async function createUser(id: string) {
  await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
}

async function grantAnalyticsConsent(
  userId: string,
  productAnalytics = true,
  policyVersion = ANALYTICS_CONSENT_POLICY_VERSION,
) {
  await prisma.analyticsConsent.create({
    data: { userId, productAnalytics, policyVersion, decidedAt: new Date(NOW.getTime() - 60 * DAY_MS) },
  });
}

async function recordEvent(input: {
  eventName: string;
  actorId: string;
  occurredAt: Date;
  consentBasis?: string;
  trackId?: string;
  geo?: unknown;
  payload?: Record<string, unknown>;
  producer?: string;
}) {
  eventSeq += 1;
  return prisma.analyticsEvent.create({
    data: {
      eventId: `${TEST_PREFIX}event_${eventSeq}`,
      eventName: input.eventName,
      eventVersion: 1,
      occurredAt: input.occurredAt,
      receivedAt: NOW,
      producer: input.producer ?? (input.eventName === "x402.purchase" ? "x402-controller" : "playback-service"),
      environment: "test",
      privacyTier: "pseudonymous",
      actorId: input.actorId,
      sessionId: null,
      consentBasis: input.consentBasis ?? null,
      payload: {
        trackId: input.trackId ?? TRACK,
        artistId: "payload-artist-is-untrusted",
        releaseId: "payload-release-is-untrusted",
        ...(input.payload ?? {}),
      },
      envelope: input.geo === undefined ? { geo: CITY } : { geo: input.geo },
    },
  });
}

async function recordResonance(userId: string, citySlug = CITY.citySlug, source = "web_player") {
  const actorId = pseudonymousAnalyticsActorId(userId)!;
  const firstAt = new Date(NOW.getTime() - 7 * DAY_MS);
  const followAt = new Date(NOW.getTime() - 6 * DAY_MS);
  const saveAt = new Date(NOW.getTime() - 5 * DAY_MS);
  const geo = { ...CITY, citySlug };
  await recordEvent({
    eventName: "playback.completed",
    actorId,
    occurredAt: firstAt,
    consentBasis: "consent",
    geo,
    payload: { completionRatio: 0.95, source, agentOriginated: source === "agent_session" },
  });
  await recordEvent({
    eventName: "playback.completed",
    actorId,
    occurredAt: followAt,
    consentBasis: "consent",
    geo,
    payload: { completionRatio: 0.96, source, agentOriginated: source === "agent_session" },
  });
  await recordEvent({
    eventName: "playlist.track_added",
    actorId,
    occurredAt: saveAt,
    consentBasis: "consent",
    geo,
    payload: { source },
  });
}

async function createSettlement(input: {
  receiptId: string;
  stemId: string;
  trackId: string;
  status: string;
  payerAddress?: string;
  purchasedAt?: Date;
}) {
  await prisma.x402Settlement.create({
    data: {
      receiptId: input.receiptId,
      stemId: input.stemId,
      payerAddress: input.payerAddress ?? null,
      receipt: { type: "resonate.x402.purchase_receipt", receiptId: input.receiptId },
      status: input.status,
      paymentToken: "0x0000000000000000000000000000000000000001",
      paymentAssetSymbol: "USDC",
      paymentAssetDecimals: 6,
      settlementAmount: "1.00",
      settlementAmountUnits: "1000000",
      purchasedAt: input.purchasedAt ?? new Date(NOW.getTime() - 2 * DAY_MS),
    },
  });
  return input.trackId;
}

describe("SceneScoutService (integration)", () => {
  jest.setTimeout(120_000);

  beforeAll(async () => {
    previousAudienceFloor = process.env.DISCOVERY_MIN_AUDIENCE;
    process.env.DISCOVERY_MIN_AUDIENCE = "3";

    for (const userId of [
      OWNER,
      LISTENER_A,
      LISTENER_B,
      LISTENER_C,
      LISTENER_MISSING_CONSENT,
      LISTENER_DENIED,
      LISTENER_STALE,
      LISTENER_RESET,
      LISTENER_AGENT,
      BUYER_WITHOUT_ANALYTICS_CONSENT,
      CAP_OWNER,
    ]) {
      await createUser(userId);
    }

    await prisma.artist.create({ data: { id: ARTIST, userId: OWNER, displayName: "Scene Scout" } });
    await prisma.release.create({ data: { id: RELEASE, artistId: ARTIST, title: "Northern Lights", status: "ready" } });
    await prisma.track.create({ data: { id: TRACK, releaseId: RELEASE, title: "First Light", position: 1 } });
    await prisma.release.create({ data: { id: SMALL_RELEASE, artistId: ARTIST, title: "Small Audience", status: "ready" } });
    await prisma.track.create({ data: { id: SMALL_TRACK, releaseId: SMALL_RELEASE, title: "One Listener", position: 1 } });
    await prisma.artist.create({ data: { id: FOREIGN_ARTIST, displayName: "Other Artist" } });
    await prisma.release.create({ data: { id: FOREIGN_RELEASE, artistId: FOREIGN_ARTIST, title: "Other Release", status: "ready" } });
    await prisma.track.create({ data: { id: FOREIGN_TRACK, releaseId: FOREIGN_RELEASE, title: "Other Track", position: 1 } });
    await prisma.artist.create({ data: { id: CAP_ARTIST, userId: CAP_OWNER, displayName: "Capped Artist" } });
    await prisma.release.create({ data: { id: CAP_RELEASE, artistId: CAP_ARTIST, title: "Capped Release", status: "ready" } });
    await prisma.track.create({ data: { id: CAP_TRACK, releaseId: CAP_RELEASE, title: "Capped Track", position: 1 } });
    await prisma.wallet.create({
      data: { userId: BUYER_WITHOUT_ANALYTICS_CONSENT, address: BUYER_WALLET, chainId: 8453 },
    });
    await prisma.wallet.create({ data: { userId: OWNER, address: OWNER_WALLET, chainId: 8453 } });

    for (const userId of [OWNER, LISTENER_A, LISTENER_B, LISTENER_C, LISTENER_RESET, LISTENER_AGENT]) {
      await grantAnalyticsConsent(userId);
    }
    await grantAnalyticsConsent(LISTENER_DENIED, false);
    await grantAnalyticsConsent(LISTENER_STALE, true, "analytics-consent:old-policy");
    await prisma.listenerTasteMemorySettings.create({
      data: { userId: LISTENER_RESET, resetAt: new Date(NOW.getTime() - 1 * DAY_MS) },
    });
    await prisma.listenerTasteMemorySettings.create({
      data: { userId: LISTENER_AGENT, agentPlaybackTrainingEnabled: false },
    });

    for (const userId of [LISTENER_A, LISTENER_B, LISTENER_C]) {
      await recordResonance(userId);
      await recordEvent({
        eventName: "library.saved",
        actorId: pseudonymousAnalyticsActorId(userId)!,
        occurredAt: new Date(NOW.getTime() - 28 * DAY_MS),
        consentBasis: "consent",
        geo: { ...CITY, citySlug: "28-day-boundary" },
      });
    }
    // Duplicate a save under the raw identity form for listener A. It must
    // remain one audience member and one save contribution.
    await recordEvent({
      eventName: "library.saved",
      actorId: LISTENER_A,
      occurredAt: new Date(NOW.getTime() - 4 * DAY_MS),
      consentBasis: "consent",
    });
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() - 4 * DAY_MS),
      consentBasis: "consent",
    });

    await recordResonance(OWNER);
    await recordEvent({
      eventName: "library.saved",
      actorId: OWNER,
      occurredAt: new Date(NOW.getTime() - DAY_MS),
      consentBasis: "consent",
    });
    await recordResonance(LISTENER_MISSING_CONSENT);
    await recordResonance(LISTENER_DENIED);
    await recordResonance(LISTENER_STALE);
    await recordResonance(LISTENER_RESET, "reset-city");
    await recordResonance(LISTENER_AGENT, "agent-city", "agent_session");
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
      consentBasis: "unknown",
      geo: { ...CITY, citySlug: "unknown-basis-city" },
    });
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
      geo: { ...CITY, citySlug: "missing-basis-city" },
    });
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
      consentBasis: "consent",
      geo: { ...CITY, citySlug: "campaign-city", source: "campaign_target" },
    });
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
      consentBasis: "consent",
      geo: { countryCode: "CA", regionCode: "QC", precision: "region", source: "user_declared" },
    });
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
      consentBasis: "consent",
      geo: { countryCode: { malformed: true }, citySlug: 17, precision: "city", source: "user_declared" },
    });
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() + 1),
      consentBasis: "consent",
      geo: { ...CITY, citySlug: "future-city" },
    });
    await recordEvent({
      eventName: "playlist.track_added",
      actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
      occurredAt: new Date(NOW.getTime() - DAY_MS),
      consentBasis: "consent",
      trackId: FOREIGN_TRACK,
      payload: { artistId: ARTIST, releaseId: RELEASE },
      geo: { ...CITY, citySlug: "unowned-track-city" },
    });

    // A single listener can create events, but the privacy floor keeps the
    // small release out of both serving and persisted snapshots.
    for (const [suffix, eventName, at, extra] of [
      ["small-complete", "playback.completed", new Date(NOW.getTime() - 2 * DAY_MS), { completionRatio: 1 }],
      ["small-replay", "playback.completed", new Date(NOW.getTime() - DAY_MS), { completionRatio: 1 }],
      ["small-save", "playlist.track_added", new Date(NOW.getTime() - 1), {}],
    ] as const) {
      await recordEvent({
        eventName,
        actorId: pseudonymousAnalyticsActorId(LISTENER_A)!,
        occurredAt: at,
        consentBasis: "consent",
        trackId: SMALL_TRACK,
        payload: { ...extra, fixture: suffix },
      });
    }

    await prisma.stem.create({ data: { id: `${TEST_PREFIX}stem`, trackId: TRACK, type: "vocal", uri: "test://scene-scout/stem" } });
    await prisma.stem.create({ data: { id: `${TEST_PREFIX}foreign_stem`, trackId: FOREIGN_TRACK, type: "vocal", uri: "test://scene-scout/foreign" } });
    await createSettlement({ receiptId: `${TEST_PREFIX}receipt_valid`, stemId: `${TEST_PREFIX}stem`, trackId: TRACK, status: "download_granted", payerAddress: BUYER_WALLET });
    await createSettlement({ receiptId: `${TEST_PREFIX}receipt_refund`, stemId: `${TEST_PREFIX}stem`, trackId: TRACK, status: "refund_due", payerAddress: BUYER_WALLET });
    await createSettlement({ receiptId: `${TEST_PREFIX}receipt_wrong_track`, stemId: `${TEST_PREFIX}foreign_stem`, trackId: FOREIGN_TRACK, status: "download_granted", payerAddress: BUYER_WALLET });
    await createSettlement({ receiptId: `${TEST_PREFIX}receipt_owner`, stemId: `${TEST_PREFIX}stem`, trackId: TRACK, status: "download_granted", payerAddress: OWNER_WALLET });
    await createSettlement({ receiptId: `${TEST_PREFIX}receipt_unknown_wallet`, stemId: `${TEST_PREFIX}stem`, trackId: TRACK, status: "download_granted", payerAddress: UNKNOWN_WALLET });

    const purchaseBase = {
      actorId: pseudonymousAnalyticsActorId(BUYER_WALLET)!,
      occurredAt: new Date(NOW.getTime() - 2 * DAY_MS),
      consentBasis: "contract",
      payload: {
        receiptId: `${TEST_PREFIX}receipt_valid`,
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        paymentRail: "facilitator",
        settlementStatus: "download_granted",
      },
    };
    await recordEvent({ eventName: "x402.purchase", ...purchaseBase });
    await recordEvent({
      eventName: "x402.purchase",
      ...purchaseBase,
      payload: { ...purchaseBase.payload, receiptId: `${TEST_PREFIX}receipt_refund` },
    });
    await recordEvent({
      eventName: "x402.purchase",
      ...purchaseBase,
      payload: { ...purchaseBase.payload, receiptId: `${TEST_PREFIX}receipt_wrong_track` },
    });
    await recordEvent({
      eventName: "x402.purchase",
      ...purchaseBase,
      consentBasis: "unknown",
      payload: { ...purchaseBase.payload, receiptId: `${TEST_PREFIX}receipt_valid` },
    });
    await recordEvent({
      eventName: "x402.purchase",
      ...purchaseBase,
      actorId: pseudonymousAnalyticsActorId(OWNER_WALLET)!,
      payload: { ...purchaseBase.payload, receiptId: `${TEST_PREFIX}receipt_owner` },
    });
    // A valid receipt and wallet-shaped event actor still need a Wallet row
    // to establish one canonical User identity.
    await recordEvent({
      eventName: "x402.purchase",
      ...purchaseBase,
      actorId: pseudonymousAnalyticsActorId(UNKNOWN_WALLET)!,
      payload: { ...purchaseBase.payload, receiptId: `${TEST_PREFIX}receipt_unknown_wallet` },
    });
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: TEST_PREFIX } } });
    await prisma.sceneScoutCityDemand.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
    await prisma.x402Settlement.deleteMany({ where: { receiptId: { startsWith: TEST_PREFIX } } });
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    if (previousAudienceFloor === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
    else process.env.DISCOVERY_MIN_AUDIENCE = previousAudienceFloor;
  });

  it("serves only current-consented listener demand in user-declared cities and recomputes aggregate-only snapshots", async () => {
    const result = await service.getArtistSceneScout(ARTIST, { now: NOW });
    expect(result.status).toBe("ready");
    expect(result.cityDemand).toEqual(expect.arrayContaining([
      expect.objectContaining({
        releaseId: RELEASE,
        releaseTitle: "Northern Lights",
        citySlug: "montreal",
        countryCode: "CA",
        windowDays: 7,
        resonantListeners: 3,
        saves: 3,
        follows: 0,
        purchases: 1,
        pledges: 0,
        uniqueListeners: 4,
        signalCount: 7,
      }),
      expect.objectContaining({ releaseId: RELEASE, citySlug: "montreal", windowDays: 28 }),
    ]));
    expect(result.cityDemand.some((row) => row.releaseId === SMALL_RELEASE)).toBe(false);
    expect(result.cityDemand.some((row) => ["campaign-city", "reset-city", "agent-city", "unowned-track-city"].includes(row.citySlug))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(LISTENER_A);
    expect(JSON.stringify(result)).not.toContain(pseudonymousAnalyticsActorId(LISTENER_A));

    const snapshots = await prisma.sceneScoutCityDemand.findMany({
      where: { artistId: ARTIST },
      orderBy: [{ citySlug: "asc" }, { windowDays: "asc" }],
    });
    expect(snapshots.some((row) => row.releaseId === SMALL_RELEASE)).toBe(false);
    expect(snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ releaseId: RELEASE, citySlug: "montreal", windowDays: 7, resonantListeners: 3 }),
      expect.objectContaining({ releaseId: RELEASE, citySlug: "montreal", windowDays: 28, saves: 3 }),
      // Exactly 28 days is included in the 28-day window and excluded from 7 days.
      expect.objectContaining({ releaseId: RELEASE, citySlug: "28-day-boundary", windowDays: 28, uniqueListeners: 3, saves: 3 }),
    ]));
    expect(snapshots.some((row) => row.citySlug === "montreal" && row.windowDays === 7 && row.releaseId === RELEASE)).toBe(true);
    expect(snapshots.some((row) => row.citySlug === "28-day-boundary" && row.windowDays === 7)).toBe(false);
    expect(snapshots.some((row) => row.citySlug === "campaign-city")).toBe(false);
    expect(snapshots.some((row) => row.citySlug === "unknown-basis-city")).toBe(false);
    expect(snapshots.some((row) => row.citySlug === "missing-basis-city")).toBe(false);
    expect(snapshots.some((row) => row.citySlug === "future-city")).toBe(false);
    expect(snapshots.some((row) => row.citySlug === "unowned-track-city")).toBe(false);
    expect(JSON.stringify(snapshots)).not.toContain(LISTENER_A);
    expect(JSON.stringify(snapshots)).not.toContain(pseudonymousAnalyticsActorId(LISTENER_A));
  });

  it("removes prior snapshots after current consent withdrawal", async () => {
    await prisma.analyticsConsent.updateMany({
      where: { userId: { in: [LISTENER_A, LISTENER_B, LISTENER_C] } },
      data: { productAnalytics: false, decidedAt: NOW },
    });
    const result = await service.getArtistSceneScout(ARTIST, { now: NOW });
    expect(result.status).toBe("thin_data");
    expect(result.cityDemand).toEqual([]);
    expect(await prisma.sceneScoutCityDemand.count({ where: { artistId: ARTIST } })).toBe(0);
  });

  it("fails closed on a cap-plus-one event read and deletes stale snapshots", async () => {
    await prisma.sceneScoutCityDemand.create({
      data: {
        artistId: CAP_ARTIST,
        releaseId: CAP_RELEASE,
        releaseTitle: "Capped Release",
        citySlug: "old-city",
        countryCode: "CA",
        windowDays: 7,
        resonantListeners: 3,
        uniqueListeners: 3,
        signalCount: 5,
      },
    });

    const eventPrefix = `${TEST_PREFIX}cap_event_`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "AnalyticsEvent" (
        "id", "eventId", "eventName", "eventVersion", "occurredAt", "receivedAt",
        "producer", "environment", "privacyTier", "consentBasis", "payload", "envelope"
      )
      SELECT ${eventPrefix} || row_num::text,
             ${eventPrefix} || row_num::text,
             'playback.completed', 1, ${new Date(NOW.getTime() - DAY_MS)}, ${NOW},
             'playback-service', 'test', 'pseudonymous', 'consent',
             jsonb_build_object('trackId', ${CAP_TRACK}, 'completionRatio', 0.95),
             jsonb_build_object('geo', jsonb_build_object(
               'countryCode', 'CA', 'citySlug', 'montreal', 'source', 'user_declared', 'precision', 'city'
             ))
      FROM generate_series(1, ${SCENE_SCOUT_READ_CAP + 1}) AS row_num
    `);

    const result = await service.getArtistSceneScout(CAP_ARTIST, { now: NOW });
    expect(result.status).toBe("thin_data");
    expect(result.reason).toContain("full recent event window");
    expect(result.cityDemand).toEqual([]);
    expect(await prisma.sceneScoutCityDemand.count({ where: { artistId: CAP_ARTIST } })).toBe(0);
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: eventPrefix } } });
  });

  it("cascades aggregate snapshots when their release is removed", async () => {
    await prisma.sceneScoutCityDemand.create({
      data: {
        artistId: CAP_ARTIST,
        releaseId: CAP_RELEASE,
        releaseTitle: "Capped Release",
        citySlug: "old-city",
        countryCode: "CA",
        windowDays: 7,
        resonantListeners: 3,
        uniqueListeners: 3,
        signalCount: 5,
      },
    });
    await prisma.track.delete({ where: { id: CAP_TRACK } });
    await prisma.release.delete({ where: { id: CAP_RELEASE } });
    expect(await prisma.sceneScoutCityDemand.count({ where: { artistId: CAP_ARTIST } })).toBe(0);

    // Artist ownership is an independent foreign key, so even a stale row
    // with another valid release is removed when its artist is deleted.
    await prisma.sceneScoutCityDemand.create({
      data: {
        artistId: CAP_ARTIST,
        releaseId: FOREIGN_RELEASE,
        releaseTitle: "Other Release",
        citySlug: "stale-artist-row",
        countryCode: "CA",
        windowDays: 28,
        resonantListeners: 3,
        uniqueListeners: 3,
        signalCount: 5,
      },
    });
    await prisma.artist.delete({ where: { id: CAP_ARTIST } });
    expect(await prisma.sceneScoutCityDemand.count({ where: { artistId: CAP_ARTIST } })).toBe(0);
  });
});
