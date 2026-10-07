import "dotenv/config";
import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "util";
import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import {
  ANALYTICS_CONSENT_POLICY_VERSION,
  AnalyticsConsentService,
} from "../modules/analytics/analytics_consent.service";
import { AnalyticsAuthorizationService } from "../modules/analytics/analytics_authorization.service";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import {
  normalizeAnalyticsEventInput,
  parseAnalyticsEventEnvelope,
  type AnalyticsEventEnvelope,
} from "../modules/analytics/analytics_event";
import { sceneScoutCityCards } from "../modules/analytics/analytics_scene_scout";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";
import { erasedEmailFor } from "../modules/privacy/personal_data_erasure_manifest";
import { measuredTrackFeatures } from "../modules/agents/measured_track_features";
import type { CrateCandidateFacts } from "../modules/crates/crate.types";
import { SceneScoutService, sceneScoutMinimumAudience } from "../modules/scene_scout/scene_scout.service";
import { UnmetDemandService } from "../modules/scene_scout/unmet_demand.service";
import {
  assertSceneScoutAcceptanceMutationRequirements,
  assertSceneScoutAcceptanceStagingEnvironment,
  parseSceneScoutAcceptanceArgs,
  planSceneScoutAcceptanceUnmetGap,
  SceneScoutAcceptanceInputError,
  SCENE_SCOUT_ACCEPTANCE_ERASE_ORDINAL,
  SCENE_SCOUT_ACCEPTANCE_MARKER_EVENT_NAME,
  SCENE_SCOUT_ACCEPTANCE_MARKER_KINDS,
  SCENE_SCOUT_ACCEPTANCE_MAX_EVENTS,
  SCENE_SCOUT_ACCEPTANCE_MAX_USERS,
  SCENE_SCOUT_ACCEPTANCE_PRODUCER,
  SCENE_SCOUT_ACCEPTANCE_WITHDRAW_ORDINAL,
  sceneScoutAcceptanceCrateRequestId,
  sceneScoutAcceptanceEventId,
  sceneScoutAcceptanceMarkerEventId,
  sceneScoutAcceptancePrefix,
  sceneScoutAcceptanceUserId,
  type SceneScoutAcceptanceEventKind,
  type SceneScoutAcceptanceMarkerKind,
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

interface ValidatedMarker {
  ordinal: number;
  kind: SceneScoutAcceptanceMarkerKind;
  eventId: string;
  occurredAt: Date;
  /** Present on `erased_account` markers: the fresh id the erasure gave the fixture account. */
  erasedUserId?: string;
}

function sameNullable(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? null) === (right ?? null);
}

/**
 * A marker is the tool's own record that one fixture account was erased: the
 * erasure rotates the account id, so the deterministic fixture id can no longer
 * find it. Markers carry no actor, subject, consent basis or geography.
 */
