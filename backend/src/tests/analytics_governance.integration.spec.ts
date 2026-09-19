import { createHash } from "crypto";
import { prisma } from "../db/prisma";
import { Prisma } from "@prisma/client";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import {
  AnalyticsWarehouseGovernanceTarget,
  WarehouseErasureRequest,
  WarehouseErasureResult,
} from "../modules/analytics/analytics_warehouse_governance";

/** Stands in for the BigQuery warehouse; external services stay mocked. */
class RecordingWarehouseGovernanceTarget implements AnalyticsWarehouseGovernanceTarget {
  readonly calls: WarehouseErasureRequest[] = [];

  constructor(private readonly onErasure?: (request: WarehouseErasureRequest) => Promise<void>) {}

  describe() {
    return { provider: "recording" };
  }

  async applyErasure(request: WarehouseErasureRequest): Promise<WarehouseErasureResult> {
    this.calls.push(request);
    await this.onErasure?.(request);
    return {
      status: "ok",
      provider: "recording",
      deletedRows: request.deleteEventIds.length,
      redactedRows: request.redactEventIds.length,
      statements: 1,
    };
  }
}

const TEST_PREFIX = `analytics_governance_${Date.now()}_`;
/** A retention window long enough that nothing seeded here has expired. */
const KEEP_EVERYTHING_DAYS = 36500;

