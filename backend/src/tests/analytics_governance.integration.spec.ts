import { prisma } from "../db/prisma";
import { Prisma } from "@prisma/client";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";

const TEST_PREFIX = `analytics_governance_${Date.now()}_`;

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
