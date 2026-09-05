import {
  evaluatePayoutEligibility,
  PAYOUT_ELIGIBILITY_REASON_CODES,
  type PayoutEligibilityInput,
} from "../modules/rights/payout-eligibility.policy";

/**
 * Pure truth-table for the fail-closed payout-eligibility policy (#1498).
 * No DB, no containers — the policy is a deterministic function of four inputs.
 */

const ELIGIBLE_BASE: PayoutEligibilityInput = {
  humanVerificationState: "human_verified",
  rightsReviewState: "rights_verified",
  payoutRelease: "trusted",
  rightsFlags: [],
};

function codes(input: PayoutEligibilityInput): string[] {
  return evaluatePayoutEligibility(input).reasons.map((reason) => reason.code);
}

describe("evaluatePayoutEligibility (pure policy)", () => {
  it("exports the four stable reason codes", () => {
    expect([...PAYOUT_ELIGIBILITY_REASON_CODES]).toEqual([
      "human_verification_required",
      "rights_review_required",
      "payout_release_blocked",
      "payouts_restricted",
    ]);
  });

  describe("eligible happy paths", () => {
    it("is eligible when all four rules hold (rights_verified + trusted)", () => {
      const result = evaluatePayoutEligibility(ELIGIBLE_BASE);
      expect(result.eligible).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it("is eligible for approved_with_limits + held (held is not 'none')", () => {
      const result = evaluatePayoutEligibility({
        humanVerificationState: "human_verified",
        rightsReviewState: "approved_with_limits",
        payoutRelease: "held",
        rightsFlags: [],
      });
      expect(result.eligible).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it("is eligible for approved_with_limits + standard", () => {
      const result = evaluatePayoutEligibility({
        ...ELIGIBLE_BASE,
        rightsReviewState: "approved_with_limits",
        payoutRelease: "standard",
      });
      expect(result.eligible).toBe(true);
    });
  });

  describe("each rule fails closed with its own reason code", () => {
    it("human_verification_required when not human-verified", () => {
      const result = evaluatePayoutEligibility({
        ...ELIGIBLE_BASE,
        humanVerificationState: "unverified",
      });
      expect(result.eligible).toBe(false);
      expect(codes({ ...ELIGIBLE_BASE, humanVerificationState: "unverified" })).toContain(
        "human_verification_required",
      );
      const reason = result.reasons.find(
        (r) => r.code === "human_verification_required",
      );
      expect(reason?.message.length).toBeGreaterThan(0);
      expect(reason?.resolution.length).toBeGreaterThan(0);
    });

    it("rights_review_required when rights are not approved", () => {
      for (const state of [
        "not_reviewed",
        "under_review",
        "evidence_submitted",
        "denied",
        "disputed",
      ] as const) {
        const result = evaluatePayoutEligibility({
          ...ELIGIBLE_BASE,
          rightsReviewState: state,
        });
        expect(result.eligible).toBe(false);
        expect(result.reasons.map((r) => r.code)).toContain(
          "rights_review_required",
        );
      }
    });

    it("payout_release_blocked when payoutRelease is 'none'", () => {
      const result = evaluatePayoutEligibility({
        ...ELIGIBLE_BASE,
        payoutRelease: "none",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons.map((r) => r.code)).toContain(
        "payout_release_blocked",
      );
    });

    it("payouts_restricted when RESTRICT_PAYOUTS flag is present", () => {
      const result = evaluatePayoutEligibility({
        ...ELIGIBLE_BASE,
        rightsFlags: ["RESTRICT_PAYOUTS"],
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons.map((r) => r.code)).toContain("payouts_restricted");
    });

    it("ignores unrelated rights flags", () => {
      const result = evaluatePayoutEligibility({
        ...ELIGIBLE_BASE,
        rightsFlags: ["NEEDS_HUMAN_REVIEW", "DISPUTE_ELIGIBLE"],
      });
      expect(result.eligible).toBe(true);
    });
  });

  it("accumulates every failing reason when all rules fail", () => {
    const result = evaluatePayoutEligibility({
      humanVerificationState: "unverified",
      rightsReviewState: "not_reviewed",
      payoutRelease: "none",
      rightsFlags: ["RESTRICT_PAYOUTS"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.map((r) => r.code).sort()).toEqual(
      [
        "human_verification_required",
        "payout_release_blocked",
        "payouts_restricted",
        "rights_review_required",
      ].sort(),
    );
    for (const reason of result.reasons) {
      expect(reason.resolution.trim().length).toBeGreaterThan(0);
    }
  });
});
