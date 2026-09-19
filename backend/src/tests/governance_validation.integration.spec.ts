/**
 * The governance validation harness against a real Postgres.
 *
 * This is the harness validating itself: seed backdated fixtures, run the
 * *real* `runRetentionCleanup` and the *real* `runDueErasures`, then let the
 * verify phases judge what happened. Two things have to be true for the harness
 * to be worth scheduling, and both are tested here:
 *
 *  1. it goes green when the policy was honoured, and
 *  2. it goes **red** when it was not — proved by breaking one expectation on
 *     purpose (deleting a control row that the policy says must survive) and
 *     checking that the report names exactly that expectation.
 *
 * A validation harness that has only ever been observed passing is in the same
 * position as the retention job was before this existed.
 */
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import {
  AnalyticsWarehouseGovernanceTarget,
  WarehouseErasureRequest,
} from "../modules/analytics/analytics_warehouse_governance";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";
import { prisma } from "../db/prisma";
import {
  cleanupAll,
  erasureIdentities,
  runGovernanceValidation,
  verifyErasure,
  verifyRetention,
} from "../scripts/governance_validation";
import {
  GovernanceValidationInvocation,
  parseInvocation,
} from "../scripts/governance_validation_support";

const RUN_ID = `it${Date.now().toString(16)}`.slice(0, 24);

/** What the infrastructure job sets, and nothing more. */
const ENABLED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GOVERNANCE_VALIDATION_ENABLED: "true",
  RESONATE_ENVIRONMENT_ID: "integration",
  GOVERNANCE_VALIDATION_RUN_ID: RUN_ID,
};

function invocationFor(phase: string): GovernanceValidationInvocation {
  const parsed = parseInvocation([phase, "--run-id", RUN_ID], {});
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.invocation;
}

const INVOCATION = invocationFor("cleanup");

/** External BigQuery stays mocked; the harness must still require an actual success. */
const successfulWarehouse: AnalyticsWarehouseGovernanceTarget = {
  describe: () => ({ provider: "recording" }),
  applyErasure: async (request: WarehouseErasureRequest) => ({
    status: "ok",
    provider: "recording",
    deletedRows: request.deleteEventIds.length,
    redactedRows: request.redactEventIds.length,
    statements: 1,
  }),
};

afterAll(async () => {
  await cleanupAll(INVOCATION);
  await prisma.$disconnect();
});

describe("governance validation harness — the guard", () => {
  it("refuses to write anything without the opt-in", async () => {
    const result = await runGovernanceValidation(["seed-retention", "--run-id", RUN_ID], {
      ...process.env,
      GOVERNANCE_VALIDATION_ENABLED: undefined,
      RESONATE_ENVIRONMENT_ID: "integration",
    });

    expect(result.kind).toBe("refused");
    expect(result.exitCode).toBe(1);
    // And it refused before touching the database, not after.
    expect(
      await prisma.analyticsEvent.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
    ).toBe(0);
  });

  it("refuses when the environment says production", async () => {
    const result = await runGovernanceValidation(["seed-retention", "--run-id", RUN_ID], {
      ...process.env,
      GOVERNANCE_VALIDATION_ENABLED: "true",
      RESONATE_ENVIRONMENT_ID: "resonate-prod",
    });

    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toContain("looks like production");
    expect(
      await prisma.analyticsEvent.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
    ).toBe(0);
  });
});

describe("governance validation harness — retention", () => {
  const retentionPrefix = INVOCATION.retentionPrefix;

  it("seeds backdated fixtures past all three windows", async () => {
    const result = await runGovernanceValidation(["seed-retention"], ENABLED_ENV);
    expect(result.kind).toBe("seed");
    expect(result.exitCode).toBe(0);

    const seeded = await prisma.analyticsEvent.findMany({
      where: { id: { startsWith: retentionPrefix } },
      select: { privacyTier: true, occurredAt: true },
    });
    expect(seeded.length).toBeGreaterThan(0);
    expect([...new Set(seeded.map((row) => row.privacyTier))].sort()).toEqual([
      "personal",
      "pseudonymous",
      "sensitive",
    ]);

    // The whole trick: a 730-day window is exercised today because the row is
    // 760 days old, not because anyone waited.
    const oldest = Math.min(...seeded.map((row) => row.occurredAt.getTime()));
    const ageDays = (Date.now() - oldest) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(730);
  }, 120000);

  it("is safe to re-run: a second seed refreshes rather than collides", async () => {
    const before = await prisma.analyticsEvent.count({ where: { id: { startsWith: retentionPrefix } } });
    const result = await runGovernanceValidation(["seed-retention"], ENABLED_ENV);
    expect(result.exitCode).toBe(0);
    expect(await prisma.analyticsEvent.count({ where: { id: { startsWith: retentionPrefix } } })).toBe(
      before,
    );
  }, 120000);

  it("passes after a real retention run, having seen deletion, redaction and survival", async () => {
    // The real service, the real policy, the real database — the same call the
    // scheduled `run_retention_cleanup` job makes.
    const run = await new AnalyticsGovernanceService(successfulWarehouse).runRetentionCleanup();
    expect(run.status).toBe("ok");
    expect(run.deleted).toBeGreaterThan(0);
    expect(run.redacted).toBeGreaterThan(0);

    const result = await runGovernanceValidation(["verify-retention"], ENABLED_ENV);
    expect(result.kind).toBe("verify");
    if (result.kind === "verify") {
      // Name the failures in the assertion message: a red run here should say
      // which promise broke, exactly as the job execution would.
      expect(result.report.failures.map((failure) => failure.id)).toEqual([]);
      expect(result.report.status).toBe("pass");
      expect(result.report.checked).toBeGreaterThan(20);
    }
    expect(result.exitCode).toBe(0);
  }, 180000);

  it("detects the failure it exists to detect: a control row that did not survive", async () => {
    // A retention run that deleted everything would satisfy every "expired row
    // is gone" expectation. Only the control rows can tell a policy from a
    // truncate, so this is the expectation whose sensitivity matters most.
    const control = `${retentionPrefix}sensitive_control_ordinary`;
    expect(await prisma.analyticsEvent.count({ where: { id: control } })).toBe(1);
    await prisma.analyticsEvent.delete({ where: { id: control } });

    const report = await verifyRetention(INVOCATION);

    expect(report.status).toBe("fail");
    const failed = report.failures.map((failure) => failure.id);
    expect(failed).toContain("retention.sensitive_control_ordinary.survived");
    expect(failed).toContain("retention.sensitive_control_ordinary.untouched_actor");
    // And it fails *only* on the row that was broken.
    expect(failed.every((id) => id.includes("sensitive_control_ordinary"))).toBe(true);

    // The same failure through the entry point the job invokes: exit 1.
    const result = await runGovernanceValidation(["verify-retention"], ENABLED_ENV);
    expect(result.exitCode).toBe(1);
  }, 180000);

  it("cleans up by prefix and leaves the rest of the ledger alone", async () => {
    const neighbour = `neighbour_${RUN_ID}`;
    await prisma.analyticsEvent.create({
      data: {
        id: neighbour,
        eventId: `${neighbour}_event`,
        eventName: "playback.completed",
        eventVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        producer: "backend",
        environment: "local",
        privacyTier: "pseudonymous",
        payload: {},
        envelope: {},
      },
    });

    const summary = await cleanupAll(INVOCATION);
    expect(summary.failures).toEqual([]);
    expect(await prisma.analyticsEvent.count({ where: { id: { startsWith: INVOCATION.prefix } } })).toBe(0);
    expect(
      await prisma.analyticsGovernanceLog.count({
        where: { eventId: { startsWith: INVOCATION.prefix } },
      }),
    ).toBe(0);
    // The row it did not create is still there.
    expect(await prisma.analyticsEvent.count({ where: { id: neighbour } })).toBe(1);

    await prisma.analyticsEvent.delete({ where: { id: neighbour } });
  }, 120000);
});

