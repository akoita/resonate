/**
 * #2119: withdrawing product-analytics consent deletes the events captured
 * under it, asynchronously, through the full analytics governance path.
 *
 * Real Postgres; the BigQuery warehouse is the only thing stood in for. The
 * cases prove the three things the policy promises and a naive delete would
 * get wrong: only consent-based events go (a contract-basis record of
 * something that happened stays), only events received up to the withdrawal go
 * (a later re-grant's events stay), and a warehouse that refuses leaves the
 * withdrawal pending and retryable instead of reporting a deletion that did
 * not happen.
 */
import { prisma } from "../db/prisma";
import { AnalyticsConsentService } from "../modules/analytics/analytics_consent.service";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import {
  AnalyticsWarehouseGovernanceTarget,
  WarehouseErasureRequest,
  WarehouseErasureResult,
} from "../modules/analytics/analytics_warehouse_governance";
import {
  ANALYTICS_CONSENT_WITHDRAWN_REASON,
  ConsentWithdrawalPropagationService,
} from "../modules/privacy/consent_withdrawal_propagation.service";

const TEST_PREFIX = `consent_withdrawal_${Date.now()}_`;
const MINUTE = 60_000;

class ScriptedWarehouse implements AnalyticsWarehouseGovernanceTarget {
  readonly calls: WarehouseErasureRequest[] = [];

  constructor(public status: WarehouseErasureResult["status"] = "ok") {}

  describe() {
    return { provider: "recording" };
  }

  async applyErasure(request: WarehouseErasureRequest): Promise<WarehouseErasureResult> {
    this.calls.push(request);
    return {
      status: this.status,
      provider: "recording",
      deletedRows: this.status === "ok" ? request.deleteEventIds.length : 0,
      redactedRows: this.status === "ok" ? request.redactEventIds.length : 0,
      statements: this.status === "skipped" ? 0 : 1,
      ...(this.status === "failed" ? { error: "streaming buffer" } : {}),
    };
  }
}

const consent = new AnalyticsConsentService();
const createdUsers: string[] = [];
let sequence = 0;

async function newUser(label: string) {
  const id = `${TEST_PREFIX}${label}_${sequence++}`;
  await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  createdUsers.push(id);
  return id;
}

async function event(input: {
  key: string;
  actorId?: string;
  consentBasis: string | null;
  receivedAt: Date;
  eventName?: string;
}) {
  const eventId = `${TEST_PREFIX}${input.key}`;
  return prisma.analyticsEvent.create({
    data: {
      eventId,
      eventName: input.eventName ?? "playback.completed",
      eventVersion: 1,
      occurredAt: input.receivedAt,
      receivedAt: input.receivedAt,
      producer: "consent-withdrawal-test",
      environment: "local",
      privacyTier: "pseudonymous",
      actorId: input.actorId,
      consentBasis: input.consentBasis,
      payload: {},
      envelope: {},
    },
  });
}

const survivors = async (keys: string[]) =>
  (
    await prisma.analyticsEvent.findMany({
      where: { eventId: { in: keys.map((key) => `${TEST_PREFIX}${key}`) } },
      select: { eventId: true },
    })
  )
    .map((row) => row.eventId.slice(TEST_PREFIX.length))
    .sort();

/** Grants, seeds events received a minute before the withdrawal, then withdraws. */
async function grantSeedAndWithdraw(userId: string, keyPrefix: string) {
  await consent.record(userId, true);
  const before = new Date(Date.now() - MINUTE);
  const actorId = pseudonymousAnalyticsActorId(userId);
  await event({ key: `${keyPrefix}_consent`, actorId, consentBasis: "consent", receivedAt: before });
  // Server-side producers write the raw user id, not the pseudonym.
  await event({ key: `${keyPrefix}_consent_raw`, actorId: userId, consentBasis: "consent", receivedAt: before });
  await event({ key: `${keyPrefix}_contract`, actorId, consentBasis: "contract", receivedAt: before });
  await event({ key: `${keyPrefix}_no_basis`, actorId, consentBasis: null, receivedAt: before });
  await consent.record(userId, false);
  return prisma.analyticsConsentWithdrawal.findFirstOrThrow({ where: { userId } });
}

