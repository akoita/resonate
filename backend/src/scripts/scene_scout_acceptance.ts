import "dotenv/config";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "util";
import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import {
  ANALYTICS_CONSENT_POLICY_VERSION,
} from "../modules/analytics/analytics_consent.service";
import {
  normalizeAnalyticsEventInput,
  parseAnalyticsEventEnvelope,
  type AnalyticsEventEnvelope,
} from "../modules/analytics/analytics_event";
import { sceneScoutCityCards } from "../modules/analytics/analytics_scene_scout";
import { SceneScoutService, sceneScoutMinimumAudience } from "../modules/scene_scout/scene_scout.service";
import {
  assertSceneScoutAcceptanceMutationRequirements,
  assertSceneScoutAcceptanceStagingEnvironment,
  parseSceneScoutAcceptanceArgs,
  SceneScoutAcceptanceInputError,
  SCENE_SCOUT_ACCEPTANCE_MAX_EVENTS,
  SCENE_SCOUT_ACCEPTANCE_MAX_USERS,
  SCENE_SCOUT_ACCEPTANCE_PRODUCER,
  sceneScoutAcceptanceEventId,
  sceneScoutAcceptancePrefix,
  sceneScoutAcceptanceUserId,
  type SceneScoutAcceptanceEventKind,
  type SceneScoutAcceptanceInvocation,
} from "./scene_scout_acceptance_support";

const CONSENT_LEAD_MS = 3 * 60 * 1000;
const COMPLETION_LEAD_MS = 2 * 60 * 1000;
const SAVE_LEAD_MS = 60 * 1000;

type SafeResult = Record<string, unknown>;

interface EligibleTarget {
  artistId: string;
  showArtistId: string;
  releaseId: string;
  releaseTitle: string;
  trackId: string;
}

interface FixtureUserRow {
  id: string;
  email: string;
}

interface FixtureConsentRow {
  userId: string;
  productAnalytics: boolean;
  policyVersion: string;
  decidedAt: Date;
}

interface FixtureEventRow {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: Date;
  receivedAt: Date;
  producer: string;
  environment: string;
  privacyTier: string;
  subjectType: string | null;
  subjectId: string | null;
  actorId: string | null;
  consentBasis: string | null;
  schemaUri: string | null;
  payload: Prisma.JsonValue;
  sourceRefs: Prisma.JsonValue | null;
  envelope: Prisma.JsonValue;
}

class SceneScoutAcceptanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneScoutAcceptanceError";
  }
}

