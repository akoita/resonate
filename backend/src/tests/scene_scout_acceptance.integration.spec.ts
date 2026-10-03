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
    await prisma.track.create({ data: { id: TRACK, releaseId: RELEASE, title: "Acceptance Fixture Track", position: 1 } });
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
});
