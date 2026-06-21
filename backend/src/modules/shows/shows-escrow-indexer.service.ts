import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  createPublicClient,
  http,
  parseAbiItem,
  decodeEventLog,
  type Log,
  type Address,
} from "viem";
import { foundry, sepolia, baseSepolia } from "viem/chains";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { resolveIndexerChainId } from "../contracts/indexer.service";
import { configuredShowCampaignEscrowAddress } from "./shows.service";

/**
 * ShowCampaignEscrow event indexer + on-chain reconciliation (#948).
 *
 * Campaign state cannot trust client-submitted transaction hashes. This poller
 * reads `ShowCampaignEscrow` logs, records them idempotently
 * (`ShowCampaignEscrowEvent` unique on `(txHash, logIndex)`), and reconciles
 * campaign status/accounting and pledge confirmation from on-chain truth. It
 * mirrors the marketplace IndexerService pattern (per-chain block cursor,
 * batch polling, reorg jump-back) but keeps a separate cursor so the two
 * pollers advance independently.
 *
 * Disabled unless `ENABLE_SHOWS_ESCROW_INDEXER=true`.
 *
 * Single-writer by design (Cloud Run minScale=1, in-process `isIndexing` guard):
 * per-event reconciliation runs in one transaction and the read-modify-write of
 * campaign `*Units` totals assumes no concurrent writer. Scaling the indexer to
 * multiple instances would require advisory locking or atomic increments.
 */

const ESCROW_EVENTS = [
  parseAbiItem(
    "event CampaignCreated(uint256 indexed campaignId, bytes32 indexed artistIdHash, bytes32 indexed authorityHash, address beneficiary, address paymentToken, uint256 goalAmount, uint256 minimumBackers, uint256 deadline, uint256 bookingDeadline)",
  ),
  parseAbiItem("event CampaignActivated(uint256 indexed campaignId)"),
  parseAbiItem(
    "event Pledged(uint256 indexed campaignId, address indexed backer, uint256 amount, uint256 totalPledged)",
  ),
  parseAbiItem(
    "event CampaignFunded(uint256 indexed campaignId, uint256 totalPledged, uint256 uniqueBackers)",
  ),
  parseAbiItem("event CampaignFailed(uint256 indexed campaignId)"),
  parseAbiItem("event CampaignCancelled(uint256 indexed campaignId)"),
  parseAbiItem(
    "event BookingConfirmed(uint256 indexed campaignId, address indexed confirmer)",
  ),
  parseAbiItem("event RefundAvailable(uint256 indexed campaignId)"),
  parseAbiItem(
    "event RefundClaimed(uint256 indexed campaignId, address indexed backer, uint256 amount)",
  ),
  parseAbiItem(
    "event DepositReleased(uint256 indexed campaignId, address indexed beneficiary, uint256 amount)",
  ),
  parseAbiItem(
    "event FulfillmentConfirmed(uint256 indexed campaignId, address indexed confirmer)",
  ),
  parseAbiItem(
    "event FundsReleased(uint256 indexed campaignId, address indexed beneficiary, uint256 amount)",
  ),
  parseAbiItem(
    "event AuthorityUpdated(uint256 indexed campaignId, bytes32 indexed authorityHash, address beneficiary)",
  ),
  parseAbiItem("event CampaignPaused(bool paused)"),
  parseAbiItem(
    "event ConfirmerUpdated(address indexed confirmer, bool allowed)",
  ),
] as const;

const RPC_OVERRIDE = process.env.RPC_URL || "";
const CHAIN_CONFIGS: Record<number, { chain: any; rpcUrl: string }> = {
  31337: {
    chain: foundry,
    rpcUrl: RPC_OVERRIDE || process.env.LOCAL_RPC_URL || "http://localhost:8545",
  },
  11155111: {
    chain: sepolia,
    rpcUrl:
      RPC_OVERRIDE ||
      process.env.SEPOLIA_RPC_URL ||
      "https://sepolia.drpc.org",
  },
  84532: {
    chain: baseSepolia,
    rpcUrl: RPC_OVERRIDE || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  },
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type MismatchInput = {
  chainId?: number;
  contractCampaignId: string;
  transactionHash: string;
  blockNumber: bigint;
  reason: string;
  eventName: string;
};

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeArgs(value: unknown): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeArgs);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeArgs(v);
    return out;
  }
  return value;
}

function addUnits(current: string | null | undefined, delta: string): string {
  const base = (() => {
    try {
      return BigInt(current ?? "0");
    } catch {
      return 0n;
    }
  })();
  return (base + BigInt(delta)).toString();
}

