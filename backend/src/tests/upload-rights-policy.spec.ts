import {
  classifyUploader,
  evaluateUploadRightsDecision,
  getUploadRightsActions,
  parseTrustedSourceTypes,
} from "../modules/rights/upload-rights-policy";

describe("upload rights policy", () => {
  it("routes new direct uploads to limited monitoring", () => {
    const decision = evaluateUploadRightsDecision({
      sourceType: "direct_upload",
      trustedSourceTypes: ["trusted_distributor"],
      uploaderTier: "new",
      hasMetadataConflict: false,
      hasQuarantinedContent: false,
      hasDmcaContent: false,
    });

    expect(decision.route).toBe("LIMITED_MONITORING");
    expect(decision.uploaderClassification).toBe("unverified_uploader");
    expect(decision.flags).toContain("NEEDS_PROOF_OF_CONTROL");
    expect(decision.actions.marketplaceAllowed).toBe(false);
  });

  it("routes verified uploaders to standard escrow", () => {
    const decision = evaluateUploadRightsDecision({
      sourceType: "direct_upload",
      trustedSourceTypes: ["trusted_distributor"],
      uploaderTier: "verified",
      hasMetadataConflict: false,
      hasQuarantinedContent: false,
      hasDmcaContent: false,
    });

    expect(decision.route).toBe("STANDARD_ESCROW");
    expect(decision.uploaderClassification).toBe("verified_independent");
    expect(decision.actions.marketplaceAllowed).toBe(true);
  });

  it("distinguishes trusted creators from verified independent uploaders", () => {
    const decision = evaluateUploadRightsDecision({
      sourceType: "direct_upload",
      trustedSourceTypes: ["trusted_distributor"],
      uploaderTier: "trusted",
      hasMetadataConflict: false,
      hasQuarantinedContent: false,
      hasDmcaContent: false,
    });

    expect(decision.route).toBe("STANDARD_ESCROW");
    expect(decision.uploaderClassification).toBe("trusted_creator");
  });

  it("routes trusted sources to trusted fast path", () => {
    const decision = evaluateUploadRightsDecision({
      sourceType: "trusted_distributor",
      trustedSourceTypes: ["trusted_distributor"],
      uploaderTier: "new",
      hasMetadataConflict: false,
      hasQuarantinedContent: false,
      hasDmcaContent: false,
    });

    expect(decision.route).toBe("TRUSTED_FAST_PATH");
    expect(decision.uploaderClassification).toBe("trusted_source_account");
    expect(decision.actions.payoutRelease).toBe("trusted");
  });

  it("quarantines metadata conflicts for review", () => {
    const decision = evaluateUploadRightsDecision({
      sourceType: "direct_upload",
      trustedSourceTypes: [],
      uploaderTier: "verified",
      hasMetadataConflict: true,
      hasQuarantinedContent: false,
      hasDmcaContent: false,
    });

    expect(decision.route).toBe("QUARANTINED_REVIEW");
    expect(decision.flags).toEqual(
      expect.arrayContaining(["NEEDS_HUMAN_REVIEW", "MAJOR_CATALOG_RISK"]),
    );
    expect(decision.actions.publicVisible).toBe(false);
  });

  it("blocks DMCA removed content", () => {
    const decision = evaluateUploadRightsDecision({
      sourceType: "direct_upload",
      trustedSourceTypes: [],
      uploaderTier: "trusted",
      hasMetadataConflict: false,
      hasQuarantinedContent: false,
      hasDmcaContent: true,
    });

    expect(decision.route).toBe("BLOCKED");
    expect(decision.flags).toContain("RESTRICT_MARKETPLACE");
  });

  it("uses stricter marketplace controls for limited monitoring than standard escrow", () => {
    expect(getUploadRightsActions("LIMITED_MONITORING").marketplaceAllowed).toBe(false);
    expect(getUploadRightsActions("STANDARD_ESCROW").marketplaceAllowed).toBe(true);
  });

  it("does not treat an empty trusted source env as direct upload", () => {
    expect(parseTrustedSourceTypes(undefined)).toEqual([]);
    expect(parseTrustedSourceTypes("")).toEqual([]);
    expect(parseTrustedSourceTypes("   ,   ")).toEqual([]);
  });

  it("never treats direct upload as a trusted source type", () => {
    expect(parseTrustedSourceTypes("direct_upload,trusted_distributor")).toEqual([
      "trusted_distributor",
    ]);
  });

  it("classifies uploader verification states for product and ops surfaces", () => {
    expect(classifyUploader({ uploaderTier: "new" })).toBe("unverified_uploader");
    expect(classifyUploader({ uploaderTier: "verified" })).toBe("verified_independent");
    expect(classifyUploader({ uploaderTier: "trusted" })).toBe("trusted_creator");
    expect(classifyUploader({ trustedSourceType: true, uploaderTier: "new" })).toBe(
      "trusted_source_account",
    );
  });
});
