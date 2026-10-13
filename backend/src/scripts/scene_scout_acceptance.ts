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
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import {
  FIRST_LISTENER_CANDIDATE_LIMIT,
  FIRST_LISTENER_MAX_RELEASE_PLACEMENTS,
  FIRST_LISTENER_WINDOW_MS,
} from "../modules/recommendations/first_listener.contracts";
import { FirstListenerDiscoveryService } from "../modules/recommendations/first_listener_discovery.service";
import {
  FirstListenerReceptionService,
  parseDiscoveryMinimumAudience,
} from "../modules/recommendations/first_listener_reception.service";
import {
  assertSceneScoutAcceptanceMutationRequirements,
  assertSceneScoutAcceptanceStagingEnvironment,
  FIRST_LISTENER_CANDIDATE_SOURCE_REASONS,
  FIRST_LISTENER_VERIFICATION_REASONS,
  firstListenerIneligibilityReasons,
  type FirstListenerIneligibilityReason,
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

function eventNameForKind(kind: SceneScoutAcceptanceEventKind) {
  if (kind === "playback_completed") return "playback.completed";
  if (kind === "playback_started") return "playback.started";
  return "library.saved";
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
  const eventName = eventNameForKind(input.kind);
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
  if (eventName === "playback.started") return "playback_started";
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
    if (events.some(({ eventName }) => eventName === "playback.started")) {
      fail("The fixture already ran the first-listener-reception scenario and is no longer complete; clean it up and seed a fresh run");
    }
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
    let firstListenerExposuresDeleted = 0;
    if (accountIds.length > 0) {
      demandObservationsDeleted = (await tx.demandObservation.deleteMany({ where: { userId: { in: accountIds } } })).count;
      // Placement rows are identity-linked and go with the account. The release's
      // placement counter is deliberately not decremented: the budget survives erasure.
      firstListenerExposuresDeleted = (await tx.firstListenerExposure.deleteMany({ where: { userId: { in: accountIds } } })).count;
    }
    const eventIds = [...owned.eventIds, ...owned.markerEventIds];
    if (eventIds.length > 0) {
      await tx.analyticsEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    }
    if (accountIds.length > 0) {
      await tx.analyticsConsent.deleteMany({ where: { userId: { in: accountIds } } });
      await tx.user.deleteMany({ where: { id: { in: accountIds } } });
    }
    return { ...owned, demandObservationsDeleted, firstListenerExposuresDeleted };
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
    firstListenerExposuresDeleted: deleted.firstListenerExposuresDeleted,
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

/** Creates fixture listeners with current-policy consent and no listening events. */
async function createConsentingFixtureListeners(
  tx: AcceptanceTransaction,
  prefix: string,
  listenerCount: number,
  now: Date,
) {
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
  return users.map(({ id }) => id);
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
      const userIds = await createConsentingFixtureListeners(tx, prefix, listenerCount, now);
      return { created: userIds.length, userIds };
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

const HOUR_MS = 60 * 60 * 1000;
/** Fixture listeners have default preferences, which exclude explicit tracks. */
const FIRST_LISTENER_ALLOW_EXPLICIT = false;
const FIRST_LISTENER_NOTE =
  "Synthetic acceptance evidence only. Each first-listener run permanently consumes placements from the release's budget; cleanup removes the fixture's placement rows but never restores the counter.";

function failedScenario(phase: string, reason: string, extra: SafeResult = {}): SafeResult {
  return {
    phase,
    result: "failed",
    provenance: "synthetic_acceptance_fixture",
    reason,
    ...extra,
    note: FIRST_LISTENER_NOTE,
  };
}

/** The reception floor, parsed exactly as the reception service parses `DISCOVERY_MIN_AUDIENCE`. */
function firstListenerAudienceFloor() {
  const floor = parseDiscoveryMinimumAudience(process.env.DISCOVERY_MIN_AUDIENCE);
  if (floor > SCENE_SCOUT_ACCEPTANCE_MAX_USERS) {
    fail(`The current first-listener audience floor requires ${floor} fixtures; the safe maximum is ${SCENE_SCOUT_ACCEPTANCE_MAX_USERS}`);
  }
  return floor;
}

function lowFloorBlock(phase: string, floor: number) {
  return blockedScenario(phase, "The audience floor is below two listeners, so suppression below it cannot be demonstrated.", {
    reasons: ["audience_floor_too_low"],
    floor,
  });
}

interface FirstListenerReleaseFacts {
  artistId: string;
  createdAt: Date;
  trackIds: string[];
  counter: number;
  exposures: number;
  reasons: FirstListenerIneligibilityReason[];
  releaseAgeHours: number;
}

/** Read-only facts and categorical ineligibility reasons for one release (or one selected track). */
async function loadFirstListenerReleaseFacts(
  releaseId: string,
  trackId: string | undefined,
  now: Date,
  placementsNeeded: number,
): Promise<FirstListenerReleaseFacts | null> {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: {
      artistId: true,
      createdAt: true,
      status: true,
      withdrawnAt: true,
      rightsRoute: true,
      releaseDate: true,
      firstListenerPlacementsUsed: true,
      artist: { select: { userId: true } },
      tracks: {
        ...(trackId ? { where: { id: trackId } } : {}),
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: FIRST_LISTENER_CANDIDATE_LIMIT,
        select: {
          id: true,
          processingStatus: true,
          contentStatus: true,
          aiDisclosureLevel: true,
          rightsRoute: true,
          explicit: true,
        },
      },
    },
  });
  if (!release) return null;
  const artistUserId = release.artist.userId;
  const [exposures, reputation] = await Promise.all([
    prisma.firstListenerExposure.count({ where: { releaseId } }),
    artistUserId
      ? prisma.curatorReputation.findUnique({
          where: { walletAddress: artistUserId.toLowerCase() },
          select: { humanVerificationStatus: true, humanVerifiedAt: true },
        })
      : Promise.resolve(null),
  ]);
  const reasons = firstListenerIneligibilityReasons({
    now,
    release,
    tracks: release.tracks.map((track) => ({ ...track, aiDisclosureLevel: String(track.aiDisclosureLevel) })),
    artistUserId,
    humanVerificationStatus: reputation?.humanVerificationStatus,
    humanVerifiedAt: reputation?.humanVerifiedAt,
    placementsUsed: Math.max(release.firstListenerPlacementsUsed, exposures),
    placementsNeeded,
  });
  return {
    artistId: release.artistId,
    createdAt: release.createdAt,
    trackIds: release.tracks.map(({ id }) => id),
    counter: release.firstListenerPlacementsUsed,
    exposures,
    reasons,
    releaseAgeHours: Math.floor((now.getTime() - release.createdAt.getTime()) / HOUR_MS),
  };
}

function capRemaining(counter: number, exposures: number) {
  return Math.max(0, FIRST_LISTENER_MAX_RELEASE_PLACEMENTS - Math.max(counter, exposures));
}

/**
 * #1970: with the real clock, every floor-count fixture listener is offered
 * the fresh target track by the real candidate source and reserves exactly one
 * placement; a repeat is refused; an optional ineligible release is excluded.
 */
async function firstListenerScenario(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
): Promise<SafeResult> {
  const phase = "first-listener";
  const listenerCount = firstListenerAudienceFloor();
  if (listenerCount < 2) return lowFloorBlock(phase, listenerCount);

  // Every precondition is read before anything is written; the catalog is never altered.
  const now = new Date();
  const facts = await loadFirstListenerReleaseFacts(target.releaseId, target.trackId, now, listenerCount);
  if (!facts) fail("The target release is no longer available");
  if (facts.reasons.length > 0) {
    return blockedScenario(
      phase,
      "The target release or track is not eligible for first-listener placement; use a fresh, public, human-verified, playable release instead of altering the catalog.",
      {
        reasons: facts.reasons,
        releaseAgeHours: facts.releaseAgeHours,
        windowHours: FIRST_LISTENER_WINDOW_MS / HOUR_MS,
        listenersRequired: listenerCount,
        capRemaining: capRemaining(facts.counter, facts.exposures),
      },
    );
  }

  let ineligible: FirstListenerReleaseFacts | null = null;
  if (invocation.ineligibleReleaseId) {
    ineligible = await loadFirstListenerReleaseFacts(invocation.ineligibleReleaseId, undefined, now, 1);
    if (!ineligible) fail("--ineligible-release-id must identify an existing release");
    if (ineligible.reasons.length === 0) {
      return blockedScenario(
        phase,
        "The --ineligible-release-id release is currently eligible for first-listener placement; nothing was reserved.",
        { reasons: ["ineligible_release_is_eligible"] },
      );
    }
  }

  const prefix = sceneScoutAcceptancePrefix(invocation);
  const fixture = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${prefix}, 0)) IS NULL AS acquired
    `);
    const owned = await inspectFixture(tx, invocation, prefix, false);
    if (owned.markers.length > 0 || owned.erasedUserIds.length > 0) {
      fail("The fixture already ran an erase scenario; clean it up and use a fresh run for first-listener acceptance");
    }
    if (owned.userIds.length > 0) {
      const prior = await tx.firstListenerExposure.count({ where: { userId: { in: owned.userIds } } });
      if (prior > 0) {
        fail("The fixture already ran the first-listener scenario, which consumes it once; run first-listener-reception, or clean it up and use a fresh run");
      }
      return { created: 0, userIds: owned.userIds };
    }
    if (owned.eventIds.length > 0) {
      fail("Fixture prefix has events but no listeners; refusing to add first-listener listeners");
    }
    const userIds = await createConsentingFixtureListeners(tx, prefix, listenerCount, now);
    return { created: userIds.length, userIds };
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
  // Fixture ids sort in ordinal order; exactly the floor count of consenting listeners is used.
  const listeners = [...fixture.userIds].sort().filter((id) => consenting.has(id)).slice(0, listenerCount);
  if (listeners.length < listenerCount) {
    return blockedScenario(phase, "Fewer fixture listeners than the audience floor currently have current consent.", {
      reasons: ["insufficient_consenting_listeners"],
      fixtureListenersCreated: fixture.created,
      consentingListeners: listeners.length,
    });
  }

  const discovery = new FirstListenerDiscoveryService();
  const placement = { trackId: target.trackId, releaseId: target.releaseId };
  const readBudget = async () => {
    const [release, fixtureExposures, releaseExposures] = await Promise.all([
      prisma.release.findUnique({ where: { id: target.releaseId }, select: { firstListenerPlacementsUsed: true } }),
      prisma.firstListenerExposure.count({ where: { releaseId: target.releaseId, userId: { in: listeners } } }),
      prisma.firstListenerExposure.count({ where: { releaseId: target.releaseId } }),
    ]);
    return { counter: release?.firstListenerPlacementsUsed ?? 0, fixtureExposures, releaseExposures };
  };

  // Every listener must be offered the target by the real candidate source before any reservation.
  let candidatesServed = 0;
  for (const userId of listeners) {
    const candidates = await discovery.getFreshCandidates({
      userId,
      allowExplicit: FIRST_LISTENER_ALLOW_EXPLICIT,
      trackIds: [target.trackId],
    });
    if (candidates.some((candidate) => candidate.id === target.trackId && candidate.release.id === target.releaseId)) {
      candidatesServed += 1;
    }
  }
  if (candidatesServed !== listeners.length) {
    return failedScenario(phase, "The fresh-candidate source did not offer the target track to every fixture listener; nothing was reserved.", {
      reasons: ["candidate_not_served"],
      clock: "real",
      listeners: listeners.length,
      candidatesServed,
      placementsReserved: 0,
    });
  }

  const before = await readBudget();
  let placementsReserved = 0;
  for (const userId of listeners) {
    const reserved = await discovery.reservePlacements(userId, [placement], { allowExplicit: FIRST_LISTENER_ALLOW_EXPLICIT });
    if (reserved.has(target.releaseId)) placementsReserved += 1;
  }
  const afterReservations = await readBudget();
  const reservationsVerified = placementsReserved === listeners.length &&
    afterReservations.counter === Math.max(before.counter, before.releaseExposures) + listeners.length &&
    afterReservations.fixtureExposures === listeners.length;

  // One placement per listener and release: a repeat for listener 1 changes nothing.
  const repeat = await discovery.reservePlacements(listeners[0], [placement], { allowExplicit: FIRST_LISTENER_ALLOW_EXPLICIT });
  const afterRepeat = await readBudget();
  const duplicateRefused = !repeat.has(target.releaseId) &&
    afterRepeat.counter === afterReservations.counter &&
    afterRepeat.fixtureExposures === afterReservations.fixtureExposures;

  let ineligibleCheck: SafeResult = { checked: false };
  let ineligibleExcluded = true;
  if (ineligible && invocation.ineligibleReleaseId) {
    const releaseId = invocation.ineligibleReleaseId;
    const sourceApplies = ineligible.reasons.some((reason) => FIRST_LISTENER_CANDIDATE_SOURCE_REASONS.includes(reason));
    const verificationApplies = ineligible.reasons.some((reason) => FIRST_LISTENER_VERIFICATION_REASONS.includes(reason));
    const candidates = ineligible.trackIds.length > 0
      ? await discovery.getFreshCandidates({
          userId: listeners[0],
          allowExplicit: FIRST_LISTENER_ALLOW_EXPLICIT,
          trackIds: ineligible.trackIds,
        })
      : [];
    const served = candidates.filter((candidate) => candidate.release.id === releaseId).length;
    // Verified-human status is enforced by the shared discovery policy (and again at reservation),
    // not by the candidate source, so it is checked against the policy context instead.
    const policyContext = verificationApplies
      ? await new DiscoveryPolicyContextService().loadContext(listeners[0], [ineligible.artistId])
      : undefined;
    const readIneligibleBudget = async () => {
      const [release, exposures] = await Promise.all([
        prisma.release.findUnique({ where: { id: releaseId }, select: { firstListenerPlacementsUsed: true } }),
        prisma.firstListenerExposure.count({ where: { releaseId } }),
      ]);
      return { counter: release?.firstListenerPlacementsUsed ?? 0, exposures };
    };
    const ineligibleBefore = await readIneligibleBudget();
    const reservationAttempted = ineligible.trackIds.length > 0;
    const reserved = reservationAttempted
      ? await discovery.reservePlacements(
          listeners[0],
          [{ trackId: ineligible.trackIds[0], releaseId }],
          { allowExplicit: FIRST_LISTENER_ALLOW_EXPLICIT },
        )
      : new Set<string>();
    const ineligibleAfter = await readIneligibleBudget();
    const candidateSourceExcluded = sourceApplies ? served === 0 : null;
    const verificationPolicyExcluded = policyContext ? !policyContext.verifiedHumanArtistIds.has(ineligible.artistId) : null;
    const reservationRefused = !reserved.has(releaseId);
    const budgetUnchanged = ineligibleAfter.counter === ineligibleBefore.counter &&
      ineligibleAfter.exposures === ineligibleBefore.exposures;
    ineligibleExcluded = candidateSourceExcluded !== false &&
      verificationPolicyExcluded !== false &&
      reservationRefused &&
      budgetUnchanged;
    ineligibleCheck = {
      checked: true,
      outcome: ineligibleExcluded ? "excluded" : "not_excluded",
      reasons: ineligible.reasons,
      candidateSourceExcluded,
      verificationPolicyExcluded,
      reservationAttempted,
      reservationRefused,
      budgetUnchanged,
    };
  }

  const verified = reservationsVerified && duplicateRefused && ineligibleExcluded;
  return {
    phase,
    result: verified ? "verified" : "failed",
    provenance: "synthetic_acceptance_fixture",
    analyticsArtistId: target.artistId,
    releaseId: target.releaseId,
    trackId: target.trackId,
    clock: "real",
    listeners: listeners.length,
    fixtureListenersCreated: fixture.created,
    candidatesServed,
    placementsReserved,
    counterBefore: before.counter,
    counterAfter: afterRepeat.counter,
    fixturePlacements: afterRepeat.fixtureExposures,
    capRemaining: capRemaining(afterRepeat.counter, afterRepeat.releaseExposures),
    capExercised: false,
    duplicateRefused,
    ineligibleRelease: ineligibleCheck,
    ...(verified ? {} : {
      reason: "Placement reservation, uniqueness, or the ineligible-release exclusion did not meet the expected result.",
    }),
    note: `${FIRST_LISTENER_NOTE} The per-release placement cap is not exercised live; the integration suite covers it.`,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * #1970: after a completed `first-listener` run, day-seven reception must
 * suppress an audience one below the floor and report exactly the floor once
 * the last fixture listener has heard the release.
 */
async function firstListenerReceptionScenario(
  invocation: SceneScoutAcceptanceInvocation,
  target: EligibleTarget,
): Promise<SafeResult> {
  const phase = "first-listener-reception";
  const listenerCount = firstListenerAudienceFloor();
  if (listenerCount < 2) return lowFloorBlock(phase, listenerCount);

  const prefix = sceneScoutAcceptancePrefix(invocation);
  const owned = await prisma.$transaction(async (tx) => inspectFixture(tx, invocation, prefix, false));
  if (owned.markers.length > 0 || owned.erasedUserIds.length > 0) {
    fail("The fixture already ran an erase scenario; clean it up and use a fresh run for first-listener acceptance");
  }
  if (owned.eventIds.some((eventId) => eventId.endsWith("_playback_started"))) {
    fail("The fixture already ran the first-listener-reception scenario, which consumes it once; clean it up and use a fresh run");
  }

  const exposures = owned.userIds.length === 0
    ? []
    : await prisma.firstListenerExposure.findMany({
        where: { releaseId: target.releaseId, userId: { in: owned.userIds } },
        orderBy: { userId: "asc" },
        select: { userId: true, placedAt: true },
      });
  if (exposures.length !== listenerCount) {
    return blockedScenario(
      phase,
      exposures.length === 0
        ? "Run first-listener for this fixture and target first."
        : "The fixture's placements do not match the audience floor; clean it up and use a fresh run.",
      {
        reasons: [exposures.length === 0 ? "first_listener_not_run" : "fixture_placements_mismatch"],
        fixturePlacements: exposures.length,
        floor: listenerCount,
      },
    );
  }

  const release = await prisma.release.findUnique({ where: { id: target.releaseId }, select: { createdAt: true } });
  if (!release) fail("The target release is no longer available");
  const windowEnd = new Date(release.createdAt.getTime() + FIRST_LISTENER_WINDOW_MS);
  // Reception counts only plays inside the release's first seven days, and this phase writes
  // plays at the real time. A matured release can therefore no longer take valid plays.
  if (Date.now() >= windowEnd.getTime()) {
    return blockedScenario(phase, "The release's first seven days have ended, so plays written now cannot count toward its reception.", {
      reasons: ["release_window_closed"],
      clock: "real",
    });
  }
  // Read reception exactly at day seven: the earliest time the release is reported at all.
  const readAt = windowEnd;
  const clock = "projected";
  if (exposures.some(({ placedAt }) => placedAt < release.createdAt || placedAt > windowEnd)) {
    return blockedScenario(phase, "A fixture placement lies outside the release's first seven days.", {
      reasons: ["placements_outside_window"],
    });
  }

  const listeners = exposures.map(({ userId }) => userId);
  const consents = await prisma.analyticsConsent.findMany({
    where: { userId: { in: listeners } },
    select: { userId: true, productAnalytics: true, policyVersion: true },
  });
  const consenting = consents.filter((consent) =>
    consent.productAnalytics && consent.policyVersion === ANALYTICS_CONSENT_POLICY_VERSION).length;
  if (consenting !== listeners.length) {
    return blockedScenario(phase, "A placed fixture listener no longer has current consent; clean it up and use a fresh run.", {
      reasons: ["listener_consent_changed"],
      consentingListeners: consenting,
    });
  }

  // Real listeners' placements on the same release would combine with the fixture's counts.
  const realPlacements = await prisma.firstListenerExposure.count({
    where: { releaseId: target.releaseId, userId: { notIn: owned.userIds } },
  });
  const reception = new FirstListenerReceptionService();
  const readRelease = async () => {
    const result = await reception.getArtistReception(target.artistId, { now: readAt });
    return {
      available: result.available,
      row: result.releases.find(({ releaseId }) => releaseId === target.releaseId),
    };
  };
  const baseline = await readRelease();
  if (!baseline.available || !baseline.row) {
    return blockedScenario(phase, "Reception was unavailable for the artist at day seven.", {
      reasons: ["reception_unavailable"],
      clock,
      readAt: readAt.toISOString(),
    });
  }
  if (realPlacements > 0 || baseline.row.heard !== null) {
    return blockedScenario(phase, "The release already has real first-listener placements or reception that would combine with the fixture's counts.", {
      reasons: ["real_reception_present"],
      clock,
      readAt: readAt.toISOString(),
    });
  }

  const ordinalOf = (userId: string) => {
    const ordinal = Array.from({ length: SCENE_SCOUT_ACCEPTANCE_MAX_USERS }, (_, index) => index)
      .find((index) => sceneScoutAcceptanceUserId(prefix, index) === userId);
    if (ordinal === undefined) fail("Fixture user marker collision detected; refusing changes to unexpected ownership");
    return ordinal;
  };
  // A play must follow its placement; never write one before the latest placement's instant.
  const latestPlacement = Math.max(...exposures.map(({ placedAt }) => placedAt.getTime()));
  while (Date.now() <= latestPlacement) await sleep(5);
  const writeHeard = async (userIds: string[]) => {
    const occurredAt = new Date();
    if (occurredAt.getTime() > windowEnd.getTime()) {
      fail("The release's first seven days ended during the run; clean it up and use a fresher release");
    }
    const events = userIds.map((userId) => {
      const actorId = pseudonymousAnalyticsActorId(userId);
      if (!actorId) fail("Could not derive a pseudonymous fixture actor id");
      return buildAnalyticsEvent({
        prefix,
        releaseId: target.releaseId,
        trackId: target.trackId,
        ordinal: ordinalOf(userId),
        kind: "playback_started",
        actorId,
        occurredAt,
        receivedAt: occurredAt,
        citySlug: invocation.citySlug,
        countryCode: invocation.countryCode,
      });
    });
    await prisma.analyticsEvent.createMany({ data: events.map(toPrismaEvent) });
  };

  await writeHeard(listeners.slice(0, -1));
  const belowFloor = await readRelease();
  await writeHeard(listeners.slice(-1));
  const atFloor = await readRelease();

  const suppressed = belowFloor.available && belowFloor.row !== undefined && belowFloor.row.heard === null;
  const reported = atFloor.available && atFloor.row !== undefined &&
    atFloor.row.heard === listenerCount &&
    atFloor.row.saves === null &&
    atFloor.row.follows === null;
  const verified = suppressed && reported;
  return {
    phase,
    result: verified ? "verified" : "failed",
    provenance: "synthetic_acceptance_fixture",
    analyticsArtistId: target.artistId,
    releaseId: target.releaseId,
    clock,
    readAt: readAt.toISOString(),
    floor: listenerCount,
    playsWritten: listeners.length,
    heardBelowFloor: belowFloor.row?.heard ?? null,
    heardAtFloor: atFloor.row?.heard ?? null,
    fullPlaysAtFloor: atFloor.row?.fullPlays ?? null,
    savesAtFloor: atFloor.row?.saves ?? null,
    followsAtFloor: atFloor.row?.follows ?? null,
    ...(verified ? {} : {
      reason: "Day-seven reception did not suppress the audience below the floor or report exactly the floor at it.",
    }),
    note: "Synthetic acceptance evidence only; the plays are synthetic fixture events. Run cleanup afterwards.",
  };
}

/**
 * Execute a parsed invocation. Preview and access-check perform reads only.
 * CLI: `[preview|seed|verify|withdraw-consent|erase-listener|unmet-demand|access-check|first-listener|
 * first-listener-reception|cleanup] --artist-id <id> --release-id <id> --run-id <id> --city-slug <slug>
 * --country-code <cc>`; `--show-artist-id` and `--track-id` are optional selectors, and
 * `--ineligible-release-id` is an optional `first-listener` check.
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
    case "first-listener":
      return firstListenerScenario(invocation, target);
    case "first-listener-reception":
      return firstListenerReceptionScenario(invocation, target);
    default:
      return verifyFixture(invocation, target, listenerCount);
  }
}

async function main(args: string[]) {
  const invocation = parseSceneScoutAcceptanceArgs(args);
  const result = await runSceneScoutAcceptance(invocation);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (["blocked", "seeded_but_blocked", "failed"].includes(String(result.result))) process.exitCode = 1;
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