function validateMarkerEvent(
  event: FixtureEventRow,
  prefix: string,
  invocation: SceneScoutAcceptanceInvocation,
): ValidatedMarker {
  const refuse = (): never => fail("Fixture marker collision detected; refusing changes to unexpected ownership");
  let identified: { ordinal: number; kind: SceneScoutAcceptanceMarkerKind } | undefined;
  for (const kind of SCENE_SCOUT_ACCEPTANCE_MARKER_KINDS) {
    for (let ordinal = 0; ordinal < SCENE_SCOUT_ACCEPTANCE_MAX_USERS; ordinal += 1) {
      if (sceneScoutAcceptanceMarkerEventId(prefix, ordinal, kind) === event.eventId) {
        identified = { ordinal, kind };
      }
    }
  }
  if (!identified || event.eventName !== SCENE_SCOUT_ACCEPTANCE_MARKER_EVENT_NAME) return refuse();

  const payload = objectFromJson(event.payload);
  const envelopeValue = objectFromJson(event.envelope);
  if (!payload || !envelopeValue) return refuse();
  let envelope: AnalyticsEventEnvelope;
  try {
    envelope = parseAnalyticsEventEnvelope(envelopeValue);
  } catch {
    return refuse();
  }
  const erased = identified.kind === "erased_account";
  const expectedPayloadKeys = [
    "synthetic",
    "acceptanceFixturePrefix",
    "acceptanceReleaseId",
    "markerKind",
    "listenerOrdinal",
    ...(erased ? ["erasedUserId"] : []),
  ];
  const expectedSourceRefs = {
    acceptanceFixturePrefix: prefix,
    acceptanceReleaseId: invocation.releaseId,
    listenerOrdinal: String(identified.ordinal).padStart(2, "0"),
    acceptanceEvent: identified.kind,
  };
  const erasedUserId = payload.erasedUserId;
  if (
    event.producer !== SCENE_SCOUT_ACCEPTANCE_PRODUCER ||
    event.environment !== "staging" ||
    event.privacyTier !== "anonymous" ||
    event.eventVersion !== 1 ||
    event.subjectType !== null ||
    event.subjectId !== null ||
    event.actorId !== null ||
    event.consentBasis !== null ||
    payload.synthetic !== true ||
    payload.acceptanceFixturePrefix !== prefix ||
    payload.acceptanceReleaseId !== invocation.releaseId ||
    payload.markerKind !== identified.kind ||
    payload.listenerOrdinal !== expectedSourceRefs.listenerOrdinal ||
    !exactKeys(payload, expectedPayloadKeys) ||
    (erased && (typeof erasedUserId !== "string" || erasedUserId.length === 0 || erasedUserId.length > 200)) ||
    !isDeepStrictEqual(envelope.payload, payload) ||
    !isDeepStrictEqual(envelope.sourceRefs, expectedSourceRefs) ||
    !isDeepStrictEqual(event.sourceRefs, expectedSourceRefs) ||
    envelope.eventId !== event.eventId ||
    envelope.eventName !== event.eventName ||
    envelope.producer !== event.producer ||
    envelope.environment !== event.environment ||
    envelope.privacyTier !== event.privacyTier ||
    !sameNullable(envelope.subjectType, event.subjectType) ||
    !sameNullable(envelope.subjectId, event.subjectId) ||
    !sameNullable(envelope.actorId, event.actorId) ||
    !sameNullable(envelope.consentBasis, event.consentBasis) ||
    envelope.geo !== undefined ||
    new Date(envelope.occurredAt).getTime() !== event.occurredAt.getTime()
  ) {
    return refuse();
  }
  return {
    ordinal: identified.ordinal,
    kind: identified.kind,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    ...(erased ? { erasedUserId: erasedUserId as string } : {}),
  };
}

