import { CommunityController } from "../modules/community/community.controller";
import { CommunityCohortService } from "../modules/community/community_cohort.service";

const mockCommunityService = {
  getMyProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-profile/v1" }),
  updateMyProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-profile/v1" }),
  getPublicProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-public-profile/v1" }),
};

const mockCommunityEligibilityService = {
  listMyBadges: jest.fn().mockResolvedValue({ schemaVersion: "community-badges/v1" }),
  listMyBenefits: jest.fn().mockResolvedValue({ schemaVersion: "community-benefits/v1" }),
  redeemBenefit: jest.fn().mockResolvedValue({ schemaVersion: "community-benefit-redemption/v1" }),
  listArtistBenefitRules: jest.fn().mockResolvedValue({ schemaVersion: "community-benefit-rules/v1" }),
  createArtistBenefitRule: jest.fn().mockResolvedValue({ schemaVersion: "community-benefit-rule/v1" }),
  pauseArtistBenefitRule: jest.fn().mockResolvedValue({ schemaVersion: "community-benefit-rule/v1" }),
  expireArtistBenefitRule: jest.fn().mockResolvedValue({ schemaVersion: "community-benefit-rule/v1" }),
};

const mockCommunityRoomsService = {
  enableArtistCommunity: jest.fn().mockResolvedValue({ schemaVersion: "community-artist-rooms/v1" }),
  listArtistRooms: jest.fn().mockResolvedValue({ schemaVersion: "community-artist-rooms/v1" }),
  joinRoom: jest.fn().mockResolvedValue({ schemaVersion: "community-membership/v1" }),
  leaveRoom: jest.fn().mockResolvedValue({ schemaVersion: "community-membership/v1" }),
  listMessages: jest.fn().mockResolvedValue({ schemaVersion: "community-messages/v1" }),
  createMessage: jest.fn().mockResolvedValue({ schemaVersion: "community-message/v1" }),
  reportMessage: jest.fn().mockResolvedValue({ schemaVersion: "community-moderation-report/v1" }),
  deleteMessage: jest.fn().mockResolvedValue({ schemaVersion: "community-message/v1" }),
  moderateMember: jest.fn().mockResolvedValue({ schemaVersion: "community-membership/v1" }),
  updateRoomStatus: jest.fn().mockResolvedValue({ schemaVersion: "community-room/v1" }),
  getCohortRoom: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-room/v1" }),
  joinCohortRoom: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-room-membership/v1" }),
};

const mockCommunityCohortService = {
  listSuggestions: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-suggestions/v1" }),
  joinCohort: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-membership/v1" }),
  leaveCohort: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-membership/v1" }),
  hideCohort: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-membership/v1" }),
};

const mockCommunityDiscordBridgeService = {
  getPublicArtistBridge: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-public/v1" }),
  getArtistBridge: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-bridge/v1" }),
  connectArtistBridge: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-bridge/v1" }),
  disconnectArtistBridge: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-bridge/v1" }),
  testArtistBridge: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-bridge-test/v1" }),
  upsertRoleMapping: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-role-mapping/v1" }),
  syncRoles: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-role-sync/v1" }),
  retryAttempt: jest.fn().mockResolvedValue({ schemaVersion: "community-discord-retry/v1" }),
};

function makeController() {
  return new CommunityController(
    mockCommunityService as any,
    mockCommunityEligibilityService as any,
    mockCommunityRoomsService as any,
    mockCommunityCohortService as unknown as CommunityCohortService,
    mockCommunityDiscordBridgeService as any,
  );
}

const req = { user: { userId: "user-42" } } as any;

beforeEach(() => jest.clearAllMocks());

