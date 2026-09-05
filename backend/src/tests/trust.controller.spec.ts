import { TrustController } from "../modules/trust/trust.controller";

const mockTrustService = {
  getStakeRequirement: jest.fn(),
  getCreatorVerificationRecord: jest.fn(),
  setVerified: jest.fn(),
};

const mockPayoutEligibilityService = {
  checkForUser: jest.fn(),
  checkForArtist: jest.fn(),
  assertEligible: jest.fn(),
};

function makeController() {
  return new TrustController(
    mockTrustService as any,
    mockPayoutEligibilityService as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe("TrustController", () => {
  it("returns human verification fields from the creator verification record", async () => {
    mockTrustService.getStakeRequirement.mockResolvedValue({
      artistId: "artist-1",
      tier: "new",
      stakeAmountWei: "5000000000000000",
      stakeAmountUsd: "5",
      tierStakeAmountWei: "5000000000000000",
      tierStakeAmountUsd: "5",
      protocolMinimumStakeAmountWei: "10000000000000",
      protocolMinimumStakeAmountUsd: "5",
      policySource: "contract",
      escrowDays: 30,
      maxPriceMultiplier: 10,
      maxListingPriceWei: "50000000000000000",
      maxListingPriceUsd: "50",
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
    expect(result.tierStakeAmountWei).toBe("5000000000000000");
    expect(result.tierStakeAmountUsd).toBe("5");
    expect(result.protocolMinimumStakeAmountWei).toBe("10000000000000");
    expect(result.protocolMinimumStakeAmountUsd).toBe("5");
    expect(result.stakeAmountUsd).toBe("5");
    expect(result.maxListingPriceUsd).toBe("50");
    expect(result.policySource).toBe("contract");
  });
});
