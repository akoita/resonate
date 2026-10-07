import { prisma } from "../db/prisma";
import { CommunityCohortGenerationService } from "../modules/community/community_cohort_generation.service";
import { CommunityCohortService } from "../modules/community/community_cohort.service";

const TEST_PREFIX = `community_cohort_generation_${Date.now()}_`;
const tasteUsers = Array.from({ length: 5 }, (_, index) => `${TEST_PREFIX}taste_${index}`);
const smallTasteUsers = Array.from({ length: 3 }, (_, index) => `${TEST_PREFIX}small_${index}`);
const reconcileUsers = Array.from({ length: 5 }, (_, index) => `${TEST_PREFIX}reconcile_${index}`);
const zeroRefreshUsers = Array.from({ length: 5 }, (_, index) => `${TEST_PREFIX}zero_${index}`);
const unsafeSignalUsers = Array.from({ length: 5 }, (_, index) => `${TEST_PREFIX}unsafe_${index}`);
const cityUsers = Array.from({ length: 5 }, (_, index) => `${TEST_PREFIX}city_${index}`);
const creditedUsers = Array.from({ length: 5 }, (_, index) => `${TEST_PREFIX}credited_${index}`);
const uncreditedUsers = Array.from({ length: 5 }, (_, index) => `${TEST_PREFIX}uncredited_${index}`);
const managerAccountId = `${TEST_PREFIX}manager_account`;
const managerAccountName = "Manager Handle";
const creditedArtistName = "Credited Star";
const creditedReleaseId = `${TEST_PREFIX}credited_release`;
const creditedTrackId = `${TEST_PREFIX}credited_track`;
const uncreditedReleaseId = `${TEST_PREFIX}uncredited_release`;
const uncreditedTrackId = `${TEST_PREFIX}uncredited_track`;
const optedOutUserId = `${TEST_PREFIX}opted_out`;
const campaignId = `${TEST_PREFIX}campaign`;
const tasteGenre = `Dream Pop ${TEST_PREFIX}`;
const smallTasteGenre = `Tiny Signal ${TEST_PREFIX}`;
const reconcileGenre = `Reconcile Signal ${TEST_PREFIX}`;
const zeroRefreshGenre = `Zero Signal ${TEST_PREFIX}`;
const unsafeGenre = "Wallet 0x1111111111111111111111111111111111111111";
const cityName = `Paris ${TEST_PREFIX}`;
const now = new Date("2026-06-02T10:00:00.000Z");

const generationService = new CommunityCohortGenerationService();
const cohortService = new CommunityCohortService({ publish: jest.fn() } as any);

