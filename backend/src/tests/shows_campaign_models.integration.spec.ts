import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import {
  SHOW_ARTIST_AUTHORITY_STATUSES,
  SHOW_CAMPAIGN_BENEFICIARY_TYPES,
  SHOW_CAMPAIGN_EVENT_TYPES,
  SHOW_CAMPAIGN_LEVELS,
  SHOW_CAMPAIGN_RELEASE_POLICIES,
  SHOW_CAMPAIGN_STATUSES,
  SHOW_PLEDGE_CONFIRMATION_STATUSES,
  SHOW_PLEDGE_STATUSES,
  assertShowArtistAuthorityStatus,
  assertShowCampaignBeneficiaryType,
  assertShowCampaignEventType,
  assertShowCampaignLevel,
  assertShowCampaignReleasePolicy,
  assertShowCampaignStatus,
  assertShowPledgeConfirmationStatus,
  assertShowPledgeStatus,
} from "../modules/shows/show-status";

const TEST_PREFIX = `shows_models_${Date.now()}_`;
const userId = `${TEST_PREFIX}user`;
const artistId = `${TEST_PREFIX}artist`;
const campaignId = `${TEST_PREFIX}campaign`;
const campaignSlug = `${TEST_PREFIX}montreal`;
const walletAddress = "0x" + "9".repeat(40);

