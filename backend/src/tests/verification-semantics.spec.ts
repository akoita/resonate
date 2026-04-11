import {
  deriveCreatorVerificationStates,
  deriveReleaseVerificationStates,
} from "../modules/trust/verification-semantics";

describe("verification semantics", () => {
  it("keeps economic trust tier separate from human verification", () => {
    const states = deriveCreatorVerificationStates({
      economicTier: "verified",
    });

    expect(states.economicTier).toBe("verified");
    expect(states.platformReviewStatus).toBe("platform_reviewed");
    expect(states.humanVerificationStatus).toBe("unverified");
    expect(states.humanVerifiedAt).toBeNull();
  });

  it("maps self-attested releases without implying rights verification", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "STANDARD_ESCROW",
      rightsUpgradeRequestStatus: null,
    });

    expect(states.provenanceStatus).toBe("self_attested");
    expect(states.rightsVerificationStatus).toBe("not_reviewed");
  });

  it("marks quarantined releases as pending review", () => {
    const states = deriveReleaseVerificationStates({
      attested: false,
      rightsRoute: "QUARANTINED_REVIEW",
      rightsUpgradeRequestStatus: null,
    });

    expect(states.provenanceStatus).toBe("unverified");
    expect(states.rightsVerificationStatus).toBe("platform_review_pending");
  });

  it("marks blocked releases as rights disputed", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "BLOCKED",
      rightsUpgradeRequestStatus: null,
    });

    expect(states.provenanceStatus).toBe("self_attested");
    expect(states.rightsVerificationStatus).toBe("rights_disputed");
  });

  it("maps active rights-upgrade requests to pending review semantics", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "LIMITED_MONITORING",
      rightsUpgradeRequestStatus: "submitted",
    });

    expect(states.provenanceStatus).toBe("self_attested");
    expect(states.rightsVerificationStatus).toBe("platform_review_pending");
  });

  it("maps approved standard escrow requests to platform reviewed", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "STANDARD_ESCROW",
      rightsUpgradeRequestStatus: "approved_standard_escrow",
    });

    expect(states.rightsVerificationStatus).toBe("platform_reviewed");
  });

  it("maps approved trusted fast path requests to rights verified", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "TRUSTED_FAST_PATH",
      rightsUpgradeRequestStatus: "approved_trusted_fast_path",
    });

    expect(states.rightsVerificationStatus).toBe("rights_verified");
  });

  it("maps denied requests to disputed rights semantics", () => {
    const states = deriveReleaseVerificationStates({
      attested: false,
      rightsRoute: "LIMITED_MONITORING",
      rightsUpgradeRequestStatus: "denied",
    });

    expect(states.rightsVerificationStatus).toBe("rights_disputed");
  });
});
