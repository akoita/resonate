import { TrustController } from "../modules/trust/trust.controller";

const mockTrustService = {
  getStakeRequirement: jest.fn(),
  getCreatorVerificationRecord: jest.fn(),
  setVerified: jest.fn(),
};

function makeController() {
  return new TrustController(mockTrustService as any);
}

beforeEach(() => jest.clearAllMocks());

describe("TrustController", () => {
  it("returns human verification fields from the creator verification record", async () => {
    mockTrustService.getStakeRequirement.mockResolvedValue({
      artistId: "artist-1",
      tier: "new",
      stakeAmountWei: "10000000000000000",
      escrowDays: 30,
      maxPriceMultiplier: 10,
      maxListingPriceWei: "100000000000000000",
      maxListingPriceUncapped: false,
      totalUploads: 0,
      cleanHistory: 0,
      disputesLost: 0,
    });
    mockTrustService.getCreatorVerificationRecord.mockResolvedValue({
      humanVerificationStatus: "verified",
      humanVerifiedAt: new Date("2026-04-09T19:51:38.721Z"),
    });

    const controller = makeController();
    const result = await controller.getTrustTier("artist-1");

    expect(result.humanVerificationStatus).toBe("human_verified");
    expect(result.humanVerifiedAt).toBe("2026-04-09T19:51:38.721Z");
  });
});