describe("Shows campaign models integration", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${TEST_PREFIX}fan@test.resonate`,
      },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: "Shows Model Artist",
        payoutAddress: "0x" + "8".repeat(40),
      },
    });
  });

  afterAll(async () => {
    await prisma.showCampaignEvent.deleteMany({
      where: { campaignId: { startsWith: TEST_PREFIX } },
    }).catch(() => {});
    await prisma.showPledge.deleteMany({
      where: { campaignId: { startsWith: TEST_PREFIX } },
    }).catch(() => {});
    await prisma.showCampaignTier.deleteMany({
      where: { campaignId: { startsWith: TEST_PREFIX } },
    }).catch(() => {});
    await prisma.showCampaign.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: artistId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("constrains Shows lifecycle values through shared constants", () => {
    expect(SHOW_CAMPAIGN_STATUSES).toEqual([
      "draft",
      "active",
      "funded",
      "booking_confirmed",
      "deposit_released",
      "fulfilled",
      "released",
      "cancelled",
      "refund_available",
      "refunded",
    ]);
    expect(SHOW_CAMPAIGN_LEVELS).toEqual([
      "signal",
      "provisional_campaign",
      "active_escrow_campaign",
    ]);
    expect(SHOW_ARTIST_AUTHORITY_STATUSES).toEqual([
      "none",
      "human_verified",
      "artist_acknowledged",
      "artist_authorized",
      "trusted_source_authorized",
      "rejected",
      "revoked",
      "expired",
    ]);
    expect(SHOW_CAMPAIGN_BENEFICIARY_TYPES).toEqual(["wallet", "split_contract", "multisig"]);
    expect(SHOW_CAMPAIGN_RELEASE_POLICIES).toEqual([
      "refund_only_until_booking",
      "staged_release",
      "manual_ops_release",
    ]);
    expect(SHOW_PLEDGE_STATUSES).toContain("refund_available");
    expect(SHOW_PLEDGE_CONFIRMATION_STATUSES).toEqual([
      "not_submitted",
      "pending",
      "confirmed",
      "failed",
    ]);
    expect(SHOW_CAMPAIGN_EVENT_TYPES).toContain("pledge_confirmed");
    expect(SHOW_CAMPAIGN_EVENT_TYPES).toContain("artist_authority_approved");
    expect(SHOW_CAMPAIGN_EVENT_TYPES).toContain("artist_authority_rejected");
    expect(SHOW_CAMPAIGN_EVENT_TYPES).toContain("artist_authority_expired");
    expect(SHOW_CAMPAIGN_EVENT_TYPES).toContain("fulfillment_confirmed");

    expect(assertShowCampaignStatus("active")).toBe("active");
    expect(assertShowCampaignStatus("deposit_released")).toBe("deposit_released");
    expect(assertShowCampaignLevel("active_escrow_campaign")).toBe("active_escrow_campaign");
    expect(assertShowArtistAuthorityStatus("artist_authorized")).toBe("artist_authorized");
    expect(assertShowArtistAuthorityStatus("revoked")).toBe("revoked");
    expect(assertShowCampaignBeneficiaryType("split_contract")).toBe("split_contract");
    expect(assertShowCampaignReleasePolicy("staged_release")).toBe("staged_release");
    expect(assertShowPledgeStatus("submitted")).toBe("submitted");
    expect(assertShowPledgeConfirmationStatus("pending")).toBe("pending");
    expect(assertShowCampaignEventType("campaign_funded")).toBe("campaign_funded");

    expect(() => assertShowCampaignStatus("soft_launch")).toThrow(BadRequestException);
    expect(() => assertShowCampaignLevel("backstage")).toThrow(BadRequestException);
    expect(() => assertShowArtistAuthorityStatus("famous")).toThrow(BadRequestException);
    expect(() => assertShowCampaignBeneficiaryType("bank_account")).toThrow(BadRequestException);
    expect(() => assertShowCampaignReleasePolicy("release_on_funding")).toThrow(BadRequestException);
    expect(() => assertShowPledgeStatus("mystery")).toThrow(BadRequestException);
  });

  it("creates a campaign with pledge tiers and lifecycle event history", async () => {
    const campaign = await prisma.showCampaign.create({
      data: {
        id: campaignId,
        slug: campaignSlug,
        artistId,
        artistDisplayName: "Shows Model Artist",
        title: "Shows Model Artist in Montreal",
        description: "A fan-funded proof of demand for a Montreal date.",
        city: "Montreal",
        country: "CA",
        venueTarget: "MTELUS",
        targetDate: new Date("2026-09-12T20:00:00.000Z"),
        deadline: new Date("2026-07-01T23:59:59.000Z"),
        goalAmountUnits: "2500000",
        minimumBackers: 250,
        paymentAssetId: "base-sepolia:usdc",
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        paymentTokenAddress: "0x" + "1".repeat(40),
        chainId: 84532,
        status: "draft",
        campaignLevel: "active_escrow_campaign",
        artistAuthorityStatus: "artist_authorized",
        authorityCredentialId: `${TEST_PREFIX}authority`,
        authorityEvidenceBundleId: `${TEST_PREFIX}evidence`,
        beneficiaryAddress: "0x" + "8".repeat(40),
        beneficiaryType: "wallet",
        bookingDeadline: new Date("2026-07-15T23:59:59.000Z"),
        releasePolicy: "refund_only_until_booking",
        depositReleaseBps: 0,
        disputeWindowSeconds: 604800,
        artistAcceptedAt: new Date("2026-06-01T10:00:00.000Z"),
        bookingTerms: {
          ticketCredit: true,
          refundFirst: true,
          noReleaseOnFunding: true,
        },
        fulfillmentNotes: "Pledges become ticket credit if booking is confirmed.",
        tiers: {
          create: [
            {
              title: "Fan Signal",
              amountUnits: "25000000",
              sortOrder: 1,
              benefits: { value: "Refundable demand signal" },
            },
            {
              title: "Ticket Intent",
              amountUnits: "75000000",
              sortOrder: 2,
              benefits: { value: "Priority ticket allocation" },
            },
          ],
        },
        events: {
          create: {
            eventType: "campaign_created",
            actorUserId: userId,
            nextStatus: "draft",
            metadata: {
              source: "integration-test",
              campaignLevel: "active_escrow_campaign",
              artistAuthorityStatus: "artist_authorized",
            },
          },
        },
      },
      include: {
        artist: true,
        tiers: { orderBy: { sortOrder: "asc" } },
        events: true,
      },
    });

    expect(campaign.artist?.displayName).toBe("Shows Model Artist");
    expect(campaign.tiers.map((tier) => tier.title)).toEqual(["Fan Signal", "Ticket Intent"]);
    expect(campaign.raisedAmountUnits).toBe("0");
    expect(campaign.confirmedPledgeCount).toBe(0);
    expect(campaign.campaignLevel).toBe("active_escrow_campaign");
    expect(campaign.artistAuthorityStatus).toBe("artist_authorized");
    expect(campaign.beneficiaryAddress).toBe("0x" + "8".repeat(40));
    expect(campaign.releasePolicy).toBe("refund_only_until_booking");
    expect(campaign.depositReleaseBps).toBe(0);
    expect(campaign.events[0].eventType).toBe("campaign_created");
  });

  it("creates pledge intents, receipts, and confirmation lifecycle events", async () => {
    const tier = await prisma.showCampaignTier.findFirstOrThrow({
      where: { campaignId, title: "Ticket Intent" },
    });

    const pledge = await prisma.showPledge.create({
      data: {
        campaignId,
        tierId: tier.id,
        userId,
        walletAddress,
        amountUnits: tier.amountUnits,
        paymentAssetId: "base-sepolia:usdc",
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        paymentTokenAddress: "0x" + "1".repeat(40),
        chainId: 84532,
        status: "intent_created",
        receiptId: `${TEST_PREFIX}receipt`,
        receipt: {
          campaignSlug,
          tierTitle: tier.title,
          fanValue: "ticket_credit",
        },
        events: {
          create: {
            campaignId,
            eventType: "pledge_intent_created",
            actorUserId: userId,
            actorWalletAddress: walletAddress,
            nextStatus: "intent_created",
          },
        },
      },
      include: {
        tier: true,
        user: true,
        events: true,
      },
    });

    expect(pledge.tier?.title).toBe("Ticket Intent");
    expect(pledge.user?.id).toBe(userId);
    expect(pledge.confirmationStatus).toBe("not_submitted");
    expect(pledge.events).toHaveLength(1);

    const confirmed = await prisma.showPledge.update({
      where: { id: pledge.id },
      data: {
        status: "confirmed",
        confirmationStatus: "confirmed",
        transactionHash: "0x" + "2".repeat(64),
        blockNumber: 123456n,
        submittedAt: new Date("2026-06-01T12:00:00.000Z"),
        confirmedAt: new Date("2026-06-01T12:01:00.000Z"),
        events: {
          create: {
            campaignId,
            eventType: "pledge_confirmed",
            actorWalletAddress: walletAddress,
            previousStatus: "submitted",
            nextStatus: "confirmed",
            transactionHash: "0x" + "2".repeat(64),
            blockNumber: 123456n,
            metadata: { confirmations: 3 },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });

    await prisma.showCampaign.update({
      where: { id: campaignId },
      data: {
        status: "active",
        raisedAmountUnits: confirmed.amountUnits,
        confirmedPledgeCount: 1,
        uniqueBackerCount: 1,
      },
    });

    const fullCampaign = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: {
        tiers: { include: { pledges: true } },
        pledges: true,
        events: { orderBy: { createdAt: "asc" } },
      },
    });

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.events.map((event) => event.eventType)).toEqual([
      "pledge_intent_created",
      "pledge_confirmed",
    ]);
    expect(fullCampaign.pledges).toHaveLength(1);
    expect(fullCampaign.tiers.find((item) => item.id === tier.id)?.pledges).toHaveLength(1);
    expect(fullCampaign.raisedAmountUnits).toBe("75000000");
  });

  it("records booking, refund, and fulfillment lifecycle state separately from funding", async () => {
    const funded = await prisma.showCampaign.update({
      where: { id: campaignId },
      data: {
        status: "funded",
        fundedAt: new Date("2026-07-01T23:59:59.000Z"),
        events: {
          create: {
            eventType: "campaign_funded",
            actorUserId: userId,
            previousStatus: "active",
            nextStatus: "funded",
            metadata: {
              releaseBlockedUntilBooking: true,
            },
          },
        },
      },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });

    expect(funded.status).toBe("funded");
    expect(funded.releasedAt).toBeNull();

    const bookingConfirmed = await prisma.showCampaign.update({
      where: { id: campaignId },
      data: {
        status: "booking_confirmed",
        bookingConfirmedAt: new Date("2026-07-05T12:00:00.000Z"),
        bookingEvidenceBundleId: `${TEST_PREFIX}booking-evidence`,
        events: {
          create: [
            {
              eventType: "booking_evidence_submitted",
              actorUserId: userId,
              previousStatus: "funded",
              nextStatus: "funded",
              metadata: { venueHold: "MTELUS" },
            },
            {
              eventType: "booking_confirmed",
              actorUserId: userId,
              previousStatus: "funded",
              nextStatus: "booking_confirmed",
            },
          ],
        },
      },
    });

    expect(bookingConfirmed.status).toBe("booking_confirmed");
    expect(bookingConfirmed.bookingEvidenceBundleId).toBe(`${TEST_PREFIX}booking-evidence`);

    const fulfilled = await prisma.showCampaign.update({
      where: { id: campaignId },
      data: {
        status: "fulfilled",
        fulfilledAt: new Date("2026-09-13T01:00:00.000Z"),
        fulfillmentEvidenceBundleId: `${TEST_PREFIX}fulfillment-evidence`,
        events: {
          create: {
            eventType: "fulfillment_confirmed",
            actorUserId: userId,
            previousStatus: "booking_confirmed",
            nextStatus: "fulfilled",
          },
        },
      },
    });

    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.fulfillmentEvidenceBundleId).toBe(`${TEST_PREFIX}fulfillment-evidence`);

    const refundAvailable = await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}refund_campaign`,
        slug: `${TEST_PREFIX}refund-city`,
        artistDisplayName: "Refund Artist",
        title: "Refund Artist in Quebec City",
        city: "Quebec City",
        country: "CA",
        deadline: new Date("2026-07-01T23:59:59.000Z"),
        goalAmountUnits: "1000000",
        chainId: 84532,
        status: "refund_available",
        campaignLevel: "signal",
        artistAuthorityStatus: "none",
        refundAvailableAt: new Date("2026-07-16T00:00:00.000Z"),
        events: {
          create: {
            eventType: "refund_available",
            previousStatus: "funded",
            nextStatus: "refund_available",
            metadata: { reason: "booking_deadline_missed" },
          },
        },
      },
      include: { events: true },
    });

    expect(refundAvailable.status).toBe("refund_available");
    expect(refundAvailable.events[0].eventType).toBe("refund_available");
  });
});
