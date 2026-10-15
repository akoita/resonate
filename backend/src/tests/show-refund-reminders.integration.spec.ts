/**
 * Shows unclaimed-refund reminders (#2149) against real Postgres. The escrow's
 * `refundable` view is a fake reader injected through the constructor; the
 * notice path (#2146) is the real service.
 */
import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";
import {
  REFUND_REMINDER_STEP_DAYS,
  ShowRefundReminderService,
  type EscrowRefundReader,
} from "../modules/shows/show-refund-reminder.service";
import { buildRefundReminderService, refundReminderLogFields } from "../scripts/run_refund_reminders";

const TEST_PREFIX = `refundrem_${Date.now()}_`;
const DAY = 24 * 60 * 60 * 1000;
const ESCROW = "0x" + "e".repeat(40);
const OPENED = new Date("2026-10-01T00:00:00.000Z");
const userA = `${TEST_PREFIX}a`;
const userB = `${TEST_PREFIX}b`;
const userC = `${TEST_PREFIX}c`;
const addr = (n: number) => `0x${String(n).repeat(40)}`;
const users = [userA, userB, userC];
const campaignIds: string[] = [];

const refundable = new Map<string, bigint>();
const reader: EscrowRefundReader = {
  async refundable({ contractCampaignId, backer }) {
    return refundable.get(`${contractCampaignId}:${backer.toLowerCase()}`) ?? BigInt(0);
  },
};

const notices = new NoticeService(new EventBus(), new AuditService());
const service = new ShowRefundReminderService(notices, reader);
const operator = { userId: `${TEST_PREFIX}op`, role: "operator" };

let seq = 0;
async function seedCampaign(status: "refund_available" | "cancelled" | "active" = "refund_available") {
  seq += 1;
  const contractCampaignId = String(900000 + Math.floor(Math.random() * 90000) + seq);
  const campaign = await prisma.showCampaign.create({
    data: {
      slug: `${TEST_PREFIX}c${seq}`,
      artistDisplayName: "Refund Artist",
      title: `Refund Show ${seq}`,
      city: "Lyon",
      country: "FR",
      deadline: new Date(OPENED.getTime() - 10 * DAY),
      goalAmountUnits: "1000000000",
      chainId: 31337,
      contractAddress: ESCROW,
      contractCampaignId,
      status,
      refundAvailableAt: OPENED,
      campaignLevel: "active_escrow_campaign",
    },
  });
  campaignIds.push(campaign.id);
  return { ...campaign, contractCampaignId };
}

async function seedPledge(
  campaignId: string,
  wallet: string,
  userId: string | null,
  amountUnits: string,
  status: "confirmed" | "refund_available" | "refunded" = "confirmed",
) {
  return prisma.showPledge.create({
    data: { campaignId, walletAddress: wallet, userId, amountUnits, chainId: 31337, status, confirmationStatus: "confirmed" },
  });
}

const refundNotices = (userId: string) =>
  prisma.notice.findMany({ where: { recipientUserId: userId, category: "refund" }, orderBy: { createdAt: "asc" } });

