import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CommunityBenefit, CommunityBenefitsResponse } from "../../lib/api";
import {
  CommunityBenefitsContent,
  communityBenefitState,
  communityBenefitStatusCopy,
  communityBenefitTypeLabel,
  partitionCommunityBenefits,
} from "./CommunityBenefitsPanel";

function benefit(overrides: Partial<CommunityBenefit> = {}): CommunityBenefit {
  return {
    id: "benefit-1",
    title: "Holder listening room",
    description: "Enter a private holder room for upcoming drops.",
    benefitType: "room_access",
    artistId: "artist-1",
    eligible: true,
    redeemable: true,
    redeemed: false,
    redemptionStatus: null,
    redeemedAt: null,
    reasons: ["stem_nft_holder"],
    privacy: {
      proofDetails: "private",
    },
    ...overrides,
  };
}

function response(benefits: CommunityBenefit[]): CommunityBenefitsResponse {
  return {
    schemaVersion: "community-benefits/v1",
    benefits,
    privacy: {
      proofDetails: "private",
      walletAddressVisible: false,
      ownershipDisplayVisible: false,
    },
  };
}

function content(overrides: Partial<React.ComponentProps<typeof CommunityBenefitsContent>> = {}) {
  return (
    <CommunityBenefitsContent
      response={response([])}
      loading={false}
      error={null}
      redeemingId={null}
      onRefresh={vi.fn()}
      onRedeem={vi.fn()}
      {...overrides}
    />
  );
}

describe("CommunityBenefitsPanel", () => {
  it("classifies benefit states for listener grouping", () => {
    const redeemable = benefit();
    const redeemed = benefit({ id: "redeemed", redeemable: false, redeemed: true, redemptionStatus: "redeemed" });
    const locked = benefit({ id: "locked", eligible: false, redeemable: false });
    const unavailable = benefit({ id: "unavailable", eligible: true, redeemable: false });

    expect(communityBenefitState(redeemable)).toBe("redeemable");
    expect(communityBenefitState(redeemed)).toBe("redeemed");
    expect(communityBenefitState(locked)).toBe("locked");
    expect(communityBenefitState(unavailable)).toBe("unavailable");
    expect(partitionCommunityBenefits([redeemable, redeemed, locked, unavailable])).toMatchObject({
      redeemable: [redeemable],
      redeemed: [redeemed],
      locked: [locked],
      unavailable: [unavailable],
    });
  });

  it("uses safe user-facing labels without exposing raw proof reasons", () => {
    expect(communityBenefitTypeLabel("remix_eligibility")).toBe("Remix eligibility");
    expect(communityBenefitStatusCopy(benefit({ eligible: false, redeemable: false })).body).toContain("Proof details stay private");

    const html = renderToStaticMarkup(content({
      response: response([benefit()]),
    }));

    expect(html).toContain("Holder listening room");
    expect(html).toContain("Proofs private");
    expect(html).toContain("Claim benefit");
    expect(html).toContain("Artist benefit");
    expect(html).not.toContain("stem_nft_holder");
    expect(html).not.toContain("artist-1");
  });

  it("renders redeemed and locked benefits separately from claimable benefits", () => {
    const html = renderToStaticMarkup(content({
      response: response([
        benefit({ id: "claimable", title: "Claimable perk" }),
        benefit({
          id: "redeemed",
          title: "Claimed perk",
          eligible: true,
          redeemable: false,
          redeemed: true,
          redemptionStatus: "redeemed",
          redeemedAt: "2026-06-08T00:00:00.000Z",
        }),
        benefit({ id: "locked", title: "Locked perk", eligible: false, redeemable: false }),
      ]),
    }));

    expect(html).toContain("Ready to claim");
    expect(html).toContain("Claimed");
    expect(html).toContain("Not currently claimable");
    expect(html).toContain("Claimable perk");
    expect(html).toContain("Claimed perk");
    expect(html).toContain("Locked perk");
  });

  it("renders the empty state", () => {
    const html = renderToStaticMarkup(content());

    expect(html).toContain("No unlocked benefits yet");
    expect(html).toContain("private community proofs");
  });
});
