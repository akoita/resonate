import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { CommunityCohortService } from "../modules/community/community_cohort.service";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";

const TEST_PREFIX = `community_cohort_${Date.now()}_`;
const optedInUserId = `${TEST_PREFIX}opted_in`;
const optedOutUserId = `${TEST_PREFIX}opted_out`;
const cityUserId = `${TEST_PREFIX}city_user`;
const cohortPeerUserId = `${TEST_PREFIX}cohort_peer`;
const publicMemberUserId = `${TEST_PREFIX}public_member`;
const communityMemberUserId = `${TEST_PREFIX}community_member`;
const privateMemberUserId = `${TEST_PREFIX}private_member`;
const followersMemberUserId = `${TEST_PREFIX}followers_member`;
const consentDisabledMemberUserId = `${TEST_PREFIX}consent_disabled_member`;
const leftMemberUserId = `${TEST_PREFIX}left_member`;
const hiddenMemberUserId = `${TEST_PREFIX}hidden_member`;

const eventBus = { publish: jest.fn() };
const service = new CommunityCohortService(eventBus as any);
const roomsService = new CommunityRoomsService(
  new CommunityEligibilityService(eventBus as any),
  eventBus as any,
);

describe("CommunityCohortService integration", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: optedInUserId, email: `${optedInUserId}@test.resonate` },
        { id: optedOutUserId, email: `${optedOutUserId}@test.resonate` },
        { id: cityUserId, email: `${cityUserId}@test.resonate` },
        { id: cohortPeerUserId, email: `${cohortPeerUserId}@test.resonate` },
        { id: publicMemberUserId, email: `${publicMemberUserId}@test.resonate` },
        { id: communityMemberUserId, email: `${communityMemberUserId}@test.resonate` },
        { id: privateMemberUserId, email: `${privateMemberUserId}@test.resonate` },
        { id: followersMemberUserId, email: `${followersMemberUserId}@test.resonate` },
        { id: consentDisabledMemberUserId, email: `${consentDisabledMemberUserId}@test.resonate` },
        { id: leftMemberUserId, email: `${leftMemberUserId}@test.resonate` },
        { id: hiddenMemberUserId, email: `${hiddenMemberUserId}@test.resonate` },
      ],
    });
    await prisma.communityVisibilitySettings.createMany({
      data: [
        { userId: optedInUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: optedOutUserId, allowTasteMatching: false, allowCityScenes: false },
        { userId: cityUserId, allowTasteMatching: false, allowCityScenes: true },
        { userId: cohortPeerUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: publicMemberUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: communityMemberUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: privateMemberUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: followersMemberUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: consentDisabledMemberUserId, allowTasteMatching: false, allowCityScenes: false },
        { userId: leftMemberUserId, allowTasteMatching: true, allowCityScenes: false },
        { userId: hiddenMemberUserId, allowTasteMatching: true, allowCityScenes: false },
      ],
    });
    await prisma.communityProfile.createMany({
      data: [
        {
          userId: optedInUserId,
          displayName: "Visible Viewer",
          profileVisibility: "community",
        },
        {
          userId: publicMemberUserId,
          displayName: "Public Listener",
          avatarUrl: "https://example.test/public-listener.png",
          profileVisibility: "public",
        },
        {
          userId: communityMemberUserId,
          displayName: "Community Listener",
          avatarUrl: "javascript:alert(1)",
          profileVisibility: "community",
        },
        {
          userId: privateMemberUserId,
          displayName: "Private Listener",
          profileVisibility: "private",
        },
        {
          userId: followersMemberUserId,
          displayName: "Followers Listener",
          profileVisibility: "followers",
        },
        {
          userId: consentDisabledMemberUserId,
          displayName: "Consent Disabled Listener",
          profileVisibility: "public",
        },
        {
          userId: leftMemberUserId,
          displayName: "Left Listener",
          profileVisibility: "public",
        },
        {
          userId: hiddenMemberUserId,
          displayName: "Hidden Listener",
          profileVisibility: "public",
        },
      ],
    });
  });

  afterAll(async () => {
    const cohortRooms = await prisma.communityRoom.findMany({
      where: { ownerType: "cohort", ownerId: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const cohortRoomIds = cohortRooms.map((room) => room.id);
    await prisma.communityModerationReport.deleteMany({ where: { roomId: { in: cohortRoomIds } } });
    await prisma.communityMessage.deleteMany({ where: { roomId: { in: cohortRoomIds } } });
    await prisma.communityMembership.deleteMany({ where: { roomId: { in: cohortRoomIds } } });
    await prisma.communityRoom.deleteMany({ where: { id: { in: cohortRoomIds } } });
    await prisma.communityCohortMembership.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityCohort.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityProfile.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
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
        otherListenerIdentities: "opted_in_profile_summaries_only",
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

  it("returns only joined public or community-visible cohort member summaries", async () => {
    const cohort = await createCohort("member_visibility", {
      cohortType: "taste",
      reasonCode: "taste:member_visibility",
      safeExplanation: "Listeners in this group share a safe taste signal.",
      minimumSize: 5,
      visibleMemberCount: 12,
    });
    await addMembership(cohort.id, optedInUserId, "joined");
    await addMembership(cohort.id, publicMemberUserId, "joined");
    await addMembership(cohort.id, communityMemberUserId, "joined");
    await addMembership(cohort.id, privateMemberUserId, "joined");
    await addMembership(cohort.id, followersMemberUserId, "joined");
    await addMembership(cohort.id, consentDisabledMemberUserId, "joined");
    await addMembership(cohort.id, leftMemberUserId, "left");
    await addMembership(cohort.id, hiddenMemberUserId, "hidden");

    const detail = await service.getCohortDetail(optedInUserId, cohort.id);
    await prisma.communityCohortMembership.updateMany({
      where: { cohortId: cohort.id, userId: optedInUserId },
      data: { status: "left", leftAt: new Date() },
    });

    expect(detail.memberVisibility).toMatchObject({
      visibilityScope: "joined_public_or_community_profiles",
      memberListLabel: "Opted-in cohort members",
      anonymousMemberLabel: "Private and non-joined members stay anonymous.",
      visibleMemberLimit: 6,
      currentViewer: {
        canAppear: true,
        profileVisibility: "community",
        cohortMembershipStatus: "joined",
        matchingConsentEnabled: true,
        reason: "Your profile can appear in joined cohort previews.",
      },
    });
    expect(detail.memberVisibility.visibleMembers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: optedInUserId,
        displayName: "Visible Viewer",
        profileVisibility: "community",
        cohortMembershipStatus: "joined",
        profileHref: null,
      }),
      expect.objectContaining({
        userId: publicMemberUserId,
        displayName: "Public Listener",
        avatarUrl: "https://example.test/public-listener.png",
        profileVisibility: "public",
      }),
      expect.objectContaining({
        userId: communityMemberUserId,
        displayName: "Community Listener",
        avatarUrl: null,
        profileVisibility: "community",
        profileHref: null,
      }),
    ]));
    expect(detail.memberVisibility.visibleMembers).toHaveLength(3);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(privateMemberUserId);
    expect(serialized).not.toContain(followersMemberUserId);
    expect(serialized).not.toContain(consentDisabledMemberUserId);
    expect(serialized).not.toContain(leftMemberUserId);
    expect(serialized).not.toContain(hiddenMemberUserId);
    expect(serialized).not.toContain("Private Listener");
    expect(serialized).not.toContain("Followers Listener");
    expect(serialized).not.toContain("Consent Disabled Listener");
    expect(serialized).not.toContain("Left Listener");
    expect(serialized).not.toContain("Hidden Listener");
    expect(serialized).not.toContain("@test.resonate");
    expect(serialized).not.toContain("0x");
    expect(serialized).not.toContain("12+ listeners");
  });

  it("hides the current viewer from member previews when not joined or profile-visible", async () => {
    const cohort = await createCohort("member_visibility_suggested", {
      cohortType: "taste",
      reasonCode: "taste:member_visibility_suggested",
      minimumSize: 5,
      visibleMemberCount: 8,
    });
    await addMembership(cohort.id, optedInUserId, "suggested");

    const detail = await service.getCohortDetail(optedInUserId, cohort.id);

    expect(detail.memberVisibility.visibleMembers).toEqual([]);
    expect(detail.memberVisibility.currentViewer).toMatchObject({
      canAppear: false,
      profileVisibility: "community",
      cohortMembershipStatus: "suggested",
      matchingConsentEnabled: true,
      reason: "Join this cohort before your community profile can appear here.",
    });
  });

  it("returns discovery context only for joined consented cohorts", async () => {
    const joined = await createCohort("discovery_joined", {
      cohortType: "taste",
      reasonCode: "taste:dream_pop",
      title: "Dream Pop listeners",
      safeExplanation: "Listeners sharing privacy-safe dream pop taste.",
      minimumSize: 5,
      visibleMemberCount: 9,
      metadata: { schemaVersion: "community-cohort-generation/v1", signalKey: "taste:dream_pop" },
    });
    const suggested = await createCohort("discovery_suggested", {
      cohortType: "taste",
      reasonCode: "taste:ambient",
      title: "Ambient listeners",
      minimumSize: 5,
      visibleMemberCount: 9,
    });
    const hidden = await createCohort("discovery_hidden", {
      cohortType: "taste",
      reasonCode: "taste:private",
      title: "Private listeners",
      minimumSize: 5,
      visibleMemberCount: 9,
    });
    const expired = await createCohort("discovery_expired", {
      cohortType: "taste",
      reasonCode: "taste:expired_context",
      title: "Expired listeners",
      minimumSize: 5,
      visibleMemberCount: 9,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await addMembership(joined.id, optedInUserId, "joined");
    await addMembership(suggested.id, optedInUserId, "suggested");
    await addMembership(hidden.id, optedInUserId, "hidden");
    await addMembership(expired.id, optedInUserId, "joined");
    await addMembership(joined.id, optedOutUserId, "joined");

    const optedInContext = await service.getDiscoveryContextForUser(optedInUserId);
    const optedOutContext = await service.getDiscoveryContextForUser(optedOutUserId);

    expect(optedInContext).toEqual([
      expect.objectContaining({
        cohortId: joined.id,
        cohortType: "taste",
        reasonCode: "taste:dream_pop",
        title: "Dream Pop listeners",
        explanation: "From your Dream Pop listeners cohort",
        queryHints: expect.arrayContaining(["dream pop"]),
        analytics: {
          cohortId: joined.id,
          cohortType: "taste",
          reasonCode: "taste:dream_pop",
        },
      }),
    ]);
    expect(JSON.stringify(optedInContext)).not.toContain(optedInUserId);
    expect(JSON.stringify(optedInContext)).not.toContain(cohortPeerUserId);
    expect(JSON.stringify(optedInContext)).not.toContain("@test.resonate");
    expect(JSON.stringify(optedInContext)).not.toContain("0x");
    expect(optedOutContext).toEqual([]);
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

  it("opens cohort rooms only for joined members and reuses room message moderation", async () => {
    const cohort = await createCohort("room_joined", {
      cohortType: "taste",
      reasonCode: "taste:room_joined",
      safeExplanation: "Joined listeners can coordinate around a shared safe music signal.",
      minimumSize: 5,
      visibleMemberCount: 12,
    });
    await addMembership(cohort.id, optedInUserId, "joined");
    await addMembership(cohort.id, cohortPeerUserId, "joined");

    const roomResponse = await roomsService.getCohortRoom(optedInUserId, cohort.id);
    expect(roomResponse).toMatchObject({
      schemaVersion: "community-cohort-room/v1",
      cohort: {
        id: cohort.id,
        memberCountLabel: "10+ listeners",
      },
      room: {
        roomType: "cohort",
        ownerType: "cohort",
        ownerId: cohort.id,
        access: { joinable: true, reason: "cohort_joined" },
      },
      privacy: {
        memberList: "not_exposed",
        otherListenerIdentities: "redacted",
        accessDerivedServerSide: true,
      },
    });
    expect(JSON.stringify(roomResponse)).not.toContain("@test.resonate");

    const joined = await roomsService.joinCohortRoom(optedInUserId, cohort.id);
    await roomsService.joinCohortRoom(cohortPeerUserId, cohort.id);
    expect(joined).toMatchObject({
      schemaVersion: "community-cohort-room-membership/v1",
      room: {
        membership: { status: "active", role: "cohort_member" },
        access: { joinable: true, reason: "cohort_joined" },
      },
      membership: { status: "active", role: "cohort_member" },
    });

    const ownMessage = await roomsService.createMessage(optedInUserId, joined.room.id, { body: "Try this stem later." });
    const peerMessage = await roomsService.createMessage(cohortPeerUserId, joined.room.id, { body: "This release fits the cohort." });
    const messages = await roomsService.listMessages(optedInUserId, joined.room.id);

    expect(messages.messages).toEqual([
      expect.objectContaining({
        id: ownMessage.message.id,
        authorId: optedInUserId,
        authorLabel: "You",
      }),
      expect.objectContaining({
        id: peerMessage.message.id,
        authorId: null,
        authorLabel: "Cohort member",
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain(cohortPeerUserId);
    expect(JSON.stringify(messages)).not.toContain(`${cohortPeerUserId}@test.resonate`);

    const report = await roomsService.reportMessage(optedInUserId, peerMessage.message.id, { reason: "Needs review." });
    const queue = await roomsService.getModerationQueue();
    expect(queue.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: report.report.id,
        room: expect.objectContaining({ roomType: "cohort", ownerType: "cohort", ownerId: cohort.id }),
      }),
    ]));
  });

  it("keeps suggested, expired, below-threshold, and consent-disabled cohorts out of rooms", async () => {
    const joinedCohort = await createCohort("room_direct_gate", {
      cohortType: "taste",
      reasonCode: "taste:direct_gate",
      minimumSize: 5,
      visibleMemberCount: 7,
    });
    await addMembership(joinedCohort.id, optedInUserId, "joined");
    await addMembership(joinedCohort.id, cohortPeerUserId, "suggested");
    const room = (await roomsService.getCohortRoom(optedInUserId, joinedCohort.id)).room;

    await expect(roomsService.getCohortRoom(cohortPeerUserId, joinedCohort.id)).rejects.toThrow(NotFoundException);
    await expect(roomsService.joinRoom(cohortPeerUserId, room.id)).rejects.toThrow(ForbiddenException);

    const consentDisabled = await createCohort("room_consent", {
      cohortType: "taste",
      reasonCode: "taste:consent",
      minimumSize: 5,
      visibleMemberCount: 7,
    });
    await addMembership(consentDisabled.id, optedOutUserId, "joined");
    await expect(roomsService.getCohortRoom(optedOutUserId, consentDisabled.id)).rejects.toThrow(ForbiddenException);

    const expired = await createCohort("room_expired", {
      cohortType: "taste",
      reasonCode: "taste:room_expired",
      minimumSize: 5,
      visibleMemberCount: 7,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const small = await createCohort("room_small", {
      cohortType: "taste",
      reasonCode: "taste:room_small",
      minimumSize: 5,
      visibleMemberCount: 4,
    });
    await addMembership(expired.id, optedInUserId, "joined");
    await addMembership(small.id, optedInUserId, "joined");

    await expect(roomsService.getCohortRoom(optedInUserId, expired.id)).rejects.toThrow(NotFoundException);
    await expect(roomsService.getCohortRoom(optedInUserId, small.id)).rejects.toThrow(NotFoundException);
  });
});

async function createCohort(
  suffix: string,
  data: {
    cohortType: string;
    reasonCode: string;
    safeExplanation?: string;
    title?: string;
    minimumSize: number;
    visibleMemberCount: number;
    status?: string;
    expiresAt?: Date;
    metadata?: Prisma.InputJsonValue;
  },
) {
  return prisma.communityCohort.create({
    data: {
      id: `${TEST_PREFIX}${suffix}`,
      title: data.title ?? `Cohort ${suffix}`,
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
