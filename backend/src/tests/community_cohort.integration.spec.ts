import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { CommunityCohortService } from "../modules/community/community_cohort.service";

const TEST_PREFIX = `community_cohort_${Date.now()}_`;
const optedInUserId = `${TEST_PREFIX}opted_in`;
const optedOutUserId = `${TEST_PREFIX}opted_out`;
const cityUserId = `${TEST_PREFIX}city_user`;

const eventBus = { publish: jest.fn() };
const service = new CommunityCohortService(eventBus as any);

describe("CommunityCohortService integration", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: optedInUserId, email: `${optedInUserId}@test.resonate` },
        { id: optedOutUserId, email: `${optedOutUserId}@test.resonate` },
        { id: cityUserId, email: `${cityUserId}@test.resonate` },
      ],
    });
    await prisma.communityVisibilitySettings.createMany({
      data: [
        { userId: optedInUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: optedOutUserId, allowTasteMatching: false, allowCityScenes: false },
        { userId: cityUserId, allowTasteMatching: false, allowCityScenes: true },
      ],
    });
  });

  afterAll(async () => {
    await prisma.communityCohortMembership.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityCohort.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityVisibilitySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(() => eventBus.publish.mockClear());

  it("suggests only consented cohorts that meet minimum size and emits once", async () => {
    const cohort = await createCohort("taste_main", {
      cohortType: "taste",
      reasonCode: "taste:ambient",
      safeExplanation: "A small group for listeners exploring ambient releases.",
      minimumSize: 5,
      visibleMemberCount: 8,
    });
    await addMembership(cohort.id, optedInUserId);
    await addMembership(cohort.id, optedOutUserId);
    const small = await createCohort("taste_small", {
      cohortType: "taste",
      reasonCode: "taste:tiny",
      minimumSize: 5,
      visibleMemberCount: 3,
    });
    await addMembership(small.id, optedInUserId);

    const optedIn = await service.listSuggestions(optedInUserId);
    const optedOut = await service.listSuggestions(optedOutUserId);

    expect(optedIn.cohorts).toEqual([
      expect.objectContaining({
        id: cohort.id,
        cohortType: "taste",
        reasonCode: "taste:ambient",
        safeExplanation: "A small group for listeners exploring ambient releases.",
        visibleMemberCount: 8,
        membership: expect.objectContaining({ status: "suggested" }),
      }),
    ]);
    expect(optedOut.cohorts).toEqual([]);
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.cohort_suggested",
      userId: optedInUserId,
      cohortId: cohort.id,
      cohortType: "taste",
      reasonCode: "taste:ambient",
      visibleMemberCount: 8,
    }));

    eventBus.publish.mockClear();
    await service.listSuggestions(optedInUserId);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it("sanitizes unsafe explanations before returning suggestions", async () => {
    const cohort = await createCohort("unsafe_explanation", {
      cohortType: "taste",
      reasonCode: "taste:unsafe",
      safeExplanation: "Matched wallet 0x1111111111111111111111111111111111111111 from private history.",
      minimumSize: 5,
      visibleMemberCount: 5,
    });
    await addMembership(cohort.id, optedInUserId);

    const response = await service.listSuggestions(optedInUserId);

    expect(response.cohorts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: cohort.id,
        safeExplanation: "This group is based on shared, privacy-safe community signals.",
      }),
    ]));
  });

  it("returns privacy-safe detail only for visible cohort memberships", async () => {
    const cohort = await createCohort("detail_visible", {
      cohortType: "taste",
      reasonCode: "taste:detail",
      safeExplanation: "Listeners in this group share a safe listening pattern.",
      minimumSize: 5,
      visibleMemberCount: 9,
    });
    await addMembership(cohort.id, optedInUserId);

    const detail = await service.getCohortDetail(optedInUserId, cohort.id);

    expect(detail).toMatchObject({
      schemaVersion: "community-cohort-detail/v1",
      cohort: {
        id: cohort.id,
        cohortType: "taste",
        reasonCode: "taste:detail",
        safeExplanation: "Listeners in this group share a safe listening pattern.",
        memberCountLabel: "5+ listeners",
        membership: expect.objectContaining({ status: "suggested" }),
      },
      context: {
        signalLabel: "Shared listening signal",
        memberCountLabel: "5+ listeners",
        visibility: "suggested_or_joined_members_only",
      },
      privacy: {
        minimumSizeEnforced: true,
        memberCountsAreBucketed: true,
        otherListenerIdentities: "redacted",
        walletAddresses: "redacted",
        rawListeningHistory: "redacted",
      },
    });
    expect(detail.cohort).not.toHaveProperty("visibleMemberCount");
    expect(detail.cohort).not.toHaveProperty("minimumSize");
    expect(JSON.stringify(detail)).not.toContain("9+ listeners");
    expect(JSON.stringify(detail)).not.toContain(optedInUserId);
    expect(JSON.stringify(detail)).not.toContain("@test.resonate");
    expect(JSON.stringify(detail)).not.toContain("0x");
  });

  it("uses coarse public member-count buckets for nonstandard privacy floors", async () => {
    const cohort = await createCohort("detail_bucketed", {
      cohortType: "taste",
      reasonCode: "taste:bucketed",
      minimumSize: 37,
      visibleMemberCount: 40,
    });
    await addMembership(cohort.id, optedInUserId);

    const detail = await service.getCohortDetail(optedInUserId, cohort.id);

    expect(detail.cohort.memberCountLabel).toBe("25+ listeners");
    expect(detail.context.memberCountLabel).toBe("25+ listeners");
    expect(JSON.stringify(detail)).not.toContain("37+ listeners");
    expect(JSON.stringify(detail)).not.toContain("40+ listeners");
  });

  it("does not return cohort detail when consent or membership state is not visible", async () => {
    const cohort = await createCohort("detail_private", {
      cohortType: "taste",
      reasonCode: "taste:private",
      minimumSize: 5,
      visibleMemberCount: 6,
    });
    await addMembership(cohort.id, optedInUserId, "left");
    await addMembership(cohort.id, optedOutUserId);

    await expect(service.getCohortDetail(optedInUserId, cohort.id)).rejects.toThrow(NotFoundException);
    await expect(service.getCohortDetail(optedOutUserId, cohort.id)).rejects.toThrow(ForbiddenException);
  });

  it("requires city-scene consent separately from taste matching consent", async () => {
    const cityCohort = await createCohort("city_scene", {
      cohortType: "city_scene",
      reasonCode: "city:lyon",
      safeExplanation: "A privacy-safe local scene cohort for Lyon listeners.",
      minimumSize: 5,
      visibleMemberCount: 9,
    });
    await addMembership(cityCohort.id, optedInUserId);
    await addMembership(cityCohort.id, cityUserId);

    await expect(service.joinCohort(optedInUserId, cityCohort.id)).rejects.toThrow(ForbiddenException);
    await expect(service.listSuggestions(cityUserId)).resolves.toMatchObject({
      cohorts: [expect.objectContaining({ id: cityCohort.id, cohortType: "city_scene" })],
    });
  });

  it("supports join, leave, and hide while keeping membership off-chain and deletable", async () => {
    const cohort = await createCohort("actions", {
      cohortType: "artist_affinity",
      reasonCode: "artist:shared",
      safeExplanation: "Listeners in this group follow similar artist communities.",
      minimumSize: 5,
      visibleMemberCount: 6,
    });
    await addMembership(cohort.id, optedInUserId);

    const joined = await service.joinCohort(optedInUserId, cohort.id);
    expect(joined).toMatchObject({
      schemaVersion: "community-cohort-membership/v1",
      membership: { status: "joined" },
      privacy: { onChain: false, deletable: true, otherListenerIdentities: "redacted" },
    });
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.cohort_joined",
      membershipStatus: "joined",
    }));

    const left = await service.leaveCohort(optedInUserId, cohort.id);
    expect(left.membership.status).toBe("left");
    const hidden = await service.hideCohort(optedInUserId, cohort.id);
    expect(hidden.membership.status).toBe("hidden");
    await expect(service.joinCohort(optedInUserId, cohort.id)).rejects.toThrow(NotFoundException);
    await expect(service.getCohortDetail(optedInUserId, cohort.id)).rejects.toThrow(NotFoundException);
  });

  it("does not backfill suggestion impressions for already joined memberships", async () => {
    const cohort = await createCohort("prejoined", {
      cohortType: "taste",
      reasonCode: "taste:prejoined",
      safeExplanation: "Listeners already joined through a previous cohort flow.",
      minimumSize: 5,
      visibleMemberCount: 6,
    });
    await addMembership(cohort.id, optedInUserId, "joined");

    const suggestions = await service.listSuggestions(optedInUserId);

    expect(suggestions.cohorts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: cohort.id,
        membership: expect.objectContaining({ status: "joined" }),
      }),
    ]));
    expect(eventBus.publish).not.toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.cohort_suggested",
      cohortId: cohort.id,
    }));
  });

  it("emits suggestion impressions once across concurrent suggestion reads", async () => {
    const cohort = await createCohort("concurrent", {
      cohortType: "taste",
      reasonCode: "taste:concurrent",
      safeExplanation: "Listeners are grouped through a shared safe taste signal.",
      minimumSize: 5,
      visibleMemberCount: 6,
    });
    await addMembership(cohort.id, optedInUserId);

    await Promise.all([
      service.listSuggestions(optedInUserId),
      service.listSuggestions(optedInUserId),
    ]);

    expect(eventBus.publish.mock.calls.filter(([event]) => (
      event.eventName === "community.cohort_suggested" && event.cohortId === cohort.id
    ))).toHaveLength(1);
  });

  it("does not expose expired or archived cohorts", async () => {
    const expired = await createCohort("expired", {
      cohortType: "taste",
      reasonCode: "taste:expired",
      minimumSize: 5,
      visibleMemberCount: 7,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const archived = await createCohort("archived", {
      cohortType: "taste",
      reasonCode: "taste:archived",
      minimumSize: 5,
      visibleMemberCount: 7,
      status: "archived",
    });
    await addMembership(expired.id, optedInUserId);
    await addMembership(archived.id, optedInUserId);

    const suggestions = await service.listSuggestions(optedInUserId);

    expect(suggestions.cohorts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expired.id }),
      expect.objectContaining({ id: archived.id }),
    ]));
    await expect(service.joinCohort(optedInUserId, expired.id)).rejects.toThrow(NotFoundException);
    await expect(service.joinCohort(optedInUserId, archived.id)).rejects.toThrow(NotFoundException);
    await expect(service.getCohortDetail(optedInUserId, expired.id)).rejects.toThrow(NotFoundException);
    await expect(service.getCohortDetail(optedInUserId, archived.id)).rejects.toThrow(NotFoundException);
  });

  it("does not return details for below-threshold cohorts", async () => {
    const cohort = await createCohort("detail_small", {
      cohortType: "taste",
      reasonCode: "taste:small_detail",
      minimumSize: 5,
      visibleMemberCount: 4,
    });
    await addMembership(cohort.id, optedInUserId);

    await expect(service.getCohortDetail(optedInUserId, cohort.id)).rejects.toThrow(NotFoundException);
  });
});

async function createCohort(
  suffix: string,
  data: {
    cohortType: string;
    reasonCode: string;
    safeExplanation?: string;
    minimumSize: number;
    visibleMemberCount: number;
    status?: string;
    expiresAt?: Date;
  },
) {
  return prisma.communityCohort.create({
    data: {
      id: `${TEST_PREFIX}${suffix}`,
      title: `Cohort ${suffix}`,
      safeExplanation: data.safeExplanation ?? "A privacy-safe community cohort.",
      status: data.status ?? "suggested",
      ...data,
    },
  });
}

async function addMembership(cohortId: string, userId: string, status = "suggested") {
  return prisma.communityCohortMembership.create({
    data: {
      cohortId,
      userId,
      status,
      joinedAt: status === "joined" ? new Date() : null,
    },
  });
}