function fail(message: string): never {
  throw new SceneScoutAcceptanceError(message);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expectedKeys: string[]) {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function requiredListenerCount() {
  const audience = Math.max(3, sceneScoutMinimumAudience());
  if (audience > SCENE_SCOUT_ACCEPTANCE_MAX_USERS) {
    fail(`The current Scene Scout audience floor requires ${audience} fixtures; the safe maximum is ${SCENE_SCOUT_ACCEPTANCE_MAX_USERS}`);
  }
  return audience;
}

async function requireEligibleTarget(
  invocation: Pick<SceneScoutAcceptanceInvocation, "artistId" | "releaseId" | "showArtistId" | "trackId">,
): Promise<EligibleTarget> {
  const artist = await prisma.artist.findUnique({
    where: { id: invocation.artistId },
    select: { id: true, userId: true, displayName: true },
  });
  if (!artist?.userId) {
    fail("The target artist must have an existing user account before Scene Scout acceptance can run");
  }
  const owner = await prisma.user.findUnique({ where: { id: artist.userId }, select: { id: true } });
  if (!owner || owner.id.startsWith("scaccept_")) {
    fail("The target artist must be linked to an existing non-fixture user account");
  }

  const release = await prisma.release.findFirst({
    where: {
      id: invocation.releaseId,
      artistId: invocation.artistId,
      status: { in: ["ready", "published"] },
      withdrawnAt: null,
    },
    select: {
      id: true,
      title: true,
      primaryArtist: true,
      tracks: {
        ...(invocation.trackId ? { where: { id: invocation.trackId } } : {}),
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!release) {
    fail("The target release must belong to the analytics artist and be ready or published and unwithdrawn");
  }
  if (release.tracks.length === 0) {
    fail(invocation.trackId
      ? "--track-id must identify a track on the selected release"
      : "The target release must contain at least one track before Scene Scout acceptance can run");
  }

  const showsArtist = await prisma.artist.findUnique({
    where: { id: invocation.showArtistId },
    select: { id: true, displayName: true },
  });
  if (!showsArtist) fail("--show-artist-id must identify an existing artist profile");
  const credited = await prisma.releaseArtistCredit.findFirst({
    where: {
      releaseId: release.id,
      artistId: showsArtist.id,
      role: { in: ["main", "primary"] },
      identityStatus: { not: "ambiguous" },
    },
    select: { id: true },
  });
  const canonicalOwnerCredit = showsArtist.id === artist.id && (
    release.primaryArtist === null ||
    release.primaryArtist === "" ||
    release.primaryArtist.toLowerCase() === showsArtist.displayName.trim().toLowerCase()
  );
  if (!credited && !canonicalOwnerCredit) {
    fail("The selected Shows artist has no Shows-compatible main/primary nonambiguous credit or canonical owner primaryArtist; resolve source credits before seeding");
  }

  return {
    artistId: artist.id,
    showArtistId: showsArtist.id,
    releaseId: release.id,
    releaseTitle: release.title,
    trackId: release.tracks[0].id,
  };
}

function buildAnalyticsEvent(input: {
  prefix: string;
  releaseId: string;
  trackId: string;
  ordinal: number;
  kind: SceneScoutAcceptanceEventKind;
  actorId: string;
  occurredAt: Date;
  receivedAt: Date;
  citySlug: string;
  countryCode: string;
}): AnalyticsEventEnvelope {
  const eventName = input.kind === "playback_completed" ? "playback.completed" : "library.saved";
  const sourceRefs = {
    acceptanceFixturePrefix: input.prefix,
    acceptanceReleaseId: input.releaseId,
    trackId: input.trackId,
    listenerOrdinal: String(input.ordinal).padStart(2, "0"),
    acceptanceEvent: input.kind,
  };
  const payload = {
    source: "web_player",
    synthetic: true,
    acceptanceFixturePrefix: input.prefix,
    acceptanceReleaseId: input.releaseId,
    trackId: input.trackId,
    ...(input.kind === "playback_completed" ? { completionRatio: 0.95 } : {}),
  };
  return normalizeAnalyticsEventInput({
    eventId: sceneScoutAcceptanceEventId(input.prefix, input.ordinal, input.kind),
    eventName,
    eventVersion: 1,
    occurredAt: input.occurredAt.toISOString(),
    receivedAt: input.receivedAt.toISOString(),
    producer: SCENE_SCOUT_ACCEPTANCE_PRODUCER,
    environment: "staging",
    privacyTier: "pseudonymous",
    subjectType: "track",
    subjectId: input.trackId,
    actorId: input.actorId,
    consentBasis: "consent",
    geo: {
      countryCode: input.countryCode,
      citySlug: input.citySlug,
      source: "user_declared",
      precision: "city",
    },
    payload,
    sourceRefs,
  }, { now: input.receivedAt, defaultEnvironment: "staging" });
}

function toPrismaEvent(event: AnalyticsEventEnvelope) {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    eventVersion: event.eventVersion,
    occurredAt: new Date(event.occurredAt),
    receivedAt: new Date(event.receivedAt),
    producer: event.producer,
    environment: event.environment,
    privacyTier: event.privacyTier,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    actorId: event.actorId,
    consentBasis: event.consentBasis,
    schemaUri: event.schemaUri,
    payload: event.payload as Prisma.InputJsonValue,
    sourceRefs: event.sourceRefs as Prisma.InputJsonValue,
    envelope: event as unknown as Prisma.InputJsonValue,
  };
}

type AcceptanceTransaction = Prisma.TransactionClient;

async function findPrefixedUsers(client: AcceptanceTransaction, prefix: string, take: number) {
  return client.user.findMany({
    where: { id: { startsWith: prefix } },
    orderBy: { id: "asc" },
    take,
    select: { id: true, email: true },
  });
}

async function findPrefixedEvents(client: AcceptanceTransaction, prefix: string, take: number) {
  return client.analyticsEvent.findMany({
    where: {
      OR: [
        { eventId: { startsWith: prefix } },
        { payload: { path: ["acceptanceFixturePrefix"], equals: prefix } },
      ],
    },
    orderBy: { eventId: "asc" },
    take,
    select: {
      eventId: true,
      eventName: true,
      eventVersion: true,
      occurredAt: true,
      receivedAt: true,
      producer: true,
      environment: true,
      privacyTier: true,
      subjectType: true,
      subjectId: true,
      actorId: true,
      consentBasis: true,
      schemaUri: true,
      payload: true,
      sourceRefs: true,
      envelope: true,
    },
  });
}

async function assertNoFixtureCollision(client: AcceptanceTransaction, prefix: string) {
  const [users, events] = await Promise.all([
    findPrefixedUsers(client, prefix, 1),
    findPrefixedEvents(client, prefix, 1),
  ]);
  if (users.length > 0 || events.length > 0) {
    fail("Fixture prefix already contains data; seed refused without changing existing rows");
  }
}

async function seedFixture(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  listenerCount: number,
) {
  const prefix = sceneScoutAcceptancePrefix(invocation);
  const now = new Date();
  const decidedAt = new Date(now.getTime() - CONSENT_LEAD_MS);
  const completedAt = new Date(now.getTime() - COMPLETION_LEAD_MS);
  const savedAt = new Date(now.getTime() - SAVE_LEAD_MS);
  const receivedAt = now;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${prefix}, 0)) IS NULL AS acquired
    `);
    await assertNoFixtureCollision(tx, prefix);

    const users = Array.from({ length: listenerCount }, (_, ordinal) => {
      const id = sceneScoutAcceptanceUserId(prefix, ordinal);
      return { id, email: `${id}@test.resonate` };
    });
    await tx.user.createMany({ data: users });
    await tx.analyticsConsent.createMany({
      data: users.map(({ id }) => ({
        userId: id,
        productAnalytics: true,
        policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
        decidedAt,
      })),
    });

    const events = users.flatMap(({ id }, ordinal) => {
      const actorId = pseudonymousAnalyticsActorId(id);
      if (!actorId) fail("Could not derive a pseudonymous fixture actor id");
      return [
        buildAnalyticsEvent({
          prefix,
          releaseId: target.releaseId,
          trackId: target.trackId,
          ordinal,
          kind: "playback_completed",
          actorId,
          occurredAt: completedAt,
          receivedAt,
          citySlug: invocation.citySlug,
          countryCode: invocation.countryCode,
        }),
        buildAnalyticsEvent({
          prefix,
          releaseId: target.releaseId,
          trackId: target.trackId,
          ordinal,
          kind: "library_saved",
          actorId,
          occurredAt: savedAt,
          receivedAt,
          citySlug: invocation.citySlug,
          countryCode: invocation.countryCode,
        }),
      ];
    });
    await tx.analyticsEvent.createMany({ data: events.map(toPrismaEvent) });
  });

  const verification = await verifyFixture(invocation, target, listenerCount);
  return {
    phase: "seed",
    result: verification.result === "verified" ? "verified" : "seeded_but_blocked",
    provenance: "synthetic_acceptance_fixture",
    analyticsArtistId: target.artistId,
    showArtistId: target.showArtistId,
    releaseId: target.releaseId,
    listenersCreated: listenerCount,
    eventsCreated: listenerCount * 2,
    verification,
    note: "Synthetic acceptance evidence only; it is not genuine listener demand.",
  } satisfies SafeResult;
}

function objectFromJson(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return isJsonRecord(value) ? value : null;
}

function expectedKindFromEventName(eventName: string): SceneScoutAcceptanceEventKind | null {
  if (eventName === "playback.completed") return "playback_completed";
  if (eventName === "library.saved") return "library_saved";
  return null;
}

function assertSameScalarEvent(event: FixtureEventRow, envelope: AnalyticsEventEnvelope) {
  return event.eventId === envelope.eventId &&
    event.eventName === envelope.eventName &&
    event.eventVersion === envelope.eventVersion &&
    event.occurredAt.getTime() === new Date(envelope.occurredAt).getTime() &&
    event.receivedAt.getTime() === new Date(envelope.receivedAt).getTime() &&
    event.producer === envelope.producer &&
    event.environment === envelope.environment &&
    event.privacyTier === envelope.privacyTier &&
    event.subjectType === envelope.subjectType &&
    event.subjectId === envelope.subjectId &&
    event.actorId === envelope.actorId &&
    event.consentBasis === envelope.consentBasis &&
    event.schemaUri === envelope.schemaUri;
}

function validateFixtureOwnership(input: {
  invocation: SceneScoutAcceptanceInvocation;
  prefix: string;
  users: FixtureUserRow[];
  consents: FixtureConsentRow[];
  events: FixtureEventRow[];
  requireCompleteConsentAndEventPairs: boolean;
}) {
  const { invocation, prefix, users, consents, events, requireCompleteConsentAndEventPairs } = input;
  if (users.length > SCENE_SCOUT_ACCEPTANCE_MAX_USERS || events.length > SCENE_SCOUT_ACCEPTANCE_MAX_EVENTS) {
    fail("Fixture prefix exceeds its safe user or event scan limit; refusing changes");
  }
  if (users.length === 0 && events.length === 0 && consents.length === 0) {
    return { userIds: [] as string[], eventIds: [] as string[], listenerCount: 0, eventCount: 0 };
  }
  const userIdByOrdinal = new Map<number, string>();
  for (const user of users) {
    const ordinal = Array.from({ length: SCENE_SCOUT_ACCEPTANCE_MAX_USERS }, (_, index) => index)
      .find((index) => sceneScoutAcceptanceUserId(prefix, index) === user.id);
    if (ordinal === undefined || user.email !== `${user.id}@test.resonate` || userIdByOrdinal.has(ordinal)) {
      fail("Fixture user marker collision detected; refusing changes to unexpected ownership");
    }
    userIdByOrdinal.set(ordinal, user.id);
  }

  const consentByUserId = new Map<string, FixtureConsentRow>();
  for (const consent of consents) {
    if (!users.some(({ id }) => id === consent.userId) || consentByUserId.has(consent.userId)) {
      fail("Fixture consent marker collision detected; refusing changes to unexpected consent ownership");
    }
    consentByUserId.set(consent.userId, consent);
  }
  if (requireCompleteConsentAndEventPairs) {
    if (consents.length !== users.length) {
      fail("Fixture consent rows are incomplete; refusing verification");
    }
    for (const consent of consents) {
      if (!consent.productAnalytics || consent.policyVersion !== ANALYTICS_CONSENT_POLICY_VERSION) {
        fail("Fixture current-policy consent is missing or no longer affirmative; verification is blocked");
      }
    }
  }

  const validatedEventIds = new Set<string>();
  const eventsByOrdinal = new Map<number, Map<SceneScoutAcceptanceEventKind, FixtureEventRow>>();
  let commonTrackId: string | undefined;
  for (const event of events) {
    const kind = expectedKindFromEventName(event.eventName);
    const eventOrdinal = Array.from({ length: SCENE_SCOUT_ACCEPTANCE_MAX_USERS }, (_, index) => index).find((ordinal) =>
      kind !== null && sceneScoutAcceptanceEventId(prefix, ordinal, kind) === event.eventId,
    );
    if (!kind || eventOrdinal === undefined || validatedEventIds.has(event.eventId)) {
      fail("Fixture event marker collision detected; refusing changes to unexpected ownership");
    }
    const userId = userIdByOrdinal.get(eventOrdinal);
    if (requireCompleteConsentAndEventPairs && !userId) {
      fail("Fixture event has no matching synthetic user; verification is blocked");
    }
    const actorId = userId ? pseudonymousAnalyticsActorId(userId) : undefined;
    const payload = objectFromJson(event.payload);
    const envelopeValue = objectFromJson(event.envelope);
    if (!payload || !envelopeValue) {
      fail("Fixture event is missing its immutable payload markers; refusing changes");
    }
    let envelope: AnalyticsEventEnvelope;
    try {
      envelope = parseAnalyticsEventEnvelope(envelopeValue);
    } catch {
      fail("Fixture event envelope is invalid; refusing changes to unexpected ownership");
    }
    const envelopePayload = isJsonRecord(envelope.payload) ? envelope.payload : null;
    const geo = envelope.geo;
    const sourceRefs = envelope.sourceRefs;
    const completedPayload = kind === "playback_completed";
    const expectedPayloadKeys = [
      "source",
      "synthetic",
      "acceptanceFixturePrefix",
      "acceptanceReleaseId",
      "trackId",
      ...(completedPayload ? ["completionRatio"] : []),
    ];
    const expectedSourceRefs = {
      acceptanceFixturePrefix: prefix,
      acceptanceReleaseId: invocation.releaseId,
      trackId: payload.trackId,
      listenerOrdinal: String(eventOrdinal).padStart(2, "0"),
      acceptanceEvent: kind,
    };
    if (
      event.producer !== SCENE_SCOUT_ACCEPTANCE_PRODUCER ||
      event.environment !== "staging" ||
      event.privacyTier !== "pseudonymous" ||
      event.consentBasis !== "consent" ||
      event.subjectType !== "track" ||
      event.subjectId !== payload.trackId ||
      (requireCompleteConsentAndEventPairs && event.actorId !== actorId) ||
      payload.source !== "web_player" ||
      payload.synthetic !== true ||
      payload.acceptanceFixturePrefix !== prefix ||
      payload.acceptanceReleaseId !== invocation.releaseId ||
      typeof payload.trackId !== "string" ||
      payload.trackId.length === 0 ||
      (invocation.trackId !== undefined && payload.trackId !== invocation.trackId) ||
      (commonTrackId !== undefined && commonTrackId !== payload.trackId) ||
      (completedPayload && (typeof payload.completionRatio !== "number" || payload.completionRatio < 0.9)) ||
      !exactKeys(payload, expectedPayloadKeys) ||
      !envelopePayload ||
      !isDeepStrictEqual(envelopePayload, payload) ||
      !geo ||
      geo.countryCode !== invocation.countryCode ||
      geo.citySlug !== invocation.citySlug ||
      geo.source !== "user_declared" ||
      geo.precision !== "city" ||
      !isDeepStrictEqual(sourceRefs, expectedSourceRefs) ||
      !isDeepStrictEqual(event.sourceRefs, expectedSourceRefs) ||
      !assertSameScalarEvent(event, envelope)
    ) {
      fail("Fixture event marker collision detected; refusing changes to unexpected ownership");
    }
    if (requireCompleteConsentAndEventPairs) {
      const consent = userId ? consentByUserId.get(userId) : undefined;
      if (!actorId || event.actorId !== actorId || !consent || event.occurredAt <= consent.decidedAt) {
        fail("Fixture event does not match current fixture consent; verification is blocked");
      }
    } else if (!event.actorId || !/^user_[0-9a-f]{32}$/i.test(event.actorId)) {
      fail("Fixture event actor marker is invalid; refusing changes to unexpected ownership");
    }
    commonTrackId = payload.trackId;
    const group = eventsByOrdinal.get(eventOrdinal) ?? new Map<SceneScoutAcceptanceEventKind, FixtureEventRow>();
    if (group.has(kind)) fail("Fixture event marker collision detected; refusing changes to unexpected ownership");
    group.set(kind, event);
    eventsByOrdinal.set(eventOrdinal, group);
    validatedEventIds.add(event.eventId);
  }

  if (requireCompleteConsentAndEventPairs) {
    if (users.length === 0 || events.length !== users.length * 2) {
      fail("The expected complete fixture is not present; verification is blocked");
    }
    for (const ordinal of userIdByOrdinal.keys()) {
      const grouped = eventsByOrdinal.get(ordinal);
      const completed = grouped?.get("playback_completed");
      const saved = grouped?.get("library_saved");
      if (!completed || !saved || completed.occurredAt >= saved.occurredAt) {
        fail("Fixture listener event pairs are incomplete or out of order; verification is blocked");
      }
    }
    if (validatedEventIds.size !== events.length) {
      fail("Fixture event count does not match its users; verification is blocked");
    }
  }

  return {
    userIds: users.map(({ id }) => id),
    eventIds: events.map(({ eventId }) => eventId),
    listenerCount: users.length,
    eventCount: events.length,
  };
}

async function inspectFixture(
  client: AcceptanceTransaction,
  invocation: SceneScoutAcceptanceInvocation,
  prefix: string,
  requireCompleteConsentAndEventPairs: boolean,
) {
  const [users, events] = await Promise.all([
    findPrefixedUsers(client, prefix, SCENE_SCOUT_ACCEPTANCE_MAX_USERS + 1),
    findPrefixedEvents(client, prefix, SCENE_SCOUT_ACCEPTANCE_MAX_EVENTS + 1),
  ]);
  if (users.length > SCENE_SCOUT_ACCEPTANCE_MAX_USERS || events.length > SCENE_SCOUT_ACCEPTANCE_MAX_EVENTS) {
    fail("Fixture prefix exceeds its safe user or event scan limit; refusing changes");
  }
  const consents = users.length === 0
    ? []
    : await client.analyticsConsent.findMany({
        where: { userId: { in: users.map(({ id }) => id) } },
        orderBy: { userId: "asc" },
        select: { userId: true, productAnalytics: true, policyVersion: true, decidedAt: true },
      });
  return validateFixtureOwnership({ invocation, prefix, users, consents, events, requireCompleteConsentAndEventPairs });
}

async function refuseIfFixturesHaveCredentials(client: AcceptanceTransaction, userIds: string[]) {
  if (userIds.length === 0) return;
  const [wallets, sessions, passkeys, sessionKeys] = await Promise.all([
    client.wallet.findMany({ where: { userId: { in: userIds } }, select: { id: true }, take: 1 }),
    client.session.findMany({ where: { userId: { in: userIds } }, select: { id: true }, take: 1 }),
    client.passkeyIdentity.findMany({ where: { userId: { in: userIds } }, select: { id: true }, take: 1 }),
    client.sessionKey.findMany({ where: { userId: { in: userIds } }, select: { id: true }, take: 1 }),
  ]);
  if (wallets.length || sessions.length || passkeys.length || sessionKeys.length) {
    fail("A fixture user has wallet or authentication data; refusing to delete that account");
  }
}

async function refreshArtistSnapshots(artistId: string) {
  const result = await new SceneScoutService().getArtistSceneScout(artistId);
  return { status: result.status, cityRows: result.cityDemand.length };
}

async function cleanupFixture(invocation: SceneScoutAcceptanceInvocation) {
  const prefix = sceneScoutAcceptancePrefix(invocation);
  const deleted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${prefix}, 0)) IS NULL AS acquired
    `);
    const owned = await inspectFixture(tx, invocation, prefix, false);
    await refuseIfFixturesHaveCredentials(tx, owned.userIds);
    if (owned.eventIds.length > 0) {
      await tx.analyticsEvent.deleteMany({ where: { eventId: { in: owned.eventIds } } });
    }
    if (owned.userIds.length > 0) {
      await tx.analyticsConsent.deleteMany({ where: { userId: { in: owned.userIds } } });
      await tx.user.deleteMany({ where: { id: { in: owned.userIds } } });
    }
    return owned;
  });

  const snapshots = await refreshArtistSnapshots(invocation.artistId);
  return {
    phase: "cleanup",
    result: "cleaned",
    provenance: "synthetic_acceptance_fixture",
    analyticsArtistId: invocation.artistId,
    showArtistId: invocation.showArtistId,
    listenersDeleted: deleted.listenerCount,
    eventsDeleted: deleted.eventCount,
    snapshots,
    note: "Cleanup removed verified local database fixture rows. Downstream staging exports require separate reconciliation.",
  } satisfies SafeResult;
}

