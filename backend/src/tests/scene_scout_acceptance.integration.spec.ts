import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { normalizeAnalyticsEventInput, parseAnalyticsEventEnvelope } from "../modules/analytics/analytics_event";
import { SceneScoutService } from "../modules/scene_scout/scene_scout.service";
import { runSceneScoutAcceptance } from "../scripts/scene_scout_acceptance";
import {
  parseSceneScoutAcceptanceArgs,
  sceneScoutAcceptanceEventId,
  sceneScoutAcceptancePrefix,
  sceneScoutAcceptanceUserId,
  type SceneScoutAcceptanceInvocation,
  type SceneScoutAcceptancePhase,
} from "../scripts/scene_scout_acceptance_support";

const TEST_PREFIX = `scene_scout_acceptance_test_${Date.now()}_`;
const OWNER = `${TEST_PREFIX}owner`;
const ARTIST = `${TEST_PREFIX}artist`;
const SHOW_ARTIST = `${TEST_PREFIX}reviewed_show_artist`;
const AMBIGUOUS_ARTIST = `${TEST_PREFIX}ambiguous_show_artist`;
const RELEASE = `${TEST_PREFIX}release`;
const TRACK = `${TEST_PREFIX}track`;
const SIBLING_RELEASE = `${TEST_PREFIX}sibling_release`;
const SIBLING_TRACK = `${TEST_PREFIX}sibling_track`;
const OTHER_OWNER = `${TEST_PREFIX}other_owner`;
const ORGANIC_CITY = "vancouver";
const ORGANIC_COUNTRY = "CA";
const FIXTURE_CITY = "chicago";
const FIXTURE_COUNTRY = "US";
const TEST_SALT = "scene-scout-acceptance-integration-test-salt-not-secret";
const ENVIRONMENT_KEYS = [
  "RESONATE_ENVIRONMENT_ID",
  "DEPLOY_ENV",
  "APP_ENV",
  "ANALYTICS_ACTOR_ID_SALT",
  "DISCOVERY_MIN_AUDIENCE",
] as const;
const originalEnvironment = new Map<string, string | undefined>();
const activeInvocations: SceneScoutAcceptanceInvocation[] = [];
let runSequence = 0;

function nextRunId(label: string) {
  runSequence += 1;
  return `${label}-${Date.now().toString(36)}-${runSequence.toString(36)}`;
}

function makeArgs(
  phase: SceneScoutAcceptancePhase,
  input: {
    runId: string;
    citySlug?: string;
    countryCode?: string;
    showArtistId?: string;
    trackId?: string;
  },
  confirm = phase !== "preview",
) {
  const args = [
    phase,
    "--artist-id", ARTIST,
    "--release-id", RELEASE,
    "--run-id", input.runId,
    "--city-slug", input.citySlug ?? FIXTURE_CITY,
    "--country-code", input.countryCode ?? FIXTURE_COUNTRY,
  ];
  if (input.showArtistId) args.push("--show-artist-id", input.showArtistId);
  if (input.trackId) args.push("--track-id", input.trackId);
  if (confirm) args.push("--confirm");
  return args;
}

function parseInvocation(
  phase: SceneScoutAcceptancePhase,
  input: Parameters<typeof makeArgs>[1],
  confirm = phase !== "preview",
) {
  return parseSceneScoutAcceptanceArgs(makeArgs(phase, input, confirm));
}

async function run(
  phase: SceneScoutAcceptancePhase,
  input: Parameters<typeof makeArgs>[1],
  confirm = phase !== "preview",
) {
  const invocation = parseInvocation(phase, input, confirm);
  if (phase !== "preview") activeInvocations.push(invocation);
  const result = await runSceneScoutAcceptance(invocation);
  return { invocation, result };
}

async function fixtureState(invocation: SceneScoutAcceptanceInvocation) {
  const prefix = sceneScoutAcceptancePrefix(invocation);
  const users = await prisma.user.findMany({
    where: { id: { startsWith: prefix } },
    orderBy: { id: "asc" },
    select: { id: true, email: true },
  });
  const userIds = users.map(({ id }) => id);
  const [consents, events] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve([])
      : prisma.analyticsConsent.findMany({
          where: { userId: { in: userIds } },
          orderBy: { userId: "asc" },
          select: { userId: true, productAnalytics: true, policyVersion: true },
        }),
    prisma.analyticsEvent.findMany({
      where: { eventId: { startsWith: prefix } },
      orderBy: { eventId: "asc" },
      select: { eventId: true, eventName: true, envelope: true, payload: true },
    }),
  ]);
  return { prefix, users, consents, events };
}

