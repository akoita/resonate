import { describe, expect, it } from "vitest";
import {
  buildCatalogArtistCandidates,
  campaignDisplayInitial,
  campaignDisplayTitle,
  campaignRouteCode,
  campaignTrustState,
  campaignTerms,
  pledgeStateLabel,
  maskAddress,
  chainName,
  releasePolicyLabel,
  campaignDisputeView,
  campaignPledgeAvailability,
  campaignFeeNotice,
  formatCampaignFeePercent,
  pledgeConfirmSummary,
  type Campaign,
} from "./shows";
import type { Release } from "./api";

describe("Shows campaign presentation", () => {
  it("uses the campaign title as the public display identity", () => {
    const campaign = {
      title: "Sennarin in Paris",
      artistName: "green",
      city: "Paris",
    };

    expect(campaignDisplayTitle(campaign)).toBe("Sennarin in Paris");
    expect(campaignDisplayInitial(campaign)).toBe("S");
    expect(campaignRouteCode(campaign)).toBe("SEN-PAR");
  });

  it("falls back to the platform artist name when a legacy campaign has no title", () => {
    const campaign = {
      title: "",
      artistName: "green",
      city: "Paris",
    };

    expect(campaignDisplayTitle(campaign)).toBe("green in Paris");
    expect(campaignDisplayInitial(campaign)).toBe("G");
  });

  it("builds campaign artist choices from declared catalog credits, not uploaders", () => {
    const releases = [
      {
        id: "release-1",
        artistId: "profile-green",
        title: "Dignified",
        status: "ready",
        type: "single",
        primaryArtist: "SennaRin",
        explicit: false,
        createdAt: "2026-05-01T00:00:00.000Z",
        artist: { id: "profile-green", displayName: "green", userId: "user-green" },
      },
      {
        id: "release-2",
        artistId: "profile-green",
        title: "Second Credit",
        status: "published",
        type: "single",
        primaryArtist: "SennaRin",
        explicit: false,
        createdAt: "2026-05-02T00:00:00.000Z",
        artist: { id: "profile-green", displayName: "green", userId: "user-green" },
      },
      {
        id: "release-3",
        artistId: "profile-bouba",
        title: "She Doesn't Mind",
        status: "ready",
        type: "single",
        primaryArtist: "bouba",
        explicit: false,
        createdAt: "2026-05-03T00:00:00.000Z",
        artist: { id: "profile-bouba", displayName: "bouba", userId: "user-bouba" },
      },
    ] satisfies Release[];

    const candidates = buildCatalogArtistCandidates(releases);

    expect(candidates.map((candidate) => candidate.name)).toEqual(["bouba", "SennaRin"]);
    expect(candidates.find((candidate) => candidate.name === "SennaRin")).toMatchObject({
      artistId: null,
      optionId: "credit:sennarin",
      releaseCount: 2,
      latestReleaseTitle: "Dignified",
    });
    expect(candidates.find((candidate) => candidate.name === "bouba")).toMatchObject({
      artistId: "profile-bouba",
      optionId: "profile:profile-bouba",
      releaseCount: 1,
    });
  });

  it("prefers first-class release artist credits for campaign artist choices", () => {
    const releases = [
      {
        id: "release-credits",
        artistId: "manager-green",
        title: "Dignified",
        status: "ready",
        type: "single",
        primaryArtist: "legacy uploader fallback",
        explicit: false,
        createdAt: "2026-05-01T00:00:00.000Z",
        artist: { id: "manager-green", displayName: "green", userId: "user-green" },
        artistCredits: [
          {
            id: "credit-sennarin",
            releaseId: "release-credits",
            artistId: "public-sennarin",
            role: "main",
            displayName: "SennaRin",
            sortOrder: 0,
            artist: { id: "public-sennarin", displayName: "SennaRin" },
          },
          {
            id: "credit-collab",
            releaseId: "release-credits",
            artistId: "public-collab",
            role: "main",
            displayName: "Collab Artist",
            sortOrder: 1,
          },
          {
            id: "credit-feature",
            releaseId: "release-credits",
            artistId: "public-feature",
            role: "featured",
            displayName: "Featured Guest",
            sortOrder: 2,
          },
        ],
      },
    ] satisfies Release[];

    const candidates = buildCatalogArtistCandidates(releases);

    expect(candidates.map((candidate) => candidate.name)).toEqual(["Collab Artist", "SennaRin"]);
    expect(candidates.find((candidate) => candidate.name === "SennaRin")).toMatchObject({
      artistId: "public-sennarin",
      optionId: "profile:public-sennarin",
      releaseCount: 1,
    });
  });
});