function validateFixtureOwnership(input: {
  invocation: SceneScoutAcceptanceInvocation;
  prefix: string;
  users: FixtureUserRow[];
  consents: FixtureConsentRow[];
  events: FixtureEventRow[];
  requireCompleteConsentAndEventPairs: boolean;
}) {
  const { invocation, prefix, users, consents, requireCompleteConsentAndEventPairs } = input;
  const allEvents = input.events;
  if (users.length > SCENE_SCOUT_ACCEPTANCE_MAX_USERS || allEvents.length > SCENE_SCOUT_ACCEPTANCE_MAX_EVENTS) {
    fail("Fixture prefix exceeds its safe user or event scan limit; refusing changes");
  }
  const markerRows = allEvents.filter((event) => event.eventName === SCENE_SCOUT_ACCEPTANCE_MARKER_EVENT_NAME);
  const events = allEvents.filter((event) => event.eventName !== SCENE_SCOUT_ACCEPTANCE_MARKER_EVENT_NAME);
  if (users.length === 0 && allEvents.length === 0 && consents.length === 0) {
    return {
      userIds: [] as string[],
      eventIds: [] as string[],
      markerEventIds: [] as string[],
      markers: [] as ValidatedMarker[],
      listenerCount: 0,
      eventCount: 0,
    };
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

  const markers = markerRows.map((event) => validateMarkerEvent(event, prefix, invocation));
  const markerKeys = new Set(markers.map(({ ordinal, kind }) => `${ordinal}:${kind}`));
  if (markerKeys.size !== markers.length) {
    fail("Fixture marker collision detected; refusing changes to unexpected ownership");
  }

  return {
    userIds: users.map(({ id }) => id),
    eventIds: events.map(({ eventId }) => eventId),
    markerEventIds: markers.map(({ eventId }) => eventId),
    markers,
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
  const owned = validateFixtureOwnership({ invocation, prefix, users, consents, events, requireCompleteConsentAndEventPairs });
  if (requireCompleteConsentAndEventPairs && owned.markers.length > 0) {
    fail("The fixture already ran an erase scenario and is no longer complete; clean it up and seed a fresh run");
  }
  const erasedUserIds = await resolveErasedFixtureAccounts(client, prefix, owned.userIds, owned.markers);
  return { ...owned, erasedUserIds };
}

/**
 * Erasure rotates a fixture account's id, so its deterministic id no longer
 * finds it. The tool's own marker records the new id; the account is accepted
 * only when it is verifiably an erased account created after the marker began.
 */
async function resolveErasedFixtureAccounts(
  client: AcceptanceTransaction,
  prefix: string,
  liveUserIds: string[],
  markers: ValidatedMarker[],
) {
  const erasedUserIds: string[] = [];
  const ordinals = [...new Set(markers.map(({ ordinal }) => ordinal))].sort((a, b) => a - b);
  for (const ordinal of ordinals) {
    const started = markers.find((marker) => marker.ordinal === ordinal && marker.kind === "erasure_started");
    const account = markers.find((marker) => marker.ordinal === ordinal && marker.kind === "erased_account");
    const originalAlive = liveUserIds.includes(sceneScoutAcceptanceUserId(prefix, ordinal));
    if (!account) {
      if (!originalAlive) {
        fail("An erased fixture account cannot be identified because its marker is missing; refusing changes, inspect manually");
      }
      continue;
    }
    const erasedUserId = account.erasedUserId!;
    const row = await client.user.findUnique({
      where: { id: erasedUserId },
      select: { id: true, email: true, erasedAt: true, closedAt: true },
    });
    if (!row) continue; // Already removed.
    if (
      originalAlive ||
      !row.erasedAt ||
      !row.closedAt ||
      row.email !== erasedEmailFor(row.id) ||
      (started && row.erasedAt.getTime() < started.occurredAt.getTime())
    ) {
      fail("Erased fixture account marker collision detected; refusing changes to unexpected ownership");
    }
    erasedUserIds.push(row.id);
  }
  return erasedUserIds;
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


type SceneScoutReadResult = Awaited<ReturnType<SceneScoutService["getArtistSceneScout"]>>;

interface CityAggregate {
  uniqueListeners: number;
  resonantListeners: number;
  saves: number;
  signalCount: number;
  windowDays: number;
}

async function refreshArtistSnapshots(artistId: string) {
  const result = await new SceneScoutService().getArtistSceneScout(artistId);
  return { status: result.status, cityRows: result.cityDemand.length };
}

async function refreshUnmetDemandSnapshots(artistId: string) {
  const result = await new UnmetDemandService().getArtistUnmetDemand(artistId);
  return { status: result.status, rows: result.demand.length };
}

async function cleanupFixture(invocation: SceneScoutAcceptanceInvocation) {
  const prefix = sceneScoutAcceptancePrefix(invocation);
  const deleted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${prefix}, 0)) IS NULL AS acquired
    `);
    const owned = await inspectFixture(tx, invocation, prefix, false);
    // Erased fixture accounts keep a rotated id and a retained consent row; they are
    // included only because the tool's own validated marker names them.
    const accountIds = [...owned.userIds, ...owned.erasedUserIds];
    await refuseIfFixturesHaveCredentials(tx, accountIds);
    let demandObservationsDeleted = 0;
    if (accountIds.length > 0) {
      demandObservationsDeleted = (await tx.demandObservation.deleteMany({ where: { userId: { in: accountIds } } })).count;
    }
    const eventIds = [...owned.eventIds, ...owned.markerEventIds];
    if (eventIds.length > 0) {
      await tx.analyticsEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    }
    if (accountIds.length > 0) {
      await tx.analyticsConsent.deleteMany({ where: { userId: { in: accountIds } } });
      await tx.user.deleteMany({ where: { id: { in: accountIds } } });
    }
    return { ...owned, demandObservationsDeleted };
  });

  const snapshots = await refreshArtistSnapshots(invocation.artistId);
  const unmetDemandSnapshots = await refreshUnmetDemandSnapshots(invocation.artistId);
  return {
    phase: "cleanup",
    result: "cleaned",
    provenance: "synthetic_acceptance_fixture",
    analyticsArtistId: invocation.artistId,
    showArtistId: invocation.showArtistId,
    listenersDeleted: deleted.listenerCount,
    erasedAccountsDeleted: deleted.erasedUserIds.length,
    eventsDeleted: deleted.eventCount,
    markerEventsDeleted: deleted.markerEventIds.length,
    demandObservationsDeleted: deleted.demandObservationsDeleted,
    snapshots,
    unmetDemandSnapshots,
    note: "Cleanup removed verified local database fixture rows. Downstream staging exports require separate reconciliation.",
  } satisfies SafeResult;
}

/** Validates the complete, intact seeded fixture; refuses when it is absent or changed. */
async function assertCompleteFixture(invocation: SceneScoutAcceptanceInvocation, listenerCount: number) {
  const prefix = sceneScoutAcceptancePrefix(invocation);
  const fixture = await prisma.$transaction(async (tx) => inspectFixture(tx, invocation, prefix, true));
  if (fixture.listenerCount !== listenerCount || fixture.eventCount !== listenerCount * 2) {
    fail("The expected complete fixture is not present; run seed and verify the same target and city");
  }
  return fixture;
}

async function readCityEvidence(invocation: SceneScoutAcceptanceInvocation, target: EligibleTarget) {
  const result: SceneScoutReadResult = await new SceneScoutService().getArtistSceneScout(invocation.artistId);
  const card = sceneScoutCityCards(result).find((candidate) => {
    const href = candidate.cta.href;
    return candidate.type === "propose_show_city" &&
      typeof href === "string" &&
      href.startsWith("/shows/create?") &&
      href.includes(`city=${encodeURIComponent(invocation.citySlug)}`) &&
      href.includes(`country=${encodeURIComponent(invocation.countryCode)}`) &&
      href.includes(`releaseId=${encodeURIComponent(target.releaseId)}`);
  });
  const row = result.cityDemand
    .filter((candidate) =>
      candidate.releaseId === target.releaseId &&
      candidate.citySlug === invocation.citySlug &&
      candidate.countryCode === invocation.countryCode,
    )
    .sort((a, b) => b.windowDays - a.windowDays)[0];
  const aggregate: CityAggregate | undefined = row
    ? {
        uniqueListeners: row.uniqueListeners,
        resonantListeners: row.resonantListeners,
        saves: row.saves,
        signalCount: row.signalCount,
        windowDays: row.windowDays,
      }
    : undefined;
  const relativeCta = card?.cta.href;
  return {
    result,
    card,
    relativeCta: typeof relativeCta === "string" ? relativeCta : undefined,
    aggregate,
  };
}

async function verifyFixture(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  listenerCount: number,
) {
  await assertCompleteFixture(invocation, listenerCount);
  const { result, card, relativeCta, aggregate } = await readCityEvidence(invocation, target);
  if (!card || relativeCta === undefined) {
    return {
      phase: "verify",
      result: "blocked",
      provenance: "synthetic_acceptance_fixture",
      status: result.status,
      reason: result.reason ?? "The requested city did not produce a visible Scene Scout card.",
      note: "Synthetic acceptance evidence only; it is not genuine listener demand.",
    } satisfies SafeResult;
  }

  return {
    phase: "verify",
    result: "verified",
    provenance: "synthetic_acceptance_fixture",
    releaseId: target.releaseId,
    analyticsArtistId: target.artistId,
    showArtistId: target.showArtistId,
    city: { citySlug: invocation.citySlug, countryCode: invocation.countryCode },
    aggregate,
    relativeCta,
    note: "This card was verified with synthetic acceptance data; it is not genuine listener demand. Staging exporters may copy these rows downstream.",
  } satisfies SafeResult;
}

function blockedScenario(phase: string, reason: string, extra: SafeResult = {}): SafeResult {
  return {
    phase,
    result: "blocked",
    provenance: "synthetic_acceptance_fixture",
    reason,
    ...extra,
    note: "Synthetic acceptance evidence only; it is not genuine listener demand.",
  };
}

/** Shared precondition: the seeded city card must be served before a contribution is removed. */
async function requireServedCityCard(
  phase: string,
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  listenerCount: number,
): Promise<{ blocked: SafeResult; before?: undefined } | { blocked?: undefined; before: CityAggregate }> {
  await assertCompleteFixture(invocation, listenerCount);
  const before = await readCityEvidence(invocation, target);
  if (!before.card || !before.aggregate) {
    return {
      blocked: blockedScenario(phase, "The seeded city card is not currently served; run verify and resolve it before this scenario."),
    };
  }
  return { before: before.aggregate };
}

/** Refresh the normal snapshots and compare the stored/served aggregate with the pre-change one. */
async function evaluateContributionRemoval(
  phase: "withdraw-consent" | "erase-listener",
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  before: CityAggregate,
  extra: SafeResult,
): Promise<SafeResult> {
  const after = await readCityEvidence(invocation, target);
  const stored = await prisma.sceneScoutCityDemand.findFirst({
    where: {
      artistId: target.artistId,
      releaseId: target.releaseId,
      citySlug: invocation.citySlug,
      countryCode: invocation.countryCode,
    },
    orderBy: { windowDays: "desc" },
    select: { uniqueListeners: true, signalCount: true, windowDays: true },
  });
  // Absent, or exactly one listener (and some of their signals) fewer.
  const dropped = (aggregate: { uniqueListeners: number; signalCount: number } | null | undefined) =>
    !aggregate || (
      aggregate.uniqueListeners === before.uniqueListeners - 1 &&
      aggregate.signalCount < before.signalCount
    );
  const removed = dropped(stored) && dropped(after.aggregate);
  return {
    phase,
    result: removed ? "contribution_removed" : "blocked",
    provenance: "synthetic_acceptance_fixture",
    analyticsArtistId: target.artistId,
    releaseId: target.releaseId,
    city: { citySlug: invocation.citySlug, countryCode: invocation.countryCode },
    before: { cardServed: true, aggregate: before },
    after: {
      cardServed: after.card !== undefined,
      servedAggregate: after.aggregate ?? null,
      storedSnapshot: stored
        ? { present: true, uniqueListeners: stored.uniqueListeners, signalCount: stored.signalCount, windowDays: stored.windowDays }
        : { present: false },
    },
    ...extra,
    ...(removed ? {} : {
      reason: "The listener's contribution was still present in the served or stored aggregate after the change.",
    }),
    note: "Synthetic acceptance evidence only; run cleanup afterwards. Staging exporters may copy the fixture rows downstream.",
  };
}

async function withdrawConsentScenario(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  listenerCount: number,
) {
  const precondition = await requireServedCityCard("withdraw-consent", invocation, target, listenerCount);
  if (precondition.blocked) return precondition.blocked;

  const prefix = sceneScoutAcceptancePrefix(invocation);
  const userId = sceneScoutAcceptanceUserId(prefix, SCENE_SCOUT_ACCEPTANCE_WITHDRAW_ORDINAL);
  const decision = await new AnalyticsConsentService().record(userId, false);
  return evaluateContributionRemoval("withdraw-consent", invocation, target, precondition.before, {
    consentAfter: { productAnalytics: decision.productAnalytics, decided: decision.decided },
    withdrawnListeners: 1,
  });
}

function buildErasureService() {
  // Same construction as the scheduled erasure runner: the warehouse target comes from the
  // runtime environment, so a configured staging warehouse is reconciled by the normal path.
  return new PersonalDataErasureService(
    new PersonalDataResolverService(),
    new AnalyticsGovernanceService(),
    new AccountClosureService(),
  );
}

async function writeMarkerEvent(
  invocation: SceneScoutAcceptanceInvocation,
  prefix: string,
  ordinal: number,
  kind: SceneScoutAcceptanceMarkerKind,
  erasedUserId?: string,
) {
  const now = new Date();
  const listenerOrdinal = String(ordinal).padStart(2, "0");
  const envelope = normalizeAnalyticsEventInput({
    eventId: sceneScoutAcceptanceMarkerEventId(prefix, ordinal, kind),
    eventName: SCENE_SCOUT_ACCEPTANCE_MARKER_EVENT_NAME,
    eventVersion: 1,
    occurredAt: now.toISOString(),
    receivedAt: now.toISOString(),
    producer: SCENE_SCOUT_ACCEPTANCE_PRODUCER,
    environment: "staging",
    privacyTier: "anonymous",
    payload: {
      synthetic: true,
      acceptanceFixturePrefix: prefix,
      acceptanceReleaseId: invocation.releaseId,
      markerKind: kind,
      listenerOrdinal,
      ...(erasedUserId ? { erasedUserId } : {}),
    },
    sourceRefs: {
      acceptanceFixturePrefix: prefix,
      acceptanceReleaseId: invocation.releaseId,
      listenerOrdinal,
      acceptanceEvent: kind,
    },
  }, { now, defaultEnvironment: "staging" });
  await prisma.analyticsEvent.create({ data: toPrismaEvent(envelope) });
}

async function eraseListenerScenario(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  listenerCount: number,
) {
  const precondition = await requireServedCityCard("erase-listener", invocation, target, listenerCount);
  if (precondition.blocked) return precondition.blocked;

  const prefix = sceneScoutAcceptancePrefix(invocation);
  const ordinal = SCENE_SCOUT_ACCEPTANCE_ERASE_ORDINAL;
  const userId = sceneScoutAcceptanceUserId(prefix, ordinal);
  const actorId = pseudonymousAnalyticsActorId(userId);
  if (!actorId) fail("Could not derive a pseudonymous fixture actor id");

  // Erasure withdraws an owned artist's releases and deletes wallets and sessions. A fixture
  // account must own none of that; refuse rather than let erasure touch real catalog data.
  await prisma.$transaction(async (tx) => refuseIfFixturesHaveCredentials(tx, [userId]));
  if (await prisma.artist.count({ where: { userId } }) > 0) {
    fail("A fixture user owns an artist profile; refusing to erase it");
  }
  const eventsBefore = await prisma.analyticsEvent.count({ where: { actorId } });

  // The erasure rotates this account's id. Record the intent first and the new id after, so
  // cleanup can still identify the erased fixture account through the tool's own markers.
  await writeMarkerEvent(invocation, prefix, ordinal, "erasure_started");
  const summary = await buildErasureService().eraseAccount(userId);
  if (summary.status !== "erased") {
    return blockedScenario("erase-listener", "The fixture account was not erased by this run; inspect it before continuing.");
  }
  let markerWritten = false;
  for (let attempt = 0; attempt < 3 && !markerWritten; attempt += 1) {
    try {
      await writeMarkerEvent(invocation, prefix, ordinal, "erased_account", summary.newUserId);
      markerWritten = true;
    } catch {
      // Retry; the loop below reports a refusal if every attempt failed.
    }
  }
  if (!markerWritten) {
    fail("The fixture account was erased but its cleanup marker could not be written; cleanup will refuse until it is inspected manually");
  }

  const eventsAfter = await prisma.analyticsEvent.count({ where: { actorId } });
  return evaluateContributionRemoval("erase-listener", invocation, target, precondition.before, {
    erasure: {
      status: summary.status,
      analytics: {
        governanceCalls: summary.analytics.governanceCalls,
        matched: summary.analytics.matched,
        deleted: summary.analytics.deleted,
        redacted: summary.analytics.redacted,
        warehouseStatuses: summary.analytics.warehouseStatuses,
      },
      listenerEventsBefore: eventsBefore,
      listenerEventsAfter: eventsAfter,
    },
    erasedListeners: 1,
  });
}

async function unmetDemandScenario(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
  listenerCount: number,
): Promise<SafeResult> {
  const prefix = sceneScoutAcceptancePrefix(invocation);

  // A stem the track really lacks is the simplest honest gap; a fully stemmed track falls back to
  // a BPM, key, or energy gap it really fails (see planSceneScoutAcceptanceUnmetGap).
  const track = await prisma.track.findUnique({
    where: { id: target.trackId },
    select: {
      aiDisclosureLevel: true,
      stems: { where: { isCurrent: true }, select: { type: true, audioFeatures: true } },
    },
  });
  if (!track) return blockedScenario("unmet-demand", "The selected track is no longer available.");
  const stemTypes = [
    ...new Set(
      track.stems
        .map((stem) => stem.type.toLowerCase())
        .filter((type) => type !== "original" && type !== "master"),
    ),
  ].sort();
  // Measured features come from the current original stem only, as in the crate pipeline.
  const measured = measuredTrackFeatures(
    track.stems.find((stem) => stem.type.toLowerCase() === "original")?.audioFeatures,
  );
  const facts: CrateCandidateFacts = {
    trackId: target.trackId,
    artistId: target.artistId,
    genre: null,
    moods: [],
    aiDisclosureLevel: String(track.aiDisclosureLevel),
    tempoBpm: measured.tempoBpm,
    camelot: measured.camelot,
    energy: measured.energy,
    stemTypes,
    listedLicenseTypes: [],
    indicativePriceUsd: {},
    verifiedHuman: false,
  };
  const plan = planSceneScoutAcceptanceUnmetGap(facts);
  if (!plan.gap) return blockedScenario("unmet-demand", plan.blocked);
  const { filters, coverage } = plan.gap;
  const gapKind = plan.gap.kind;
  const gapValue = plan.gap.value;
  const gapTargetType = plan.gap.targetType;
  const gapTargetId = gapTargetType === "track" ? target.trackId : target.artistId;

  const now = new Date();
  const fixture = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${prefix}, 0)) IS NULL AS acquired
    `);
    const owned = await inspectFixture(tx, invocation, prefix, false);
    const empty = owned.userIds.length === 0 && owned.eventIds.length === 0 &&
      owned.markers.length === 0 && owned.erasedUserIds.length === 0;
    if (empty) {
      const users = Array.from({ length: listenerCount }, (_, ordinal) => {
        const id = sceneScoutAcceptanceUserId(prefix, ordinal);
        return { id, email: `${id}@test.resonate` };
      });
      const decidedAt = new Date(now.getTime() - CONSENT_LEAD_MS);
      await tx.user.createMany({ data: users });
      await tx.analyticsConsent.createMany({
        data: users.map(({ id }) => ({
          userId: id,
          productAnalytics: true,
          policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
          decidedAt,
        })),
      });
      return { created: users.length, userIds: users.map(({ id }) => id) };
    }
    if (owned.userIds.length === 0) {
      fail("Fixture prefix has events or markers but no listeners; refusing to add demand listeners");
    }
    return { created: 0, userIds: owned.userIds };
  });

  const consents = await prisma.analyticsConsent.findMany({
    where: { userId: { in: fixture.userIds } },
    select: { userId: true, productAnalytics: true, policyVersion: true },
  });
  const consenting = new Set(
    consents
      .filter((consent) => consent.productAnalytics && consent.policyVersion === ANALYTICS_CONSENT_POLICY_VERSION)
      .map((consent) => consent.userId),
  );
  const requesters = fixture.userIds.filter((id) => consenting.has(id));
  if (requesters.length < listenerCount) {
    return blockedScenario("unmet-demand", "Fewer fixture listeners than the audience floor currently have current consent.", {
      fixtureListenersCreated: fixture.created,
      consentingListeners: requesters.length,
    });
  }

  const service = new UnmetDemandService();
  let observationsRecorded = 0;
  for (const userId of requesters) {
    const ordinal = fixture.userIds.indexOf(userId);
    observationsRecorded += await service.recordCrateRequest({
      userId,
      requestId: sceneScoutAcceptanceCrateRequestId(prefix, ordinal),
      observedAt: new Date(),
      filters,
      coverage,
      considered: [facts],
      candidatePoolComplete: true,
    });
  }

  const result = await service.getArtistUnmetDemand(target.artistId);
  const row = result.demand
    .filter((candidate) =>
      candidate.targetType === gapTargetType &&
      (gapTargetType !== "track" || candidate.trackId === target.trackId) &&
      candidate.kind === gapKind &&
      candidate.value === gapValue,
    )
    .sort((a, b) => b.windowDays - a.windowDays)[0];

  // Stored rows: only categorical values, no free text; this tool never stores a prompt.
  const observations = await prisma.demandObservation.findMany({
    where: { userId: { in: requesters } },
    select: {
      sourceType: true,
      sourceKey: true,
      targetArtistId: true,
      targetId: true,
      targetType: true,
      evidenceTrackId: true,
      kind: true,
      value: true,
    },
  });
  const categoricalOnly = observations.length === requesters.length && observations.every((observation) =>
    observation.sourceType === "crate" &&
    /^[0-9a-f]{64}$/.test(observation.sourceKey) &&
    observation.targetArtistId === target.artistId &&
    observation.targetId === gapTargetId &&
    observation.targetType === gapTargetType &&
    observation.evidenceTrackId === target.trackId &&
    observation.kind === gapKind &&
    observation.value === gapValue,
  );

  // The aggregate response must not expose requester or actor identities, or fixture markers.
  const serialized = JSON.stringify(result);
  const forbiddenFragments = [
    prefix,
    ...requesters,
    ...requesters.map((id) => pseudonymousAnalyticsActorId(id)).filter((id): id is string => Boolean(id)),
  ];
  const responseExposesIdentity = forbiddenFragments.some((fragment) => serialized.includes(fragment));

  const stored = await prisma.demandSignal.findFirst({
    where: {
      artistId: target.artistId,
      targetType: gapTargetType,
      targetId: gapTargetId,
      kind: gapKind,
      value: gapValue,
    },
    orderBy: { windowDays: "desc" },
    select: { distinctRequesters: true, requestCount: true, windowDays: true },
  });

  const verified = row !== undefined &&
    row.distinctRequesters >= listenerCount &&
    row.requestCount >= listenerCount &&
    categoricalOnly &&
    !responseExposesIdentity &&
    stored !== null &&
    stored.distinctRequesters >= listenerCount;
  if (!verified || !row || !stored) {
    return blockedScenario("unmet-demand", row
      ? "The aggregate or its privacy checks did not meet the expected result."
      : (result.reason ?? "No aggregate was produced for the selected track; check that it is a playable, clean, complete catalog track."), {
      status: result.status,
      fixtureListenersCreated: fixture.created,
      observationsRecorded,
      observationsCategoricalOnly: categoricalOnly,
      responseExposesIdentity,
    });
  }

  return {
    phase: "unmet-demand",
    result: "verified",
    provenance: "synthetic_acceptance_fixture",
    analyticsArtistId: target.artistId,
    releaseId: target.releaseId,
    trackId: target.trackId,
    fixtureListenersCreated: fixture.created,
    requestersRecorded: requesters.length,
    observationsRecorded,
    gapKind,
    value: gapValue,
    catalogAction: { targetType: gapTargetType, kind: gapKind, value: gapValue },
    aggregate: {
      distinctRequesters: row.distinctRequesters,
      requestCount: row.requestCount,
      windowDays: row.windowDays,
    },
    storedSnapshot: {
      present: true,
      distinctRequesters: stored.distinctRequesters,
      requestCount: stored.requestCount,
      windowDays: stored.windowDays,
    },
    privacy: {
      storedObservations: observations.length,
      categoricalOnly,
      promptsStored: false,
      responseExposesIdentity,
    },
    note: "Synthetic acceptance evidence only; it is not genuine listener demand.",
  };
}

