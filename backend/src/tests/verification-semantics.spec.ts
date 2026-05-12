import {
  deriveCreatorVerificationStates,
  deriveReleaseVerificationStates,
  isReleaseRightsUpgradeTransitionAllowed,
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

  it("marks quarantined releases as under review", () => {
    const states = deriveReleaseVerificationStates({
      attested: false,
      rightsRoute: "QUARANTINED_REVIEW",
      rightsUpgradeRequestStatus: null,
    });

    expect(states.provenanceStatus).toBe("unverified");
    expect(states.rightsReviewState).toBe("under_review");
    expect(states.rightsVerificationStatus).toBe("under_review");
  });

  it("marks blocked releases as disputed", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "BLOCKED",
      rightsUpgradeRequestStatus: null,
    });

    expect(states.provenanceStatus).toBe("self_attested");
    expect(states.rightsVerificationStatus).toBe("disputed");
  });

  it("maps submitted rights-upgrade requests to evidence-submitted semantics", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "LIMITED_MONITORING",
      rightsUpgradeRequestStatus: "submitted",
    });

    expect(states.provenanceStatus).toBe("self_attested");
    expect(states.rightsReviewState).toBe("evidence_submitted");
    expect(states.rightsVerificationStatus).toBe("evidence_submitted");
  });

  it("maps evidence requests to evidence-requested semantics", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "LIMITED_MONITORING",
      rightsUpgradeRequestStatus: "more_evidence_requested",
    });

    expect(states.rightsVerificationStatus).toBe("evidence_requested");
  });

  it("maps approved standard escrow requests to approved with limits", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "STANDARD_ESCROW",
      rightsUpgradeRequestStatus: "approved_standard_escrow",
    });

    expect(states.rightsVerificationStatus).toBe("approved_with_limits");
  });

  it("maps approved trusted fast path requests to rights verified", () => {
    const states = deriveReleaseVerificationStates({
      attested: true,
      rightsRoute: "TRUSTED_FAST_PATH",
      rightsUpgradeRequestStatus: "approved_trusted_fast_path",
    });

    expect(states.rightsVerificationStatus).toBe("rights_verified");
  });

  it("maps denied requests to denied rights semantics", () => {
    const states = deriveReleaseVerificationStates({
      attested: false,
      rightsRoute: "LIMITED_MONITORING",
      rightsUpgradeRequestStatus: "denied",
    });

    expect(states.rightsVerificationStatus).toBe("denied");
  });

  it("allows only expected rights-upgrade workflow transitions", () => {
    expect(isReleaseRightsUpgradeTransitionAllowed("submitted", "under_review")).toBe(true);
    expect(isReleaseRightsUpgradeTransitionAllowed("submitted", "approved_standard_escrow")).toBe(true);
    expect(isReleaseRightsUpgradeTransitionAllowed("under_review", "under_review")).toBe(true);
    expect(isReleaseRightsUpgradeTransitionAllowed("under_review", "more_evidence_requested")).toBe(true);
    expect(isReleaseRightsUpgradeTransitionAllowed("more_evidence_requested", "submitted")).toBe(true);
    expect(isReleaseRightsUpgradeTransitionAllowed("more_evidence_requested", "approved_standard_escrow")).toBe(false);
    expect(isReleaseRightsUpgradeTransitionAllowed("approved_standard_escrow", "under_review")).toBe(false);
    expect(isReleaseRightsUpgradeTransitionAllowed("denied", "submitted")).toBe(false);
  });
});
