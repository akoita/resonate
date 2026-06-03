import { prisma } from "../db/prisma";
import { CommunityCohortQualityService } from "../modules/community/community_cohort_quality.service";

const TEST_PREFIX = `community_cohort_quality_${Date.now()}_`;
const service = new CommunityCohortQualityService();

describe("CommunityCohortQualityService integration", () => {
  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: TEST_PREFIX } } });
    await prisma.communityCohortMembership.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityCohort.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityVisibilitySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it("returns a privacy-safe empty report", async () => {
    const report = await service.getQualityReport();

    expect(report).toMatchObject({
      schemaVersion: "community-cohort-quality/v1",
      cohorts: expect.objectContaining({
        byStatus: {},
        byType: {},
      }),
      memberships: expect.objectContaining({
        byStatus: {},
        disabledConsent: { total: 0, byType: {} },
      }),
      actions: {
        total: 0,
        source: "analytics_event_ledger",
        byEvent: [
          { key: "community.cohort_suggested", count: 0 },
          { key: "community.cohort_joined", count: 0 },
          { key: "community.cohort_left", count: 0 },
          { key: "community.cohort_hidden", count: 0 },
        ],
      },
      reasonCodes: expect.objectContaining({
        total: 0,
        summaries: [],
      }),
      privacy: {
        aggregateOnly: true,
        noListenerIdentifiers: true,
        noWalletAddresses: true,
        noRawListeningHistory: true,
        noFineLocation: true,
        reasonCodesAreBounded: true,
        memberCountsAreBucketed: true,
      },
    });
  });

  it("aggregates cohort lifecycle, membership, consent, action, and reason-code quality", async () => {
    await seedQualityData();

    const report = await service.getQualityReport();

    expect(report.cohorts).toMatchObject({
      total: 3,
      visibleNow: 1,
      belowThreshold: 2,
      byStatus: {
        active: 1,
        archived: 1,
        expired: 1,
      },
      byType: {
        taste: 1,
        city_scene: 1,
        collector: 1,
      },
    });
    expect(report.memberships).toMatchObject({
      total: 6,
      stale: 2,
      byStatus: {
        suggested: 2,
        joined: 1,
        hidden: 1,
        stale: 1,
        stale_joined: 1,
      },
      disabledConsent: {
        total: 1,
        byType: { taste: 1 },
      },
    });
    expect(report.actions.byEvent).toEqual([
      { key: "community.cohort_suggested", count: 1 },
      { key: "community.cohort_joined", count: 1 },
      { key: "community.cohort_left", count: 0 },
      { key: "community.cohort_hidden", count: 1 },
    ]);
    expect(report.actions.total).toBe(3);
    expect(report.reasonCodes.summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cohortType: "city_scene",
        reasonCode: "city_scene:paris_fr",
        cohortCount: 1,
        archivedCount: 1,
        belowThresholdCount: 1,
        visibleMemberBucket: "1-4",
      }),
      expect.objectContaining({
        cohortType: "taste",
        reasonCode: "taste:dream_pop",
        cohortCount: 1,
        activeCount: 1,
        belowThresholdCount: 0,
        visibleMemberBucket: "5-9",
      }),
    ]));

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(`${TEST_PREFIX}opted_in`);
    expect(serialized).not.toContain("0x1111111111111111111111111111111111111111");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("private_history");
    expect(serialized).not.toContain("\"visibleMemberCount\"");
  });
});

