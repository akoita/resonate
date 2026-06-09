import {
  evaluateRemixEligibility,
  REMIX_POLICY_VERSION,
  type RemixEligibilityPolicyInput,
} from "../modules/remix/remix-eligibility.policy";

function input(
  overrides: Partial<RemixEligibilityPolicyInput> = {},
): RemixEligibilityPolicyInput {
  return {
    rightsRoute: "STANDARD_ESCROW",
    contentStatus: "clean",
    sourceOptedIn: true,
    stems: [{ stemId: "stem-1", mintRemixable: null, licensed: true }],
    ...overrides,
  };
}

describe("remix eligibility policy", () => {
  it("denies blocked sources", () => {
    const decision = evaluateRemixEligibility(input({ rightsRoute: "BLOCKED" }));
    expect(decision.allowed).toBe(false);
    expect(decision.requiredLicense).toBeNull();
    expect(decision.allowedActions).toEqual([]);
    expect(decision.reasons.map((r) => r.code)).toContain("source_blocked");
  });

  it("denies quarantined-review sources", () => {
    const decision = evaluateRemixEligibility(
      input({ rightsRoute: "QUARANTINED_REVIEW" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain("source_quarantined");
  });

  it("denies quarantined content status even on an eligible route", () => {
    const decision = evaluateRemixEligibility(
      input({ contentStatus: "quarantined" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain("source_quarantined");
  });

  it("denies dmca-removed content", () => {
    const decision = evaluateRemixEligibility(
      input({ contentStatus: "dmca_removed" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain("source_removed");
  });

  it("treats limited-monitoring sources conservatively", () => {
    const decision = evaluateRemixEligibility(
      input({ rightsRoute: "LIMITED_MONITORING" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain(
      "source_under_monitoring",
    );
  });

  it("denies sources with unknown rights state", () => {
    const decision = evaluateRemixEligibility(input({ rightsRoute: null }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain(
      "source_rights_unknown",
    );
  });

  it("denies sources that have not opted in", () => {
    const decision = evaluateRemixEligibility(input({ sourceOptedIn: false }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain("source_not_opted_in");
  });

  it("denies stems minted as non-remixable", () => {
    const decision = evaluateRemixEligibility(
      input({
        stems: [
          { stemId: "stem-1", mintRemixable: false, licensed: true },
          { stemId: "stem-2", mintRemixable: true, licensed: true },
        ],
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.requiredLicense).toBeNull();
    expect(decision.reasons.map((r) => r.code)).toContain("stem_not_remixable");
    expect(
      decision.reasons.find((r) => r.code === "stem_not_remixable")?.message,
    ).toContain("stem-1");
  });

  it("requires a remix license for eligible standard sources", () => {
    const decision = evaluateRemixEligibility(
      input({
        stems: [{ stemId: "stem-1", mintRemixable: true, licensed: false }],
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.requiredLicense).toBe("remix");
    expect(decision.reasons.map((r) => r.code)).toEqual(["license_required"]);
  });

  it("requires a license when any selected stem is unlicensed", () => {
    const decision = evaluateRemixEligibility(
      input({
        stems: [
          { stemId: "stem-1", mintRemixable: null, licensed: true },
          { stemId: "stem-2", mintRemixable: null, licensed: false },
        ],
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.requiredLicense).toBe("remix");
  });

  it("requires a license when no stems are selected", () => {
    const decision = evaluateRemixEligibility(input({ stems: [] }));
    expect(decision.allowed).toBe(false);
    expect(decision.requiredLicense).toBe("remix");
  });

  it("allows private drafts for licensed standard-escrow sources", () => {
    const decision = evaluateRemixEligibility(input());
    expect(decision.allowed).toBe(true);
    expect(decision.requiredLicense).toBeNull();
    expect(decision.allowedActions).toEqual(["private_draft"]);
    expect(decision.reasons).toEqual([]);
    expect(decision.policyVersion).toBe(REMIX_POLICY_VERSION);
  });

  it("allows private drafts for licensed trusted-fast-path sources", () => {
    const decision = evaluateRemixEligibility(
      input({ rightsRoute: "TRUSTED_FAST_PATH" }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.allowedActions).toEqual(["private_draft"]);
  });

  it("does not grant publish or export actions in v1", () => {
    const decision = evaluateRemixEligibility(input());
    expect(decision.allowedActions).not.toContain("publish_resonate");
    expect(decision.allowedActions).not.toContain("export");
  });

  it("collects multiple denial reasons for compound failures", () => {
    const decision = evaluateRemixEligibility(
      input({
        rightsRoute: "BLOCKED",
        contentStatus: "dmca_removed",
        stems: [{ stemId: "stem-1", mintRemixable: false, licensed: false }],
      }),
    );
    const codes = decision.reasons.map((r) => r.code);
    expect(codes).toContain("source_blocked");
    expect(codes).toContain("source_removed");
    expect(codes).toContain("stem_not_remixable");
    expect(decision.requiredLicense).toBeNull();
  });
});
