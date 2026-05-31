import { CommunityController } from "../modules/community/community.controller";

const mockCommunityService = {
  getMyProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-profile/v1" }),
  updateMyProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-profile/v1" }),
  getPublicProfile: jest.fn().mockResolvedValue({ schemaVersion: "community-public-profile/v1" }),
};

function makeController() {
  return new CommunityController(mockCommunityService as any);
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
});
