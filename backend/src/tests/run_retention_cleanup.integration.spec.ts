import { prisma } from "../db/prisma";
import { previewRetention } from "../scripts/run_retention_cleanup";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";

const TEST_PREFIX = `retention_preview_${Date.now()}_`;

const KEEP_EVERYTHING_DAYS = 36500;
const EXPIRE_EVERYTHING_DAYS = 1;

function eventData(id: string, occurredAt: Date) {
  return {
    id: `${TEST_PREFIX}${id}`,
    eventId: `${TEST_PREFIX}${id}_event`,
    eventName: "playback.completed",
    eventVersion: 1,
    occurredAt,
    receivedAt: occurredAt,
    producer: "backend",
    environment: "test",
    privacyTier: "sensitive",
    actorId: `${TEST_PREFIX}actor`,
    payload: { marker: TEST_PREFIX },
    envelope: { marker: TEST_PREFIX },
  };
}

describe("retention dry run (integration)", () => {
  beforeAll(async () => {
    await prisma.analyticsEvent.create({
      data: eventData("old", new Date("2020-01-01T00:00:00.000Z")),
    });
    await prisma.analyticsEvent.create({
      data: eventData("recent", new Date()),
    });
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  /**
   * The point of the dry run is to size the first real execution against a
   * ledger that has never been pruned. A preview that mutated anything would be
   * worse than no preview at all, because it would be trusted.
   */
  it("counts what would expire and changes nothing", async () => {
    const before = await prisma.analyticsEvent.count({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    expect(before).toBe(2);

    const governance = new AnalyticsGovernanceService();
    jest.spyOn(governance, "getRetentionPolicy").mockReturnValue({
      sensitiveDays: EXPIRE_EVERYTHING_DAYS,
      personalDays: KEEP_EVERYTHING_DAYS,
      pseudonymousDays: KEEP_EVERYTHING_DAYS,
    });

    const preview = await previewRetention(governance);

    const sensitive = preview.tiers.find((entry) => entry.tier === "sensitive");
    expect(sensitive?.expired).toBeGreaterThanOrEqual(1);

    // Nothing moved. Both seeded rows survive, including the expired one.
    expect(
      await prisma.analyticsEvent.count({ where: { id: { startsWith: TEST_PREFIX } } }),
    ).toBe(2);
    expect(
      await prisma.analyticsEvent.findUnique({ where: { id: `${TEST_PREFIX}old` } }),
    ).not.toBeNull();

    // And no lineage was written — a preview must not look like a run.
    expect(
      await prisma.analyticsGovernanceLog.count({
        where: { eventId: { startsWith: TEST_PREFIX } },
      }),
    ).toBe(0);
  });
});
