import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import {
  SHOW_CAMPAIGN_EVENT_TYPES,
  SHOW_CAMPAIGN_STATUSES,
  SHOW_PLEDGE_CONFIRMATION_STATUSES,
  SHOW_PLEDGE_STATUSES,
  assertShowCampaignEventType,
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
      "released",
      "cancelled",
      "refunded",
    ]);
    expect(SHOW_PLEDGE_STATUSES).toContain("refund_available");
    expect(SHOW_PLEDGE_CONFIRMATION_STATUSES).toEqual([
      "not_submitted",
      "pending",
      "confirmed",
      "failed",
    ]);
    expect(SHOW_CAMPAIGN_EVENT_TYPES).toContain("pledge_confirmed");

    expect(assertShowCampaignStatus("active")).toBe("active");
    expect(assertShowPledgeStatus("submitted")).toBe("submitted");
    expect(assertShowPledgeConfirmationStatus("pending")).toBe("pending");
    expect(assertShowCampaignEventType("campaign_funded")).toBe("campaign_funded");

    expect(() => assertShowCampaignStatus("soft_launch")).toThrow(BadRequestException);
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
        bookingTerms: {
          ticketCredit: true,
          refundFirst: true,
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
            metadata: { source: "integration-test" },
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
});