describe("CommunityCohortGenerationService integration", () => {
  beforeAll(async () => {
    const userIds = [
      ...tasteUsers,
      ...smallTasteUsers,
      ...reconcileUsers,
      ...zeroRefreshUsers,
      ...unsafeSignalUsers,
      ...cityUsers,
      ...creditedUsers,
      ...uncreditedUsers,
      optedOutUserId,
    ];
    await prisma.user.createMany({
      data: userIds.map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.communityVisibilitySettings.createMany({
      data: [
        ...tasteUsers.map((userId) => ({ userId, allowTasteMatching: true, allowCityScenes: false })),
        ...smallTasteUsers.map((userId) => ({ userId, allowTasteMatching: true, allowCityScenes: false })),
        ...reconcileUsers.map((userId) => ({ userId, allowTasteMatching: true, allowCityScenes: false })),
        ...zeroRefreshUsers.map((userId) => ({ userId, allowTasteMatching: true, allowCityScenes: false })),
        ...unsafeSignalUsers.map((userId) => ({ userId, allowTasteMatching: true, allowCityScenes: false })),
        ...cityUsers.map((userId) => ({ userId, allowTasteMatching: false, allowCityScenes: true })),
        ...creditedUsers.map((userId) => ({ userId, allowTasteMatching: true, allowCityScenes: false })),
        ...uncreditedUsers.map((userId) => ({ userId, allowTasteMatching: true, allowCityScenes: false })),
        { userId: optedOutUserId, allowTasteMatching: false, allowCityScenes: false },
      ],
    });
    // An uploader/manager ACCOUNT whose label must never name an artist cohort.
    await prisma.artist.create({
      data: { id: managerAccountId, displayName: managerAccountName },
    });
    await prisma.release.createMany({
      data: [
        {
          id: creditedReleaseId,
          artistId: managerAccountId,
          title: "Credited Release",
          primaryArtist: creditedArtistName,
        },
        {
          id: uncreditedReleaseId,
          artistId: managerAccountId,
          title: "Uncredited Release",
        },
      ],
    });
    await prisma.track.createMany({
      data: [
        { id: creditedTrackId, releaseId: creditedReleaseId, title: "Credited Track" },
        { id: uncreditedTrackId, releaseId: uncreditedReleaseId, title: "Uncredited Track" },
      ],
    });
    await prisma.libraryTrack.createMany({
      data: [
        ...creditedUsers.map((userId) => ({
          userId,
          title: "Credited Track",
          source: "remote",
          catalogTrackId: creditedTrackId,
        })),
        ...uncreditedUsers.map((userId) => ({
          userId,
          title: "Uncredited Track",
          source: "remote",
          catalogTrackId: uncreditedTrackId,
        })),
        ...tasteUsers.map((userId, index) => ({
          userId,
          title: `Dream Pop Track ${index}`,
          source: "remote",
          genre: tasteGenre,
        })),
        {
          userId: optedOutUserId,
          title: "Opted Out Dream Pop Track",
          source: "remote",
          genre: tasteGenre,
        },
        ...smallTasteUsers.map((userId, index) => ({
          userId,
          title: `Tiny Signal Track ${index}`,
          source: "remote",
          genre: smallTasteGenre,
        })),
        ...reconcileUsers.map((userId, index) => ({
          userId,
          title: `Reconcile Signal Track ${index}`,
          source: "remote",
          genre: reconcileGenre,
        })),
        ...zeroRefreshUsers.map((userId, index) => ({
          userId,
          title: `Zero Signal Track ${index}`,
          source: "remote",
          genre: zeroRefreshGenre,
        })),
        ...unsafeSignalUsers.map((userId, index) => ({
          userId,
          title: `Unsafe Signal Track ${index}`,
          source: "remote",
          genre: unsafeGenre,
        })),
      ],
    });
    await prisma.showCampaign.create({
      data: {
        id: campaignId,
        slug: `${TEST_PREFIX}campaign`,
        artistDisplayName: "City Cohort Artist",
        title: "City Cohort Artist in Paris",
        city: cityName,
        country: "FR",
        deadline: new Date("2026-07-01T10:00:00.000Z"),
        goalAmountUnits: "1000000",
        chainId: 84532,
        status: "active",
      },
    });
    await prisma.showPledge.createMany({
      data: cityUsers.map((userId, index) => ({
        campaignId,
        userId,
        walletAddress: `0x${String(index + 1).padStart(40, "0")}`,
        amountUnits: "250000",
        chainId: 84532,
        status: "confirmed",
        confirmationStatus: "confirmed",
        confirmedAt: now,
      })),
    });
  });

  afterAll(async () => {
    await prisma.communityCohortMembership.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityCohort.deleteMany({
      where: {
        OR: [
          { reasonCode: { contains: "community_cohort_generation" } },
          { reasonCode: "taste:shared_taste" },
          { reasonCode: "artist_affinity:credited_star" },
          { reasonCode: { contains: "manager_handle" } },
        ],
      },
    });
    await prisma.showPledge.deleteMany({ where: { campaignId } });
    await prisma.showCampaign.deleteMany({ where: { id: campaignId } });
    await prisma.libraryTrack.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { in: [creditedTrackId, uncreditedTrackId] } } });
    await prisma.release.deleteMany({ where: { id: { in: [creditedReleaseId, uncreditedReleaseId] } } });
    await prisma.artist.deleteMany({ where: { id: managerAccountId } });
    await prisma.communityVisibilitySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it("materializes opted-in taste cohorts idempotently without opt-out memberships", async () => {
    const first = await generationService.generateCohorts({ minimumSize: 5, now });
    const tasteCohort = first.cohorts.find((cohort) => cohort.reasonCode.includes("dream_pop"));

    expect(tasteCohort).toEqual(expect.objectContaining({
      cohortType: "taste",
      status: "active",
      visibleMemberCount: 5,
      membershipsCreated: 5,
    }));
    expect(await prisma.communityCohortMembership.count({ where: { cohortId: tasteCohort!.cohortId } })).toBe(5);
    expect(await prisma.communityCohortMembership.findFirst({
      where: { cohortId: tasteCohort!.cohortId, userId: optedOutUserId },
    })).toBeNull();

    const second = await generationService.generateCohorts({ minimumSize: 5, now });
    const rerunTasteCohort = second.cohorts.find((cohort) => cohort.cohortId === tasteCohort!.cohortId);
    expect(rerunTasteCohort).toEqual(expect.objectContaining({
      visibleMemberCount: 5,
      membershipsCreated: 0,
      membershipsPreserved: 5,
    }));
    expect(await prisma.communityCohortMembership.count({ where: { cohortId: tasteCohort!.cohortId } })).toBe(5);

    const suggestions = await cohortService.listSuggestions(tasteUsers[0]);
    expect(suggestions.cohorts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tasteCohort!.cohortId }),
    ]));
  });

  it("keeps below-threshold cohorts from becoming visible or actionable", async () => {
    const result = await generationService.generateCohorts({ minimumSize: 5, now });
    const smallCohort = result.cohorts.find((cohort) => cohort.reasonCode.includes("tiny_signal"));

    expect(smallCohort).toEqual(expect.objectContaining({
      cohortType: "taste",
      status: "archived",
      lifecycleAction: expect.stringMatching(/archived|unchanged/),
      visibleMemberCount: 3,
      minimumSize: 5,
    }));
    await expect(prisma.communityCohort.findUniqueOrThrow({
      where: { id: smallCohort!.cohortId },
    })).resolves.toMatchObject({ status: "archived", visibleMemberCount: 3 });
    await expect(cohortService.listSuggestions(smallTasteUsers[0])).resolves.toMatchObject({ cohorts: [] });
    await expect(cohortService.joinCohort(smallTasteUsers[0], smallCohort!.cohortId)).rejects.toThrow("Community cohort not found");
  });

  it("marks no-longer-eligible visible memberships stale before recomputing privacy thresholds", async () => {
    const initial = await generationService.generateCohorts({ minimumSize: 5, now });
    const reconcileCohort = initial.cohorts.find((cohort) => cohort.reasonCode.includes("reconcile_signal"));

    expect(reconcileCohort).toEqual(expect.objectContaining({
      visibleMemberCount: 5,
    }));
    await prisma.communityCohortMembership.update({
      where: { CommunityCohortMembership_identity: { cohortId: reconcileCohort!.cohortId, userId: reconcileUsers[0] } },
      data: { status: "joined", joinedAt: now },
    });

    await prisma.communityVisibilitySettings.updateMany({
      where: { userId: { in: reconcileUsers.slice(0, 4) } },
      data: { allowTasteMatching: false },
    });

    const regenerated = await generationService.generateCohorts({ minimumSize: 5, now });
    const regeneratedCohort = regenerated.cohorts.find((cohort) => cohort.cohortId === reconcileCohort!.cohortId);

    expect(regeneratedCohort).toEqual(expect.objectContaining({
      status: "archived",
      lifecycleAction: "archived",
      visibleMemberCount: 1,
      staleMembershipsMarked: 4,
    }));
    expect(await prisma.communityCohortMembership.count({
      where: { cohortId: reconcileCohort!.cohortId, status: "stale" },
    })).toBe(3);
    expect(await prisma.communityCohortMembership.count({
      where: { cohortId: reconcileCohort!.cohortId, status: "stale_joined" },
    })).toBe(1);
    await expect(cohortService.listSuggestions(reconcileUsers[4])).resolves.toMatchObject({ cohorts: [] });

    await prisma.communityVisibilitySettings.updateMany({
      where: { userId: { in: reconcileUsers.slice(0, 4) } },
      data: { allowTasteMatching: true },
    });

    const restored = await generationService.generateCohorts({ minimumSize: 5, now });
    const restoredCohort = restored.cohorts.find((cohort) => cohort.cohortId === reconcileCohort!.cohortId);

    expect(restoredCohort).toEqual(expect.objectContaining({
      status: "active",
      lifecycleAction: "activated",
      visibleMemberCount: 5,
      staleMembershipsRestored: 4,
    }));
    expect(await prisma.communityCohortMembership.count({
      where: { cohortId: reconcileCohort!.cohortId, status: "stale" },
    })).toBe(0);
    expect(await prisma.communityCohortMembership.count({
      where: { cohortId: reconcileCohort!.cohortId, status: "stale_joined" },
    })).toBe(0);
    await expect(prisma.communityCohortMembership.findUniqueOrThrow({
      where: { CommunityCohortMembership_identity: { cohortId: reconcileCohort!.cohortId, userId: reconcileUsers[0] } },
    })).resolves.toMatchObject({ status: "joined" });
    await expect(cohortService.listSuggestions(reconcileUsers[0])).resolves.toMatchObject({
      cohorts: [expect.objectContaining({ id: reconcileCohort!.cohortId })],
    });
  });

  it("expires generated cohorts when refresh finds no current eligible members", async () => {
    const initial = await generationService.generateCohorts({ minimumSize: 5, now });
    const zeroCohort = initial.cohorts.find((cohort) => cohort.reasonCode.includes("zero_signal"));

    expect(zeroCohort).toEqual(expect.objectContaining({
      status: "active",
      visibleMemberCount: 5,
    }));

    await prisma.libraryTrack.deleteMany({ where: { userId: { in: zeroRefreshUsers } } });

    const refreshed = await generationService.generateCohorts({ minimumSize: 5, now });
    const expiredCohort = refreshed.cohorts.find((cohort) => cohort.cohortId === zeroCohort!.cohortId);
    const storedCohort = await prisma.communityCohort.findUniqueOrThrow({
      where: { id: zeroCohort!.cohortId },
      select: { status: true, visibleMemberCount: true, expiresAt: true },
    });

    expect(expiredCohort).toEqual(expect.objectContaining({
      status: "expired",
      lifecycleAction: "expired",
      visibleMemberCount: 0,
      staleMembershipsMarked: 5,
    }));
    expect(storedCohort).toEqual({
      status: "expired",
      visibleMemberCount: 0,
      expiresAt: now,
    });
    expect(await prisma.communityCohortMembership.count({
      where: { cohortId: zeroCohort!.cohortId, status: "stale" },
    })).toBe(5);
    await expect(cohortService.listSuggestions(zeroRefreshUsers[0])).resolves.toMatchObject({ cohorts: [] });
  });

  it("sanitizes unsafe source labels before writing cohort titles and reason codes", async () => {
    const result = await generationService.generateCohorts({ minimumSize: 5, now });
    const unsafeCohort = result.cohorts.find((cohort) => cohort.reasonCode === "taste:shared_taste");
    const storedCohort = await prisma.communityCohort.findUniqueOrThrow({
      where: { id: unsafeCohort!.cohortId },
      select: { title: true, reasonCode: true, safeExplanation: true },
    });

    expect(storedCohort).toEqual({
      title: "Shared Taste listeners",
      reasonCode: "taste:shared_taste",
      safeExplanation: "A privacy-safe group for listeners with a shared taste listening signal.",
    });
    expect(JSON.stringify(storedCohort)).not.toContain("0x1111111111111111111111111111111111111111");
  });

  it("preserves hidden and left memberships while recomputing visible member count", async () => {
    const initial = await generationService.generateCohorts({ minimumSize: 5, now });
    const tasteCohort = initial.cohorts.find((cohort) => cohort.reasonCode.includes("dream_pop"));
    await prisma.communityCohortMembership.update({
      where: { CommunityCohortMembership_identity: { cohortId: tasteCohort!.cohortId, userId: tasteUsers[0] } },
      data: { status: "hidden", hiddenAt: now },
    });
    await prisma.communityCohortMembership.update({
      where: { CommunityCohortMembership_identity: { cohortId: tasteCohort!.cohortId, userId: tasteUsers[1] } },
      data: { status: "left", leftAt: now },
    });

    const regenerated = await generationService.generateCohorts({ minimumSize: 5, now });
    const regeneratedTasteCohort = regenerated.cohorts.find((cohort) => cohort.cohortId === tasteCohort!.cohortId);

    expect(regeneratedTasteCohort).toEqual(expect.objectContaining({
      status: "archived",
      visibleMemberCount: 3,
      hiddenMembershipsPreserved: 1,
    }));
    await expect(prisma.communityCohortMembership.findUniqueOrThrow({
      where: { CommunityCohortMembership_identity: { cohortId: tasteCohort!.cohortId, userId: tasteUsers[0] } },
    })).resolves.toMatchObject({ status: "hidden" });
    await expect(prisma.communityCohortMembership.findUniqueOrThrow({
      where: { CommunityCohortMembership_identity: { cohortId: tasteCohort!.cohortId, userId: tasteUsers[1] } },
    })).resolves.toMatchObject({ status: "left" });
    await expect(cohortService.listSuggestions(tasteUsers[2])).resolves.toMatchObject({ cohorts: [] });
  });

  it("materializes city-scene cohorts from coarse campaign city signals only for city opt-in listeners", async () => {
    const result = await generationService.generateCohorts({ minimumSize: 5, now });
    const cityCohort = result.cohorts.find((cohort) => cohort.reasonCode.startsWith("city_scene:paris_"));

    expect(cityCohort).toEqual(expect.objectContaining({
      cohortType: "city_scene",
      status: "active",
      visibleMemberCount: 5,
      membershipsCreated: expect.any(Number),
    }));
    await expect(cohortService.listSuggestions(cityUsers[0])).resolves.toMatchObject({
      cohorts: [expect.objectContaining({ id: cityCohort!.cohortId, cohortType: "city_scene" })],
    });
    expect(await prisma.communityCohortMembership.findFirst({
      where: { cohortId: cityCohort!.cohortId, userId: tasteUsers[0] },
    })).toBeNull();
  });

  it("names and keys artist cohorts by the credited artist, never the uploader account", async () => {
    const result = await generationService.generateCohorts({ minimumSize: 5, now });
    const artistCohort = result.cohorts.find((cohort) => cohort.reasonCode === "artist_affinity:credited_star");

    expect(artistCohort).toEqual(expect.objectContaining({
      cohortType: "artist_affinity",
      status: "active",
      visibleMemberCount: 5,
    }));
    await expect(prisma.communityCohort.findUniqueOrThrow({
      where: { id: artistCohort!.cohortId },
      select: { title: true },
    })).resolves.toEqual({ title: "Credited Star listeners" });
    expect(await prisma.communityCohort.count({
      where: {
        OR: [
          { title: { contains: managerAccountName, mode: "insensitive" } },
          { reasonCode: { contains: "manager_handle" } },
          { reasonCode: { contains: managerAccountId } },
        ],
      },
    })).toBe(0);
  });

  it("creates no artist_affinity cohort for a release with no artist credit", async () => {
    await generationService.generateCohorts({ minimumSize: 5, now });

    expect(await prisma.communityCohortMembership.count({
      where: {
        userId: { in: uncreditedUsers },
        cohort: { cohortType: { in: ["artist_affinity", "collector"] } },
      },
    })).toBe(0);
  });
});
