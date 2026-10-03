import { prisma } from "../db/prisma";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { AgentSessionRequest } from "../modules/agents/agent_session_request";
import { CrateEntitlementsService } from "../modules/crates/crate-entitlements";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import { deterministicCrateRequestParser } from "../modules/crates/crate_request_parser";
import { CratesService } from "../modules/crates/crates.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { UnmetDemandService } from "../modules/scene_scout/unmet_demand.service";
import { EventBus } from "../modules/shared/event_bus";
import { SessionsService } from "../modules/sessions/sessions.service";

const PREFIX = `unmet_demand_${Date.now()}_`;
const OWNER = `${PREFIX}owner`;
const JAZZ_OWNER = `${PREFIX}jazz_owner`;
const WINDOW_OWNER = `${PREFIX}window_owner`;
const FUTURE_OWNER = `${PREFIX}future_owner`;
const PROCESSING_OWNER = `${PREFIX}processing_owner`;
const WITHDRAWN_OWNER = `${PREFIX}withdrawn_owner`;
const LISTENERS = Array.from({ length: 5 }, (_, index) => `${PREFIX}listener_${index + 1}`);
const WINDOW_LISTENERS = Array.from({ length: 3 }, (_, index) => `${PREFIX}window_listener_${index + 1}`);
const DENIED = `${PREFIX}denied`;
const MISSING_CONSENT = `${PREFIX}missing_consent`;
const SESSION_USER = `${PREFIX}session_user`;
const ARTIST = `${PREFIX}artist`;
const RELEASE = `${PREFIX}release`;
const TRACK = `${PREFIX}track`;
const JAZZ_ARTIST = `${PREFIX}jazz_artist`;
const JAZZ_RELEASE = `${PREFIX}jazz_release`;
const JAZZ_TRACK = `${PREFIX}jazz_track`;
const WINDOW_ARTIST = `${PREFIX}window_artist`;
const WINDOW_RELEASE = `${PREFIX}window_release`;
const WINDOW_TRACK = `${PREFIX}window_track`;
const FUTURE_ARTIST = `${PREFIX}future_artist`;
const FUTURE_RELEASE = `${PREFIX}future_release`;
const FUTURE_TRACK = `${PREFIX}future_track`;
const PROCESSING_ARTIST = `${PREFIX}processing_artist`;
const PROCESSING_RELEASE = `${PREFIX}processing_release`;
const PROCESSING_TRACK = `${PREFIX}processing_track`;
const WITHDRAWN_ARTIST = `${PREFIX}withdrawn_artist`;
const WITHDRAWN_RELEASE = `${PREFIX}withdrawn_release`;
const WITHDRAWN_TRACK = `${PREFIX}withdrawn_track`;
const TEST_NOW = new Date(Date.now() + 60_000);
const DAY_MS = 24 * 60 * 60 * 1000;

const unmetDemand = new UnmetDemandService();

async function createUser(userId: string, analytics = true, decidedAt = new Date(Date.now() - DAY_MS)) {
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
  if (analytics) {
    await prisma.analyticsConsent.create({
      data: {
        userId,
        productAnalytics: true,
        policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
        decidedAt,
      },
    });
  }
}

async function createCatalog(input: {
  artistId: string;
  releaseId: string;
  trackId: string;
  genre: string;
  moods?: string[];
  ownerUserId?: string;
  releaseDate?: Date;
  withdrawnAt?: Date;
  processingStatus?: string;
}) {
  await prisma.artist.create({
    data: { id: input.artistId, userId: input.ownerUserId ?? OWNER, displayName: input.artistId },
  });
  await prisma.release.create({
    data: {
      id: input.releaseId,
      artistId: input.artistId,
      title: input.releaseId,
      status: "published",
      genre: input.genre,
      moods: input.moods ?? [],
      releaseDate: input.releaseDate,
      withdrawnAt: input.withdrawnAt,
    },
  });
  await prisma.track.create({
    data: {
      id: input.trackId,
      releaseId: input.releaseId,
      title: input.trackId,
      position: 1,
      processingStatus: input.processingStatus ?? "complete",
      contentStatus: "clean",
      aiDisclosureLevel: "NONE",
    },
  });
}