/** Read-only: calls the analytics authorization decision directly with request-user shapes. */
async function accessCheckScenario(invocation: SceneScoutAcceptanceInvocation, target: EligibleTarget): Promise<SafeResult> {
  const prefix = sceneScoutAcceptancePrefix(invocation);
  const owned = await prisma.$transaction(async (tx) => inspectFixture(tx, invocation, prefix, false));
  const listenerId = sceneScoutAcceptanceUserId(prefix, 2);
  if (!owned.userIds.includes(listenerId)) {
    fail("The seeded fixture is not present; run seed for this target before the access check");
  }
  const artist = await prisma.artist.findUnique({ where: { id: target.artistId }, select: { userId: true } });
  if (!artist?.userId) fail("The target artist has no owner account to check against");
  const otherArtist = invocation.showArtistId !== target.artistId
    ? await prisma.artist.findUnique({ where: { id: invocation.showArtistId }, select: { userId: true } })
    : null;
  const otherOwnerId = otherArtist?.userId && otherArtist.userId !== artist.userId ? otherArtist.userId : undefined;

  // Request users have the shape the JWT strategy returns: { userId, role }.
  const authorization = new AnalyticsAuthorizationService();
  const attempt = async (user: { userId: string; role: string }, expected: "allow" | "forbidden") => {
    try {
      await authorization.assertCanReadArtistMetrics(target.artistId, user);
      return expected === "allow" ? "pass" : "fail";
    } catch (error) {
      return expected === "forbidden" && error instanceof ForbiddenException ? "pass" : "fail";
    }
  };
  const cases: Array<{ case: string; expected: string; outcome: string; reason?: string }> = [
    {
      case: "target_artist_owner",
      expected: "allow",
      outcome: await attempt({ userId: artist.userId, role: "artist" }, "allow"),
    },
    {
      case: "fixture_non_artist_listener",
      expected: "forbidden",
      outcome: await attempt({ userId: listenerId, role: "listener" }, "forbidden"),
    },
    otherOwnerId
      ? {
          case: "other_artist_owner",
          expected: "forbidden",
          outcome: await attempt({ userId: otherOwnerId, role: "artist" }, "forbidden"),
        }
      : {
          case: "other_artist_owner",
          expected: "forbidden",
          outcome: "skipped",
          reason: "The --show-artist-id artist has no owner distinct from the target artist's owner.",
        },
  ];
  const passed = cases.every((entry) => entry.outcome === "pass" || entry.outcome === "skipped");
  return {
    phase: "access-check",
    result: passed ? "passed" : "blocked",
    provenance: "synthetic_acceptance_fixture",
    cases,
    note: "Read-only check of the authorization decision with request-user shapes; no tokens are minted and nothing is written.",
  };
}

/**
 * Execute a parsed invocation. Preview and access-check perform reads only.
 * CLI: `[preview|seed|verify|withdraw-consent|erase-listener|unmet-demand|access-check|cleanup]
 * --artist-id <id> --release-id <id> --run-id <id> --city-slug <slug> --country-code <cc>`;
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
  switch (invocation.phase) {
    case "preview": {
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
    case "seed":
      return seedFixture(invocation, target, listenerCount);
    case "withdraw-consent":
      return withdrawConsentScenario(invocation, target, listenerCount);
    case "erase-listener":
      return eraseListenerScenario(invocation, target, listenerCount);
    case "unmet-demand":
      return unmetDemandScenario(invocation, target, listenerCount);
    case "access-check":
      return accessCheckScenario(invocation, target);
    default:
      return verifyFixture(invocation, target, listenerCount);
  }
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