function serviceWith(warehouse: AnalyticsWarehouseGovernanceTarget) {
  return new ConsentWithdrawalPropagationService(new AnalyticsGovernanceService(warehouse));
}

afterAll(async () => {
  await prisma.analyticsGovernanceLog.deleteMany({
    where: {
      OR: [
        { eventId: { startsWith: TEST_PREFIX } },
        { actorId: { in: createdUsers.map((id) => pseudonymousAnalyticsActorId(id) ?? id) } },
        { actorId: { startsWith: TEST_PREFIX } },
      ],
    },
  });
  await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: TEST_PREFIX } } });
  await prisma.analyticsConsentWithdrawal.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.analyticsConsent.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("consent withdrawal propagation", () => {
  it("deletes the consent-based events captured before the withdrawal and nothing else", async () => {
    const warehouse = new ScriptedWarehouse("ok");
    const subject = await newUser("subject");
    const bystander = await newUser("bystander");
    await consent.record(bystander, true);
    await event({
      key: "bystander_consent",
      actorId: pseudonymousAnalyticsActorId(bystander),
      consentBasis: "consent",
      receivedAt: new Date(Date.now() - MINUTE),
    });
    const withdrawal = await grantSeedAndWithdraw(subject, "a");

    // A later re-grant's event: same basis, received after the withdrawal.
    await event({
      key: "a_after_regrant",
      actorId: pseudonymousAnalyticsActorId(subject),
      consentBasis: "consent",
      receivedAt: new Date(withdrawal.withdrawnAt.getTime() + MINUTE),
    });

    const run = await serviceWith(warehouse).runPendingWithdrawals();

    expect(run.results).toContainEqual({ id: withdrawal.id, status: "completed" });
    expect(await survivors(["a_consent", "a_consent_raw", "a_contract", "a_no_basis", "a_after_regrant", "bystander_consent"]))
      .toEqual(["a_after_regrant", "a_contract", "a_no_basis", "bystander_consent"]);

    const settled = await prisma.analyticsConsentWithdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
    expect(settled).toMatchObject({
      status: "completed",
      attempts: 1,
      deleted: 2,
      redacted: 0,
      matched: 2,
      lastErrorStatus: null,
    });
    expect(settled.completedAt).not.toBeNull();

    // Warehouse first, with exactly the removed ids.
    expect(warehouse.calls.flatMap((call) => call.deleteEventIds).sort()).toEqual([
      `${TEST_PREFIX}a_consent`,
      `${TEST_PREFIX}a_consent_raw`,
    ]);
    expect(warehouse.calls.every((call) => call.reason === ANALYTICS_CONSENT_WITHDRAWN_REASON)).toBe(true);

    const lineage = await prisma.analyticsGovernanceLog.findMany({
      where: { eventId: { in: [`${TEST_PREFIX}a_consent`, `${TEST_PREFIX}a_consent_raw`] } },
    });
    expect(lineage.map((row) => row.action)).toEqual(["consent_withdrawn", "consent_withdrawn"]);
    expect(lineage.every((row) => row.reason === ANALYTICS_CONSENT_WITHDRAWN_REASON)).toBe(true);
    // The window the deletion covered is part of the lineage.
    expect(JSON.stringify(lineage[0].details)).toContain(withdrawal.withdrawnAt.toISOString());
  }, 120000);

  it("keeps the withdrawal pending and retryable while the warehouse refuses, then completes", async () => {
    const warehouse = new ScriptedWarehouse("failed");
    const subject = await newUser("retry");
    const withdrawal = await grantSeedAndWithdraw(subject, "b");

    const first = await serviceWith(warehouse).runPendingWithdrawals();

    expect(first.status).toBe("failures");
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(first.results).toContainEqual({ id: withdrawal.id, status: "failed" });
    // Postgres still holds the ids, so the retry can act on them.
    expect(await survivors(["b_consent", "b_consent_raw"])).toEqual(["b_consent", "b_consent_raw"]);
    const stuck = await prisma.analyticsConsentWithdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
    expect(stuck).toMatchObject({ status: "pending", attempts: 1, completedAt: null });
    expect(stuck.lastErrorStatus).toBe("warehouse:failed");
    // Sanitized: a status, never an identifier or the warehouse's message.
    expect(stuck.lastErrorStatus).not.toContain(subject);
    expect(stuck.lastErrorStatus).not.toContain("streaming buffer");

    warehouse.status = "ok";
    const second = await serviceWith(warehouse).runPendingWithdrawals();

    expect(second.results).toContainEqual({ id: withdrawal.id, status: "completed" });
    expect(await survivors(["b_consent", "b_consent_raw", "b_contract"])).toEqual(["b_contract"]);
    const done = await prisma.analyticsConsentWithdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
    expect(done).toMatchObject({ status: "completed", attempts: 2, deleted: 2, lastErrorStatus: null });
  }, 120000);

  it("requeues instead of completing when a newer withdrawal moves the bound mid-run", async () => {
    const subject = await newUser("moved");
    const withdrawal = await grantSeedAndWithdraw(subject, "m");
    // While the warehouse call is in flight the person re-grants and withdraws
    // again, which moves the same row's bound forward.
    let interleaved = false;
    const warehouse = new ScriptedWarehouse("ok");
    const original = warehouse.applyErasure.bind(warehouse);
    warehouse.applyErasure = async (request) => {
      if (!interleaved) {
        interleaved = true;
        await consent.record(subject, true);
        await event({ key: "m_after_regrant", actorId: pseudonymousAnalyticsActorId(subject), consentBasis: "consent", receivedAt: new Date() });
        await consent.record(subject, false);
      }
      return original(request);
    };

    const first = await serviceWith(warehouse).runPendingWithdrawals();

    expect(first.results).toContainEqual({ id: withdrawal.id, status: "requeued" });
    expect(first.failed).toBe(0);
    const moved = await prisma.analyticsConsentWithdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
    expect(moved.status).toBe("pending");
    expect(moved.withdrawnAt.getTime()).toBeGreaterThan(withdrawal.withdrawnAt.getTime());
    // The window captured during the re-grant is still there for the next run.
    expect(await survivors(["m_after_regrant"])).toEqual(["m_after_regrant"]);

    const second = await serviceWith(new ScriptedWarehouse("ok")).runPendingWithdrawals();

    expect(second.results).toContainEqual({ id: withdrawal.id, status: "completed" });
    expect(await survivors(["m_consent", "m_consent_raw", "m_after_regrant", "m_contract"])).toEqual(["m_contract"]);
  }, 120000);

  it("treats a skipped warehouse as done, as account erasure does for Postgres-only environments", async () => {
    const subject = await newUser("skipped");
    const withdrawal = await grantSeedAndWithdraw(subject, "c");

    const run = await serviceWith(new ScriptedWarehouse("skipped")).runPendingWithdrawals();

    expect(run.results).toContainEqual({ id: withdrawal.id, status: "completed" });
    expect(await survivors(["c_consent", "c_consent_raw", "c_contract"])).toEqual(["c_contract"]);
  }, 120000);

  it("completes a withdrawal with nothing to delete without calling the warehouse", async () => {
    const warehouse = new ScriptedWarehouse("ok");
    const subject = await newUser("empty");
    await consent.record(subject, true);
    await consent.record(subject, false);
    const withdrawal = await prisma.analyticsConsentWithdrawal.findFirstOrThrow({ where: { userId: subject } });

    const run = await serviceWith(warehouse).runPendingWithdrawals();

    expect(run.results).toContainEqual({ id: withdrawal.id, status: "completed" });
    expect(warehouse.calls).toHaveLength(0);
    expect(
      await prisma.analyticsConsentWithdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } }),
    ).toMatchObject({ status: "completed", matched: 0, deleted: 0, redacted: 0 });
  }, 120000);

  it("works the oldest withdrawals first and honours the batch limit", async () => {
    const warehouse = new ScriptedWarehouse("ok");
    const older = await newUser("older");
    const newer = await newUser("newer");
    await consent.record(older, true);
    await consent.record(older, false);
    await consent.record(newer, true);
    await consent.record(newer, false);
    // Pushed to the front of the queue regardless of what other specs left behind.
    await prisma.analyticsConsentWithdrawal.updateMany({
      where: { userId: older },
      data: { withdrawnAt: new Date("1990-01-01T00:00:00.000Z") },
    });
    await prisma.analyticsConsentWithdrawal.updateMany({
      where: { userId: newer },
      data: { withdrawnAt: new Date("1990-01-02T00:00:00.000Z") },
    });
    const [olderRow, newerRow] = await Promise.all([
      prisma.analyticsConsentWithdrawal.findFirstOrThrow({ where: { userId: older } }),
      prisma.analyticsConsentWithdrawal.findFirstOrThrow({ where: { userId: newer } }),
    ]);

    const run = await serviceWith(warehouse).runPendingWithdrawals({ limit: 1 });

    expect(run.due).toBe(1);
    expect(run.results).toEqual([{ id: olderRow.id, status: "completed" }]);
    expect(
      (await prisma.analyticsConsentWithdrawal.findUniqueOrThrow({ where: { id: newerRow.id } })).status,
    ).toBe("pending");
  }, 120000);

  it("does not report results that name a person", async () => {
    const subject = await newUser("privacy");
    const withdrawal = await grantSeedAndWithdraw(subject, "d");

    const run = await serviceWith(new ScriptedWarehouse("ok")).runPendingWithdrawals();

    const serialized = JSON.stringify(run);
    expect(serialized).toContain(withdrawal.id);
    expect(serialized).not.toContain(subject);
    expect(serialized).not.toContain(pseudonymousAnalyticsActorId(subject)!);
  }, 120000);
});

