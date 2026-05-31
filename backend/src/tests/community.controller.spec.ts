import { CommunityController } from "../modules/community/community.controller";

const mockCommunityService = {
  getMyProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-profile/v1" }),
  updateMyProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-profile/v1" }),
  getPublicProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-public-profile/v1" }),
};

const mockCommunityEligibilityService = {
  listMyBadges: jest.fn().mockResolvedValue({ schemaVersion: "community-badges/v1" }),
  listMyBenefits: jest.fn().mockResolvedValue({ schemaVersion: "community-benefits/v1" }),
  redeemBenefit: jest.fn().mockResolvedValue({ schemaVersion: "community-benefit-redemption/v1" }),
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
};

function makeController() {
  return new CommunityController(
    mockCommunityService as any,
    mockCommunityEligibilityService as any,
    mockCommunityRoomsService as any,
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
});