async function verifyFixture(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  listenerCount: number,
) {
  const prefix = sceneScoutAcceptancePrefix(invocation);
  const fixture = await prisma.$transaction(async (tx) => inspectFixture(tx, invocation, prefix, true));
  if (fixture.listenerCount !== listenerCount || fixture.eventCount !== listenerCount * 2) {
    fail("The expected complete fixture is not present; run seed and verify the same target and city");
  }

  const result = await new SceneScoutService().getArtistSceneScout(invocation.artistId);
  const card = sceneScoutCityCards(result).find((candidate) => {
    const href = candidate.cta.href;
    return candidate.type === "propose_show_city" &&
      typeof href === "string" &&
      href.startsWith("/shows/create?") &&
      href.includes(`city=${encodeURIComponent(invocation.citySlug)}`) &&
      href.includes(`country=${encodeURIComponent(invocation.countryCode)}`) &&
      href.includes(`releaseId=${encodeURIComponent(target.releaseId)}`);
  });
  const relativeCta = card?.cta.href;
  if (!card || typeof relativeCta !== "string") {
    return {
      phase: "verify",
      result: "blocked",
      provenance: "synthetic_acceptance_fixture",
      status: result.status,
      reason: result.reason ?? "The requested city did not produce a visible Scene Scout card.",
      note: "Synthetic acceptance evidence only; it is not genuine listener demand.",
    } satisfies SafeResult;
  }

  const row = result.cityDemand
    .filter((candidate) =>
      candidate.releaseId === target.releaseId &&
      candidate.citySlug === invocation.citySlug &&
      candidate.countryCode === invocation.countryCode,
    )
    .sort((a, b) => b.windowDays - a.windowDays)[0];
  return {
    phase: "verify",
    result: "verified",
    provenance: "synthetic_acceptance_fixture",
    releaseId: target.releaseId,
    analyticsArtistId: target.artistId,
    showArtistId: target.showArtistId,
    city: { citySlug: invocation.citySlug, countryCode: invocation.countryCode },
    aggregate: row
      ? {
          uniqueListeners: row.uniqueListeners,
          resonantListeners: row.resonantListeners,
          saves: row.saves,
          signalCount: row.signalCount,
          windowDays: row.windowDays,
        }
      : undefined,
    relativeCta,
    note: "This card was verified with synthetic acceptance data; it is not genuine listener demand. Staging exporters may copy these rows downstream.",
  } satisfies SafeResult;
}

