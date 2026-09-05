import type {
  HumanVerificationState,
  RightsReviewState,
} from "../trust/verification-semantics";
import type { UploadRightsActionProfile } from "./upload-rights-policy";

/**
 * Payout Eligibility Policy (ADR-BM-5, #1498).
 *
 * A pure, fail-closed gate that decides whether an artist may be the
 * destination of a money-bearing authorization (a Shows escrow beneficiary or a
 * marketplace mint whose proceeds flow to them). Money settles on-chain; the
 * backend's only lever is refusing to *authorize* a payout to an ineligible
 * destination, so this policy is enforced before any authority-granting or
 * signing step.
 *
 * The four primitives it reads already exist in the rights/trust stack — this
 * policy is the missing gate that finally reads them together:
 *   1. human-verification status (personhood / anti-sybil) on the creator;
 *   2. rights-review state of the artist's catalog;
 *   3. the route's payout-release action profile;
 *   4. the RESTRICT_PAYOUTS rights flag.
 *
 * ALL four rules must hold. Every failing rule contributes one explainable
 * reason with a stable machine `code`, a plain-language `message`, and a
 * `resolution` naming the exact unblock step — so the UI can show an honest
 * "here's why, here's how to fix it" without re-deriving policy.
 *
 * Scope note (#1336 / #1164): the `payoutRelease === "held"` escrow-days
 * semantics are OUT of scope for this slice. `held` is not `none`, so it passes
 * the payout-release rule here; a held route is instead gated by its
 * RESTRICT_PAYOUTS flag (which `held` routes carry) — keeping the gate
 * fail-closed while deferring the timed-release accounting.
 */

export const PAYOUT_ELIGIBILITY_REASON_CODES = [
  "human_verification_required",
  "rights_review_required",
  "payout_release_blocked",
  "payouts_restricted",
] as const;

export type PayoutEligibilityReasonCode =
  (typeof PAYOUT_ELIGIBILITY_REASON_CODES)[number];

/** Rights-review states that are "approved enough" to receive payouts. */
export const PAYOUT_APPROVED_RIGHTS_REVIEW_STATES: readonly RightsReviewState[] =
  ["approved_with_limits", "rights_verified"] as const;

/** The rights flag that hard-blocks payouts regardless of route. */
export const RESTRICT_PAYOUTS_FLAG = "RESTRICT_PAYOUTS";

export interface PayoutEligibilityReason {
  code: PayoutEligibilityReasonCode;
  /** Plain-language explanation shown to the artist. */
  message: string;
  /** The exact next step that unblocks this reason. */
  resolution: string;
}

export interface PayoutEligibilityInput {
  humanVerificationState: HumanVerificationState;
  rightsReviewState: RightsReviewState;
  payoutRelease: UploadRightsActionProfile["payoutRelease"];
  rightsFlags: string[];
}

export interface PayoutEligibilityResult {
  /** True only when no rule produced a reason. */
  eligible: boolean;
  reasons: PayoutEligibilityReason[];
}

/**
 * Evaluate the four fail-closed payout rules. Pure and deterministic: identical
 * inputs always yield the identical set of reasons, which is what makes the
 * truth-table unit test exhaustive and the server-side re-check trustworthy.
 */
export function evaluatePayoutEligibility(
  input: PayoutEligibilityInput,
): PayoutEligibilityResult {
  const reasons: PayoutEligibilityReason[] = [];

  if (input.humanVerificationState !== "human_verified") {
    reasons.push({
      code: "human_verification_required",
      message:
        "This account is not human-verified, so it cannot receive payouts yet.",
      resolution:
        "Complete the human-verification (personhood) check on your artist profile before opening a paid campaign or listing.",
    });
  }

  if (!PAYOUT_APPROVED_RIGHTS_REVIEW_STATES.includes(input.rightsReviewState)) {
    reasons.push({
      code: "rights_review_required",
      message:
        "No release on this account has passed rights review, so payouts are not enabled yet.",
      resolution:
        "Publish a release and complete rights review so it reaches the standard or trusted rights route, which enables payouts.",
    });
  }

  if (input.payoutRelease === "none") {
    reasons.push({
      code: "payout_release_blocked",
      message:
        "Your catalog's current rights route does not release payouts.",
      resolution:
        "Complete rights review to move your release onto the standard or trusted route, which releases payouts.",
    });
  }

  if (input.rightsFlags.includes(RESTRICT_PAYOUTS_FLAG)) {
    reasons.push({
      code: "payouts_restricted",
      message:
        "Payouts are restricted on your catalog while a rights review is pending.",
      resolution:
        "Resolve the open rights review that set the payout restriction (RESTRICT_PAYOUTS) with the rights team, then re-check eligibility.",
    });
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}