describe("Shows trust / terms / pledge helpers (#949)", () => {
  const baseCampaign = {
    campaignLevel: "active_escrow_campaign",
    rawStatus: "active",
    artistAuthorityStatus: "artist_authorized",
  };

  it("derives the trust state across the campaign ladder and terminal states", () => {
    expect(campaignTrustState(baseCampaign).key).toBe("authorized_escrow");
    expect(campaignTrustState({ ...baseCampaign, campaignLevel: "signal" }).key).toBe(
      "demand_signal",
    );
    expect(
      campaignTrustState({ ...baseCampaign, campaignLevel: "provisional_campaign", artistAuthorityStatus: "none" }).key,
    ).toBe("provisional");
    expect(campaignTrustState({ ...baseCampaign, artistAuthorityStatus: "revoked" }).key).toBe(
      "authority_revoked",
    );
    expect(campaignTrustState({ ...baseCampaign, rawStatus: "refund_available" }).key).toBe(
      "refund_available",
    );
    expect(campaignTrustState({ ...baseCampaign, rawStatus: "cancelled" }).key).toBe("cancelled");
    // Terminal/refund wins over authority + level.
    expect(
      campaignTrustState({ campaignLevel: "signal", rawStatus: "cancelled", artistAuthorityStatus: "revoked" }).key,
    ).toBe("cancelled");
  });

  it("never implies a guaranteed ticket in trust descriptions", () => {
    for (const key of ["demand_signal", "provisional", "authorized_escrow"]) {
      const state = campaignTrustState(
        key === "demand_signal"
          ? { ...baseCampaign, campaignLevel: "signal" }
          : key === "provisional"
            ? { ...baseCampaign, campaignLevel: "provisional_campaign", artistAuthorityStatus: "none" }
            : baseCampaign,
      );
      expect(state.description.toLowerCase()).not.toContain("guarantee");
      expect(state.description.toLowerCase()).not.toContain("ticket");
    }
  });

  it("formats immutable terms a fan can read before signing", () => {
    const terms = campaignTerms({
      goalCents: 300000,
      currency: "USD",
      deadline: "2026-07-01T00:00:00.000Z",
      bookingDeadline: "2026-07-15T00:00:00.000Z",
      thresholdBackers: 100,
      paymentAssetSymbol: "USDC",
      chainId: 84532,
      depositReleaseBps: 1000,
      disputeWindowSeconds: 604800,
      releasePolicy: "staged_release",
      feeBps: 600,
    } as unknown as Campaign);
    const byLabel = Object.fromEntries(terms.map((t) => [t.label, t.value]));
    expect(byLabel["Minimum backers"]).toBe("100");
    expect(byLabel["Payment"]).toBe("USDC on Base Sepolia");
    expect(byLabel["Deposit released on booking"]).toBe("10%");
    expect(byLabel["Dispute window"]).toBe("7 days");
    expect(byLabel["Refund policy"]).toContain("Staged release");
    expect(byLabel["Funding deadline"]).toBe("2026-07-01");
    expect(byLabel["Platform fee"]).toBe("6% success-only; refunds fee-free");
  });

  it("derives platform fee copy from basis points and omits missing or zero fees", () => {
    expect(formatCampaignFeePercent(600)).toBe("6%");
    expect(formatCampaignFeePercent(625)).toBe("6.25%");
    expect(formatCampaignFeePercent(50)).toBe("0.5%");
    expect(formatCampaignFeePercent(0)).toBeNull();
    expect(campaignFeeNotice({ feeBps: null })).toBeNull();
    expect(campaignFeeNotice({ feeBps: 600 })).toBe(
      "A 6% platform fee applies only if the campaign is funded — deducted from the artist payout at release. If the campaign fails, you are refunded 100%.",
    );
  });

  it("does not throw on a malformed date (server-render safety)", () => {
    const run = () =>
      campaignTerms({
        goalCents: 1000,
        currency: "USD",
        deadline: "not-a-date",
        thresholdBackers: 0,
      } as unknown as Campaign);
    expect(run).not.toThrow();
    const byLabel = Object.fromEntries(run().map((t) => [t.label, t.value]));
    expect(byLabel["Funding deadline"]).toBe("not-a-date");
    expect(byLabel["Minimum backers"]).toBe("—");
  });

  it("derives the fan-visible dispute view (#950)", () => {
    const future = new Date(Date.now() + 3 * 86400_000).toISOString();
    const past = new Date(Date.now() - 86400_000).toISOString();

    const active = campaignDisputeView({ disputeStatus: "active", disputeWindowClosesAt: future });
    expect(active.label).toBe("Dispute under review");
    expect(active.tone).toBe("warning");

    const resolved = campaignDisputeView({ disputeStatus: "resolved", disputeWindowClosesAt: past });
    expect(resolved.label).toBe("Dispute resolved");
    expect(resolved.windowOpen).toBe(false);

    const windowOpen = campaignDisputeView({ disputeStatus: "none", disputeWindowClosesAt: future });
    expect(windowOpen.label).toBe("Dispute window open");
    expect(windowOpen.windowOpen).toBe(true);
    expect(windowOpen.windowClosesAt).toBe(future.slice(0, 10));

    const none = campaignDisputeView({ disputeStatus: "none", disputeWindowClosesAt: null });
    expect(none.label).toBe("No active dispute");
    expect(none.windowOpen).toBe(false);
  });

  it("labels every pledge state and masks addresses", () => {
    expect(pledgeStateLabel("submitted", "pending")).toContain("awaiting on-chain");
    expect(pledgeStateLabel("confirmed")).toBe("Confirmed on-chain");
    expect(pledgeStateLabel("refund_available")).toBe("Refund available");
    expect(pledgeStateLabel("released")).toBe("Funds released to artist");
    expect(pledgeStateLabel("weird_state")).toBe("weird state");
    expect(maskAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(maskAddress(null)).toBe("—");
    expect(chainName(11155111)).toBe("Sepolia");
    expect(releasePolicyLabel("refund_only_until_booking")).toContain("Refund-only");
  });
});

describe("campaignPledgeAvailability empty states (#949)", () => {
  const openCampaign = {
    campaignLevel: "active_escrow_campaign",
    rawStatus: "active",
    artistAuthorityStatus: "artist_authorized",
    beneficiaryAddress: "0x1234567890abcdef1234567890abcdef12345678",
    beneficiaryType: "wallet",
  } as unknown as Campaign;

  it("opens pledging only when the campaign mirrors the server's pledgeable gate", () => {
    const result = campaignPledgeAvailability(openCampaign);
    expect(result.open).toBe(true);
    expect(result.key).toBe("open");
  });

  it("flags a provisional campaign as awaiting artist authority", () => {
    const result = campaignPledgeAvailability({
      ...openCampaign,
      campaignLevel: "provisional_campaign",
      artistAuthorityStatus: "none",
    } as unknown as Campaign);
    expect(result.open).toBe(false);
    expect(result.key).toBe("pending_authority");
    expect(result.message.toLowerCase()).toContain("operator");
  });

  it("treats an unbound beneficiary as still pending even when authorized", () => {
    const result = campaignPledgeAvailability({
      ...openCampaign,
      beneficiaryAddress: null,
      beneficiaryType: null,
    } as unknown as Campaign);
    expect(result.key).toBe("pending_authority");
  });

  it("flags revoked / rejected / expired authority as not authorized", () => {
    for (const authority of ["revoked", "rejected", "expired"]) {
      const result = campaignPledgeAvailability({
        ...openCampaign,
        artistAuthorityStatus: authority,
      } as unknown as Campaign);
      expect(result.open).toBe(false);
      expect(result.key).toBe("not_authorized");
    }
  });

  it("labels a demand signal honestly (no escrow)", () => {
    const result = campaignPledgeAvailability({
      ...openCampaign,
      campaignLevel: "signal",
    } as unknown as Campaign);
    expect(result.key).toBe("signal");
    expect(result.message.toLowerCase()).toContain("demand signal");
  });

  it("closes pledging for terminal/refund states ahead of authority checks", () => {
    expect(campaignPledgeAvailability({ ...openCampaign, rawStatus: "cancelled" } as unknown as Campaign).key).toBe(
      "cancelled",
    );
    expect(
      campaignPledgeAvailability({ ...openCampaign, rawStatus: "refund_available" } as unknown as Campaign).key,
    ).toBe("closed_refund");
    // Terminal wins even when authority is also broken.
    expect(
      campaignPledgeAvailability({
        ...openCampaign,
        rawStatus: "cancelled",
        artistAuthorityStatus: "revoked",
      } as unknown as Campaign).key,
    ).toBe("cancelled");
  });

  it("closes pledging for an authorized campaign that is no longer active", () => {
    const result = campaignPledgeAvailability({
      ...openCampaign,
      rawStatus: "booking_confirmed",
    } as unknown as Campaign);
    expect(result.open).toBe(false);
    expect(result.key).toBe("closed");
  });
});

describe("pledgeConfirmSummary pre-sign terms (#1240)", () => {
  const campaign = {
    goalCents: 300000,
    currency: "USD",
    deadline: "2026-07-01T00:00:00.000Z",
    bookingDeadline: "2026-07-15T00:00:00.000Z",
    thresholdBackers: 100,
    paymentAssetSymbol: "USDC",
    chainId: 84532,
    depositReleaseBps: 1000,
    disputeWindowSeconds: 604800,
    releasePolicy: "staged_release",
    feeBps: 600,
  } as unknown as Campaign;

  const tier = { title: "Ticket intent", amountCents: 7500, currency: "USD" as const };

  it("summarizes the selected tier amount and the fan-risk terms", () => {
    const summary = pledgeConfirmSummary(campaign, tier);
    expect(summary).toContain("$75");
    expect(summary).toContain("Ticket intent");
    expect(summary).toContain("Payment: USDC on Base Sepolia");
    expect(summary).toContain("Deposit released on booking: 10%");
    expect(summary).toContain("Dispute window: 7 days");
    expect(summary).toContain("Refund policy: Staged release");
    expect(summary).toContain("Platform fee: A 6% platform fee applies only if the campaign is funded");
    expect(summary).toContain("If the campaign fails, you are refunded 100%.");
  });

  it("never promises a guaranteed ticket", () => {
    const summary = pledgeConfirmSummary(campaign, tier).toLowerCase();
    expect(summary).toContain("never guarantees a ticket");
    expect(summary).toContain("refunded automatically");
    expect(summary).not.toContain("guaranteed ticket");
  });

  it("omits term rows that are unknown rather than showing a dash", () => {
    const summary = pledgeConfirmSummary(
      { ...campaign, depositReleaseBps: null } as unknown as Campaign,
      tier,
    );
    expect(summary).not.toContain("Deposit released on booking");
    // Other known rows still present.
    expect(summary).toContain("Dispute window: 7 days");
  });
});