/**
 * Execute a parsed invocation. Preview performs reads only and never invokes
 * SceneScoutService. CLI: `[preview|seed|verify|cleanup] --artist-id <id>
 * --release-id <id> --run-id <id> --city-slug <slug> --country-code <cc>`;
 * `--show-artist-id` and `--track-id` are optional selectors.
 */
export async function runSceneScoutAcceptance(
  invocation: SceneScoutAcceptanceInvocation,
): Promise<SafeResult> {
  assertSceneScoutAcceptanceStagingEnvironment();
  assertSceneScoutAcceptanceMutationRequirements(invocation);

  if (invocation.phase === "cleanup") {
    return cleanupFixture(invocation);
  }

  const listenerCount = requiredListenerCount();
  const target = await requireEligibleTarget(invocation);
  if (invocation.phase === "preview") {
    const prefix = sceneScoutAcceptancePrefix(invocation);
    return {
      phase: "preview",
      result: "preview_only",
      provenance: "synthetic_acceptance_fixture",
      releaseId: target.releaseId,
      analyticsArtistId: target.artistId,
      showArtistId: target.showArtistId,
      trackId: target.trackId,
      city: { citySlug: invocation.citySlug, countryCode: invocation.countryCode },
      planned: { syntheticListeners: listenerCount, events: listenerCount * 2 },
      fixtureNamespace: prefix,
      wouldWrite: false,
    } satisfies SafeResult;
  }
  if (invocation.phase === "seed") return seedFixture(invocation, target, listenerCount);
  return verifyFixture(invocation, target, listenerCount);
}

async function main(args: string[]) {
  const invocation = parseSceneScoutAcceptanceArgs(args);
  const result = await runSceneScoutAcceptance(invocation);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.result === "blocked" || result.result === "seeded_but_blocked") process.exitCode = 1;
}

if (require.main === module) {
  void main(process.argv.slice(2))
    .catch((error: unknown) => {
      if (error instanceof SceneScoutAcceptanceError || error instanceof SceneScoutAcceptanceInputError) {
        process.stderr.write(`[scene_scout_acceptance] ${error.message}\n`);
      } else {
        // Prisma errors can include connection configuration; do not print raw database errors.
        process.stderr.write("[scene_scout_acceptance] database operation failed; details are withheld\n");
      }
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect().catch(() => undefined));
}
