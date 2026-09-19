import "dotenv/config";
import { createHash } from "crypto";
import { AccountClosureStatus } from "@prisma/client";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { ERASED_EMAIL_DOMAIN } from "../modules/privacy/personal_data_erasure_manifest";
import { writeStructuredLog } from "../modules/shared/structured_logging";
import { prisma } from "../db/prisma";
import {
  AUDIT_EVENT_NAMES,
  Expectation,
  GOVERNANCE_VALIDATION_PHASES,
  GovernanceValidationInvocation,
  PAYLOAD_KEPT_KEY,
  PAYLOAD_REDACTED_KEY,
  REDACTED_VALUE,
  RETENTION_DELETED_ACTION,
  RETENTION_REDACTED_ACTION,
  RetentionFixture,
  RetentionWindows,
  VerificationReport,
  WAREHOUSE_ERASURE_ACTION,
  analyticsEnvironmentLabel,
  assessEnvironment,
  evaluateExpectations,
  parseInvocation,
  retentionFixturePlan,
  verificationExitCode,
} from "./governance_validation_support";

/**
 * #1789 / #1771 — the staging validation harness for the two governance
 * mechanisms this sprint shipped: analytics retention and account erasure.
 *
 * ## Why this exists
 *
 * Both jobs are scheduled, both report success, and neither has ever been
 * observed doing anything. The retention dry run in staging returned `0 expired`
 * in every tier — which proves the plumbing, the database connection and the
 * policy read, and proves nothing at all about whether an expiry is correct.
 * It cannot: the windows are 90, 395 and 730 days, and the data in staging is
 * younger than the shortest of them.
 *
 * So the harness **backdates `occurredAt`**. That single move turns a two-year
 * wait into a job execution, and it is the reason the retention half of this
 * file exists rather than a test that mocks the clock: mocking the clock tests
 * the service, while backdating the rows tests the *scheduled job* against the
 * real service, the real policy and the real database.
 *
 * ## Why the phases are separate executions
 *
 * Each verify phase has to observe what a real job run did, and that run
 * happens outside this process — `run_retention_cleanup.js` and
 * `run_due_erasures.js` are their own Cloud Run Jobs. A single script could
 * only validate itself calling the service in-process, which is the weaker
 * claim. So: seed, then let the scheduled job run, then verify.
 *
 * ## Why it builds its own services
 *
 * Same reason `run_due_erasures.ts` does, and it matters more here: this runs
 * as a small Cloud Run Job with a database URL and the analytics settings.
 * Booting Nest would drag in Redis, BullMQ and every secret the service holds,
 * and a validation harness that needs production-shaped credentials is not one
 * anybody will run.
 *
 * ## This writes fake data
 *
 * Fake analytics events, fake accounts, a fake wallet, a fake private key. It
 * refuses without `GOVERNANCE_VALIDATION_ENABLED=true`, refuses without an
 * environment label, and refuses on any label that looks like production. See
 * `assessEnvironment` for why `NODE_ENV` is not one of the labels.
 *
 * Every row it writes is named `govval_<runId>_…`, and cleanup deletes on that
 * prefix and nothing else.
 *
 * Usage:
 *   node dist/scripts/governance_validation.js <phase> [--run-id <id>]
 *   phases: seed-retention | verify-retention | seed-erasure | verify-erasure | cleanup
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stamped on every seeded analytics event, so a row is identifiable without its id. */
export const GOVERNANCE_VALIDATION_PRODUCER = "governance_validation";

// ---------------------------------------------------------------------------
// Deterministic fixture identities
// ---------------------------------------------------------------------------

/**
 * Addresses, keys and transaction hashes derived from the prefix.
 *
 * Deterministic because seed and verify are different processes: verify has to
 * rediscover the wallet address in order to assert it appears nowhere, and
 * cannot be told it by the seed. Derived from the prefix rather than fixed so
 * two runs in one environment do not collide on the unique columns.
 */
function derive(prefix: string, tag: string, length: number) {
  return createHash("sha256").update(`${prefix}|${tag}`).digest("hex").slice(0, length);
}

function harnessAddress(prefix: string, tag: string) {
  return `0x${derive(prefix, `address:${tag}`, 40)}`;
}

function harnessHash(prefix: string, tag: string) {
  return `0x${derive(prefix, `hash:${tag}`, 64)}`;
}

/** A BigInt id small enough to be readable and derived so it does not collide. */
function harnessBigInt(prefix: string, tag: string) {
  return BigInt(`0x${derive(prefix, `bigint:${tag}`, 10)}`);
}

export interface ErasureFixtureIdentities {
  /** The person who asks to be erased. `User.id` is their lowercased address. */
  subjectUserId: string;
  subjectAddressLower: string;
  /** The same address in the casing an on-chain writer stores: a case-sensitive match misses it. */
  subjectAddressChecksummed: string;
  subjectPrivateKey: string;
  /** The control. Nothing about the erasure may touch this account. */
  controlUserId: string;
  controlAddressLower: string;
  controlAddressChecksummed: string;
  controlPrivateKey: string;
}

export function erasureIdentities(erasurePrefix: string): ErasureFixtureIdentities {
  const subject = harnessAddress(erasurePrefix, "subject");
  const control = harnessAddress(erasurePrefix, "control");
  return {
    subjectUserId: subject,
    subjectAddressLower: subject,
    subjectAddressChecksummed: `0x${subject.slice(2).toUpperCase()}`,
    subjectPrivateKey: harnessHash(erasurePrefix, "subject_private_key"),
    controlUserId: control,
    controlAddressLower: control,
    controlAddressChecksummed: `0x${control.slice(2).toUpperCase()}`,
    controlPrivateKey: harnessHash(erasurePrefix, "control_private_key"),
  };
}

function environmentLabelFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return analyticsEnvironmentLabel(
    env.RESONATE_ENVIRONMENT_ID || env.DEPLOY_ENV || env.APP_ENV || "dev",
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — seed-retention
// ---------------------------------------------------------------------------

export interface RetentionSeedSummary {
  phase: "seed-retention";
  prefix: string;
  windows: RetentionWindows;
  seededAt: string;
  total: number;
  /** Per tier, what was written and what the policy says must happen to it. */
  tiers: Array<{
    tier: string;
    windowDays: number;
    expectedDeleted: number;
    expectedRedacted: number;
    expectedSurviving: number;
    oldestOccurredAt: string;
    newestOccurredAt: string;
  }>;
}

/**
 * Write the backdated fixtures a retention run must act on.
 *
 * Re-runnable: it removes its own prefix first, so a second seed is a refresh
 * rather than a unique-constraint failure.
 */
export async function seedRetention(
  invocation: GovernanceValidationInvocation,
  options: { now?: Date; windows?: RetentionWindows; environmentLabel?: string } = {},
): Promise<RetentionSeedSummary> {
  const now = options.now ?? new Date();
  const windows = options.windows ?? new AnalyticsGovernanceService().getRetentionPolicy();
  const environment = options.environmentLabel ?? environmentLabelFromEnv();
  const fixtures = retentionFixturePlan(windows, now);

  await cleanupRetention(invocation);

  for (const fixture of fixtures) {
    await prisma.analyticsEvent.create({
      data: {
        id: retentionRowId(invocation, fixture.key),
        eventId: retentionEventId(invocation, fixture.key),
        eventName: fixture.eventName,
        eventVersion: 1,
        occurredAt: fixture.occurredAt,
        receivedAt: fixture.occurredAt,
        producer: GOVERNANCE_VALIDATION_PRODUCER,
        environment,
        privacyTier: fixture.tier,
        subjectType: GOVERNANCE_VALIDATION_PRODUCER,
        subjectId: retentionSubjectId(invocation, fixture.key),
        actorId: retentionActorId(invocation, fixture.key),
        sessionId: `${invocation.retentionPrefix}session_${fixture.key}`,
        traceId: `${invocation.retentionPrefix}trace_${fixture.key}`,
        consentBasis: "legitimate_interest",
        // `marker` survives redaction and the `userId` key does not, so a
        // redaction that emptied the whole payload is distinguishable from a
        // correct one.
        payload: {
          [PAYLOAD_KEPT_KEY]: fixture.key,
          [PAYLOAD_REDACTED_KEY]: retentionPayloadUserId(invocation, fixture.key),
        },
        envelope: { [PAYLOAD_KEPT_KEY]: fixture.key, fixture: fixture.disposition },
      },
    });
  }

  const summary: RetentionSeedSummary = {
    phase: "seed-retention",
    prefix: invocation.retentionPrefix,
    windows,
    seededAt: now.toISOString(),
    total: fixtures.length,
    tiers: summarizeSeededTiers(fixtures, windows),
  };

  writeStructuredLog({
    level: "info",
    event: "governance.validation.retention_seeded",
    message:
      `Seeded ${fixtures.length} backdated analytics events across three tiers. ` +
      "Run the retention job, then verify-retention.",
    ...summary,
  });

  return summary;
}

function summarizeSeededTiers(fixtures: RetentionFixture[], windows: RetentionWindows) {
  const tiers = [...new Set(fixtures.map((fixture) => fixture.tier))];
  return tiers.map((tier) => {
    const own = fixtures.filter((fixture) => fixture.tier === tier);
    const occurredAt = own.map((fixture) => fixture.occurredAt.getTime());
    return {
      tier,
      windowDays:
        tier === "personal"
          ? windows.personalDays
          : tier === "sensitive"
            ? windows.sensitiveDays
            : windows.pseudonymousDays,
      expectedDeleted: own.filter((fixture) => fixture.disposition === "deleted").length,
      expectedRedacted: own.filter((fixture) => fixture.disposition === "redacted").length,
      expectedSurviving: own.filter((fixture) => fixture.disposition === "survives").length,
      oldestOccurredAt: new Date(Math.min(...occurredAt)).toISOString(),
      newestOccurredAt: new Date(Math.max(...occurredAt)).toISOString(),
    };
  });
}

const retentionRowId = (invocation: GovernanceValidationInvocation, key: string) =>
  `${invocation.retentionPrefix}${key}`;
const retentionEventId = (invocation: GovernanceValidationInvocation, key: string) =>
  `${invocation.retentionPrefix}${key}_event`;
const retentionActorId = (invocation: GovernanceValidationInvocation, key: string) =>
  `${invocation.retentionPrefix}actor_${key}`;
const retentionSubjectId = (invocation: GovernanceValidationInvocation, key: string) =>
  `${invocation.retentionPrefix}subject_${key}`;
const retentionPayloadUserId = (invocation: GovernanceValidationInvocation, key: string) =>
  `${invocation.retentionPrefix}payload_user_${key}`;

// ---------------------------------------------------------------------------
// Phase 2 — verify-retention
// ---------------------------------------------------------------------------

/**
 * Check what the retention run actually did against what the policy promises.
 *
 * The plan is recomputed rather than read back from the database, because the
 * rows the run deleted cannot tell us they were supposed to be deleted. It is
 * derived from the same `now`/windows the seed used — hence `seededAt`, which
 * defaults to the oldest surviving fixture's implied seeding time.
 */
export async function verifyRetention(
  invocation: GovernanceValidationInvocation,
  options: { now?: Date; windows?: RetentionWindows } = {},
): Promise<VerificationReport> {
  const now = options.now ?? new Date();
  const windows = options.windows ?? new AnalyticsGovernanceService().getRetentionPolicy();
  const fixtures = retentionFixturePlan(windows, now);

  const events = await prisma.analyticsEvent.findMany({
    where: { id: { startsWith: invocation.retentionPrefix } },
  });
  const lineage = await prisma.analyticsGovernanceLog.findMany({
    where: { eventId: { startsWith: invocation.retentionPrefix } },
  });

  const byEventId = new Map(events.map((event) => [event.eventId, event]));
  const lineageByEventId = new Map<string, string[]>();
  for (const row of lineage) {
    if (!row.eventId) continue;
    lineageByEventId.set(row.eventId, [...(lineageByEventId.get(row.eventId) ?? []), row.action]);
  }

  const expectations: Expectation[] = [
    {
      id: "retention.run_observed",
      what: "The retention job wrote lineage for the seeded fixtures — i.e. it ran at all since the seed.",
      operator: "atLeast",
      expected: 1,
      actual: lineage.length,
    },
  ];

  for (const fixture of fixtures) {
    const eventId = retentionEventId(invocation, fixture.key);
    const event = byEventId.get(eventId);
    const actions = [...new Set(lineageByEventId.get(eventId) ?? [])].sort();
    const payload = (event?.payload ?? {}) as Record<string, unknown>;

    if (fixture.disposition === "deleted") {
      expectations.push(
        {
          id: `retention.${fixture.key}.deleted`,
          what: `An expired ${fixture.tier} "${fixture.eventName}" event is not audit-preserved, so retention must delete it.`,
          operator: "equals",
          expected: 0,
          actual: event ? 1 : 0,
        },
        {
          id: `retention.${fixture.key}.lineage`,
          what: "A deletion must leave a lineage row, or the removal is unprovable.",
          operator: "contains",
          expected: RETENTION_DELETED_ACTION,
          actual: actions,
        },
      );
      continue;
    }

    if (fixture.disposition === "redacted") {
      expectations.push(
        {
          id: `retention.${fixture.key}.retained`,
          what: `"${fixture.eventName}" is an audit-preserved family, so expiry must redact it in place, not delete it.`,
          operator: "equals",
          expected: 1,
          actual: event ? 1 : 0,
        },
        {
          id: `retention.${fixture.key}.actor_redacted`,
          what: "The actor id is the identifier expiry exists to remove.",
          operator: "equals",
          expected: REDACTED_VALUE,
          actual: event?.actorId ?? null,
        },
        {
          id: `retention.${fixture.key}.subject_redacted`,
          what: "The subject id is an identifier too.",
          operator: "equals",
          expected: REDACTED_VALUE,
          actual: event?.subjectId ?? null,
        },
        {
          id: `retention.${fixture.key}.session_redacted`,
          what: "Session and trace ids re-identify a person across events.",
          operator: "equals",
          expected: REDACTED_VALUE,
          actual: event?.sessionId ?? null,
        },
        {
          id: `retention.${fixture.key}.trace_redacted`,
          what: "Session and trace ids re-identify a person across events.",
          operator: "equals",
          expected: REDACTED_VALUE,
          actual: event?.traceId ?? null,
        },
        {
          id: `retention.${fixture.key}.payload_redacted`,
          what: "Person-shaped payload keys must be emptied by the payload redactor.",
          operator: "equals",
          expected: REDACTED_VALUE,
          actual: payload[PAYLOAD_REDACTED_KEY] ?? null,
        },
        {
          id: `retention.${fixture.key}.payload_preserved`,
          what: "Redaction must keep the non-personal payload: an audit row emptied of everything is not preserved for audit.",
          operator: "equals",
          expected: fixture.key,
          actual: payload[PAYLOAD_KEPT_KEY] ?? null,
        },
        {
          id: `retention.${fixture.key}.lineage`,
          what: "A redaction must be recorded as a redaction, distinctly from a deletion.",
          operator: "contains",
          expected: RETENTION_REDACTED_ACTION,
          actual: actions,
        },
      );
      continue;
    }

    // The control rows. Everything above passes for a run that truncated the
    // table; only these can tell a retention policy from a delete-everything.
    expectations.push(
      {
        id: `retention.${fixture.key}.survived`,
        what: `A ${fixture.tier} event ${fixture.ageDays} days old is inside its ${retentionWindowFor(windows, fixture.tier)}-day window and must still be here.`,
        operator: "equals",
        expected: 1,
        actual: event ? 1 : 0,
      },
      {
        id: `retention.${fixture.key}.untouched_actor`,
        what: "An event inside its window must not be redacted either.",
        operator: "equals",
        expected: retentionActorId(invocation, fixture.key),
        actual: event?.actorId ?? null,
      },
      {
        id: `retention.${fixture.key}.untouched_payload`,
        what: "An event inside its window keeps its payload intact.",
        operator: "equals",
        expected: retentionPayloadUserId(invocation, fixture.key),
        actual: payload[PAYLOAD_REDACTED_KEY] ?? null,
      },
      {
        id: `retention.${fixture.key}.no_lineage`,
        what: "Nothing happened to it, so nothing should claim it did.",
        operator: "equals",
        expected: 0,
        actual: actions.length,
      },
    );
  }

  const warehouse = await warehouseOutcomesForRun(lineage);
  expectations.push(
    {
      id: "retention.warehouse.recorded",
      what: "Expired events existed, so the run must have recorded a warehouse erasure outcome for them.",
      operator: "atLeast",
      expected: 1,
      actual: warehouse.records,
    },
    {
      id: "retention.warehouse.no_failure",
      what: "A run that cleared Postgres while the warehouse refused has left the two stores disagreeing.",
      operator: "equals",
      expected: 0,
      actual: warehouse.failed,
    },
  );

  return evaluateExpectations("verify-retention", expectations, {
    prefix: invocation.retentionPrefix,
    fixtures: fixtures.length,
    survivingRows: events.length,
    lineageRows: lineage.length,
    warehouse,
  });
}

function retentionWindowFor(windows: RetentionWindows, tier: string) {
  if (tier === "personal") return windows.personalDays;
  if (tier === "sensitive") return windows.sensitiveDays;
  return windows.pseudonymousDays;
}

/**
 * The warehouse half, scoped to this run by time.
 *
 * `warehouse_erasure` records carry no `eventId`, so they cannot be found by
 * the fixture prefix; they are batch summaries that also cover real rows, which
 * is also why cleanup leaves them alone. Scoping to "written at or after the
 * first lineage row our fixtures produced" is the closest honest window.
 */
async function warehouseOutcomesForRun(lineage: Array<{ createdAt: Date }>) {
  if (lineage.length === 0) {
    return { records: 0, failed: 0, statuses: [] as string[], scopedFrom: null as string | null };
  }
  const from = new Date(Math.min(...lineage.map((row) => row.createdAt.getTime())));
  const rows = await prisma.analyticsGovernanceLog.findMany({
    where: { action: WAREHOUSE_ERASURE_ACTION, createdAt: { gte: from } },
    select: { details: true },
  });

  const statuses: string[] = [];
  for (const row of rows) {
    const details = (row.details ?? {}) as Record<string, unknown>;
    if (details.sourceAction !== "retention") continue;
    const outcome = (details.warehouse ?? {}) as Record<string, unknown>;
    statuses.push(typeof outcome.status === "string" ? outcome.status : "unknown");
  }

  return {
    records: statuses.length,
    failed: statuses.filter((status) => status === "failed").length,
    statuses,
    scopedFrom: from.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase 3 — seed-erasure
// ---------------------------------------------------------------------------

export interface ErasureSeedSummary {
  phase: "seed-erasure";
  prefix: string;
  seededAt: string;
  closureRequestId: string;
  dueAt: string;
  /** Counts only. The addresses are fabricated, but the habit is the point. */
  rows: Record<string, number>;
}

/**
 * Seed a throwaway account with the spread of rows an erasure has to handle,
 * plus a second account that must come through it untouched, plus a closure
 * request already past its 30-day window so the scheduled job picks it up.
 */
export async function seedErasure(
  invocation: GovernanceValidationInvocation,
  options: { now?: Date; environmentLabel?: string } = {},
): Promise<ErasureSeedSummary> {
  const now = options.now ?? new Date();
  const environment = options.environmentLabel ?? environmentLabelFromEnv();
  const identities = erasureIdentities(invocation.erasurePrefix);

  await cleanupErasure(invocation);

  await seedPerson(invocation, environment, now, {
    suffix: "subject",
    userId: identities.subjectUserId,
    addressChecksummed: identities.subjectAddressChecksummed,
    privateKey: identities.subjectPrivateKey,
  });
  await seedPerson(invocation, environment, now, {
    suffix: "control",
    userId: identities.controlUserId,
    addressChecksummed: identities.controlAddressChecksummed,
    privateKey: identities.controlPrivateKey,
  });

  // The control buys from the subject: a financial record with one party on
  // each side of the erasure, which must survive intact for the buyer.
  await prisma.stemPurchase.create({
    data: {
      id: `${invocation.erasurePrefix}purchase_control_buys_subject`,
      listingId: `${invocation.erasurePrefix}listing_subject`,
      buyerAddress: identities.controlAddressChecksummed,
      amount: 1n,
      totalPaid: "1000",
      royaltyPaid: "100",
      protocolFeePaid: "50",
      sellerReceived: "850",
      transactionHash: harnessHash(invocation.erasurePrefix, "purchase"),
      blockNumber: 2n,
      purchasedAt: now,
    },
  });

  // Backdated past the 30-day window so `run_due_erasures` finds it due.
  const closures = new AccountClosureService();
  const request = await closures.request(
    identities.subjectUserId,
    `${invocation.erasurePrefix}closure_reason`,
  );
  const dueAt = new Date(now.getTime() - 31 * DAY_MS);
  await prisma.accountClosureRequest.update({ where: { id: request.id }, data: { dueAt } });

  const summary: ErasureSeedSummary = {
    phase: "seed-erasure",
    prefix: invocation.erasurePrefix,
    seededAt: now.toISOString(),
    closureRequestId: request.id,
    dueAt: dueAt.toISOString(),
    rows: {
      users: 2,
      wallets: 2,
      playlists: 2,
      libraryTracks: 2,
      communityMessages: 2,
      sessionKeys: 2,
      artists: 2,
      releases: 2,
      analyticsEvents: 4,
      stemPurchases: 1,
      accountClosureRequests: 1,
    },
  };

  writeStructuredLog({
    level: "info",
    event: "governance.validation.erasure_seeded",
    message:
      "Seeded a throwaway account due for erasure and a control account that must be untouched. " +
      "Run the due-erasure job, then verify-erasure.",
    ...summary,
  });

  return summary;
}

interface SeedPerson {
  suffix: "subject" | "control";
  userId: string;
  addressChecksummed: string;
  privateKey: string;
}

async function seedPerson(
  invocation: GovernanceValidationInvocation,
  environment: string,
  now: Date,
  person: SeedPerson,
) {
  const prefix = invocation.erasurePrefix;
  const own = (name: string) => `${prefix}${name}_${person.suffix}`;

  // `User.id` is the lowercased wallet address, as `auth.service.ts` writes it
  // for a wallet account. That is the whole reason the id is rotated, and it
  // makes "the address appears nowhere" a searchable assertion.
  await prisma.user.create({
    data: { id: person.userId, email: `${person.userId}@wallet.resonate` },
  });

  await prisma.wallet.create({
    data: {
      id: own("wallet"),
      userId: person.userId,
      // Stored checksummed while the resolver returns lowercase.
      address: person.addressChecksummed,
      chainId: 11155111,
      salt: own("salt"),
    },
  });

  await prisma.sessionKey.create({
    data: {
      id: own("session_key"),
      userId: person.userId,
      agentPrivateKey: person.privateKey,
      agentAddress: harnessAddress(prefix, `agent_${person.suffix}`),
      permissions: { target: "0x0", totalCap: 1 },
      validUntil: new Date(now.getTime() + 365 * DAY_MS),
    },
  });

  await prisma.folder.create({
    data: { id: own("folder"), userId: person.userId, name: own("folder_name") },
  });
  await prisma.playlist.create({
    data: {
      id: own("playlist"),
      userId: person.userId,
      folderId: own("folder"),
      name: own("playlist_name"),
      // Public on purpose: a kept playlist must not stay browsable under an
      // erased account.
      visibility: "public",
    },
  });

  await prisma.libraryTrack.create({
    data: {
      id: own("library_track"),
      userId: person.userId,
      title: own("library_title"),
      // A path on the person's own computer: the most identifying column here.
      sourcePath: `/home/${person.userId}/Music/${person.suffix}.flac`,
      isOwned: true,
    },
  });

  await prisma.communityRoom.create({
    data: {
      id: own("room"),
      roomType: "artist",
      // Polymorphic and dangling: `ownerId` has no relation behind it, so the
      // `ON UPDATE CASCADE` rotation cannot reach it.
      ownerType: "user",
      ownerId: person.userId,
      title: own("room_title"),
    },
  });
  await prisma.communityMessage.create({
    data: {
      id: own("message"),
      roomId: own("room"),
      authorId: person.userId,
      body: own("message_body"),
    },
  });

  // Retained rows that keep pointing at the account: these are how the verify
  // phase rediscovers the rotated `User.id` after the erasure.
  await prisma.keyAuditLog.create({
    data: { id: own("key_audit"), userId: person.userId, action: "session_key_issued" },
  });
  await prisma.session.create({
    data: { id: own("session"), userId: person.userId, budgetCapUsd: 5 },
  });
  await prisma.agentTransaction.create({
    data: {
      id: own("agent_tx"),
      sessionId: own("session"),
      userId: person.userId,
      listingId: 1n,
      tokenId: 1n,
      amount: 1n,
      totalPriceWei: "1000",
      priceUsd: 1.5,
    },
  });
  // A financial record keyed by the address, which is retained as it is.
  await prisma.royaltyPayment.create({
    data: {
      id: own("royalty"),
      tokenId: harnessBigInt(prefix, `token_${person.suffix}`),
      chainId: 11155111,
      recipientAddress: person.addressChecksummed,
      amount: "1000000000000000",
      transactionHash: harnessHash(prefix, `royalty_${person.suffix}`),
      blockNumber: 1n,
      paidAt: now,
    },
  });

  // The catalogue other people bought from.
  await prisma.artist.create({
    data: {
      id: own("artist"),
      userId: person.userId,
      displayName: own("artist_name"),
      payoutAddress: person.addressChecksummed,
    },
  });
  await prisma.release.create({
    data: {
      id: own("release"),
      artistId: own("artist"),
      title: own("release_title"),
      status: "published",
    },
  });
  await prisma.track.create({
    data: { id: own("track"), releaseId: own("release"), title: own("track_title") },
  });
  await prisma.stem.create({
    data: { id: own("stem"), trackId: own("track"), type: "vocals", uri: `ipfs://${own("stem")}` },
  });
  await prisma.stemListing.create({
    data: {
      id: own("listing"),
      stemId: own("stem"),
      listingId: harnessBigInt(prefix, `listing_${person.suffix}`),
      tokenId: 1n,
      chainId: 11155111,
      contractAddress: harnessAddress(prefix, "contract"),
      sellerAddress: person.addressChecksummed,
      pricePerUnit: "1000",
      amount: 1n,
      paymentToken: "0x0000000000000000000000000000000000000000",
      expiresAt: new Date(now.getTime() + 365 * DAY_MS),
      transactionHash: harnessHash(prefix, `listing_${person.suffix}`),
      blockNumber: 1n,
      listedAt: now,
    },
  });

  // Analytics keyed both ways. The pseudonymous actor id is derivable from
  // `User.id` only until the id rotates, which is why the erasure engine runs
  // analytics first; the raw form is what the domain-event bridge writes for
  // around twenty event types, and for a wallet account that value *is* the
  // person's address.
  await prisma.analyticsEvent.create({
    data: {
      id: own("analytics_pseudonymous"),
      eventId: own("analytics_pseudonymous_event"),
      eventName: "playback.completed",
      eventVersion: 1,
      occurredAt: now,
      receivedAt: now,
      producer: GOVERNANCE_VALIDATION_PRODUCER,
      environment,
      privacyTier: "pseudonymous",
      actorId: pseudonymousAnalyticsActorId(person.userId),
      payload: { [PAYLOAD_KEPT_KEY]: own("analytics_pseudonymous") },
      envelope: { [PAYLOAD_KEPT_KEY]: own("analytics_pseudonymous") },
    },
  });
  await prisma.analyticsEvent.create({
    data: {
      id: own("analytics_raw"),
      eventId: own("analytics_raw_event"),
      eventName: "taste_memory.settings_updated",
      eventVersion: 1,
      occurredAt: now,
      receivedAt: now,
      producer: GOVERNANCE_VALIDATION_PRODUCER,
      environment,
      privacyTier: "personal",
      actorId: person.userId,
      subjectType: "taste_memory",
      subjectId: person.userId,
      payload: { [PAYLOAD_KEPT_KEY]: own("analytics_raw") },
      envelope: { [PAYLOAD_KEPT_KEY]: own("analytics_raw") },
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 4 — verify-erasure
// ---------------------------------------------------------------------------

/**
 * Check the erasure against the same properties
 * `personal_data_erasure.integration.spec.ts` asserts, but against whatever
 * the scheduled job did in staging rather than against an in-process call.
 */
export async function verifyErasure(
  invocation: GovernanceValidationInvocation,
): Promise<VerificationReport> {
  const prefix = invocation.erasurePrefix;
  const identities = erasureIdentities(prefix);
  const subject = identities.subjectAddressLower;
  const own = (name: string, suffix: "subject" | "control") => `${prefix}${name}_${suffix}`;

  // The rotated id, rediscovered through a retained row rather than carried
  // over from the seed — the seeding process is long gone, and the pre-rotation
  // id is exactly what must no longer be findable.
  const locator = await prisma.keyAuditLog.findUnique({ where: { id: own("key_audit", "subject") } });
  const rotatedUserId = locator?.userId ?? null;
  const account = rotatedUserId
    ? await prisma.user.findUnique({ where: { id: rotatedUserId } })
    : null;

  const insensitive = { contains: subject, mode: "insensitive" as const };
  const pseudonym = pseudonymousAnalyticsActorId(subject) ?? "__none__";

  const [
    userIdHits,
    userEmailHits,
    walletHits,
    roomOwnerHits,
    keyAuditHits,
    agentTxHits,
    libraryPathHits,
    analyticsHits,
    sessionKeyHits,
    privateKeyHits,
  ] = await Promise.all([
    prisma.user.count({ where: { id: insensitive } }),
    prisma.user.count({ where: { email: insensitive } }),
    prisma.wallet.count({ where: { address: insensitive } }),
    prisma.communityRoom.count({ where: { ownerId: insensitive } }),
    prisma.keyAuditLog.count({ where: { userId: insensitive } }),
    prisma.agentTransaction.count({ where: { userId: insensitive } }),
    prisma.libraryTrack.count({ where: { sourcePath: insensitive } }),
    prisma.analyticsEvent.count({
      where: {
        OR: [{ actorId: insensitive }, { subjectId: insensitive }, { actorId: pseudonym }],
      },
    }),
    prisma.sessionKey.count({ where: { id: own("session_key", "subject") } }),
    prisma.sessionKey.count({ where: { agentPrivateKey: identities.subjectPrivateKey } }),
  ]);

  const [artist, release, royalty, agentTx, purchase, closure] = await Promise.all([
    prisma.artist.findUnique({ where: { id: own("artist", "subject") } }),
    prisma.release.findUnique({ where: { id: own("release", "subject") } }),
    prisma.royaltyPayment.findUnique({ where: { id: own("royalty", "subject") } }),
    prisma.agentTransaction.findUnique({ where: { id: own("agent_tx", "subject") } }),
    prisma.stemPurchase.findUnique({ where: { id: `${prefix}purchase_control_buys_subject` } }),
    prisma.accountClosureRequest.findFirst({
      where: { userId: rotatedUserId ?? "__none__" },
      orderBy: { requestedAt: "desc" },
    }),
  ]);

  const [controlUser, controlWallet, controlMessage, controlPlaylist, controlRelease, controlSessionKey] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: identities.controlUserId } }),
      prisma.wallet.count({ where: { id: own("wallet", "control") } }),
      prisma.communityMessage.findUnique({ where: { id: own("message", "control") } }),
      prisma.playlist.findUnique({ where: { id: own("playlist", "control") } }),
      prisma.release.findUnique({ where: { id: own("release", "control") } }),
      prisma.sessionKey.count({ where: { agentPrivateKey: identities.controlPrivateKey } }),
    ]);
  const controlAnalytics = await prisma.analyticsEvent.count({
    where: {
      id: { startsWith: prefix },
      OR: [
        { actorId: identities.controlUserId },
        { subjectId: identities.controlUserId },
        { actorId: pseudonymousAnalyticsActorId(identities.controlUserId) ?? "__none__" },
      ],
    },
  });

  const expectations: Expectation[] = [
    {
      id: "erasure.ran",
      what: "The retained audit row still exists and no longer points at the pre-erasure id — i.e. the job ran and rotated it.",
      operator: "equals",
      expected: true,
      actual: Boolean(rotatedUserId) && rotatedUserId !== identities.subjectUserId,
    },
    {
      id: "erasure.account_marked",
      what: "The User row survives (103 foreign keys point at it) but is closed and marked erased.",
      operator: "equals",
      expected: true,
      actual: Boolean(account?.closedAt) && Boolean(account?.erasedAt),
    },
    {
      id: "erasure.email_replaced",
      what: `A wallet account's email was "<address>@wallet.resonate"; it must become "<uuid>@${ERASED_EMAIL_DOMAIN}".`,
      operator: "equals",
      expected: rotatedUserId ? `${rotatedUserId}@${ERASED_EMAIL_DOMAIN}` : null,
      actual: account?.email ?? null,
    },

    // The wallet address, everywhere it must not be.
    {
      id: "erasure.address.user_id",
      what: "For a wallet account the address is the primary key of 43 models; it must be rotated away.",
      operator: "equals",
      expected: 0,
      actual: userIdHits,
    },
    {
      id: "erasure.address.user_email",
      what: "The email derived from the address goes with it.",
      operator: "equals",
      expected: 0,
      actual: userEmailHits,
    },
    {
      id: "erasure.address.wallet",
      what: "Nothing may still resolve the address back to a person.",
      operator: "equals",
      expected: 0,
      actual: walletHits,
    },
    {
      id: "erasure.address.community_room_owner",
      what: "`CommunityRoom.ownerId` is polymorphic with no relation behind it, so the cascade cannot reach it.",
      operator: "equals",
      expected: 0,
      actual: roomOwnerHits,
    },
    {
      id: "erasure.address.key_audit_log",
      what: "`KeyAuditLog.userId` is a dangling column: a rewrite it misses keeps the address forever, silently.",
      operator: "equals",
      expected: 0,
      actual: keyAuditHits,
    },
    {
      id: "erasure.address.agent_transaction",
      what: "`AgentTransaction.userId` is a dangling column on a retained financial row.",
      operator: "equals",
      expected: 0,
      actual: agentTxHits,
    },
    {
      id: "erasure.address.library_path",
      what: "The local file path contains the person's home directory.",
      operator: "equals",
      expected: 0,
      actual: libraryPathHits,
    },
    {
      id: "erasure.address.analytics",
      what: "Analytics keyed by the raw user id, the checksummed address and the pseudonymous actor id all have to go.",
      operator: "equals",
      expected: 0,
      actual: analyticsHits,
    },
    {
      id: "erasure.session_key_deleted",
      what: "A session key is a credential; the manifest deletes it outright.",
      operator: "equals",
      expected: 0,
      actual: sessionKeyHits,
    },
    {
      id: "erasure.private_key_absent",
      what: "The seeded agent private key must not be anywhere in the database afterwards.",
      operator: "equals",
      expected: 0,
      actual: privateKeyHits,
    },

    // Retained, but unlinked.
    {
      id: "erasure.financial.royalty_retained",
      what: "A royalty payment is a financial record under a retention obligation and keeps its recipient address.",
      operator: "equals",
      expected: identities.subjectAddressChecksummed,
      actual: royalty?.recipientAddress ?? null,
    },
    {
      id: "erasure.financial.agent_transaction_relinked",
      what: "The retained transaction stays, pointing at the rotated id rather than at the address.",
      operator: "equals",
      expected: rotatedUserId,
      actual: agentTx?.userId ?? null,
    },
    {
      id: "erasure.financial.purchase_intact",
      what: "What the other person bought is their financial record and must survive untouched.",
      operator: "equals",
      expected: identities.controlAddressChecksummed,
      actual: purchase?.buyerAddress ?? null,
    },

    // The catalogue.
    {
      id: "erasure.artist.detached",
      what: "`Artist.userId` is nullable by design: the profile is set adrift, the catalogue survives.",
      operator: "equals",
      expected: null,
      actual: artist ? artist.userId : "__missing__",
    },
    {
      id: "erasure.artist.payout_cleared",
      what: "No later payout may route to the erased person's wallet.",
      operator: "equals",
      expected: null,
      actual: artist ? artist.payoutAddress : "__missing__",
    },
    {
      id: "erasure.release.withdrawn_not_deleted",
      what: "Other people bought these releases, so streaming is suspended rather than the row removed.",
      operator: "equals",
      expected: "withdrawn",
      actual: release?.status ?? null,
    },
    {
      id: "erasure.release.prior_status_recorded",
      what: "#1793: the pre-withdrawal status is kept so a restore puts it back where it was.",
      operator: "equals",
      expected: "published",
      actual: release?.statusBeforeWithdrawal ?? null,
    },

    // The closure request.
    {
      id: "erasure.closure_settled",
      what: "The request survives as proof the erasure was asked for; the free text the person typed does not.",
      operator: "equals",
      expected: true,
      actual: closure?.status === AccountClosureStatus.completed && closure?.reason === null,
    },

    // The control account.
    {
      id: "erasure.control.untouched_account",
      what: "The second account must come through an erasure entirely untouched.",
      operator: "equals",
      expected: `${identities.controlUserId}@wallet.resonate`,
      actual: controlUser?.email ?? null,
    },
    {
      id: "erasure.control.not_erased",
      what: "Nothing may mark the control account as erased.",
      operator: "equals",
      expected: null,
      actual: controlUser ? controlUser.erasedAt : "__missing__",
    },
    {
      id: "erasure.control.wallet_intact",
      what: "The control's wallet still resolves.",
      operator: "equals",
      expected: 1,
      actual: controlWallet,
    },
    {
      id: "erasure.control.message_intact",
      what: "The control's own words are still their own.",
      operator: "equals",
      expected: own("message_body", "control"),
      actual: controlMessage?.body ?? null,
    },
    {
      id: "erasure.control.playlist_intact",
      what: "A public playlist belonging to someone else stays public.",
      operator: "equals",
      expected: "public",
      actual: controlPlaylist?.visibility ?? null,
    },
    {
      id: "erasure.control.release_still_published",
      what: "Withdrawal must not spill onto another artist's catalogue.",
      operator: "equals",
      expected: "published",
      actual: controlRelease?.status ?? null,
    },
    {
      id: "erasure.control.session_key_intact",
      what: "Also proves the private-key query above looks where keys actually live.",
      operator: "equals",
      expected: 1,
      actual: controlSessionKey,
    },
    {
      id: "erasure.control.analytics_intact",
      what: "Both analytics keyings for the control survive: the propagation was scoped to one person.",
      operator: "equals",
      expected: 2,
      actual: controlAnalytics,
    },
  ];

  return evaluateExpectations("verify-erasure", expectations, {
    prefix,
    // The rotated id is a fresh UUID naming nobody, so it is safe to report.
    // The pre-rotation id is the person's address and is deliberately absent.
    rotatedUserId,
  });
}

// ---------------------------------------------------------------------------
// Phase 5 — cleanup
// ---------------------------------------------------------------------------

export interface CleanupSummary {
  phase: string;
  removed: Record<string, number>;
  failures: Array<{ model: string; error: string }>;
  /** Things the harness knowingly leaves behind, and why. */
  residue: string[];
}

/**
 * Remove the harness's rows and nothing else.
 *
 * Every delete below filters on `startsWith(prefix)` where the prefix always
 * begins `govval_`, or on a user id list derived from rows that already matched
 * that prefix. There is no branch here that can reach a row the harness did not
 * create.
 */
export async function cleanupAll(invocation: GovernanceValidationInvocation): Promise<CleanupSummary> {
  const erasure = await cleanupErasure(invocation);
  const retention = await cleanupRetention(invocation);
  return {
    phase: "cleanup",
    removed: { ...erasure.removed, ...retention.removed },
    failures: [...erasure.failures, ...retention.failures],
    residue: [...new Set([...erasure.residue, ...retention.residue])],
  };
}

export async function cleanupRetention(
  invocation: GovernanceValidationInvocation,
): Promise<CleanupSummary> {
  const prefix = invocation.retentionPrefix;
  const removed: Record<string, number> = {};
  const failures: CleanupSummary["failures"] = [];

  await remove(removed, failures, "retention.analyticsGovernanceLog", () =>
    prisma.analyticsGovernanceLog.deleteMany({ where: { eventId: { startsWith: prefix } } }),
  );
  await remove(removed, failures, "retention.analyticsEvent", () =>
    prisma.analyticsEvent.deleteMany({ where: { id: { startsWith: prefix } } }),
  );

  return {
    phase: "cleanup:retention",
    removed,
    failures,
    residue: [
      `AnalyticsGovernanceLog rows with action "${WAREHOUSE_ERASURE_ACTION}" are batch summaries that ` +
        "carry no eventId and also describe real rows from the same run, so they are left in place.",
    ],
  };
}

export async function cleanupErasure(
  invocation: GovernanceValidationInvocation,
): Promise<CleanupSummary> {
  const prefix = invocation.erasurePrefix;
  const identities = erasureIdentities(prefix);
  const where = { id: { startsWith: prefix } };
  const removed: Record<string, number> = {};
  const failures: CleanupSummary["failures"] = [];

  // The seeded ids plus whatever they rotated to. Found through rows that
  // survive an erasure and still carry the prefix, which is the only handle
  // left once the id has changed.
  const [audits, sessions, transactions] = await Promise.all([
    prisma.keyAuditLog.findMany({ where, select: { userId: true } }),
    prisma.session.findMany({ where, select: { userId: true } }),
    prisma.agentTransaction.findMany({ where, select: { userId: true } }),
  ]);
  const userIds = [
    ...new Set([
      identities.subjectUserId,
      identities.controlUserId,
      ...audits.map((row) => row.userId),
      ...sessions.map((row) => row.userId),
      ...transactions.map((row) => row.userId),
    ]),
  ];

  // Reverse foreign-key order.
  await remove(removed, failures, "erasure.stemPurchase", () => prisma.stemPurchase.deleteMany({ where }));
  await remove(removed, failures, "erasure.stemListing", () => prisma.stemListing.deleteMany({ where }));
  await remove(removed, failures, "erasure.stem", () => prisma.stem.deleteMany({ where }));
  await remove(removed, failures, "erasure.track", () => prisma.track.deleteMany({ where }));
  await remove(removed, failures, "erasure.release", () => prisma.release.deleteMany({ where }));
  await remove(removed, failures, "erasure.artist", () => prisma.artist.deleteMany({ where }));
  await remove(removed, failures, "erasure.royaltyPayment", () => prisma.royaltyPayment.deleteMany({ where }));
  await remove(removed, failures, "erasure.agentTransaction", () => prisma.agentTransaction.deleteMany({ where }));
  await remove(removed, failures, "erasure.session", () => prisma.session.deleteMany({ where }));
  await remove(removed, failures, "erasure.keyAuditLog", () => prisma.keyAuditLog.deleteMany({ where }));
  await remove(removed, failures, "erasure.libraryTrack", () => prisma.libraryTrack.deleteMany({ where }));
  await remove(removed, failures, "erasure.communityMessage", () => prisma.communityMessage.deleteMany({ where }));
  await remove(removed, failures, "erasure.communityRoom", () => prisma.communityRoom.deleteMany({ where }));
  await remove(removed, failures, "erasure.playlist", () => prisma.playlist.deleteMany({ where }));
  await remove(removed, failures, "erasure.folder", () => prisma.folder.deleteMany({ where }));
  await remove(removed, failures, "erasure.sessionKey", () => prisma.sessionKey.deleteMany({ where }));
  await remove(removed, failures, "erasure.wallet", () => prisma.wallet.deleteMany({ where }));
  await remove(removed, failures, "erasure.analyticsGovernanceLog", () =>
    prisma.analyticsGovernanceLog.deleteMany({ where: { eventId: { startsWith: prefix } } }),
  );
  await remove(removed, failures, "erasure.analyticsEvent", () => prisma.analyticsEvent.deleteMany({ where }));
  await remove(removed, failures, "erasure.accountClosureRequest", () =>
    prisma.accountClosureRequest.deleteMany({ where: { userId: { in: userIds } } }),
  );
  await remove(removed, failures, "erasure.user", () =>
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  );

  return {
    phase: "cleanup:erasure",
    removed,
    failures,
    residue: [
      "AnalyticsGovernanceLog lineage written for an erased fixture event is removed by eventId prefix; " +
        `batch "${WAREHOUSE_ERASURE_ACTION}" summaries carry no eventId and are left in place.`,
    ],
  };
}

async function remove(
  removed: Record<string, number>,
  failures: CleanupSummary["failures"],
  model: string,
  operation: () => Promise<{ count: number }>,
) {
  try {
    removed[model] = (await operation()).count;
  } catch (error) {
    removed[model] = 0;
    failures.push({ model, error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type GovernanceValidationResult =
  | { kind: "refused"; exitCode: 1; reason: string }
  | { kind: "seed"; exitCode: 0; summary: RetentionSeedSummary | ErasureSeedSummary }
  | { kind: "verify"; exitCode: 0 | 1; report: VerificationReport }
  | { kind: "cleanup"; exitCode: 0 | 1; summary: CleanupSummary };

export async function runGovernanceValidation(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<GovernanceValidationResult> {
  const parsed = parseInvocation(argv, env);
  if (!parsed.ok) {
    return refuse(parsed.error);
  }

  // The guard runs before anything opens a connection: a harness that has to
  // reach the database in order to discover it must not write there is not a
  // guard.
  const guard = assessEnvironment(env);
  if (!guard.allowed) {
    return refuse(guard.reason);
  }

  const { invocation } = parsed;
  writeStructuredLog({
    level: "info",
    event: "governance.validation.started",
    message: `Governance validation: ${invocation.phase} in ${guard.environment}`,
    phase: invocation.phase,
    runId: invocation.runId,
    prefix: invocation.prefix,
    environment: guard.environment,
    signals: guard.signals.map((signal) => signal.variable),
  });

  switch (invocation.phase) {
    case "seed-retention":
      return { kind: "seed", exitCode: 0, summary: await seedRetention(invocation) };
    case "seed-erasure":
      return { kind: "seed", exitCode: 0, summary: await seedErasure(invocation) };
    case "verify-retention":
      return reportVerification(await verifyRetention(invocation));
    case "verify-erasure":
      return reportVerification(await verifyErasure(invocation));
    case "cleanup": {
      const summary = await cleanupAll(invocation);
      writeStructuredLog({
        level: summary.failures.length > 0 ? "error" : "info",
        event: "governance.validation.cleaned_up",
        message: `Cleanup removed ${Object.values(summary.removed).reduce((total, count) => total + count, 0)} rows by prefix`,
        removed: summary.removed,
        failures: summary.failures,
        residue: summary.residue,
      });
      return { kind: "cleanup", exitCode: summary.failures.length > 0 ? 1 : 0, summary };
    }
  }
}

function refuse(reason: string): GovernanceValidationResult {
  writeStructuredLog({
    level: "error",
    event: "governance.validation.refused",
    message: reason,
    phases: [...GOVERNANCE_VALIDATION_PHASES],
  });
  return { kind: "refused", exitCode: 1, reason };
}

/**
 * A failing verification names the expectation it broke.
 *
 * The whole point is a job execution that goes red when the policy was not
 * honoured, and a red execution nobody can read is only marginally better than
 * a green one that was wrong.
 */
function reportVerification(report: VerificationReport): GovernanceValidationResult {
  const exitCode = verificationExitCode(report);
  writeStructuredLog({
    level: exitCode === 0 ? "info" : "error",
    event:
      exitCode === 0 ? "governance.validation.verified" : "governance.validation.expectation_failed",
    message:
      exitCode === 0
        ? `${report.phase}: ${report.passed} of ${report.checked} expectations held`
        : `${report.phase}: ${report.failed} of ${report.checked} expectations failed`,
    phase: report.phase,
    status: report.status,
    checked: report.checked,
    passed: report.passed,
    failed: report.failed,
    failures: report.failures.map((failure) => ({
      id: failure.id,
      what: failure.what,
      operator: failure.operator,
      expected: failure.expected,
      actual: failure.actual,
    })),
    observations: report.observations,
  });
  return { kind: "verify", exitCode, report };
}

/** Exported because the mapping is the contract with the job that schedules this. */
export function exitCodeFor(result: GovernanceValidationResult): 0 | 1 {
  return result.exitCode;
}

if (require.main === module) {
  runGovernanceValidation()
    .then(async (result) => {
      await prisma.$disconnect();
      process.exit(exitCodeFor(result));
    })
    .catch(async (error) => {
      writeStructuredLog({
        level: "error",
        event: "governance.validation.crashed",
        message: "Governance validation could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      await prisma.$disconnect().catch(() => undefined);
      process.exit(1);
    });
}

/** Re-exported so the audit-preserved families are visible from one import. */
export { AUDIT_EVENT_NAMES };