@Injectable()
export class ShowsEscrowIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShowsEscrowIndexerService.name);
  private interval: NodeJS.Timeout | null = null;
  private isIndexing = false;
  private readonly pollIntervalMs = parsePositiveIntegerEnv(
    "SHOWS_ESCROW_INDEXER_POLL_INTERVAL_MS",
    5000,
  );
  private readonly blocksPerBatch = parsePositiveIntegerEnv(
    "SHOWS_ESCROW_BLOCKS_PER_BATCH",
    1000,
  );
  private readonly maxBatchesPerCycle = parsePositiveIntegerEnv(
    "SHOWS_ESCROW_MAX_BATCHES_PER_CYCLE",
    20,
  );
  private clientCache = new Map<number, any>();

  constructor(private readonly eventBus: EventBus) {}

  private getClient(chainId: number) {
    let client = this.clientCache.get(chainId);
    if (!client) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) return null;
      client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
      this.clientCache.set(chainId, client);
    }
    return client;
  }

  async onModuleInit() {
    if (process.env.ENABLE_SHOWS_ESCROW_INDEXER !== "true") {
      this.logger.log(
        "Shows escrow indexer disabled (set ENABLE_SHOWS_ESCROW_INDEXER=true to enable)",
      );
      return;
    }
    this.logger.log(
      `Starting Shows escrow indexer (poll=${this.pollIntervalMs}ms, blocksPerBatch=${this.blocksPerBatch})`,
    );
    await this.runIndexCycle();
    this.interval = setInterval(() => {
      if (!this.isIndexing) void this.runIndexCycle();
    }, this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** One poll cycle: advance the cursor and reconcile new escrow logs. */
  async runIndexCycle() {
    this.isIndexing = true;
    try {
      const chainId = resolveIndexerChainId();
      const escrowAddress = configuredShowCampaignEscrowAddress(chainId);
      if (!escrowAddress) {
        this.logger.debug(
          `No ShowCampaignEscrow address configured for chain ${chainId}; skipping`,
        );
        return;
      }
      const client = this.getClient(chainId);
      if (!client) {
        this.logger.warn(`No RPC client for chain ${chainId}`);
        return;
      }

      let state = await prisma.showEscrowIndexerState.findUnique({ where: { chainId } });
      const currentBlock: bigint = await client.getBlockNumber();
      if (!state) {
        const startBlock = currentBlock > 100n ? currentBlock - 100n : 0n;
        state = await prisma.showEscrowIndexerState.create({
          data: { chainId, contractAddress: escrowAddress, lastBlockNumber: startBlock },
        });
        this.logger.log(`First run: escrow indexer starting at block ${startBlock}`);
      }

      let fromBlock = state.lastBlockNumber + 1n;
      if (fromBlock > currentBlock) {
        if (currentBlock === 0n) return;
        const gap = state.lastBlockNumber - currentBlock;
        if (gap > 10n) {
          // Chain reset (e.g. Anvil restarted): jump near tip and reprocess.
          const safeBlock = currentBlock > 50n ? currentBlock - 50n : 0n;
          this.logger.warn(
            `Chain reset detected (last ${state.lastBlockNumber} >> current ${currentBlock}); resetting to ${safeBlock}`,
          );
          await prisma.showEscrowIndexerState.update({
            where: { chainId },
            data: { lastBlockNumber: safeBlock, contractAddress: escrowAddress },
          });
        } else {
          // Caught up: heartbeat the cursor row.
          await prisma.showEscrowIndexerState.update({
            where: { chainId },
            data: { lastBlockNumber: state.lastBlockNumber, contractAddress: escrowAddress },
          });
        }
        return;
      }

      let batches = 0;
      while (fromBlock <= currentBlock && batches < this.maxBatchesPerCycle) {
        const toBlock = fromBlock + BigInt(this.blocksPerBatch) - 1n;
        const effectiveToBlock = toBlock > currentBlock ? currentBlock : toBlock;
        const logs = await client.getLogs({
          address: escrowAddress as Address,
          fromBlock,
          toBlock: effectiveToBlock,
        });
        // Deterministic order so status transitions apply chronologically.
        logs.sort((a: Log, b: Log) =>
          a.blockNumber === b.blockNumber
            ? (a.logIndex ?? 0) - (b.logIndex ?? 0)
            : Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)),
        );
        for (const log of logs) {
          await this.processLog(log, chainId, escrowAddress);
        }
        await prisma.showEscrowIndexerState.update({
          where: { chainId },
          data: { lastBlockNumber: effectiveToBlock, contractAddress: escrowAddress },
        });
        fromBlock = effectiveToBlock + 1n;
        batches++;
      }
    } catch (error) {
      this.logger.error(
        `Escrow indexing error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Decode + persist + reconcile one log atomically (#948 review hardening).
   *
   * The event row, all reconciliation writes, and the processedAt stamp commit
   * in ONE transaction: a reconcile failure rolls back the row too, so the
   * event is retried cleanly on the next cycle (no permanently-dropped payment
   * state, no half-applied accounting). The skip guard consults processedAt, so
   * a row left unprocessed by a legacy/partial run is re-attempted. Mismatch
   * domain events are collected and published only after the tx commits.
   */
  async processLog(log: Log, chainId: number, escrowAddress: string) {
    const { transactionHash, logIndex, blockNumber, blockHash } = log;
    if (transactionHash == null || logIndex == null) return;

    const existing = await prisma.showCampaignEscrowEvent.findUnique({
      where: { transactionHash_logIndex: { transactionHash, logIndex } },
      select: { processedAt: true },
    });
    if (existing?.processedAt) return; // idempotent: already fully reconciled

    const decoded = this.decode(log);
    if (!decoded) return;
    const { eventName, args } = decoded;
    const contractCampaignId =
      args.campaignId !== undefined ? String(args.campaignId) : null;
    const ctx = {
      chainId,
      escrowAddress,
      transactionHash,
      blockNumber: blockNumber ?? 0n,
    };
    const mismatches: MismatchInput[] = [];

    try {
      await prisma.$transaction(async (tx) => {
        // Upsert tolerates a row left over from an earlier rolled-back/legacy run.
        await tx.showCampaignEscrowEvent.upsert({
          where: { transactionHash_logIndex: { transactionHash, logIndex } },
          create: {
            chainId,
            contractAddress: escrowAddress,
            eventName,
            contractCampaignId,
            transactionHash,
            logIndex,
            blockNumber: blockNumber ?? 0n,
            blockHash: blockHash ?? "",
            args: sanitizeArgs(args),
          },
          update: {},
        });

        await this.reconcile(tx, eventName, args, ctx, (m) => mismatches.push(m));

        await tx.showCampaignEscrowEvent.update({
          where: { transactionHash_logIndex: { transactionHash, logIndex } },
          data: { processedAt: new Date() },
        });
      });
      // Side effects only after the durable state committed.
      for (const m of mismatches) this.emitMismatch(m);
    } catch (error) {
      this.logger.error(
        `Reconcile failed for ${eventName} (campaign ${contractCampaignId}); will retry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private decode(log: Log): { eventName: string; args: any } | null {
    for (const abiItem of ESCROW_EVENTS) {
      try {
        const out = decodeEventLog({ abi: [abiItem], data: log.data, topics: log.topics });
        return { eventName: (abiItem as any).name as string, args: out.args as any };
      } catch {
        continue;
      }
    }
    return null;
  }

  private async reconcile(
    tx: Prisma.TransactionClient,
    eventName: string,
    args: any,
    ctx: {
      chainId: number;
      escrowAddress: string;
      transactionHash: string;
      blockNumber: bigint;
    },
    pushMismatch: (m: MismatchInput) => void,
  ): Promise<void> {
    // Contract-only events with no campaign mapping: recorded, not reconciled.
    if (eventName === "CampaignPaused" || eventName === "ConfirmerUpdated") {
      return;
    }

    const contractCampaignId = String(args.campaignId);
    // Bind strictly to (chainId, escrow address, campaignId). fail-closed if the
    // triple is ambiguous so events can't mutate the wrong campaign (review #2).
    const matches = await tx.showCampaign.findMany({
      where: {
        chainId: ctx.chainId,
        contractAddress: { equals: ctx.escrowAddress, mode: "insensitive" },
        contractCampaignId,
      },
      select: {
        id: true,
        status: true,
        totalRefundedUnits: true,
        totalReleasedUnits: true,
      },
      take: 2,
    });

    if (matches.length === 0) {
      pushMismatch({
        ...ctx,
        contractCampaignId,
        reason: `no backend campaign bound to escrow campaign ${contractCampaignId}`,
        eventName,
      });
      return;
    }
    if (matches.length > 1) {
      pushMismatch({
        ...ctx,
        contractCampaignId,
        reason: `multiple backend campaigns bound to escrow campaign ${contractCampaignId}`,
        eventName,
      });
      return;
    }
    const campaign = matches[0];

    const data: Record<string, unknown> = {
      lastEscrowIndexedBlock: ctx.blockNumber,
    };
    let eventType:
      | "campaign_activated"
      | "campaign_funded"
      | "booking_confirmed"
      | "deposit_released"
      | "fulfillment_confirmed"
      | "refund_available"
      | "campaign_released"
      | "campaign_cancelled"
      | null = null;

    switch (eventName) {
      case "CampaignCreated":
        data.onChainStatus = "Draft";
        break;
      case "CampaignActivated":
        data.onChainStatus = "Active";
        if (campaign.status === "draft") data.status = "active";
        eventType = "campaign_activated";
        break;
      case "Pledged":
        // Ignore a late/reordered pledge on a terminal campaign (review M2).
        if (campaign.status === "cancelled" || campaign.status === "refunded") {
          break;
        }
        // Authoritative cumulative total from chain; confirm the matching pledge.
        data.raisedAmountUnits = String(args.totalPledged);
        await this.confirmPledgeFromChain(tx, campaign.id, args, ctx, pushMismatch);
        break;
      case "CampaignFunded":
        data.onChainStatus = "Funded";
        data.raisedAmountUnits = String(args.totalPledged);
        data.uniqueBackerCount = Number(args.uniqueBackers);
        if (this.canAdvance(campaign.status, "funded")) data.status = "funded";
        data.fundedAt = new Date();
        eventType = "campaign_funded";
        break;
      case "CampaignFailed":
        data.onChainStatus = "RefundAvailable";
        if (this.canAdvance(campaign.status, "refund_available"))
          data.status = "refund_available";
        data.refundAvailableAt = new Date();
        eventType = "refund_available";
        break;
      case "CampaignCancelled":
        data.onChainStatus = "Cancelled";
        data.status = "cancelled";
        data.cancelledAt = new Date();
        eventType = "campaign_cancelled";
        break;
      case "BookingConfirmed":
        data.onChainStatus = "BookingConfirmed";
        if (this.canAdvance(campaign.status, "booking_confirmed"))
          data.status = "booking_confirmed";
        data.bookingConfirmedAt = new Date();
        eventType = "booking_confirmed";
        break;
      case "RefundAvailable":
        data.onChainStatus = "RefundAvailable";
        if (this.canAdvance(campaign.status, "refund_available"))
          data.status = "refund_available";
        data.refundAvailableAt = new Date();
        eventType = "refund_available";
        break;
      case "RefundClaimed":
        await this.markPledgeRefunded(tx, campaign.id, args, ctx);
        // Snapshot read from the same tx; the once-only (txHash,logIndex) guard
        // makes this read-modify-write safe under the single-writer indexer.
        data.totalRefundedUnits = addUnits(campaign.totalRefundedUnits, String(args.amount));
        break;
      case "DepositReleased":
        data.onChainStatus = "DepositReleased";
        if (this.canAdvance(campaign.status, "deposit_released"))
          data.status = "deposit_released";
        data.depositReleasedAt = new Date();
        data.totalReleasedUnits = addUnits(campaign.totalReleasedUnits, String(args.amount));
        eventType = "deposit_released";
        break;
      case "FulfillmentConfirmed":
        data.onChainStatus = "Fulfilled";
        if (this.canAdvance(campaign.status, "fulfilled")) data.status = "fulfilled";
        data.fulfilledAt = new Date();
        eventType = "fulfillment_confirmed";
        break;
      case "FundsReleased":
        data.onChainStatus = "Released";
        if (this.canAdvance(campaign.status, "released")) data.status = "released";
        data.releasedAt = new Date();
        data.totalReleasedUnits = addUnits(campaign.totalReleasedUnits, String(args.amount));
        eventType = "campaign_released";
        break;
      case "AuthorityUpdated":
        if (args.beneficiary && args.beneficiary !== ZERO_ADDRESS) {
          data.beneficiaryAddress = String(args.beneficiary);
        }
        break;
      default:
        return;
    }

    // Clear any prior drift flag on a successful reconcile.
    data.reconciliationError = null;
    data.reconciliationErrorAt = null;

    await tx.showCampaign.update({ where: { id: campaign.id }, data });

    // Recompute backer counts from confirmed pledges (authoritative DB view).
    await this.recomputeBackerCounts(tx, campaign.id);

    if (eventType) {
      await tx.showCampaignEvent.create({
        data: {
          campaignId: campaign.id,
          eventType,
          previousStatus: campaign.status,
          nextStatus: (data.status as string) ?? campaign.status,
          transactionHash: ctx.transactionHash,
          blockNumber: ctx.blockNumber,
          metadata: { source: "escrow-indexer", onChainStatus: data.onChainStatus ?? null },
        },
      });
    }
  }

  /** Confirm a backer's pledge from an on-chain Pledged event (not client claim). */
  private async confirmPledgeFromChain(
    tx: Prisma.TransactionClient,
    campaignId: string,
    args: any,
    ctx: { transactionHash: string; blockNumber: bigint },
    pushMismatch: (m: MismatchInput) => void,
  ): Promise<void> {
    const backer = String(args.backer).toLowerCase();
    const amount = String(args.amount);
    // Match on (backer, exact amount): never confirm a different-amount intent
    // against this on-chain pledge (review M1). No match → drift, not a guess.
    const pledge = await tx.showPledge.findFirst({
      where: {
        campaignId,
        walletAddress: { equals: backer, mode: "insensitive" },
        amountUnits: amount,
        status: { in: ["intent_created", "submitted"] },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!pledge) {
      // A pledge happened on chain without a matching backend intent.
      pushMismatch({
        contractCampaignId: String(args.campaignId),
        transactionHash: ctx.transactionHash,
        blockNumber: ctx.blockNumber,
        reason: `on-chain pledge from ${backer} (${amount}) has no matching backend intent`,
        eventName: "Pledged",
      });
      return;
    }
    const now = new Date();
    await tx.showPledge.update({
      where: { id: pledge.id },
      data: {
        status: "confirmed",
        confirmationStatus: "confirmed",
        transactionHash: ctx.transactionHash,
        blockNumber: ctx.blockNumber,
        confirmedAt: now,
        submittedAt: pledge.submittedAt ?? now,
        receipt: { ...((pledge.receipt as object) ?? {}), onChainAmountUnits: amount },
        events: {
          create: {
            campaignId,
            eventType: "pledge_confirmed",
            actorWalletAddress: backer,
            previousStatus: pledge.status,
            nextStatus: "confirmed",
            transactionHash: ctx.transactionHash,
            blockNumber: ctx.blockNumber,
            metadata: { source: "escrow-indexer", onChainAmountUnits: amount },
          },
        },
      },
    });
  }

  private async markPledgeRefunded(
    tx: Prisma.TransactionClient,
    campaignId: string,
    args: any,
    ctx: { transactionHash: string; blockNumber: bigint },
  ): Promise<void> {
    const backer = String(args.backer).toLowerCase();
    const pledge = await tx.showPledge.findFirst({
      where: {
        campaignId,
        walletAddress: { equals: backer, mode: "insensitive" },
        status: { in: ["confirmed", "refund_available"] },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!pledge) return;
    const now = new Date();
    await tx.showPledge.update({
      where: { id: pledge.id },
      data: {
        status: "refunded",
        refundedAt: now,
        events: {
          create: {
            campaignId,
            eventType: "pledge_refunded",
            actorWalletAddress: backer,
            previousStatus: pledge.status,
            nextStatus: "refunded",
            transactionHash: ctx.transactionHash,
            blockNumber: ctx.blockNumber,
            metadata: { source: "escrow-indexer" },
          },
        },
      },
    });
  }

  private async recomputeBackerCounts(
    tx: Prisma.TransactionClient,
    campaignId: string,
  ): Promise<void> {
    const confirmed = await tx.showPledge.findMany({
      where: { campaignId, status: { in: ["confirmed", "released"] } },
      select: { walletAddress: true },
    });
    const uniqueWallets = new Set(confirmed.map((p) => p.walletAddress.toLowerCase()));
    await tx.showCampaign.update({
      where: { id: campaignId },
      data: {
        confirmedPledgeCount: confirmed.length,
        uniqueBackerCount: uniqueWallets.size,
      },
    });
  }

  /** Status forward-only guard: never regress past a terminal/later state. */
  private canAdvance(current: string, next: string): boolean {
    const rank: Record<string, number> = {
      draft: 0,
      active: 1,
      funded: 2,
      booking_confirmed: 3,
      deposit_released: 4,
      fulfilled: 5,
      released: 6,
    };
    // cancelled/refund_available are handled explicitly by their events.
    if (current === "cancelled" || current === "refunded") return false;
    const c = rank[current];
    const n = rank[next];
    if (c === undefined || n === undefined) return true;
    return n > c;
  }

  private emitMismatch(input: MismatchInput): void {
    this.logger.warn(
      `Reconciliation mismatch (${input.eventName}, campaign ${input.contractCampaignId}): ${input.reason}`,
    );
    this.eventBus.publish({
      eventName: "shows.campaign_reconciliation_mismatch",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      contractCampaignId: input.contractCampaignId,
      escrowEventName: input.eventName,
      transactionHash: input.transactionHash,
      blockNumber: input.blockNumber.toString(),
      reason: input.reason,
    });
  }
}