describe("CommunityController", () => {
  it("loads the authenticated listener profile", () => {
    const ctrl = makeController();
    ctrl.getMyProfile(req);
    expect(mockCommunityService.getMyProfile).toHaveBeenCalledWith("user-42");
  });

  it("updates the authenticated listener profile", () => {
    const ctrl = makeController();
    const body = { displayName: "Ada", visibility: { showWalletAddress: false } };
    ctrl.updateMyProfile(req, body);
    expect(mockCommunityService.updateMyProfile).toHaveBeenCalledWith("user-42", body);
  });

  it("loads public profile reads without authenticated user context", () => {
    const ctrl = makeController();
    ctrl.getPublicProfile("user-1");
    expect(mockCommunityService.getPublicProfile).toHaveBeenCalledWith("user-1");
  });

  it("loads authenticated listener badges", () => {
    const ctrl = makeController();
    ctrl.getMyBadges(req);
    expect(mockCommunityEligibilityService.listMyBadges).toHaveBeenCalledWith("user-42");
  });

  it("loads authenticated listener benefits", () => {
    const ctrl = makeController();
    ctrl.getMyBenefits(req);
    expect(mockCommunityEligibilityService.listMyBenefits).toHaveBeenCalledWith("user-42");
  });

  it("redeems benefits for the authenticated listener", () => {
    const ctrl = makeController();
    ctrl.redeemBenefit(req, "benefit-1");
    expect(mockCommunityEligibilityService.redeemBenefit).toHaveBeenCalledWith("user-42", "benefit-1");
  });

  it("routes artist benefit rule management", () => {
    const ctrl = makeController();
    const input = {
      title: "Holder room access",
      benefitType: "room_access",
      eligibilityPolicy: { type: "ownership", artistId: "artist-1" },
    };
    ctrl.listArtistBenefitRules(req, "artist-1");
    ctrl.createArtistBenefitRule(req, "artist-1", input);
    ctrl.pauseArtistBenefitRule(req, "artist-1", "rule-1");
    ctrl.expireArtistBenefitRule(req, "artist-1", "rule-1");

    expect(mockCommunityEligibilityService.listArtistBenefitRules).toHaveBeenCalledWith("user-42", "artist-1");
    expect(mockCommunityEligibilityService.createArtistBenefitRule).toHaveBeenCalledWith("user-42", "artist-1", input);
    expect(mockCommunityEligibilityService.pauseArtistBenefitRule).toHaveBeenCalledWith("user-42", "artist-1", "rule-1");
    expect(mockCommunityEligibilityService.expireArtistBenefitRule).toHaveBeenCalledWith("user-42", "artist-1", "rule-1");
  });

  it("enables artist community rooms for the authenticated artist", () => {
    const ctrl = makeController();
    ctrl.enableArtistCommunity(req, "artist-1");
    expect(mockCommunityRoomsService.enableArtistCommunity).toHaveBeenCalledWith("user-42", "artist-1");
  });

  it("loads artist rooms with authenticated listener context", () => {
    const ctrl = makeController();
    ctrl.listMyArtistRooms(req, "artist-1");
    expect(mockCommunityRoomsService.listArtistRooms).toHaveBeenCalledWith("artist-1", "user-42");
  });

  it("routes artist room membership and message actions", () => {
    const ctrl = makeController();
    ctrl.joinRoom(req, "room-1");
    ctrl.createMessage(req, "room-1", { body: "Hello" });
    ctrl.reportMessage(req, "message-1", { reason: "spam" });
    ctrl.updateRoomStatus(req, "room-1", { status: "paused" });

    expect(mockCommunityRoomsService.joinRoom).toHaveBeenCalledWith("user-42", "room-1");
    expect(mockCommunityRoomsService.createMessage).toHaveBeenCalledWith("user-42", "room-1", { body: "Hello" });
    expect(mockCommunityRoomsService.reportMessage).toHaveBeenCalledWith("user-42", "message-1", { reason: "spam" });
    expect(mockCommunityRoomsService.updateRoomStatus).toHaveBeenCalledWith("user-42", "room-1", { status: "paused" });
  });

  it("routes authenticated cohort suggestions and membership actions", () => {
    const ctrl = makeController();
    ctrl.listCohortSuggestions(req);
    ctrl.getCohortRoom(req, "cohort-1");
    ctrl.joinCohortRoom(req, "cohort-1");
    ctrl.joinCohort(req, "cohort-1");
    ctrl.leaveCohort(req, "cohort-1");
    ctrl.hideCohort(req, "cohort-1");

    expect(mockCommunityCohortService.listSuggestions).toHaveBeenCalledWith("user-42");
    expect(mockCommunityRoomsService.getCohortRoom).toHaveBeenCalledWith("user-42", "cohort-1");
    expect(mockCommunityRoomsService.joinCohortRoom).toHaveBeenCalledWith("user-42", "cohort-1");
    expect(mockCommunityCohortService.joinCohort).toHaveBeenCalledWith("user-42", "cohort-1");
    expect(mockCommunityCohortService.leaveCohort).toHaveBeenCalledWith("user-42", "cohort-1");
    expect(mockCommunityCohortService.hideCohort).toHaveBeenCalledWith("user-42", "cohort-1");
  });
});