describe("governance validation harness — erasure", () => {
  const identities = erasureIdentities(INVOCATION.erasurePrefix);

  it("seeds an account due for erasure and a control that must not be touched", async () => {
    const result = await runGovernanceValidation(["seed-erasure"], ENABLED_ENV);
    expect(result.exitCode).toBe(0);

    expect(await prisma.user.count({ where: { id: identities.subjectUserId } })).toBe(1);
    expect(await prisma.user.count({ where: { id: identities.controlUserId } })).toBe(1);
    const closure = await prisma.accountClosureRequest.findFirst({
      where: { userId: identities.subjectUserId },
    });
    expect(closure?.dueAt.getTime()).toBeLessThan(Date.now());
    // Only the subject asked to be closed.
    expect(await prisma.accountClosureRequest.count({ where: { userId: identities.controlUserId } })).toBe(0);
  }, 180000);

  it("passes after a real due-erasure run", async () => {
    // The same call the scheduled `run_due_erasures` job makes.
    const service = new PersonalDataErasureService(
      new PersonalDataResolverService(),
      new AnalyticsGovernanceService(successfulWarehouse),
      new AccountClosureService(),
    );
    const run = await service.runDueErasures();
    expect(run.failed).toBe(0);
    expect(run.erased).toBeGreaterThan(0);

    const result = await runGovernanceValidation(["verify-erasure"], ENABLED_ENV);
    expect(result.kind).toBe("verify");
    if (result.kind === "verify") {
      expect(result.report.failures.map((failure) => failure.id)).toEqual([]);
      expect(result.report.status).toBe("pass");
    }
    expect(result.exitCode).toBe(0);
  }, 300000);

  it("detects an erasure that left the control account disturbed", async () => {
    // The mirror image of the retention control: an erasure that scrubbed both
    // accounts would satisfy every "the address is gone" expectation.
    const message = `${INVOCATION.erasurePrefix}message_control`;
    const original = await prisma.communityMessage.findUnique({ where: { id: message } });
    await prisma.communityMessage.update({ where: { id: message }, data: { body: "" } });

    const report = await verifyErasure(INVOCATION);
    expect(report.status).toBe("fail");
    expect(report.failures.map((failure) => failure.id)).toEqual([
      "erasure.control.message_intact",
    ]);

    await prisma.communityMessage.update({
      where: { id: message },
      data: { body: original!.body },
    });
  }, 180000);

  it("cleans up the erasure fixtures, rotated ids included", async () => {
    const summary = await cleanupAll(INVOCATION);
    expect(summary.failures).toEqual([]);

    expect(await prisma.user.count({ where: { id: identities.subjectUserId } })).toBe(0);
    expect(await prisma.user.count({ where: { id: identities.controlUserId } })).toBe(0);
    for (const remaining of [
      prisma.wallet.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
      prisma.artist.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
      prisma.release.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
      prisma.stemPurchase.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
      prisma.sessionKey.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
      prisma.analyticsEvent.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
    ]) {
      expect(await remaining).toBe(0);
    }
    // The rotated account is gone too: cleanup found it through a retained row.
    expect(
      await prisma.keyAuditLog.count({ where: { id: { startsWith: INVOCATION.prefix } } }),
    ).toBe(0);

    // Re-running cleanup on an already-clean prefix is a no-op, not an error.
    const again = await cleanupAll(INVOCATION);
    expect(again.failures).toEqual([]);
  }, 180000);
});