async function seedQualityData() {
  const optedInUserId = `${TEST_PREFIX}opted_in`;
  const optedOutUserId = `${TEST_PREFIX}opted_out`;
  const cityUserId = `${TEST_PREFIX}city_user`;
  const staleUserId = `${TEST_PREFIX}stale_user`;
  const staleJoinedUserId = `${TEST_PREFIX}stale_joined_user`;
  const hiddenUserId = `${TEST_PREFIX}hidden_user`;

  await prisma.user.createMany({
    data: [
      { id: optedInUserId, email: `${optedInUserId}@test.resonate` },
      { id: optedOutUserId, email: `${optedOutUserId}@test.resonate` },
      { id: cityUserId, email: `${cityUserId}@test.resonate` },
      { id: staleUserId, email: `${staleUserId}@test.resonate` },
      { id: staleJoinedUserId, email: `${staleJoinedUserId}@test.resonate` },
      { id: hiddenUserId, email: `${hiddenUserId}@test.resonate` },
    ],
  });
  await prisma.communityVisibilitySettings.createMany({
    data: [
      { userId: optedInUserId, allowTasteMatching: true, allowCityScenes: false },
      { userId: optedOutUserId, allowTasteMatching: false, allowCityScenes: false },
      { userId: cityUserId, allowTasteMatching: false, allowCityScenes: true },
      { userId: staleUserId, allowTasteMatching: true, allowCityScenes: false },
      { userId: staleJoinedUserId, allowTasteMatching: true, allowCityScenes: false },
      { userId: hiddenUserId, allowTasteMatching: true, allowCityScenes: false },
    ],
  });

  const tasteCohort = await prisma.communityCohort.create({
    data: {
      id: `${TEST_PREFIX}taste`,
      cohortType: "taste",
      reasonCode: "taste:dream_pop",
      title: "Dream pop listeners",
      safeExplanation: "Listeners sharing privacy-safe dream pop taste.",
      minimumSize: 5,
      visibleMemberCount: 6,
      status: "active",
    },
  });
  const cityCohort = await prisma.communityCohort.create({
    data: {
      id: `${TEST_PREFIX}city`,
      cohortType: "city_scene",
      reasonCode: "city_scene:paris_fr",
      title: "Paris scene listeners",
      safeExplanation: "Listeners sharing a coarse city scene.",
      minimumSize: 5,
      visibleMemberCount: 3,
      status: "archived",
    },
  });
  await prisma.communityCohort.create({
    data: {
      id: `${TEST_PREFIX}collector`,
      cohortType: "collector",
      reasonCode: "collector:rare_drop",
      title: "Collector listeners",
      safeExplanation: "Collectors sharing a safe catalog signal.",
      minimumSize: 5,
      visibleMemberCount: 0,
      status: "expired",
      expiresAt: new Date(Date.now() - 60_000),
    },
  });

  await prisma.communityCohortMembership.createMany({
    data: [
      { cohortId: tasteCohort.id, userId: optedInUserId, status: "suggested" },
      { cohortId: tasteCohort.id, userId: optedOutUserId, status: "suggested" },
      { cohortId: tasteCohort.id, userId: staleUserId, status: "stale" },
      { cohortId: tasteCohort.id, userId: staleJoinedUserId, status: "stale_joined" },
      { cohortId: tasteCohort.id, userId: hiddenUserId, status: "hidden" },
      { cohortId: cityCohort.id, userId: cityUserId, status: "joined" },
    ],
  });

  await prisma.analyticsEvent.createMany({
    data: [
      analyticsEvent("community.cohort_suggested", "suggested"),
      analyticsEvent("community.cohort_joined", "joined"),
      analyticsEvent("community.cohort_hidden", "hidden"),
    ],
  });
}

function analyticsEvent(eventName: string, suffix: string) {
  const occurredAt = new Date();
  return {
    eventId: `${TEST_PREFIX}${suffix}`,
    eventName,
    eventVersion: 1,
    occurredAt,
    receivedAt: occurredAt,
    producer: "community-service",
    environment: "test",
    privacyTier: "internal",
    subjectType: "community_cohort",
    subjectId: `${TEST_PREFIX}taste`,
    consentBasis: "community_cohort_matching:v1",
    payload: {
      cohortType: "taste",
      reasonCode: "taste:dream_pop",
      membershipStatus: suffix,
      unsafeIgnored: "0x1111111111111111111111111111111111111111 user@example.com private_history",
    },
    sourceRefs: {},
    envelope: { eventName },
  };
}