describe("AnalyticsGovernanceService.withdrawConsent receivedBefore", () => {
  it("only affects events received at or before the bound, and records the bound in the lineage", async () => {
    const warehouse = new ScriptedWarehouse("ok");
    const governance = new AnalyticsGovernanceService(warehouse);
    const actorId = `${TEST_PREFIX}bound_actor`;
    const bound = new Date("2026-03-01T00:00:00.000Z");
    await event({ key: "bound_before", actorId, consentBasis: "consent", receivedAt: new Date(bound.getTime() - MINUTE) });
    await event({ key: "bound_at", actorId, consentBasis: "consent", receivedAt: bound });
    await event({ key: "bound_after", actorId, consentBasis: "consent", receivedAt: new Date(bound.getTime() + MINUTE) });

    const result = await governance.withdrawConsent({
      actorId,
      consentBasis: "consent",
      receivedBefore: bound,
      reason: `${TEST_PREFIX}bound`,
    });

    expect(result.matched).toBe(2);
    expect(await survivors(["bound_before", "bound_at", "bound_after"])).toEqual(["bound_after"]);
    const lineage = await prisma.analyticsGovernanceLog.findFirstOrThrow({
      where: { eventId: `${TEST_PREFIX}bound_at` },
    });
    expect(lineage.details).toMatchObject({ receivedBefore: bound.toISOString() });
  }, 120000);

  it("keeps the unbounded behaviour when no bound is given", async () => {
    const governance = new AnalyticsGovernanceService(new ScriptedWarehouse("ok"));
    const actorId = `${TEST_PREFIX}unbounded_actor`;
    await event({ key: "unbounded_old", actorId, consentBasis: "consent", receivedAt: new Date("2020-01-01T00:00:00.000Z") });
    await event({ key: "unbounded_future", actorId, consentBasis: "consent", receivedAt: new Date("2099-01-01T00:00:00.000Z") });

    const result = await governance.withdrawConsent({
      actorId,
      consentBasis: "consent",
      reason: `${TEST_PREFIX}unbounded`,
    });

    expect(result.matched).toBe(2);
    expect(await survivors(["unbounded_old", "unbounded_future"])).toEqual([]);
  }, 120000);
});
