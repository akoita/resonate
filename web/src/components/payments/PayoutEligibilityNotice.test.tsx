import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayoutEligibilityNotice } from "./PayoutEligibilityNotice";
import type { PayoutEligibility } from "../../lib/api";

const eligible: PayoutEligibility = {
  artistId: "artist-1",
  eligible: true,
  reasons: [],
  inputs: {
    humanVerificationState: "human_verified",
    rightsReviewState: "rights_verified",
    payoutRelease: "trusted",
    rightsFlags: [],
    rightsRoute: "TRUSTED_FAST_PATH",
    hasReleases: true,
  },
};

const blocked: PayoutEligibility = {
  artistId: "artist-1",
  eligible: false,
  reasons: [
    {
      code: "human_verification_required",
      message: "This account is not human-verified, so it cannot receive payouts yet.",
      resolution: "Complete the human-verification check on your artist profile.",
    },
    {
      code: "rights_review_required",
      message: "No release on this account has passed rights review.",
      resolution: "Publish a release and complete rights review.",
    },
  ],
  inputs: {
    humanVerificationState: "unverified",
    rightsReviewState: "not_reviewed",
    payoutRelease: "none",
    rightsFlags: [],
    rightsRoute: null,
    hasReleases: false,
  },
};

describe("PayoutEligibilityNotice", () => {
  it("renders nothing without data", () => {
    expect(renderToStaticMarkup(<PayoutEligibilityNotice eligibility={null} />)).toBe("");
  });

  it("shows a confirmation when eligible", () => {
    const html = renderToStaticMarkup(<PayoutEligibilityNotice eligibility={eligible} />);
    expect(html).toContain("Payouts enabled");
    expect(html).toContain('data-testid="payout-eligibility-eligible"');
    expect(html).not.toContain("payout-eligibility-blocked");
  });

  it("lists every reason and its resolution when blocked", () => {
    const html = renderToStaticMarkup(<PayoutEligibilityNotice eligibility={blocked} />);
    expect(html).toContain('data-testid="payout-eligibility-blocked"');
    expect(html).toContain("not human-verified");
    expect(html).toContain("Complete the human-verification check");
    expect(html).toContain("passed rights review");
    expect(html).toContain("Publish a release and complete rights review");
  });

  it("wires the human-verification reason to an action when a handler is provided", () => {
    const withHandler = renderToStaticMarkup(
      <PayoutEligibilityNotice eligibility={blocked} onVerifyHuman={() => {}} />,
    );
    expect(withHandler).toContain('data-testid="payout-eligibility-verify-human"');

    const withoutHandler = renderToStaticMarkup(
      <PayoutEligibilityNotice eligibility={blocked} />,
    );
    expect(withoutHandler).not.toContain("payout-eligibility-verify-human");
  });
});
