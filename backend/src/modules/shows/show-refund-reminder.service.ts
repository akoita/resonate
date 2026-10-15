import { ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { createPublicClient, formatUnits, http, parseAbiItem, type Address } from "viem";
import { prisma } from "../../db/prisma";
import { NoticeService, type NoticeActor } from "../notifications/notice.service";
import { CHAIN_CONFIGS } from "./shows-escrow-indexer.service";

/**
 * #2149 — remind backers of unclaimed Shows refunds.
 *
 * A failed or cancelled campaign leaves each backer's money in the escrow
 * until they call `claimRefund`. Nothing else tells them, so this finds the
 * (campaign, backer) pairs whose refund is claimable on-chain and not yet
 * claimed and sends a `refund` platform notice (#2146) at a bounded cadence.
 *
 * ## How "claimed" is known
 *
 * `ShowCampaignEscrow.claimRefund` is per backer per campaign: it clears the
 * backer's whole pledged balance. The escrow indexer records `RefundClaimed`
 * by marking the backer's oldest pledge `refunded` (with `refundedAt`), and
 * `POST /shows/pledges/:id/refund/confirm` marks a pledge the same way. So a
 * (campaign, wallet) pair is a candidate only while NONE of its pledges is
 * `refunded`, and its remaining pledges are `confirmed`/`refund_available`.
 * Before notifying, the escrow's `refundable(campaignId, backer)` view is read
 * on-chain; a zero (already claimed, or nothing owed) sends nothing, which also
 * covers the indexer lagging behind a claim.
 *
 * ## Cadence
 *
 * Reminders are due at refunds-open time + {@link REFUND_REMINDER_STEP_DAYS}
 * (0, 7 and 30 days). Each run sends at most ONE notice per backer: the latest
 * due step, keyed `refund_reminder:<pledgeId>:<step>` so a rerun is a no-op
 * (the notice dedupe key, #2146). After the last step the backer is not
 * reminded again. `<pledgeId>` is the backer's oldest open pledge on the
 * campaign, because one claim covers all of their pledges.
 *
 * "Refunds opened at" is `ShowCampaign.refundAvailableAt` (set by the
 * `CampaignFailed`/`RefundAvailable` indexer events and by operator cancel),
 * falling back to `cancelledAt`, then `updatedAt` for campaigns that predate
 * the column.
 */

/** Days after refunds open at which a backer is reminded. */
export const REFUND_REMINDER_STEP_DAYS = [0, 7, 30] as const;
/** Most backers one run checks on-chain / notifies, oldest first. */
export const REFUND_REMINDER_BATCH_LIMIT = 200;
/** Upper bound on pledge rows one run reads (a DB-only, cheap scan). */
const CANDIDATE_SCAN_LIMIT = 5000;
const REFUND_REMINDER_ACTOR: NoticeActor = { userId: "system:show-refund-reminders" };
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_CAMPAIGN_STATUSES = ["refund_available", "cancelled"] as const;
const CLAIMABLE_PLEDGE_STATUSES = ["confirmed", "refund_available"] as const;

export const REFUND_READER = Symbol("SHOW_ESCROW_REFUND_READER");

/** Reads the escrow's `refundable(campaignId, backer)` view. */
export interface EscrowRefundReader {
  refundable(input: {
    chainId: number;
    escrowAddress: string;
    contractCampaignId: string;
    backer: string;
  }): Promise<bigint>;
}

const REFUNDABLE_ABI = [
  parseAbiItem("function refundable(uint256 campaignId, address backer) view returns (uint256)"),
] as const;

export class ViemEscrowRefundReader implements EscrowRefundReader {
  private readonly clients = new Map<number, any>();

  async refundable(input: {
    chainId: number;
    escrowAddress: string;
    contractCampaignId: string;
    backer: string;
  }): Promise<bigint> {
    let client = this.clients.get(input.chainId);
    if (!client) {
      const config = CHAIN_CONFIGS[input.chainId];
      if (!config) throw new Error(`No RPC configuration for chain ${input.chainId}`);
      client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
      this.clients.set(input.chainId, client);
    }
    return (await client.readContract({
      address: input.escrowAddress as Address,
      abi: REFUNDABLE_ABI,
      functionName: "refundable",
      args: [BigInt(input.contractCampaignId), input.backer as Address],
    })) as bigint;
  }
}

export type RefundReminderSkipReason =
  | "alreadyReminded"
  | "notDue"
  | "notRefundable"
  | "noRecipient"
  | "deferred";

export interface RefundReminderRunResult {
  dryRun: boolean;
  ranAt: string;
  scanned: number;
  refundable: number;
  /** Notices created (or, in a dry run, that would be created). */
  reminded: number;
  skipped: Record<RefundReminderSkipReason, number>;
  failed: number;
}

export interface UnclaimedRefundCampaign {
  campaignId: string;
  slug: string;
  title: string;
  artistDisplayName: string;
  city: string;
  status: string;
  asset: { symbol: string; decimals: number };
  backerCount: number;
  /** Sum of the unclaimed backers' pledged units. After an early deposit release the claimable amount is lower (pro rata). */
  totalUnclaimedUnits: string;
  refundsOpenedAt: string;
  oldestAgeDays: number;
  /** Highest reminder step already sent to any backer of this campaign, or null. */
  lastReminderStep: number | null;
}

export interface UnclaimedRefundsReport {
  campaigns: UnclaimedRefundCampaign[];
  generatedAt: string;
}

export function refundReminderDedupeKey(pledgeId: string, step: number) {
  return `refund_reminder:${pledgeId}:${step}`;
}

/** Latest cadence step whose time has come, or null before the first. */
export function latestDueReminderStep(openedAt: Date, now: Date): number | null {
  const elapsedDays = (now.getTime() - openedAt.getTime()) / DAY_MS;
  let due: number | null = null;
  REFUND_REMINDER_STEP_DAYS.forEach((days, step) => {
    if (elapsedDays >= days) due = step;
  });
  return due;
}

type Group = {
  campaign: {
    id: string;
    slug: string;
    title: string;
    artistDisplayName: string;
    city: string;
    status: string;
    paymentAssetSymbol: string;
    paymentAssetDecimals: number;
    chainId: number;
    contractAddress: string;
    contractCampaignId: string;
    openedAt: Date;
  };
  wallet: string;
  /** Oldest open pledge: the stable reminder key. */
  representativePledgeId: string;
  userId: string | null;
  totalUnits: bigint;
};

@Injectable()
export class ShowRefundReminderService {
  private readonly reader: EscrowRefundReader;

  constructor(
    private readonly notices: NoticeService,
    @Optional() @Inject(REFUND_READER) reader?: EscrowRefundReader,
  ) {
    this.reader = reader ?? new ViemEscrowRefundReader();
  }

  async run(
    options: { dryRun?: boolean; now?: Date; limit?: number } = {},
  ): Promise<RefundReminderRunResult> {
    const now = options.now ?? new Date();
    const limit = options.limit ?? REFUND_REMINDER_BATCH_LIMIT;
    const dryRun = options.dryRun ?? false;
    const result: RefundReminderRunResult = {
      dryRun,
      ranAt: now.toISOString(),
      scanned: 0,
      refundable: 0,
      reminded: 0,
      skipped: { alreadyReminded: 0, notDue: 0, notRefundable: 0, noRecipient: 0, deferred: 0 },
      failed: 0,
    };

    const groups = await this.loadUnclaimedGroups(true);
    result.scanned = groups.length;

    // Each backer's latest due step; drop the ones already told for it.
    const withStep = groups.map((group) => ({
      group,
      step: latestDueReminderStep(group.campaign.openedAt, now),
    }));
    result.skipped.notDue = withStep.filter((entry) => entry.step === null).length;
    const due = withStep.filter((entry): entry is { group: Group; step: number } => entry.step !== null);
    const sentKeys = await this.existingDedupeKeys(
      due.map(({ group, step }) => refundReminderDedupeKey(group.representativePledgeId, step)),
    );
    const pending = due.filter(({ group, step }) => {
      const sent = sentKeys.has(refundReminderDedupeKey(group.representativePledgeId, step));
      if (sent) result.skipped.alreadyReminded += 1;
      return !sent;
    });

    pending.sort((a, b) => a.group.campaign.openedAt.getTime() - b.group.campaign.openedAt.getTime());
    result.skipped.deferred = Math.max(0, pending.length - limit);

    for (const { group, step } of pending.slice(0, limit)) {
      try {
        const claimable = await this.reader.refundable({
          chainId: group.campaign.chainId,
          escrowAddress: group.campaign.contractAddress,
          contractCampaignId: group.campaign.contractCampaignId,
          backer: group.wallet,
        });
        if (claimable <= BigInt(0)) {
          result.skipped.notRefundable += 1;
          continue;
        }
        result.refundable += 1;
        const userId = group.userId ?? (await this.userForWallet(group.wallet));
        if (!userId) {
          result.skipped.noRecipient += 1;
          continue;
        }
        if (dryRun) {
          result.reminded += 1;
          continue;
        }
        const sent = await this.notices.sendTargeted(
          {
            userIds: [userId],
            category: "refund",
            title: refundReminderTitle(group.campaign.title),
            body: refundReminderBody(group, claimable),
            link: `/shows/${group.campaign.id}`,
          },
          REFUND_REMINDER_ACTOR,
          { dedupeKey: refundReminderDedupeKey(group.representativePledgeId, step) },
        );
        result.reminded += sent.created;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  /**
   * Operator view: unclaimed refunds per campaign from database state only (no
   * RPC), so it is cheap and may lag a claim the indexer has not seen yet.
   */
  async getUnclaimedRefunds(
    actor: { userId: string; role?: string },
    query: { campaignId?: string } = {},
    now: Date = new Date(),
  ): Promise<UnclaimedRefundsReport> {
    if (!["admin", "operator"].includes(actor.role ?? "")) {
      throw new ForbiddenException("Only operators can read unclaimed refunds");
    }
    const groups = await this.loadUnclaimedGroups(false, query.campaignId);
    const byCampaign = new Map<string, Group[]>();
    for (const group of groups) {
      const list = byCampaign.get(group.campaign.id) ?? [];
      list.push(group);
      byCampaign.set(group.campaign.id, list);
    }

    const keys: string[] = [];
    for (const group of groups) {
      REFUND_REMINDER_STEP_DAYS.forEach((_, step) =>
        keys.push(refundReminderDedupeKey(group.representativePledgeId, step)),
      );
    }
    const sentKeys = await this.existingDedupeKeys(keys);

    const campaigns = [...byCampaign.values()].map((list): UnclaimedRefundCampaign => {
      const campaign = list[0].campaign;
      let lastStep: number | null = null;
      for (const group of list) {
        REFUND_REMINDER_STEP_DAYS.forEach((_, step) => {
          if (sentKeys.has(refundReminderDedupeKey(group.representativePledgeId, step))) {
            lastStep = Math.max(lastStep ?? -1, step);
          }
        });
      }
      const total = list.reduce((sum, group) => sum + group.totalUnits, BigInt(0));
      return {
        campaignId: campaign.id,
        slug: campaign.slug,
        title: campaign.title,
        artistDisplayName: campaign.artistDisplayName,
        city: campaign.city,
        status: campaign.status,
        asset: { symbol: campaign.paymentAssetSymbol, decimals: campaign.paymentAssetDecimals },
        backerCount: list.length,
        totalUnclaimedUnits: total.toString(),
        refundsOpenedAt: campaign.openedAt.toISOString(),
        oldestAgeDays: Math.max(0, Math.floor((now.getTime() - campaign.openedAt.getTime()) / DAY_MS)),
        lastReminderStep: lastStep,
      };
    });
    campaigns.sort((a, b) => a.refundsOpenedAt.localeCompare(b.refundsOpenedAt));
    return { campaigns, generatedAt: now.toISOString() };
  }

  /** Dedupe keys that already have a notice (any recipient). */
  private async existingDedupeKeys(keys: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < keys.length; i += 1000) {
      const rows = await prisma.notice.findMany({
        where: { dedupeKey: { in: keys.slice(i, i + 1000) } },
        select: { dedupeKey: true },
      });
      rows.forEach((row) => row.dedupeKey && found.add(row.dedupeKey));
    }
    return found;
  }

  private async userForWallet(address: string): Promise<string | null> {
    const wallet = await prisma.wallet.findFirst({
      where: { address: { equals: address, mode: "insensitive" } },
      select: { userId: true },
    });
    return wallet?.userId ?? null;
  }

  /**
   * (campaign, backer wallet) pairs on refund-open escrow campaigns where no
   * pledge has been marked refunded yet. `forReminders` additionally requires
   * an RPC configuration for the campaign's chain.
   */
  private async loadUnclaimedGroups(forReminders: boolean, campaignId?: string): Promise<Group[]> {
    const pledges = await prisma.showPledge.findMany({
      where: {
        status: { in: [...CLAIMABLE_PLEDGE_STATUSES, "refunded"] },
        campaign: {
          ...(campaignId ? { id: campaignId } : {}),
          status: { in: [...OPEN_CAMPAIGN_STATUSES] },
          contractAddress: { not: null },
          contractCampaignId: { not: null },
        },
      },
      orderBy: { createdAt: "asc" },
      take: CANDIDATE_SCAN_LIMIT,
      select: {
        id: true,
        userId: true,
        walletAddress: true,
        amountUnits: true,
        status: true,
        campaign: {
          select: {
            id: true,
            slug: true,
            title: true,
            artistDisplayName: true,
            city: true,
            status: true,
            paymentAssetSymbol: true,
            paymentAssetDecimals: true,
            chainId: true,
            contractAddress: true,
            contractCampaignId: true,
            refundAvailableAt: true,
            cancelledAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const groups = new Map<string, Group>();
    const claimed = new Set<string>();
    for (const pledge of pledges) {
      const campaign = pledge.campaign;
      const key = `${campaign.id}:${pledge.walletAddress.toLowerCase()}`;
      if (pledge.status === "refunded") {
        claimed.add(key);
        continue;
      }
      const existing = groups.get(key);
      if (existing) {
        existing.totalUnits += BigInt(pledge.amountUnits);
        existing.userId = existing.userId ?? pledge.userId;
        continue;
      }
      groups.set(key, {
        campaign: {
          id: campaign.id,
          slug: campaign.slug,
          title: campaign.title,
          artistDisplayName: campaign.artistDisplayName,
          city: campaign.city,
          status: campaign.status,
          paymentAssetSymbol: campaign.paymentAssetSymbol,
          paymentAssetDecimals: campaign.paymentAssetDecimals,
          chainId: campaign.chainId,
          contractAddress: campaign.contractAddress!,
          contractCampaignId: campaign.contractCampaignId!,
          openedAt: campaign.refundAvailableAt ?? campaign.cancelledAt ?? campaign.updatedAt,
        },
        wallet: pledge.walletAddress.toLowerCase(),
        representativePledgeId: pledge.id,
        userId: pledge.userId,
        totalUnits: BigInt(pledge.amountUnits),
      });
    }
    return [...groups.entries()]
      .filter(([key]) => !claimed.has(key))
      .map(([, group]) => group)
      .filter((group) => !forReminders || Boolean(CHAIN_CONFIGS[group.campaign.chainId]));
  }
}

/** Notice titles are capped at 120 characters; campaign titles are free text. */
function refundReminderTitle(campaignTitle: string) {
  const title = `Refund ready to claim: ${campaignTitle}`;
  return title.length <= 120 ? title : `${title.slice(0, 117)}...`;
}

function refundReminderBody(group: Group, claimable: bigint) {
  const { campaign } = group;
  const amount = `${formatUnits(claimable, campaign.paymentAssetDecimals)} ${campaign.paymentAssetSymbol}`;
  return (
    `The campaign "${campaign.title}" by ${campaign.artistDisplayName} in ${campaign.city} will not go ahead, ` +
    `and ${amount} of your pledge can be refunded to your wallet. ` +
    "Refunds carry no fee. Open the campaign page and use the claim button to get your refund back."
  );
}
