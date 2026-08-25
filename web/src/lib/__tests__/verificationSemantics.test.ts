import { describe, expect, it } from "vitest";
import {
  CONTENT_PROVENANCE_COPY,
  HUMAN_VERIFICATION_COPY,
  RIGHTS_VERIFICATION_COPY,
  RIGHTS_UPLOADER_CLASSIFICATION_COPY,
  normalizeContentProvenanceState,
  normalizeHumanVerificationState,
  normalizeRightsVerificationState,
} from "../verificationSemantics";

describe("verificationSemantics", () => {
  it("labels human verification without implying ownership rights", () => {
    const state = normalizeHumanVerificationState("verified");

    expect(state).toBe("human_verified");
    expect(HUMAN_VERIFICATION_COPY[state].label).toBe("Human Verified");
    expect(HUMAN_VERIFICATION_COPY[state].description).toContain("does not verify music ownership rights");
  });

  it("labels self-attestation as provenance rather than independent rights review", () => {
    const state = normalizeContentProvenanceState(null, true);

    expect(state).toBe("self_attested");
    expect(CONTENT_PROVENANCE_COPY[state].label).toBe("Self-Attested On-Chain");
    expect(CONTENT_PROVENANCE_COPY[state].description).toContain("not independent rights verification");
  });

  it("keeps rights verification separate from limited review approval", () => {
    expect(normalizeRightsVerificationState("approved_standard_escrow")).toBe("not_reviewed");
    expect(normalizeRightsVerificationState("approved_with_limits")).toBe("approved_with_limits");
    expect(RIGHTS_VERIFICATION_COPY.approved_with_limits.description).toContain("not verified ownership rights");
    expect(RIGHTS_VERIFICATION_COPY.rights_verified.label).toBe("Rights Verified");
  });

  it("scopes independent trust to the account rather than release rights", () => {
    const copy = RIGHTS_UPLOADER_CLASSIFICATION_COPY.verified_independent;

    expect(copy.label).toBe("Independent Account Trust");
    expect(copy.description).toContain("does not independently verify ownership");
    expect(copy.description).toContain("release rights remain release-scoped");
  });

  it("keeps personhood, self-attestation, economic trust, and rights review distinct", () => {
    expect(HUMAN_VERIFICATION_COPY.human_verified.description).toContain("does not verify music ownership rights");
    expect(CONTENT_PROVENANCE_COPY.self_attested.description).toContain("not independent rights verification");
    expect(RIGHTS_VERIFICATION_COPY.approved_with_limits.description).toContain("not verified ownership rights");
    expect(RIGHTS_VERIFICATION_COPY.rights_verified.description).toContain("enough evidence");
  });

  it("normalizes legacy platform review labels to explicit rights review states", () => {
    expect(normalizeRightsVerificationState("platform_review_pending")).toBe("under_review");
    expect(normalizeRightsVerificationState("platform_reviewed")).toBe("approved_with_limits");
    expect(normalizeRightsVerificationState("rights_disputed")).toBe("disputed");
  });

  it("labels operational rights review states distinctly", () => {
    expect(normalizeRightsVerificationState("evidence_submitted")).toBe("evidence_submitted");
    expect(RIGHTS_VERIFICATION_COPY.evidence_submitted.label).toBe("Evidence Submitted");
    expect(RIGHTS_VERIFICATION_COPY.evidence_requested.label).toBe("Evidence Requested");
    expect(RIGHTS_VERIFICATION_COPY.denied.label).toBe("Denied");
  });

  it("normalizes legacy unreviewed rights labels to the neutral state", () => {
    expect(normalizeRightsVerificationState("not_independently_reviewed")).toBe("not_reviewed");
    expect(RIGHTS_VERIFICATION_COPY.not_reviewed.label).toBe("Rights Not Reviewed");
  });
});