describe("ShowRefundReminderService integration", () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [...users, operator.userId].map((id) => ({ id, email: `${id}@test.resonate` })) });
  });

  afterAll(async () => {
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: users } } });
    await prisma.showPledge.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.showCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [...users, operator.userId] } } });
  });

  it("exports the 0/7/30 day cadence", () => {
    expect([...REFUND_REMINDER_STEP_DAYS]).toEqual([0, 7, 30]);
  });

  it("sends one notice per step for an unclaimed refundable pledge, then stops", async () => {
    const campaign = await seedCampaign();
    await seedPledge(campaign.id, addr(1), userA, "25000000");
    refundable.set(`${campaign.contractCampaignId}:${addr(1)}`, BigInt(25_000_000));
    const only = { limit: 1000 };

    const first = await service.run({ now: new Date(OPENED.getTime() + 1000), ...only });
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    let list = await refundNotices(userA);
    expect(list).toHaveLength(1);
    expect(list[0].link).toBe(`/shows/${campaign.id}`);
    expect(list[0].body).toContain("25 USDC");
    expect(list[0].body).toContain("no fee");
    expect(list[0].body).toContain("Refund Show");

    // Same day again: still one.
    await service.run({ now: new Date(OPENED.getTime() + 2 * 3600_000), ...only });
    expect(await refundNotices(userA)).toHaveLength(1);

    // Day 3: nothing new. Day 7: second. Day 8 rerun: still two.
    await service.run({ now: new Date(OPENED.getTime() + 3 * DAY), ...only });
    expect(await refundNotices(userA)).toHaveLength(1);
    await service.run({ now: new Date(OPENED.getTime() + 7 * DAY), ...only });
    await service.run({ now: new Date(OPENED.getTime() + 8 * DAY), ...only });
    expect(await refundNotices(userA)).toHaveLength(2);

    // Day 30: third. After that, never again.
    await service.run({ now: new Date(OPENED.getTime() + 30 * DAY), ...only });
    await service.run({ now: new Date(OPENED.getTime() + 90 * DAY), ...only });
    list = await refundNotices(userA);
    expect(list).toHaveLength(3);
    expect(list.map((n) => n.dedupeKey?.split(":").pop())).toEqual(["0", "1", "2"]);

    const report = await service.getUnclaimedRefunds(operator, { campaignId: campaign.id }, new Date(OPENED.getTime() + 90 * DAY));
    expect(report.campaigns[0].lastReminderStep).toBe(2);
    expect(report.campaigns[0].oldestAgeDays).toBe(90);
  });

  it("sends only the latest due step when a backer is first found late", async () => {
    const campaign = await seedCampaign("cancelled");
    await seedPledge(campaign.id, addr(2), userB, "10000000", "refund_available");
    refundable.set(`${campaign.contractCampaignId}:${addr(2)}`, BigInt(10_000_000));

    await service.run({ now: new Date(OPENED.getTime() + 40 * DAY), limit: 1000 });
    const list = await refundNotices(userB);
    expect(list).toHaveLength(1);
    expect(list[0].dedupeKey?.endsWith(":2")).toBe(true);
  });

  it("sends nothing once the refund is claimed (recorded) or on-chain refundable is zero", async () => {
    const claimed = await seedCampaign();
    // The indexer marks the backer's oldest pledge refunded; their other pledge must not trigger a reminder.
    await seedPledge(claimed.id, addr(3), userC, "5000000", "refunded");
    await seedPledge(claimed.id, addr(3), userC, "5000000", "confirmed");
    refundable.set(`${claimed.contractCampaignId}:${addr(3)}`, BigInt(10_000_000));

    const zero = await seedCampaign();
    await seedPledge(zero.id, addr(4), userC, "5000000");
    // refundable() = 0 on-chain (claimed, indexer lagging).

    const result = await service.run({ now: new Date(OPENED.getTime() + DAY), limit: 1000 });
    expect(await refundNotices(userC)).toHaveLength(0);
    expect(result.skipped.notRefundable).toBeGreaterThanOrEqual(1);

    const report = await service.getUnclaimedRefunds(operator, { campaignId: claimed.id });
    expect(report.campaigns).toHaveLength(0);
  });

  it("does not notify or send anything in a dry run, and skips pledges without a resolvable user", async () => {
    const campaign = await seedCampaign();
    await seedPledge(campaign.id, addr(5), null, "7000000");
    refundable.set(`${campaign.contractCampaignId}:${addr(5)}`, BigInt(7_000_000));
    const before = await prisma.notice.count({ where: { category: "refund" } });

    const dry = await service.run({ dryRun: true, now: new Date(OPENED.getTime() + DAY), limit: 1000 });
    expect(dry.dryRun).toBe(true);
    expect(dry.refundable).toBeGreaterThanOrEqual(1);
    expect(dry.skipped.noRecipient).toBeGreaterThanOrEqual(1);
    expect(await prisma.notice.count({ where: { category: "refund" } })).toBe(before);
    expect(Object.keys(refundReminderLogFields(dry)).sort()).toEqual(
      ["dryRun", "failed", "ranAt", "reminded", "refundable", "scanned", "skipped"].sort(),
    );
  });

  it("resolves a user-less pledge through the backer wallet", async () => {
    const campaign = await seedCampaign();
    const wallet = addr(6);
    await prisma.wallet.create({ data: { userId: userA, address: wallet, chainId: 31337 } });
    try {
      await seedPledge(campaign.id, wallet, null, "3000000");
      refundable.set(`${campaign.contractCampaignId}:${wallet}`, BigInt(3_000_000));
      const before = (await refundNotices(userA)).length;
      await service.run({ now: new Date(OPENED.getTime() + DAY), limit: 1000 });
      expect((await refundNotices(userA)).length).toBe(before + 1);
    } finally {
      await prisma.wallet.deleteMany({ where: { userId: userA } });
    }
  });

  it("bounds a run to the batch limit and defers the rest", async () => {
    const campaign = await seedCampaign();
    await seedPledge(campaign.id, addr(7), userC, "1000000");
    await seedPledge(campaign.id, addr(8), userC, "1000000");
    const result = await service.run({ dryRun: true, now: new Date(OPENED.getTime() + DAY), limit: 1 });
    expect(result.skipped.deferred).toBeGreaterThanOrEqual(1);
  });

  it("reports unclaimed totals per campaign to operators only", async () => {
    const campaign = await seedCampaign();
    await seedPledge(campaign.id, addr(1), userA, "2000000");
    await seedPledge(campaign.id, addr(1), userA, "3000000");
    await seedPledge(campaign.id, addr(2), userB, "4000000");
    await seedPledge(campaign.id, addr(9), userC, "9000000", "refunded");
    const other = await seedCampaign("active");
    await seedPledge(other.id, addr(1), userA, "1000000");

    const report = await service.getUnclaimedRefunds(operator, { campaignId: campaign.id }, new Date(OPENED.getTime() + 5 * DAY));
    expect(report.campaigns).toHaveLength(1);
    expect(report.campaigns[0]).toMatchObject({
      campaignId: campaign.id,
      slug: campaign.slug,
      backerCount: 2,
      totalUnclaimedUnits: "9000000",
      oldestAgeDays: 5,
      lastReminderStep: null,
      asset: { symbol: "USDC", decimals: 6 },
    });
    expect((await service.getUnclaimedRefunds(operator, { campaignId: other.id })).campaigns).toHaveLength(0);
    await expect(service.getUnclaimedRefunds({ userId: userA, role: "listener" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("builds the script's service without the Nest container", () => {
    expect(buildRefundReminderService()).toBeInstanceOf(ShowRefundReminderService);
  });
});