describe("Analytics governance integration", () => {
  const governance = new AnalyticsGovernanceService();
  const now = new Date("2026-05-20T12:00:00.000Z");

  afterAll(async () => {
    await prisma.analyticsGovernanceLog.deleteMany({
      where: {
        OR: [
          { eventId: { startsWith: TEST_PREFIX } },
          { actorId: { startsWith: TEST_PREFIX } },
          { subjectId: { startsWith: TEST_PREFIX } },
          { reason: { startsWith: TEST_PREFIX } },
          // Retention's warehouse_erasure rows carry no subject or actor.
          { action: "warehouse_erasure", reason: { startsWith: "retention expired for " } },
        ],
      },
    });
    await prisma.analyticsEvent.deleteMany({
      where: {
        OR: [
          { eventId: { startsWith: TEST_PREFIX } },
          { actorId: { startsWith: TEST_PREFIX } },
          { subjectId: { startsWith: TEST_PREFIX } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  it("deletes expired non-audit raw events and redacts expired audit events", async () => {
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}old_playback`,
      eventName: "playback.completed",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}user`,
      subjectType: "track",
      subjectId: `${TEST_PREFIX}track_deleted`,
      occurredAt: new Date("2024-01-01T00:00:00.000Z"),
      payload: { userId: `${TEST_PREFIX}user`, trackId: `${TEST_PREFIX}track_deleted` },
    });
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}old_payment`,
      eventName: "payment.settled",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}user`,
      subjectType: "track",
      subjectId: `${TEST_PREFIX}track_redacted`,
      occurredAt: new Date("2024-01-01T00:00:00.000Z"),
      payload: {
        userId: `${TEST_PREFIX}user`,
        trackId: `${TEST_PREFIX}track_redacted`,
        amountUsd: 4,
      },
    });
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}recent_generation`,
      eventName: "generation.created",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}recent_user`,
      subjectType: "generation",
      subjectId: `${TEST_PREFIX}recent_generation`,
      occurredAt: new Date("2026-05-01T00:00:00.000Z"),
      payload: { userId: `${TEST_PREFIX}recent_user` },
    });

    const result = await governance.runRetentionCleanup({
      now,
      policy: {
        personalDays: 30,
        sensitiveDays: 30,
        pseudonymousDays: 30,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        deleted: 1,
        redacted: 1,
        lineageRecords: 2,
      }),
    );
    await expect(prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}old_playback` } })).resolves.toBeNull();
    await expect(prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}recent_generation` } })).resolves.toEqual(
      expect.objectContaining({ actorId: `${TEST_PREFIX}recent_user` }),
    );

    const redacted = await prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}old_payment` } });
    expect(redacted).toEqual(
      expect.objectContaining({
        actorId: "[redacted]",
        subjectId: "[redacted]",
      }),
    );
    expect(redacted?.payload).toEqual(
      expect.objectContaining({
        userId: "[redacted]",
        trackId: `${TEST_PREFIX}track_redacted`,
        amountUsd: 4,
      }),
    );

    const lineage = await prisma.analyticsGovernanceLog.findMany({
      where: { eventId: { in: [`${TEST_PREFIX}old_playback`, `${TEST_PREFIX}old_payment`] } },
      orderBy: { eventId: "asc" },
    });
    expect(lineage.map((row) => row.action).sort()).toEqual(["retention_deleted", "retention_redacted"]);
  });

  /**
   * The warehouse is the long-lived store since the Sprint 21 cutover, so a
   * retention run that stops at Postgres enforces the window only in the copy
   * that is not the long-lived one (#1789). The `sensitive` tier is used on its
   * own here because no other suite writes it, and the retention scan is global.
   */
  it("erases the expired events from the warehouse as well as Postgres", async () => {
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}retention_playback`,
      eventName: "playback.completed",
      privacyTier: "sensitive",
      actorId: `${TEST_PREFIX}retention_user`,
      subjectType: "track",
      subjectId: `${TEST_PREFIX}retention_track`,
      occurredAt: new Date("2024-02-03T00:00:00.000Z"),
      payload: { userId: `${TEST_PREFIX}retention_user`, trackId: `${TEST_PREFIX}retention_track` },
    });
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}retention_commerce`,
      eventName: "commerce.settled",
      privacyTier: "sensitive",
      actorId: `${TEST_PREFIX}retention_user`,
      subjectType: "track",
      subjectId: `${TEST_PREFIX}retention_track`,
      occurredAt: new Date("2024-02-04T00:00:00.000Z"),
      payload: { userId: `${TEST_PREFIX}retention_user`, canonicalAmountUsd: 7 },
    });

    const postgresState: { deleted: unknown; redactedActorId: string | null | undefined }[] = [];
    const target = new RecordingWarehouseGovernanceTarget(async () => {
      postgresState.push({
        deleted: await prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}retention_playback` } }),
        redactedActorId: (
          await prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}retention_commerce` } })
        )?.actorId,
      });
    });

    // `runRetentionCleanup` scans the whole table, so any other suite's expired
    // fixtures land in the same run and write their own `warehouse_erasure`
    // row. Scope the lineage assertion below to this run by time rather than
    // matching the first row with the right action — the batch-level row
    // carries no eventId, actorId or subjectId to scope it by.
    const runStartedAt = new Date();
    const result = await new AnalyticsGovernanceService(target).runRetentionCleanup({
      now,
      policy: { personalDays: KEEP_EVERYTHING_DAYS, sensitiveDays: 30, pseudonymousDays: KEEP_EVERYTHING_DAYS },
    });

    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]).toEqual(
      expect.objectContaining({
        deleteEventIds: [`${TEST_PREFIX}retention_playback`],
        redactEventIds: [`${TEST_PREFIX}retention_commerce`],
        reason: "retention expired for sensitive event",
      }),
    );
    expect(target.calls[0].affectedDates.sort()).toEqual(["2024-02-03", "2024-02-04"]);
    // Postgres first, as for any other erasure: a load in between cannot reintroduce the rows.
    expect(postgresState).toEqual([{ deleted: null, redactedActorId: "[redacted]" }]);
    expect(target.calls[0].redactedEnvelopes).toEqual([
      expect.objectContaining({ eventId: `${TEST_PREFIX}retention_commerce`, actorId: "[redacted]", subjectId: "[redacted]" }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        deleted: 1,
        redacted: 1,
        lineageRecords: 2,
        warehouse: [
          { tier: "sensitive", status: "ok", provider: "recording", deletedRows: 1, redactedRows: 1, statements: 1 },
        ],
      }),
    );

    // The disposition survives the batching: an audit reviewer still sees which was which.
    const lineage = await prisma.analyticsGovernanceLog.findMany({
      where: { eventId: { in: [`${TEST_PREFIX}retention_playback`, `${TEST_PREFIX}retention_commerce`] } },
      orderBy: { eventId: "asc" },
    });
    expect(lineage.map((row) => row.action).sort()).toEqual(["retention_deleted", "retention_redacted"]);
    await expect(
      prisma.analyticsGovernanceLog.findFirst({
        where: {
          action: "warehouse_erasure",
          reason: "retention expired for sensitive event",
          createdAt: { gte: runStartedAt },
        },
        orderBy: { createdAt: "desc" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ sourceAction: "retention", warehouse: expect.objectContaining({ status: "ok" }) }),
      }),
    );
  });

  it("does not touch the warehouse when nothing has expired", async () => {
    const target = new RecordingWarehouseGovernanceTarget();

    const result = await new AnalyticsGovernanceService(target).runRetentionCleanup({
      now,
      policy: {
        personalDays: KEEP_EVERYTHING_DAYS,
        sensitiveDays: KEEP_EVERYTHING_DAYS,
        pseudonymousDays: KEEP_EVERYTHING_DAYS,
      },
    });

    expect(target.calls).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({ status: "ok", deleted: 0, redacted: 0, lineageRecords: 0, warehouse: [] }),
    );
  });

  it("keeps the expired-event purge and reports a retention warehouse failure", async () => {
    // The previous retention test left its redacted audit event in the same tier.
    await prisma.analyticsEvent.deleteMany({ where: { eventId: `${TEST_PREFIX}retention_commerce` } });
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}retention_failure`,
      eventName: "playback.completed",
      privacyTier: "sensitive",
      actorId: `${TEST_PREFIX}retention_failure_user`,
      subjectType: "track",
      subjectId: `${TEST_PREFIX}retention_failure_track`,
      occurredAt: new Date("2024-02-05T00:00:00.000Z"),
      payload: { userId: `${TEST_PREFIX}retention_failure_user` },
    });

    const failing: AnalyticsWarehouseGovernanceTarget = {
      describe: () => ({ provider: "recording" }),
      applyErasure: async () => {
        throw new Error("warehouse unavailable");
      },
    };

    const result = await new AnalyticsGovernanceService(failing).runRetentionCleanup({
      now,
      policy: { personalDays: KEEP_EVERYTHING_DAYS, sensitiveDays: 30, pseudonymousDays: KEEP_EVERYTHING_DAYS },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "warehouse_failed",
        deleted: 1,
        warehouse: [expect.objectContaining({ tier: "sensitive", status: "failed", error: "warehouse unavailable" })],
      }),
    );
    // The completed Postgres work is never discarded because the warehouse failed.
    await expect(
      prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}retention_failure` } }),
    ).resolves.toBeNull();
    await expect(
      prisma.analyticsGovernanceLog.findFirst({
        where: { action: "warehouse_erasure", reason: "retention expired for sensitive event" },
        orderBy: { createdAt: "desc" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ warehouse: expect.objectContaining({ status: "failed" }) }),
      }),
    );
  });

  it("propagates deletion while preserving lawful financial facts with redaction", async () => {
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}delete_generation`,
      eventName: "generation.created",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}delete_user`,
      subjectType: "generation",
      subjectId: `${TEST_PREFIX}delete_generation`,
      occurredAt: now,
      payload: { userId: `${TEST_PREFIX}delete_user` },
    });
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}delete_commerce`,
      eventName: "commerce.settled",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}delete_user`,
      subjectType: "track",
      subjectId: `${TEST_PREFIX}delete_track`,
      occurredAt: now,
      payload: { userId: `${TEST_PREFIX}delete_user`, canonicalAmountUsd: 9 },
    });

    const result = await governance.propagateDeletion({
      actorId: `${TEST_PREFIX}delete_user`,
      reason: "user deletion request",
    });

    expect(result).toEqual(
      expect.objectContaining({
        matched: 2,
        deleted: 1,
        redacted: 1,
        lineageRecords: 2,
      }),
    );
    await expect(prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}delete_generation` } })).resolves.toBeNull();
    await expect(prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}delete_commerce` } })).resolves.toEqual(
      expect.objectContaining({
        actorId: "[redacted]",
        payload: expect.objectContaining({
          userId: "[redacted]",
          canonicalAmountUsd: 9,
        }),
      }),
    );
  });

  it("propagates the erasure to the warehouse once, after the Postgres work", async () => {
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}warehouse_generation`,
      eventName: "generation.created",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}warehouse_user`,
      subjectType: "generation",
      subjectId: `${TEST_PREFIX}warehouse_generation`,
      occurredAt: new Date("2026-05-20T12:00:00.000Z"),
      payload: { userId: `${TEST_PREFIX}warehouse_user` },
    });
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}warehouse_commerce`,
      eventName: "commerce.settled",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}warehouse_user`,
      subjectType: "track",
      subjectId: `${TEST_PREFIX}warehouse_track`,
      occurredAt: new Date("2026-05-21T12:00:00.000Z"),
      payload: { userId: `${TEST_PREFIX}warehouse_user`, canonicalAmountUsd: 9 },
    });

    const postgresState: { deleted: unknown; redactedActorId: string | null | undefined }[] = [];
    const target = new RecordingWarehouseGovernanceTarget(async () => {
      postgresState.push({
        deleted: await prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}warehouse_generation` } }),
        redactedActorId: (
          await prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}warehouse_commerce` } })
        )?.actorId,
      });
    });

    const result = await new AnalyticsGovernanceService(target).propagateDeletion({
      actorId: `${TEST_PREFIX}warehouse_user`,
      reason: "user deletion request",
    });

    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]).toEqual(
      expect.objectContaining({
        deleteEventIds: [`${TEST_PREFIX}warehouse_generation`],
        redactEventIds: [`${TEST_PREFIX}warehouse_commerce`],
        reason: "user deletion request",
      }),
    );
    expect(target.calls[0].affectedDates.sort()).toEqual(["2026-05-20", "2026-05-21"]);
    // The warehouse runs after Postgres, so a load in between cannot reintroduce rows.
    expect(postgresState).toEqual([{ deleted: null, redactedActorId: "[redacted]" }]);
    expect(target.calls[0].redactedEnvelopes).toEqual([
      expect.objectContaining({ eventId: `${TEST_PREFIX}warehouse_commerce`, actorId: "[redacted]", subjectId: "[redacted]" }),
    ]);
    expect(result.warehouse).toEqual({
      status: "ok",
      provider: "recording",
      deletedRows: 1,
      redactedRows: 1,
      statements: 1,
    });
    await expect(
      prisma.analyticsGovernanceLog.findFirst({
        where: { action: "warehouse_erasure", actorId: `${TEST_PREFIX}warehouse_user` },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        reason: "user deletion request",
        details: expect.objectContaining({ sourceAction: "deletion_propagated" }),
      }),
    );
  });

  it("does not copy a wallet address into the warehouse erasure summary", async () => {
    const walletAddress = `0x${createHash("sha256").update(TEST_PREFIX).digest("hex").slice(0, 40)}`;
    const reason = `${TEST_PREFIX}wallet_erasure`;
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}wallet_lineage_event`,
      eventName: "generation.created",
      privacyTier: "personal",
      actorId: walletAddress,
      occurredAt: now,
      payload: { userId: walletAddress },
    });

    await new AnalyticsGovernanceService(new RecordingWarehouseGovernanceTarget()).propagateDeletion({
      actorId: walletAddress,
      reason,
    });

    const lineage = await prisma.analyticsGovernanceLog.findMany({ where: { reason } });
    expect(lineage).not.toHaveLength(0);
    expect(lineage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "warehouse_erasure",
          actorId: pseudonymousAnalyticsActorId(walletAddress),
        }),
      ]),
    );
    for (const row of lineage) {
      expect(row.actorId).not.toBe(walletAddress);
      expect(row.subjectId).not.toBe(walletAddress);
      expect(JSON.stringify(row.details).toLowerCase()).not.toContain(walletAddress.toLowerCase());
    }
  });

  it("keeps the Postgres erasure and reports the failure when the warehouse rejects it", async () => {
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}warehouse_failure`,
      eventName: "generation.created",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}warehouse_failure_user`,
      subjectType: "generation",
      subjectId: `${TEST_PREFIX}warehouse_failure`,
      occurredAt: now,
      payload: { userId: `${TEST_PREFIX}warehouse_failure_user` },
    });

    const failing: AnalyticsWarehouseGovernanceTarget = {
      describe: () => ({ provider: "recording" }),
      applyErasure: async () => {
        throw new Error("warehouse unavailable");
      },
    };

    const result = await new AnalyticsGovernanceService(failing).propagateDeletion({
      actorId: `${TEST_PREFIX}warehouse_failure_user`,
      reason: "user deletion request",
    });

    expect(result).toEqual(
      expect.objectContaining({
        deleted: 1,
        warehouse: expect.objectContaining({ status: "failed", error: "warehouse unavailable" }),
      }),
    );
    await expect(
      prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}warehouse_failure` } }),
    ).resolves.toBeNull();
    await expect(
      prisma.analyticsGovernanceLog.findFirst({
        where: { action: "warehouse_erasure", actorId: `${TEST_PREFIX}warehouse_failure_user` },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ warehouse: expect.objectContaining({ status: "failed" }) }),
      }),
    );
  });

  it("withdraws consent for matching events", async () => {
    await createAnalyticsEvent({
      eventId: `${TEST_PREFIX}consent_generation`,
      eventName: "generation.created",
      privacyTier: "personal",
      actorId: `${TEST_PREFIX}consent_user`,
      subjectType: "generation",
      subjectId: `${TEST_PREFIX}consent_generation`,
      consentBasis: "test-consent:v1",
      occurredAt: now,
      payload: { userId: `${TEST_PREFIX}consent_user` },
    });

    const result = await governance.withdrawConsent({
      actorId: `${TEST_PREFIX}consent_user`,
      consentBasis: "test-consent:v1",
      reason: "consent withdrawn",
    });

    expect(result).toEqual(expect.objectContaining({ matched: 1, deleted: 1, lineageRecords: 1 }));
    await expect(prisma.analyticsEvent.findUnique({ where: { eventId: `${TEST_PREFIX}consent_generation` } })).resolves.toBeNull();
    await expect(prisma.analyticsGovernanceLog.findFirst({
      where: {
        eventId: `${TEST_PREFIX}consent_generation`,
        action: "consent_withdrawn",
      },
    })).resolves.toEqual(expect.objectContaining({ reason: "consent withdrawn" }));
  });
});

async function createAnalyticsEvent(input: {
  eventId: string;
  eventName: string;
  privacyTier: string;
  actorId?: string;
  subjectType?: string;
  subjectId?: string;
  consentBasis?: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}) {
  const envelope = {
    eventId: input.eventId,
    eventName: input.eventName,
    eventVersion: 1,
    occurredAt: input.occurredAt.toISOString(),
    receivedAt: input.occurredAt.toISOString(),
    producer: "analytics-governance-test",
    environment: "local",
    privacyTier: input.privacyTier,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    actorId: input.actorId,
    consentBasis: input.consentBasis ?? "test-consent:v1",
    payload: input.payload,
  };

  return prisma.analyticsEvent.create({
    data: {
      eventId: input.eventId,
      eventName: input.eventName,
      eventVersion: 1,
      occurredAt: input.occurredAt,
      receivedAt: input.occurredAt,
      producer: "analytics-governance-test",
      environment: "local",
      privacyTier: input.privacyTier,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      actorId: input.actorId,
      consentBasis: input.consentBasis ?? "test-consent:v1",
      payload: input.payload as Prisma.InputJsonValue,
      envelope: envelope as Prisma.InputJsonValue,
    },
  });
}