function makeCratesService() {
  return new CratesService(
    deterministicCrateRequestParser,
    new DiscoveryRankingService(),
    new DiscoveryPolicyContextService(),
    new CrateEntitlementsService(),
    new AgentLearningService(),
    undefined,
    undefined,
    unmetDemand,
  );
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

describe("Scene Scout unmet demand (integration)", () => {
  jest.setTimeout(120_000);
  let previousAudienceFloor: string | undefined;

  beforeAll(async () => {
    previousAudienceFloor = process.env.DISCOVERY_MIN_AUDIENCE;
    process.env.DISCOVERY_MIN_AUDIENCE = "3";

    for (const userId of [
      OWNER, JAZZ_OWNER, WINDOW_OWNER, FUTURE_OWNER, PROCESSING_OWNER, WITHDRAWN_OWNER,
      ...LISTENERS, ...WINDOW_LISTENERS, DENIED, MISSING_CONSENT, SESSION_USER,
    ]) {
      await createUser(userId, userId !== MISSING_CONSENT);
    }
    for (const userId of WINDOW_LISTENERS) {
      await prisma.analyticsConsent.update({
        where: { userId },
        data: { decidedAt: new Date(TEST_NOW.getTime() - 60 * DAY_MS) },
      });
    }
    await prisma.analyticsConsent.update({
      where: { userId: DENIED },
      data: { productAnalytics: false },
    });
    await createCatalog({ artistId: ARTIST, releaseId: RELEASE, trackId: TRACK, genre: "Electronic", moods: ["Calm"] });
    await createCatalog({ artistId: JAZZ_ARTIST, ownerUserId: JAZZ_OWNER, releaseId: JAZZ_RELEASE, trackId: JAZZ_TRACK, genre: "Jazz" });
    await createCatalog({ artistId: WINDOW_ARTIST, ownerUserId: WINDOW_OWNER, releaseId: WINDOW_RELEASE, trackId: WINDOW_TRACK, genre: "Electronic" });
    await createCatalog({
      artistId: FUTURE_ARTIST,
      ownerUserId: FUTURE_OWNER,
      releaseId: FUTURE_RELEASE,
      trackId: FUTURE_TRACK,
      genre: "Electronic",
      releaseDate: new Date(TEST_NOW.getTime() + DAY_MS),
    });
    await createCatalog({
      artistId: PROCESSING_ARTIST,
      ownerUserId: PROCESSING_OWNER,
      releaseId: PROCESSING_RELEASE,
      trackId: PROCESSING_TRACK,
      genre: "Electronic",
      processingStatus: "processing",
    });
    await createCatalog({
      artistId: WITHDRAWN_ARTIST,
      ownerUserId: WITHDRAWN_OWNER,
      releaseId: WITHDRAWN_RELEASE,
      trackId: WITHDRAWN_TRACK,
      genre: "Electronic",
      withdrawnAt: new Date(Date.now() - 1_000),
    });
  });

  afterAll(async () => {
    const ownedBy = { userId: { startsWith: PREFIX } };
    const sessionIds = await prisma.session.findMany({ where: ownedBy, select: { id: true } });
    const ids = sessionIds.map((session) => session.id);
    await prisma.license.deleteMany({ where: { sessionId: { in: ids } } }).catch(() => {});
    await prisma.session.deleteMany({ where: ownedBy }).catch(() => {});
    await prisma.crateItem.deleteMany({ where: ownedBy }).catch(() => {});
    await prisma.crateRequest.deleteMany({ where: ownedBy }).catch(() => {});
    await prisma.crate.deleteMany({ where: ownedBy }).catch(() => {});
    await prisma.demandObservation.deleteMany({ where: { userId: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.demandSignal.deleteMany({ where: { artistId: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.agentConfig.deleteMany({ where: { userId: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.analyticsConsent.deleteMany({ where: { userId: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    if (previousAudienceFloor === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
    else process.env.DISCOVERY_MIN_AUDIENCE = previousAudienceFloor;
  });

  it("records through CratesService, enforces the audience floor, and replaces snapshots after consent withdrawal", async () => {
    const service = makeCratesService();
    const filters = { ...defaultCrateFilters(), count: 1, requiredStems: ["vocals"] as const };

    for (const listener of LISTENERS.slice(0, 2)) {
      const result = await service.createFromRequest(listener, { filters });
      expect(result.coverage).toMatchObject({ found: 0, gaps: [{ filter: "requiredStems" }] });
    }
    let result = await unmetDemand.getArtistUnmetDemand(ARTIST, { now: TEST_NOW });
    expect(result.status).toBe("thin_data");
    expect(result.demand).toEqual([]);
    expect(await prisma.demandSignal.count({ where: { artistId: ARTIST } })).toBe(0);

    for (const listener of LISTENERS.slice(2)) {
      await service.createFromRequest(listener, { filters });
    }
    // The catalog owner, explicit refusal, and absent consent cannot lift the
    // listener count or source count.
    await service.createFromRequest(OWNER, { filters });
    await service.createFromRequest(DENIED, { filters });
    await service.createFromRequest(MISSING_CONSENT, { filters });

    result = await unmetDemand.getArtistUnmetDemand(ARTIST, { now: TEST_NOW });
    expect(result.status).toBe("ready");
    const trackRow = result.demand.find((row) => row.targetType === "track" && row.trackId === TRACK);
    expect(trackRow).toMatchObject({
      targetType: "track",
      trackId: TRACK,
      releaseId: RELEASE,
      trackTitle: TRACK,
      kind: "stem",
      value: "vocals",
      windowDays: 28,
      distinctRequesters: 5,
      requestCount: 5,
    });
    expect(JSON.stringify(trackRow)).not.toContain(OWNER);
    expect(JSON.stringify(trackRow)).not.toContain(LISTENERS[0]);
    const stored = await prisma.demandSignal.findMany({ where: { artistId: ARTIST } });
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((row) => row.distinctRequesters >= 3)).toBe(true);
    expect(Object.keys(stored[0]).sort()).toEqual([
      "artistId", "computedAt", "distinctRequesters", "id", "kind", "requestCount", "targetId", "targetType", "value", "windowDays",
    ]);

    for (const listener of LISTENERS.slice(0, 3)) {
      await prisma.analyticsConsent.update({
        where: { userId: listener },
        data: { productAnalytics: false, decidedAt: new Date() },
      });
    }
    const withdrawn = await unmetDemand.getArtistUnmetDemand(ARTIST, { now: TEST_NOW });
    expect(withdrawn.status).toBe("thin_data");
    expect(withdrawn.demand).toEqual([]);
    expect(await prisma.demandSignal.count({ where: { artistId: ARTIST } })).toBe(0);

    await prisma.analyticsConsent.update({
      where: { userId: LISTENERS[0] },
      data: { productAnalytics: true, decidedAt: new Date() },
    });
    const regranted = await unmetDemand.getArtistUnmetDemand(ARTIST, { now: TEST_NOW });
    expect(regranted.status).toBe("thin_data");
    expect(await prisma.demandSignal.count({ where: { artistId: ARTIST } })).toBe(0);
  });

  it("accepts only fully canonical approved picks at the ADK boundary", async () => {
    const userId = SESSION_USER;
    await prisma.agentConfig.create({ data: { userId, name: "Scene Scout test", vibes: ["Electronic"] } });
    const eventBus = new EventBus();
    const learning = {
      resolveTasteProfile: jest.fn().mockResolvedValue(null),
      mergeLearnedGenres: jest.fn(),
    };
    let picks: Array<{ trackId: string; licenseType: string; priceUsd: number }> = [
      { trackId: TRACK, licenseType: "personal", priceUsd: 0 },
    ];
    const controller = new AgentConfigController(
      {} as any,
      { run: jest.fn().mockImplementation(async () => ({ status: "approved", picks, latencyMs: 1 })) } as any,
      {} as any,
      learning as any,
      eventBus,
      undefined,
      unmetDemand,
    );
    const body = {
      preferences: {
        request: { genres: [], moods: ["Focus"], energy: null, bpm: null } satisfies AgentSessionRequest,
      },
    };
    const request = { user: { userId } };

    const valid = await controller.startSession(request, body);
    const validSessionId = (valid as { sessionId: string }).sessionId;
    const recorded = await waitFor(async () =>
      (await prisma.demandObservation.count({ where: { userId, sourceType: "session" } })) === 1,
    );
    expect(recorded).toBe(true);
    expect(await prisma.demandObservation.findFirstOrThrow({ where: { userId, sourceType: "session" } }))
      .not.toHaveProperty("sessionId", validSessionId);

    picks = [
      { trackId: TRACK, licenseType: "personal", priceUsd: 0 },
      { trackId: FUTURE_TRACK, licenseType: "personal", priceUsd: 0 },
    ];
    await controller.startSession(request, body);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(await prisma.demandObservation.count({ where: { userId, sourceType: "session" } })).toBe(1);
  });

  it("records a legitimate zero-pick session against exact catalog genre and avoids IDs", async () => {
    const sessionId = `${PREFIX}no_tracks_session`;
    await prisma.session.create({ data: { id: sessionId, userId: SESSION_USER, budgetCapUsd: 10 } });
    const runtime = {
      runCommerce: jest.fn().mockResolvedValue({ status: "no_tracks", tracks: [], shortfall: 5 }),
    };
    const sessions = new SessionsService(
      {} as any,
      new EventBus(),
      runtime as any,
      {} as any,
      undefined,
      unmetDemand,
    );
    const result = await sessions.agentNext({
      sessionId,
      preferences: {
        request: { genres: ["Jazz"], moods: [], energy: null, bpm: null },
      },
    });
    expect(result).toMatchObject({ status: "no_tracks", tracks: [] });
    const observation = await prisma.demandObservation.findFirstOrThrow({
      where: { userId: SESSION_USER, sourceType: "session", targetArtistId: JAZZ_ARTIST },
    });
    expect(observation).toMatchObject({ targetType: "genre", targetId: JAZZ_ARTIST, kind: "genre", value: "Jazz" });
    expect(JSON.stringify(observation)).not.toContain(sessionId);
    expect(JSON.stringify(observation)).not.toContain("requesting Jazz music");
  });

  it("rejects future, processing, and withdrawn catalog tracks as approved runtime evidence", async () => {
    const request: AgentSessionRequest = { genres: [], moods: ["Focus"], energy: null, bpm: null };
    const before = await prisma.demandObservation.count({ where: { userId: SESSION_USER, sourceType: "session" } });
    for (const [suffix, trackId] of [
      ["future", FUTURE_TRACK],
      ["processing", PROCESSING_TRACK],
      ["withdrawn", WITHDRAWN_TRACK],
    ]) {
      const created = await unmetDemand.recordSessionShortfall({
        userId: SESSION_USER,
        sessionId: `${PREFIX}${suffix}_session`,
        resultStatus: "approved",
        observedAt: new Date(),
        request,
        requestedCount: 2,
        foundTrackIds: [trackId],
      });
      expect(created).toBe(0);
    }
    expect(await prisma.demandObservation.count({ where: { userId: SESSION_USER, sourceType: "session" } })).toBe(before);
  });

  it("uses inclusive seven- and twenty-eight-day windows and purges expired observations in bounded governance cleanup", async () => {
    const listeners = WINDOW_LISTENERS;
    const consentRows = await prisma.analyticsConsent.findMany({
      where: { userId: { in: listeners } },
      select: { userId: true, decidedAt: true },
    });
    const consentByUser = new Map(consentRows.map((row) => [row.userId, row.decidedAt]));
    const makeObservation = (input: {
      userId: string;
      value: string;
      observedAt: Date;
      sourceIndex: number;
    }) => ({
      userId: input.userId,
      sourceType: "crate",
      sourceKey: input.sourceIndex.toString(16).padStart(64, "0"),
      targetArtistId: WINDOW_ARTIST,
      targetId: WINDOW_ARTIST,
      targetType: "artist",
      evidenceTrackId: WINDOW_TRACK,
      kind: "mood",
      value: input.value,
      consentDecidedAt: consentByUser.get(input.userId)!,
      observedAt: input.observedAt,
      expiresAt: new Date(input.observedAt.getTime() + 28 * DAY_MS),
    });
    const data = listeners.flatMap((userId) => [
      makeObservation({ userId, value: "Focus", observedAt: new Date(TEST_NOW.getTime() - 7 * DAY_MS), sourceIndex: 1 }),
      makeObservation({ userId, value: "Calm", observedAt: new Date(TEST_NOW.getTime() - 7 * DAY_MS - 1), sourceIndex: 2 }),
    ]);
    await prisma.demandObservation.createMany({ data, skipDuplicates: true });
    await prisma.demandObservation.createMany({
      data: listeners.map((userId) => ({
        ...makeObservation({ userId, value: "Low", observedAt: new Date(TEST_NOW.getTime() - 28 * DAY_MS), sourceIndex: 3 }),
        kind: "energy",
        expiresAt: TEST_NOW,
      })),
    });
    const expired = await prisma.demandObservation.create({
      data: {
        ...makeObservation({ userId: listeners[0], value: "High", observedAt: new Date(TEST_NOW.getTime() - 28 * DAY_MS - 1), sourceIndex: 4 }),
        kind: "energy",
        expiresAt: new Date(TEST_NOW.getTime() - 1),
      },
    });

    const [first, concurrent] = await Promise.all([
      unmetDemand.getArtistUnmetDemand(WINDOW_ARTIST, { now: TEST_NOW }),
      unmetDemand.getArtistUnmetDemand(WINDOW_ARTIST, { now: TEST_NOW }),
    ]);
    expect(first.status).toBe("ready");
    expect(concurrent.status).toBe("ready");
    expect(first.demand).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mood", value: "Focus", windowDays: 7, distinctRequesters: 3 }),
      expect.objectContaining({ kind: "mood", value: "Calm", windowDays: 28, distinctRequesters: 3 }),
      expect.objectContaining({ kind: "energy", value: "Low", windowDays: 28, distinctRequesters: 3 }),
    ]));
    expect(first.demand).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mood", value: "Calm", windowDays: 7 }),
      expect.objectContaining({ kind: "energy", value: "High" }),
    ]));
    expect(await prisma.demandObservation.findUnique({ where: { id: expired.id } })).toBeNull();

    const expiredForGovernance = await prisma.demandObservation.create({
      data: {
        ...makeObservation({ userId: listeners[0], value: "Medium", observedAt: new Date(TEST_NOW.getTime() - 29 * DAY_MS), sourceIndex: 5 }),
        kind: "energy",
        expiresAt: new Date(TEST_NOW.getTime() - 1),
      },
    });
    const cleanup = await new AnalyticsGovernanceService().runRetentionCleanup({
      now: TEST_NOW,
      policy: { personalDays: 36_500, sensitiveDays: 36_500, pseudonymousDays: 36_500 },
    });
    expect(cleanup.demandObservationsDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.demandObservation.findUnique({ where: { id: expiredForGovernance.id } })).toBeNull();
  });
});
