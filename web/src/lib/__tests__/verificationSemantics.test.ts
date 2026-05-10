import { describe, expect, it } from "vitest";
import {
  CONTENT_PROVENANCE_COPY,
  HUMAN_VERIFICATION_COPY,
  RIGHTS_VERIFICATION_COPY,
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

  it("keeps rights verification separate from platform review", () => {
    expect(normalizeRightsVerificationState("platform_reviewed")).toBe("platform_reviewed");
    expect(RIGHTS_VERIFICATION_COPY.platform_reviewed.description).toContain("not the same as verified ownership rights");
    expect(RIGHTS_VERIFICATION_COPY.rights_verified.label).toBe("Rights Verified");
  });

  it("normalizes legacy unreviewed rights labels to the neutral state", () => {
    expect(normalizeRightsVerificationState("not_independently_reviewed")).toBe("not_reviewed");
    expect(RIGHTS_VERIFICATION_COPY.not_reviewed.label).toBe("Rights Not Reviewed");
  });
});
