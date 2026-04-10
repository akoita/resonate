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
    });

    expect(states.provenanceStatus).toBe("self_attested");
    expect(states.rightsVerificationStatus).toBe("not_reviewed");
  });

  it("marks quarantined releases as pending review", () => {
    const states = deriveReleaseVerificationStates({
      attested: false,
      rightsRoute: "QUARANTINED_REVIEW",
    });

    expect(states.provenanceStatus).toBe("unverified");
    expect(states.rightsVerificationStatus).toBe("platform_review_pending");
  });

  it("marks blocked releases as rights disputed", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "BLOCKED",
    });

    expect(states.provenanceStatus).toBe("self_attested");
    expect(states.rightsVerificationStatus).toBe("rights_disputed");
  });
});