async function createOrganicEvidence() {
  const users = Array.from({ length: 3 }, (_, index) => `${TEST_PREFIX}organic_${index}`);
  const decidedAt = new Date(Date.now() - 5 * 60_000);
  await prisma.user.createMany({
    data: users.map((id) => ({ id, email: `${id}@test.resonate` })),
  });
  await prisma.analyticsConsent.createMany({
    data: users.map((userId) => ({
      userId,
      productAnalytics: true,
      policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      decidedAt,
    })),
  });

  const receivedAt = new Date();
  for (const [ordinal, userId] of users.entries()) {
    const actorId = pseudonymousAnalyticsActorId(userId);
    if (!actorId) throw new Error("Could not derive the integration listener actor id");
    const completedAt = new Date(Date.now() - 3 * 60_000);
    const savedAt = new Date(Date.now() - 2 * 60_000);
    for (const [kind, eventName, occurredAt] of [
      ["completed", "playback.completed", completedAt],
      ["saved", "library.saved", savedAt],
    ] as const) {
      const producer = kind === "completed" ? "playback-service" : "web-app";
      const envelope = normalizeAnalyticsEventInput({
        eventId: `${TEST_PREFIX}organic_${ordinal}_${kind}`,
        eventName,
        eventVersion: 1,
        occurredAt: occurredAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
        producer,
        environment: "staging",
        privacyTier: "pseudonymous",
        subjectType: "track",
        subjectId: TRACK,
        actorId,
        consentBasis: "consent",
        geo: {
          countryCode: ORGANIC_COUNTRY,
          citySlug: ORGANIC_CITY,
          source: "user_declared",
          precision: "city",
        },
        payload: {
          source: "web_player",
          trackId: TRACK,
          ...(kind === "completed" ? { completionRatio: 0.96 } : {}),
        },
        sourceRefs: { integrationTest: `${TEST_PREFIX}organic_${ordinal}_${kind}` },
      }, { now: receivedAt, defaultEnvironment: "staging" });
      await prisma.analyticsEvent.create({
        data: {
          eventId: envelope.eventId,
          eventName: envelope.eventName,
          eventVersion: envelope.eventVersion,
          occurredAt: new Date(envelope.occurredAt),
          receivedAt: new Date(envelope.receivedAt),
          producer: envelope.producer,
          environment: envelope.environment,
          privacyTier: envelope.privacyTier,
          subjectType: envelope.subjectType,
          subjectId: envelope.subjectId,
          actorId: envelope.actorId,
          consentBasis: envelope.consentBasis,
          schemaUri: envelope.schemaUri,
          payload: envelope.payload as Prisma.InputJsonValue,
          sourceRefs: envelope.sourceRefs as Prisma.InputJsonValue,
          envelope: envelope as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
  return users;
}

describe("Scene Scout acceptance fixture runner (integration)", () => {
  jest.setTimeout(120_000);

  beforeAll(async () => {
    for (const key of ENVIRONMENT_KEYS) originalEnvironment.set(key, process.env[key]);
    process.env.RESONATE_ENVIRONMENT_ID = "staging-epoch";
    process.env.DEPLOY_ENV = "staging-epoch";
    process.env.APP_ENV = "staging-epoch";
    process.env.ANALYTICS_ACTOR_ID_SALT = TEST_SALT;
    process.env.DISCOVERY_MIN_AUDIENCE = "3";

    await prisma.user.create({ data: { id: OWNER, email: `${OWNER}@test.resonate` } });
    await prisma.artist.create({ data: { id: ARTIST, userId: OWNER, displayName: "Acceptance Catalog Artist" } });
    await prisma.artist.create({
      data: {
        id: SHOW_ARTIST,
        displayName: "Reviewed Guest Artist",
        profileType: "public_artist",
        claimStatus: "unclaimed",
      },
    });
    await prisma.artist.create({
      data: {
        id: AMBIGUOUS_ARTIST,
        displayName: "Ambiguous Guest Artist",
        profileType: "public_artist",
        claimStatus: "unclaimed",
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE,
        artistId: ARTIST,
        title: "Acceptance Fixture Release",
        status: "ready",
        primaryArtist: "Reviewed Guest Artist",
      },
    });
    await prisma.track.create({
      data: { id: TRACK, releaseId: RELEASE, title: "Acceptance Fixture Track", position: 1, processingStatus: "complete" },
    });
    await prisma.release.create({
      data: {
        id: SIBLING_RELEASE,
        artistId: ARTIST,
        title: "Acceptance Sibling Release",
        status: "ready",
        primaryArtist: "Acceptance Catalog Artist",
      },
    });
    await prisma.track.create({ data: { id: SIBLING_TRACK, releaseId: SIBLING_RELEASE, title: "Sibling Track", position: 1 } });
    await prisma.releaseArtistCredit.createMany({
      data: [
        {
          releaseId: RELEASE,
          artistId: SHOW_ARTIST,
          role: "main",
          displayName: "Reviewed Guest Artist",
          identityStatus: "reviewed",
          identityReviewedAt: new Date(),
          identityReviewNote: "Reviewed for the Scene Scout acceptance fixture test.",
          sortOrder: 0,
        },
        {
          releaseId: RELEASE,
          artistId: AMBIGUOUS_ARTIST,
          role: "main",
          displayName: "Ambiguous Guest Artist",
          identityStatus: "ambiguous",
          sortOrder: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    process.env.DISCOVERY_MIN_AUDIENCE = "3";
    await prisma.release.updateMany({
      where: { id: RELEASE },
      data: { status: "ready", withdrawnAt: null },
    }).catch(() => undefined);

    for (const invocation of activeInvocations) {
      try {
        const state = await fixtureState(invocation);
        if (state.users.length) {
          await prisma.wallet.deleteMany({ where: { userId: { in: state.users.map(({ id }) => id) } } });
        }
        const cleanup = { ...invocation, phase: "cleanup" as const, confirm: true };
        await runSceneScoutAcceptance(cleanup);
      } catch {
        const prefix = sceneScoutAcceptancePrefix(invocation);
        const ids = Array.from({ length: 50 }, (_, index) => sceneScoutAcceptanceUserId(prefix, index));
        await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: prefix } } }).catch(() => undefined);
        await prisma.analyticsConsent.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
        await prisma.wallet.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
      }
    }

    await prisma.sceneScoutCityDemand.deleteMany({ where: { artistId: ARTIST } }).catch(() => undefined);
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: TEST_PREFIX } } }).catch(() => undefined);
    const organicIds = Array.from({ length: 3 }, (_, index) => `${TEST_PREFIX}organic_${index}`);
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: organicIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: organicIds } } }).catch(() => undefined);
    await prisma.stem.deleteMany({ where: { trackId: { in: [TRACK, SIBLING_TRACK] } } }).catch(() => undefined);
    await prisma.demandSignal.deleteMany({ where: { artistId: ARTIST } }).catch(() => undefined);
    await prisma.artist.updateMany({ where: { id: SHOW_ARTIST }, data: { userId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: OTHER_OWNER } }).catch(() => undefined);
    await prisma.track.deleteMany({ where: { id: { in: [TRACK, SIBLING_TRACK] } } }).catch(() => undefined);
    await prisma.release.deleteMany({ where: { id: { in: [RELEASE, SIBLING_RELEASE] } } }).catch(() => undefined);
    await prisma.artist.deleteMany({ where: { id: { in: [AMBIGUOUS_ARTIST, SHOW_ARTIST, ARTIST] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: OWNER } }).catch(() => undefined);

    for (const key of ENVIRONMENT_KEYS) {
      const previous = originalEnvironment.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("previews without writes, seeds three listeners, verifies the card, and preserves organic demand on cleanup", async () => {
    const input = { runId: nextRunId("lifecycle"), showArtistId: SHOW_ARTIST };
    const previewInvocation = parseInvocation("preview", input);
    const prefix = sceneScoutAcceptancePrefix(previewInvocation);
    const snapshotsBefore = await prisma.sceneScoutCityDemand.findMany({ where: { artistId: ARTIST } });
    const preview = await runSceneScoutAcceptance(previewInvocation);

    expect(preview).toMatchObject({
      phase: "preview",
      result: "preview_only",
      provenance: "synthetic_acceptance_fixture",
      analyticsArtistId: ARTIST,
      showArtistId: SHOW_ARTIST,
      trackId: TRACK,
      city: { citySlug: FIXTURE_CITY, countryCode: FIXTURE_COUNTRY },
      planned: { syntheticListeners: 3, events: 6 },
      fixtureNamespace: prefix,
      wouldWrite: false,
    });
    expect(await prisma.user.count({ where: { id: { startsWith: prefix } } })).toBe(0);
    expect(await prisma.analyticsEvent.count({ where: { eventId: { startsWith: prefix } } })).toBe(0);
    expect(await prisma.sceneScoutCityDemand.findMany({ where: { artistId: ARTIST } })).toEqual(snapshotsBefore);

    const seeded = await run("seed", input);
    const stateAfterSeed = await fixtureState(seeded.invocation);
    expect(seeded.result).toMatchObject({
      phase: "seed",
      result: "verified",
      provenance: "synthetic_acceptance_fixture",
      listenersCreated: 3,
      eventsCreated: 6,
      verification: {
        phase: "verify",
        result: "verified",
        aggregate: { uniqueListeners: 3, signalCount: 6 },
        relativeCta: expect.stringMatching(/^\/shows\/create\?/),
      },
    });
    expect(stateAfterSeed.users).toHaveLength(3);
    expect(stateAfterSeed.consents).toHaveLength(3);
    expect(stateAfterSeed.events).toHaveLength(6);
    for (const event of stateAfterSeed.events) {
      const envelope = parseAnalyticsEventEnvelope(event.envelope);
      expect(envelope).toMatchObject({
        eventId: event.eventId,
        eventName: event.eventName,
        producer: "scene_scout_acceptance",
        environment: "staging",
        privacyTier: "pseudonymous",
        subjectType: "track",
        subjectId: TRACK,
        consentBasis: "consent",
        geo: {
          countryCode: FIXTURE_COUNTRY,
          citySlug: FIXTURE_CITY,
          source: "user_declared",
          precision: "city",
        },
        payload: {
          source: "web_player",
          synthetic: true,
          acceptanceFixturePrefix: prefix,
          acceptanceReleaseId: RELEASE,
          trackId: TRACK,
        },
      });
      expect(event.payload).toEqual(envelope.payload);
      expect(envelope.actorId).not.toMatch(new RegExp(TEST_PREFIX));
    }

    const repeatedSeed = parseInvocation("seed", input);
    await expect(runSceneScoutAcceptance(repeatedSeed)).rejects.toThrow(/Fixture prefix already contains data/);
    expect((await fixtureState(seeded.invocation)).events).toHaveLength(6);

    const verified = await run("verify", input);
    expect(verified.result).toMatchObject({
      result: "verified",
      aggregate: { uniqueListeners: 3, signalCount: 6 },
      relativeCta: expect.stringMatching(/^\/shows\/create\?/),
    });
    expect((verified.result as Record<string, unknown>).relativeCta).toEqual(expect.stringContaining(`city=${FIXTURE_CITY}`));
    expect((verified.result as Record<string, unknown>).relativeCta).toEqual(expect.stringContaining(`country=${FIXTURE_COUNTRY}`));
    expect((verified.result as Record<string, unknown>).relativeCta).toEqual(expect.stringContaining(`releaseId=${RELEASE}`));

    await prisma.release.update({ where: { id: RELEASE }, data: { status: "processing" } });
    await expect(run("verify", input)).rejects.toThrow(/ready or published/);
    await prisma.release.update({ where: { id: RELEASE }, data: { status: "ready" } });

    const organicUsers = await createOrganicEvidence();
    const cleaned = await run("cleanup", input);
    expect(cleaned.result).toMatchObject({ phase: "cleanup", result: "cleaned", listenersDeleted: 3, eventsDeleted: 6 });
    const finalFixtureState = await fixtureState(seeded.invocation);
    expect(finalFixtureState.users).toHaveLength(0);
    expect(finalFixtureState.consents).toHaveLength(0);
    expect(finalFixtureState.events).toHaveLength(0);
    await expect(prisma.artist.findUnique({ where: { id: ARTIST } })).resolves.toMatchObject({ id: ARTIST });
    await expect(prisma.release.findUnique({ where: { id: RELEASE } })).resolves.toMatchObject({ id: RELEASE });
    await expect(prisma.track.findUnique({ where: { id: TRACK } })).resolves.toMatchObject({ id: TRACK });
    expect(await prisma.user.count({ where: { id: OWNER } })).toBe(1);
    expect(await prisma.analyticsConsent.count({ where: { userId: { in: organicUsers } } })).toBe(3);
    expect(await prisma.user.count({ where: { id: { in: organicUsers } } })).toBe(3);

    const retained = await prisma.sceneScoutCityDemand.findFirst({
      where: { artistId: ARTIST, releaseId: RELEASE, citySlug: ORGANIC_CITY, countryCode: ORGANIC_COUNTRY },
    });
    expect(retained).toMatchObject({ uniqueListeners: 3, signalCount: 6, saves: 3, citySlug: ORGANIC_CITY });
  });

  it("rejects ineligible catalog, ambiguous or missing Shows credit, and a track from another release before writes", async () => {
    const runId = nextRunId("guards");
    const baselineSnapshots = await prisma.sceneScoutCityDemand.findMany({ where: { artistId: ARTIST }, orderBy: { id: "asc" } });
    const rejected: Array<{
      input: Parameters<typeof makeArgs>[1];
      prepare?: () => Promise<void>;
      restore?: () => Promise<void>;
      message: RegExp;
    }> = [
      {
        input: { runId, showArtistId: SHOW_ARTIST },
        prepare: () => prisma.release.update({ where: { id: RELEASE }, data: { status: "processing" } }).then(() => undefined),
        restore: () => prisma.release.update({ where: { id: RELEASE }, data: { status: "ready" } }).then(() => undefined),
        message: /ready or published/,
      },
      {
        input: { runId, showArtistId: SHOW_ARTIST },
        prepare: () => prisma.release.update({ where: { id: RELEASE }, data: { withdrawnAt: new Date() } }).then(() => undefined),
        restore: () => prisma.release.update({ where: { id: RELEASE }, data: { withdrawnAt: null } }).then(() => undefined),
        message: /unwithdrawn/,
      },
      {
        input: { runId, showArtistId: AMBIGUOUS_ARTIST },
        message: /no Shows-compatible main\/primary nonambiguous credit/,
      },
      {
        input: { runId, showArtistId: ARTIST },
        prepare: () => prisma.release.update({ where: { id: RELEASE }, data: { primaryArtist: "An unrelated public artist" } }).then(() => undefined),
        restore: () => prisma.release.update({ where: { id: RELEASE }, data: { primaryArtist: "Reviewed Guest Artist" } }).then(() => undefined),
        message: /no Shows-compatible main\/primary nonambiguous credit/,
      },
      {
        input: { runId, showArtistId: SHOW_ARTIST, trackId: SIBLING_TRACK },
        message: /track-id must identify a track on the selected release/,
      },
    ];

    for (const scenario of rejected) {
      if (scenario.prepare) await scenario.prepare();
      try {
        const invocation = parseInvocation("preview", scenario.input);
        await expect(runSceneScoutAcceptance(invocation)).rejects.toThrow(scenario.message);
        const state = await fixtureState(invocation);
        expect(state.users).toHaveLength(0);
        expect(state.events).toHaveLength(0);
      } finally {
        if (scenario.restore) await scenario.restore();
      }
    }

    expect(await prisma.sceneScoutCityDemand.findMany({ where: { artistId: ARTIST }, orderBy: { id: "asc" } })).toEqual(baselineSnapshots);
  });

  it("refuses marker and wallet collisions without deleting owned fixture rows", async () => {
    const markerInput = { runId: nextRunId("marker"), showArtistId: SHOW_ARTIST };
    const markerSeed = await run("seed", markerInput);
    const markerState = await fixtureState(markerSeed.invocation);
    const changedEmail = `${TEST_PREFIX}unexpected@test.resonate`;
    await prisma.user.update({ where: { id: markerState.users[0].id }, data: { email: changedEmail } });

    await expect(runSceneScoutAcceptance(parseInvocation("cleanup", markerInput))).rejects.toThrow(/Fixture user marker collision/);
    const afterRefusal = await fixtureState(markerSeed.invocation);
    expect(afterRefusal.users).toHaveLength(3);
    expect(afterRefusal.consents).toHaveLength(3);
    expect(afterRefusal.events).toHaveLength(6);

    await prisma.user.update({
      where: { id: markerState.users[0].id },
      data: { email: `${markerState.users[0].id}@test.resonate` },
    });
    await runSceneScoutAcceptance(parseInvocation("cleanup", markerInput));

    const walletInput = { runId: nextRunId("wallet"), showArtistId: SHOW_ARTIST };
    const walletSeed = await run("seed", walletInput);
    const walletState = await fixtureState(walletSeed.invocation);
    const walletUserId = walletState.users[0].id;
    await prisma.wallet.create({
      data: { userId: walletUserId, address: "0x0000000000000000000000000000000000000a91", chainId: 8453 },
    });

    await expect(runSceneScoutAcceptance(parseInvocation("cleanup", walletInput))).rejects.toThrow(/wallet or authentication data/);
    const afterCredentialRefusal = await fixtureState(walletSeed.invocation);
    expect(afterCredentialRefusal.users).toHaveLength(3);
    expect(afterCredentialRefusal.consents).toHaveLength(3);
    expect(afterCredentialRefusal.events).toHaveLength(6);

    await prisma.wallet.delete({ where: { userId: walletUserId } });
    await runSceneScoutAcceptance(parseInvocation("cleanup", walletInput));
  });

  it("cleans a partial fixture after consent, event, catalog, and audience-floor changes", async () => {
    const input = { runId: nextRunId("partial"), showArtistId: SHOW_ARTIST };
    const seeded = await run("seed", input);
    const state = await fixtureState(seeded.invocation);
    const userIds = state.users.map(({ id }) => id);
    const oneEvent = state.events.find(({ eventName }) => eventName === "library.saved")!;

    await prisma.analyticsConsent.update({
      where: { userId: userIds[0] },
      data: { policyVersion: "analytics-consent:stale" },
    });
    await prisma.analyticsConsent.update({ where: { userId: userIds[1] }, data: { productAnalytics: false } });
    await prisma.analyticsConsent.delete({ where: { userId: userIds[2] } });
    await prisma.analyticsEvent.delete({ where: { eventId: oneEvent.eventId } });
    await prisma.release.update({ where: { id: RELEASE }, data: { withdrawnAt: new Date() } });
    process.env.DISCOVERY_MIN_AUDIENCE = "51";

    const cleanup = await run("cleanup", input);
    expect(cleanup.result).toMatchObject({ phase: "cleanup", result: "cleaned", listenersDeleted: 3, eventsDeleted: 5 });
    const stateAfterCleanup = await fixtureState(seeded.invocation);
    expect(stateAfterCleanup.users).toHaveLength(0);
    expect(stateAfterCleanup.consents).toHaveLength(0);
    expect(stateAfterCleanup.events).toHaveLength(0);
    await expect(prisma.artist.findUnique({ where: { id: ARTIST } })).resolves.toMatchObject({ id: ARTIST });
    await expect(prisma.release.findUnique({ where: { id: RELEASE } })).resolves.toMatchObject({ id: RELEASE, withdrawnAt: expect.any(Date) });
    await expect(prisma.track.findUnique({ where: { id: TRACK } })).resolves.toMatchObject({ id: TRACK });

    const repeatedCleanup = await runSceneScoutAcceptance(parseInvocation("cleanup", input));
    expect(repeatedCleanup).toMatchObject({ phase: "cleanup", result: "cleaned", listenersDeleted: 0, eventsDeleted: 0 });
    process.env.DISCOVERY_MIN_AUDIENCE = "3";
    await prisma.release.update({ where: { id: RELEASE }, data: { withdrawnAt: null } });
  });

  describe("acceptance scenarios (#1968, #1969)", () => {
    function expectNoIdentities(output: unknown, invocation: SceneScoutAcceptanceInvocation, extraIds: string[] = []) {
      const serialized = JSON.stringify(output);
      const prefix = sceneScoutAcceptancePrefix(invocation);
      expect(serialized).not.toContain(prefix);
      expect(serialized).not.toContain("scaccept_");
      for (let ordinal = 0; ordinal < 5; ordinal += 1) {
        const userId = sceneScoutAcceptanceUserId(prefix, ordinal);
        expect(serialized).not.toContain(userId);
        const actorId = pseudonymousAnalyticsActorId(userId);
        if (actorId) expect(serialized).not.toContain(actorId);
      }
      for (const id of extraIds) expect(serialized).not.toContain(id);
      expect(serialized).not.toContain("@");
    }

    async function expectFixtureGone(invocation: SceneScoutAcceptanceInvocation) {
      const state = await fixtureState(invocation);
      expect(state.users).toHaveLength(0);
      expect(state.consents).toHaveLength(0);
      expect(state.events).toHaveLength(0);
    }

    it("withdraws one listener's consent, removes the contribution, and cleans up", async () => {
      const input = { runId: nextRunId("withdraw"), showArtistId: SHOW_ARTIST };
      const seeded = await run("seed", input);
      const withdrawnUserId = sceneScoutAcceptanceUserId(sceneScoutAcceptancePrefix(seeded.invocation), 0);

      const withdrawn = await run("withdraw-consent", input);
      expect(withdrawn.result).toMatchObject({
        phase: "withdraw-consent",
        result: "contribution_removed",
        before: { cardServed: true, aggregate: { uniqueListeners: 3, signalCount: 6 } },
        after: { cardServed: false, storedSnapshot: { present: false } },
        withdrawnListeners: 1,
        consentAfter: { productAnalytics: false, decided: true },
      });
      expectNoIdentities(withdrawn.result, withdrawn.invocation);
      await expect(prisma.analyticsConsent.findUnique({ where: { userId: withdrawnUserId } }))
        .resolves.toMatchObject({ productAnalytics: false });
      expect(await prisma.sceneScoutCityDemand.count({
        where: { artistId: ARTIST, releaseId: RELEASE, citySlug: FIXTURE_CITY, countryCode: FIXTURE_COUNTRY },
      })).toBe(0);

      // The scenario is single-use per seeded fixture: a second attempt refuses.
      await expect(run("withdraw-consent", input)).rejects.toThrow(/no longer affirmative/);

      const cleaned = await run("cleanup", input);
      expect(cleaned.result).toMatchObject({
        phase: "cleanup",
        result: "cleaned",
        listenersDeleted: 3,
        eventsDeleted: 6,
        erasedAccountsDeleted: 0,
      });
      expectNoIdentities(cleaned.result, cleaned.invocation);
      await expectFixtureGone(seeded.invocation);
    });

    it("erases one listener's account, removes the contribution, and cleans up the erased account", async () => {
      const input = { runId: nextRunId("erase"), showArtistId: SHOW_ARTIST };
      const seeded = await run("seed", input);
      const prefix = sceneScoutAcceptancePrefix(seeded.invocation);
      const erasedOriginalId = sceneScoutAcceptanceUserId(prefix, 1);

      const erased = await run("erase-listener", input);
      expect(erased.result).toMatchObject({
        phase: "erase-listener",
        result: "contribution_removed",
        before: { cardServed: true, aggregate: { uniqueListeners: 3, signalCount: 6 } },
        after: { cardServed: false, storedSnapshot: { present: false } },
        erasure: { status: "erased", listenerEventsBefore: 2, listenerEventsAfter: 0 },
        erasedListeners: 1,
      });
      expectNoIdentities(erased.result, erased.invocation);

      const state = await fixtureState(seeded.invocation);
      expect(state.users.map(({ id }) => id)).not.toContain(erasedOriginalId);
      expect(state.users).toHaveLength(2);
      const markers = state.events.filter(({ eventName }) => eventName === "scene_scout_acceptance.fixture_marker");
      expect(markers).toHaveLength(2);
      const accountMarker = markers.find(({ eventId }) => eventId.endsWith("_erased_account"))!;
      const erasedUserId = (accountMarker.payload as Record<string, unknown>).erasedUserId as string;
      await expect(prisma.user.findUnique({ where: { id: erasedUserId } }))
        .resolves.toMatchObject({ erasedAt: expect.any(Date) });

      // The erased fixture is no longer a complete fixture.
      await expect(run("verify", input)).rejects.toThrow(/erase scenario/);
      await expect(run("erase-listener", input)).rejects.toThrow(/erase scenario|complete fixture/);

      const cleaned = await run("cleanup", input);
      expect(cleaned.result).toMatchObject({
        phase: "cleanup",
        result: "cleaned",
        listenersDeleted: 2,
        erasedAccountsDeleted: 1,
        eventsDeleted: 4,
        markerEventsDeleted: 2,
      });
      expectNoIdentities(cleaned.result, cleaned.invocation, [erasedUserId]);
      await expectFixtureGone(seeded.invocation);
      expect(await prisma.user.count({ where: { id: erasedUserId } })).toBe(0);
      expect(await prisma.analyticsConsent.count({ where: { userId: erasedUserId } })).toBe(0);
    });

    it("refuses cleanup of an erased account whose marker is missing or tampered with", async () => {
      const input = { runId: nextRunId("erase-marker"), showArtistId: SHOW_ARTIST };
      const seeded = await run("seed", input);
      await run("erase-listener", input);
      const state = await fixtureState(seeded.invocation);
      const accountMarker = state.events.find(({ eventId }) => eventId.endsWith("_erased_account"))!;
      const erasedUserId = (accountMarker.payload as Record<string, unknown>).erasedUserId as string;

      // A marker naming a live (non-erased) account must never authorize its deletion.
      await prisma.user.update({ where: { id: erasedUserId }, data: { erasedAt: null } });
      await expect(runSceneScoutAcceptance(parseInvocation("cleanup", input)))
        .rejects.toThrow(/Erased fixture account marker collision/);
      await prisma.user.update({ where: { id: erasedUserId }, data: { erasedAt: new Date() } });

      await prisma.analyticsEvent.delete({ where: { eventId: accountMarker.eventId } });
      await expect(runSceneScoutAcceptance(parseInvocation("cleanup", input)))
        .rejects.toThrow(/marker is missing/);
      expect(await prisma.user.count({ where: { id: erasedUserId } })).toBe(1);

      // Restoring the marker lets the guarded cleanup proceed.
      await prisma.analyticsEvent.create({
        data: {
          eventId: accountMarker.eventId,
          eventName: accountMarker.eventName,
          eventVersion: 1,
          occurredAt: new Date((accountMarker.envelope as Record<string, string>).occurredAt),
          receivedAt: new Date((accountMarker.envelope as Record<string, string>).receivedAt),
          producer: "scene_scout_acceptance",
          environment: "staging",
          privacyTier: "anonymous",
          schemaUri: (accountMarker.envelope as Record<string, string>).schemaUri,
          payload: accountMarker.payload as Prisma.InputJsonValue,
          sourceRefs: (accountMarker.envelope as Record<string, unknown>).sourceRefs as Prisma.InputJsonValue,
          envelope: accountMarker.envelope as Prisma.InputJsonValue,
        },
      });
      const cleaned = await run("cleanup", input);
      expect(cleaned.result).toMatchObject({ result: "cleaned", erasedAccountsDeleted: 1 });
      await expectFixtureGone(seeded.invocation);
    });

    it("refuses the scenario phases without a seeded fixture or without confirmation", async () => {
      const input = { runId: nextRunId("refuse"), showArtistId: SHOW_ARTIST };
      const usersBefore = await prisma.user.count();
      for (const phase of ["withdraw-consent", "erase-listener"] as const) {
        await expect(run(phase, input)).rejects.toThrow(/complete fixture is not present/);
        await expect(run(phase, input, false)).rejects.toThrow(/requires --confirm/);
      }
      await expect(run("unmet-demand", input, false)).rejects.toThrow(/requires --confirm/);
      await expect(run("access-check", input, false)).rejects.toThrow(/seeded fixture is not present/);
      expect(await prisma.user.count()).toBe(usersBefore);

      const saltlessInvocation = parseInvocation("withdraw-consent", input);
      const salt = process.env.ANALYTICS_ACTOR_ID_SALT;
      delete process.env.ANALYTICS_ACTOR_ID_SALT;
      try {
        await expect(runSceneScoutAcceptance(saltlessInvocation)).rejects.toThrow(/ANALYTICS_ACTOR_ID_SALT is required/);
      } finally {
        process.env.ANALYTICS_ACTOR_ID_SALT = salt;
      }
    });

    it("produces an aggregate stem catalog action from floor-count requesters without exposing them or prompts", async () => {
      const input = { runId: nextRunId("unmet"), showArtistId: SHOW_ARTIST };
      const first = await run("unmet-demand", input);
      const prefix = sceneScoutAcceptancePrefix(first.invocation);
      expect(first.result).toMatchObject({
        phase: "unmet-demand",
        result: "verified",
        trackId: TRACK,
        fixtureListenersCreated: 3,
        requestersRecorded: 3,
        observationsRecorded: 3,
        catalogAction: { targetType: "track", kind: "stem", value: "vocals" },
        aggregate: { distinctRequesters: 3, requestCount: 3 },
        storedSnapshot: { present: true, distinctRequesters: 3, requestCount: 3 },
        privacy: { storedObservations: 3, categoricalOnly: true, promptsStored: false, responseExposesIdentity: false },
      });
      expectNoIdentities(first.result, first.invocation);

      const fixtureUserIds = Array.from({ length: 3 }, (_, ordinal) => sceneScoutAcceptanceUserId(prefix, ordinal));
      const observations = await prisma.demandObservation.findMany({ where: { userId: { in: fixtureUserIds } } });
      expect(observations).toHaveLength(3);
      for (const observation of observations) {
        expect(observation).toMatchObject({
          sourceType: "crate",
          targetType: "track",
          targetId: TRACK,
          evidenceTrackId: TRACK,
          kind: "stem",
          value: "vocals",
        });
        expect(observation.sourceKey).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(await prisma.demandSignal.count({ where: { artistId: ARTIST, targetId: TRACK, kind: "stem", value: "vocals" } }))
        .toBeGreaterThan(0);
      // The fixture contains no listening events: a city card is not produced by this phase.
      expect((await fixtureState(first.invocation)).events).toHaveLength(0);

      // Repeating reuses the fixture and creates no duplicate observations.
      const repeated = await run("unmet-demand", input);
      expect(repeated.result).toMatchObject({
        result: "verified",
        fixtureListenersCreated: 0,
        observationsRecorded: 0,
        aggregate: { distinctRequesters: 3, requestCount: 3 },
      });

      const cleaned = await run("cleanup", input);
      expect(cleaned.result).toMatchObject({
        result: "cleaned",
        listenersDeleted: 3,
        eventsDeleted: 0,
        demandObservationsDeleted: 3,
        unmetDemandSnapshots: { status: "thin_data", rows: 0 },
      });
      await expectFixtureGone(first.invocation);
      expect(await prisma.demandObservation.count({ where: { userId: { in: fixtureUserIds } } })).toBe(0);
      expect(await prisma.demandSignal.count({ where: { artistId: ARTIST } })).toBe(0);
    });

    it("reuses a seeded fixture for unmet demand and targets the first stem type the track lacks", async () => {
      const input = { runId: nextRunId("unmet-seeded"), showArtistId: SHOW_ARTIST };
      const seeded = await run("seed", input);
      await prisma.stem.create({
        data: { id: `${TEST_PREFIX}vocals_stem`, trackId: TRACK, type: "vocals", uri: "memory://acceptance-test-stem" },
      });
      try {
        const demand = await run("unmet-demand", input);
        expect(demand.result).toMatchObject({
          result: "verified",
          fixtureListenersCreated: 0,
          catalogAction: { targetType: "track", kind: "stem", value: "drums" },
          aggregate: { distinctRequesters: 3 },
        });
        expectNoIdentities(demand.result, demand.invocation);

        const cleaned = await run("cleanup", input);
        expect(cleaned.result).toMatchObject({
          result: "cleaned",
          listenersDeleted: 3,
          eventsDeleted: 6,
          demandObservationsDeleted: 3,
        });
        await expectFixtureGone(seeded.invocation);
      } finally {
        await prisma.stem.deleteMany({ where: { trackId: TRACK } });
      }
    });

    it("blocks unmet demand rather than inventing an aggregate when the track is not a complete catalog track", async () => {
      const input = { runId: nextRunId("unmet-pending"), showArtistId: SHOW_ARTIST };
      await prisma.track.update({ where: { id: TRACK }, data: { processingStatus: "pending" } });
      try {
        const blocked = await run("unmet-demand", input);
        expect(blocked.result).toMatchObject({ phase: "unmet-demand", result: "blocked", observationsRecorded: 0 });
        expect(await prisma.demandSignal.count({ where: { artistId: ARTIST } })).toBe(0);
      } finally {
        await prisma.track.update({ where: { id: TRACK }, data: { processingStatus: "complete" } });
        await run("cleanup", input);
      }
    });

    it("blocks unmet demand when fewer fixture listeners than the floor still consent", async () => {
      const input = { runId: nextRunId("unmet-blocked"), showArtistId: SHOW_ARTIST };
      const seeded = await run("seed", input);
      await run("withdraw-consent", input);
      const blocked = await run("unmet-demand", input);
      expect(blocked.result).toMatchObject({ phase: "unmet-demand", result: "blocked", consentingListeners: 2 });
      expect(await prisma.demandObservation.count({
        where: { userId: { startsWith: sceneScoutAcceptancePrefix(seeded.invocation) } },
      })).toBe(0);
      await run("cleanup", input);
      await expectFixtureGone(seeded.invocation);
    });

    it("checks artist analytics authorization read-only for a listener, another artist's owner, and the owner", async () => {
      const input = { runId: nextRunId("access"), showArtistId: SHOW_ARTIST };
      const seeded = await run("seed", input);
      const stateBefore = await fixtureState(seeded.invocation);

      // Without a distinct owner on the other artist, that case is reported as skipped.
      const skipped = await run("access-check", { runId: input.runId, showArtistId: SHOW_ARTIST }, false);
      expect(skipped.result).toMatchObject({
        phase: "access-check",
        result: "passed",
        cases: [
          { case: "target_artist_owner", expected: "allow", outcome: "pass" },
          { case: "fixture_non_artist_listener", expected: "forbidden", outcome: "pass" },
          { case: "other_artist_owner", expected: "forbidden", outcome: "skipped" },
        ],
      });

      await prisma.user.create({ data: { id: OTHER_OWNER, email: `${OTHER_OWNER}@test.resonate` } });
      await prisma.artist.update({ where: { id: SHOW_ARTIST }, data: { userId: OTHER_OWNER } });
      try {
        const checked = await run("access-check", { runId: input.runId, showArtistId: SHOW_ARTIST }, false);
        expect(checked.result).toMatchObject({
          phase: "access-check",
          result: "passed",
          cases: [
            { case: "target_artist_owner", expected: "allow", outcome: "pass" },
            { case: "fixture_non_artist_listener", expected: "forbidden", outcome: "pass" },
            { case: "other_artist_owner", expected: "forbidden", outcome: "pass" },
          ],
        });
        expectNoIdentities(checked.result, checked.invocation, [OWNER, OTHER_OWNER, ARTIST, SHOW_ARTIST]);
      } finally {
        await prisma.artist.update({ where: { id: SHOW_ARTIST }, data: { userId: null } });
        await prisma.user.delete({ where: { id: OTHER_OWNER } });
      }

      // Read-only: the fixture is untouched.
      expect(await fixtureState(seeded.invocation)).toEqual(stateBefore);
      await run("cleanup", input);
      await expectFixtureGone(seeded.invocation);
    });
  });
});
