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

function makeController() {
  return new CommunityController(mockCommunityService as any, mockCommunityEligibilityService as any);
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
});
