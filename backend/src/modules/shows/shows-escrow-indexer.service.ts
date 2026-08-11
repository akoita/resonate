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
import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma";
import type { ShowCampaignSettledEvent } from "../../events/event_types";
import { EventBus } from "../shared/event_bus";
import { writeStructuredLog } from "../shared/structured_logging";
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
 * A database-backed, fenced lease elects one writer independently for each
 * `(chainId, escrow address)` target. Expired holders can be replaced without
 * allowing their stale work to mutate reconciliation state or advance cursors.
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
    "event FeeCharged(uint256 indexed campaignId, address indexed feeRecipient, uint256 amount)",
  ),
  parseAbiItem("event FeeConfigUpdated(uint256 feeBps, address feeRecipient)"),
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
    rpcUrl:
      RPC_OVERRIDE || process.env.LOCAL_RPC_URL || "http://localhost:8545",
  },
  11155111: {
    chain: sepolia,
    rpcUrl:
      RPC_OVERRIDE || process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org",
  },
  84532: {
    chain: baseSepolia,
    rpcUrl:
      RPC_OVERRIDE ||
      process.env.BASE_SEPOLIA_RPC_URL ||
      "https://sepolia.base.org",
  },
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type EscrowIndexerTarget = { address: string; deploymentBlock: bigint | null };

const SHOW_ESCROW_INDEXER_TARGET_ENVS: Record<number, string[]> = {
  31337: ["SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS"],
  11155111: [
    "SEPOLIA_SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS",
    "SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS",
  ],
  84532: [
    "BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS",
    "SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS",
  ],
  421614: [
    "ARBITRUM_SEPOLIA_SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS",
    "SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS",
  ],
};

const SHOW_ESCROW_DEPLOYMENT_BLOCK_ENVS: Record<number, string[]> = {
  31337: ["SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK"],
  11155111: [
    "SEPOLIA_SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK",
    "SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK",
  ],
  84532: [
    "BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK",
    "SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK",
  ],
  421614: [
    "ARBITRUM_SEPOLIA_SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK",
    "SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK",
  ],
};

function firstConfiguredEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function parseDeploymentBlock(raw: string | null): bigint | null {
  if (raw === null) return null;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(
      `Invalid Shows escrow deployment block "${raw}"; expected an unsigned integer`,
    );
  }
  return BigInt(raw);
}

/**
 * Index targets are independent from the single current escrow used for new
 * campaigns. During a cutover this lets the backend keep reconciling unsettled
 * campaigns on legacy escrows while indexing the replacement from its exact
 * deployment block.
 *
 * Format: `0xaddress:deploymentBlock,0xaddress:deploymentBlock`.
 */
export function configuredShowEscrowIndexerTargets(
  chainId: number,
): EscrowIndexerTarget[] {
  const targetKeys = SHOW_ESCROW_INDEXER_TARGET_ENVS[chainId] ?? [
    "SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS",
  ];
  const rawTargets = firstConfiguredEnv(targetKeys);
  const seen = new Map<string, bigint>();
  const targets: EscrowIndexerTarget[] = [];

  if (rawTargets) {
    for (const entry of rawTargets.split(",")) {
      const [rawAddress, rawBlock, ...extra] = entry.trim().split(":");
      const address = rawAddress?.toLowerCase();
      if (
        extra.length > 0 ||
        !address ||
        !/^0x[0-9a-f]{40}$/.test(address) ||
        address === ZERO_ADDRESS ||
        !rawBlock ||
        !/^[0-9]+$/.test(rawBlock)
      ) {
        throw new Error(
          `Invalid Shows escrow indexer target "${entry.trim()}"; expected 0xaddress:deploymentBlock`,
        );
      }
      const deploymentBlock = BigInt(rawBlock);
      const priorBlock = seen.get(address);
      if (priorBlock !== undefined) {
        if (priorBlock !== deploymentBlock) {
          throw new Error(
            `Conflicting deployment blocks configured for Shows escrow ${address}`,
          );
        }
        continue;
      }
      seen.set(address, deploymentBlock);
      targets.push({ address, deploymentBlock });
    }
    const currentAddress =
      configuredShowCampaignEscrowAddress(chainId)?.toLowerCase();
    if (currentAddress && !seen.has(currentAddress)) {
      throw new Error(
        `Current Shows escrow ${currentAddress} is missing from the configured indexer targets`,
      );
    }
    return targets;
  }

  const currentAddress = configuredShowCampaignEscrowAddress(chainId);
  if (!currentAddress) return [];
  const deploymentBlockKeys = SHOW_ESCROW_DEPLOYMENT_BLOCK_ENVS[chainId] ?? [
    "SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK",
  ];
  return [
    {
      address: currentAddress.toLowerCase(),
      deploymentBlock: parseDeploymentBlock(
        firstConfiguredEnv(deploymentBlockKeys),
      ),
    },
  ];
}

type MismatchInput = {
  chainId: number;
  contractAddress: string;
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

class ShowsEscrowLeaseLostError extends Error {
  constructor() {
    super("Shows escrow indexer lease lost");
    this.name = "ShowsEscrowLeaseLostError";
  }
}

type Lease = {
  stateId: string;
  epoch: bigint;
  chainId: number;
  contractAddress: string;
};

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

function addUnitBigInt(
  current: string | null | undefined,
  delta: bigint,
): string {
  return addUnits(current, delta.toString());
}

function inferFeeBps(feeAmount: bigint, grossAmount: bigint): number | null {
  if (feeAmount <= 0n || grossAmount <= 0n) return null;
  const bps = (feeAmount * 10000n) / grossAmount;
  return bps <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bps) : null;
}

@Injectable()
export class ShowsEscrowIndexerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ShowsEscrowIndexerService.name);
  private interval: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private readonly leaseOwnerId = randomUUID();
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
  private readonly leaseTtlMs = this.resolveLeaseTtlMs();
  private clientCache = new Map<number, any>();

  constructor(private readonly eventBus: EventBus) {}

  private resolveLeaseTtlMs(): number {
    const fallback = Math.max(30_000, this.pollIntervalMs * 3);
    const raw = process.env.SHOWS_ESCROW_LEASE_TTL_MS;
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < 5_000 || value > 300_000) {
      throw new Error(
        "SHOWS_ESCROW_LEASE_TTL_MS must be an integer from 5000 to 300000",
      );
    }
    if (raw && value <= this.pollIntervalMs * 2) {
      throw new Error(
        "SHOWS_ESCROW_LEASE_TTL_MS must be greater than twice the poll interval",
      );
    }
    return value;
  }

  private getClient(chainId: number) {
    let client = this.clientCache.get(chainId);
    if (!client) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) return null;
      client = createPublicClient({
        chain: config.chain,
        transport: http(config.rpcUrl),
      });
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
      void this.runIndexCycle();
    }, this.pollIntervalMs);
  }

  async onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    await this.activeCycle;
    const owned = await prisma.showEscrowIndexerState.findMany({
      where: { leaseOwnerId: this.leaseOwnerId },
      select: {
        id: true,
        chainId: true,
        contractAddress: true,
        leaseEpoch: true,
      },
    });
    for (const lease of owned) {
      const released = await prisma.showEscrowIndexerState.updateMany({
        where: {
          id: lease.id,
          leaseOwnerId: this.leaseOwnerId,
          leaseEpoch: lease.leaseEpoch,
        },
        data: {
          leaseOwnerId: null,
          leaseExpiresAt: null,
          leaseHeartbeatAt: null,
        },
      });
      if (released.count === 1) {
        writeStructuredLog({
          level: "info",
          event: "shows.escrow_indexer.lease_released",
          message: "Shows escrow indexer lease released",
          chainId: lease.chainId,
          contractAddress: lease.contractAddress,
          ownerId: this.leaseOwnerId,
          leaseEpoch: lease.leaseEpoch.toString(),
        });
      }
    }
  }

  /** One poll cycle: advance the cursor and reconcile new escrow logs. */
  runIndexCycle(): Promise<void> {
    if (this.activeCycle) return this.activeCycle;
    const cycle = this.runIndexCycleInner();
    const tracked = cycle.finally(() => {
      if (this.activeCycle === tracked) this.activeCycle = null;
    });
    this.activeCycle = tracked;
    return tracked;
  }

  private async runIndexCycleInner(): Promise<void> {
    try {
      const chainId = resolveIndexerChainId();
      const targets = configuredShowEscrowIndexerTargets(chainId);
      if (targets.length === 0) {
        this.logger.debug(
          `No ShowCampaignEscrow index targets configured for chain ${chainId}; skipping`,
        );
        return;
      }
      const client = this.getClient(chainId);
      if (!client) {
        this.logger.warn(`No RPC client for chain ${chainId}`);
        return;
      }

      const currentBlock: bigint = await client.getBlockNumber();
      for (const target of targets) {
        try {
          await this.indexTarget(client, chainId, target, currentBlock);
        } catch (error) {
          this.logger.error(
            `Escrow indexing error for ${target.address}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Escrow indexing error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async acquireLease(
    stateId: string,
    chainId: number,
    contractAddress: string,
  ): Promise<Lease | null> {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        leaseEpoch: bigint;
        leaseExpiresAt: Date;
        previousOwner: string | null;
        previousExpiry: Date | null;
        previousEpoch: bigint;
      }>
    >(Prisma.sql`
      WITH previous AS (
        SELECT id, "leaseOwnerId", "leaseExpiresAt", "leaseEpoch" FROM "ShowEscrowIndexerState"
        WHERE id = ${stateId} FOR UPDATE
      )
      UPDATE "ShowEscrowIndexerState" AS state
      SET "leaseOwnerId" = ${this.leaseOwnerId},
          "leaseEpoch" = CASE WHEN state."leaseOwnerId" = ${this.leaseOwnerId} THEN state."leaseEpoch" ELSE state."leaseEpoch" + 1 END,
          "leaseHeartbeatAt" = NOW(),
          "leaseExpiresAt" = NOW() + (${this.leaseTtlMs} * INTERVAL '1 millisecond'),
          "updatedAt" = NOW()
      FROM previous
      WHERE state.id = previous.id
        AND (state."leaseOwnerId" IS NULL OR state."leaseOwnerId" = ${this.leaseOwnerId} OR state."leaseExpiresAt" <= NOW())
      RETURNING state.id, state."leaseEpoch", state."leaseExpiresAt", previous."leaseOwnerId" AS "previousOwner",
        previous."leaseExpiresAt" AS "previousExpiry", previous."leaseEpoch" AS "previousEpoch"
    `);
    const row = rows[0];
    if (!row) return null;
    const takeover =
      row.previousOwner !== null && row.previousOwner !== this.leaseOwnerId;
    if (row.previousOwner !== this.leaseOwnerId) {
      writeStructuredLog({
        level: takeover ? "warn" : "info",
        event: takeover
          ? "shows.escrow_indexer.lease_takeover"
          : "shows.escrow_indexer.lease_acquired",
        message: takeover
          ? "Shows escrow indexer lease taken over after expiry"
          : "Shows escrow indexer lease acquired",
        chainId,
        contractAddress,
        ownerId: this.leaseOwnerId,
        previousOwnerId: row.previousOwner,
        previousLeaseExpiredAt: row.previousExpiry?.toISOString() ?? null,
        previousLeaseEpoch: takeover ? row.previousEpoch.toString() : null,
        leaseEpoch: row.leaseEpoch.toString(),
        leaseExpiresAt: row.leaseExpiresAt.toISOString(),
        leaseTtlMs: this.leaseTtlMs,
      });
    }
    return { stateId: row.id, epoch: row.leaseEpoch, chainId, contractAddress };
  }

  private async fenceCursor(
    lease: Lease,
    lastBlockNumber: bigint,
  ): Promise<void> {
    const count = await prisma.$executeRaw(Prisma.sql`
      UPDATE "ShowEscrowIndexerState"
      SET "lastBlockNumber" = ${lastBlockNumber}, "leaseHeartbeatAt" = NOW(),
          "leaseExpiresAt" = NOW() + (${this.leaseTtlMs} * INTERVAL '1 millisecond'), "updatedAt" = NOW()
      WHERE id = ${lease.stateId} AND "leaseOwnerId" = ${this.leaseOwnerId}
        AND "leaseEpoch" = ${lease.epoch} AND "leaseExpiresAt" > NOW()
    `);
    if (count !== 1) {
      this.emitLeaseLost(
        lease.chainId,
        lease.contractAddress,
        lease.epoch,
        "cursor",
        "owner, epoch, or database-time expiry fence rejected",
      );
      throw new ShowsEscrowLeaseLostError();
    }
  }

  private emitLeaseLost(
    chainId: number,
    contractAddress: string,
    epoch: bigint,
    phase: "cursor" | "reconciliation",
    reason: string,
  ): void {
    writeStructuredLog({
      level: "error",
      event: "shows.escrow_indexer.lease_lost",
      message: "Shows escrow indexer lease lost",
      chainId,
      contractAddress,
      ownerId: this.leaseOwnerId,
      leaseEpoch: epoch.toString(),
      leaseTtlMs: this.leaseTtlMs,
      phase,
      reason,
    });
  }

  private async indexTarget(
    client: any,
    chainId: number,
    target: EscrowIndexerTarget,
    currentBlock: bigint,
  ) {
    const escrowAddress = target.address;
    const startBlock =
      target.deploymentBlock ??
      (currentBlock > 100n ? currentBlock - 100n : 0n);
    if (startBlock > currentBlock) {
      throw new Error(
        `Shows escrow ${escrowAddress} deployment block ${startBlock} is ahead of chain tip ${currentBlock}`,
      );
    }
    const initialCursor = startBlock > 0n ? startBlock - 1n : 0n;
    let state = await prisma.showEscrowIndexerState.upsert({
      where: {
        chainId_contractAddress: { chainId, contractAddress: escrowAddress },
      },
      create: {
        chainId,
        contractAddress: escrowAddress,
        lastBlockNumber: initialCursor,
      },
      update: {},
    });
    if (state.lastBlockNumber === initialCursor && state.leaseEpoch === 0n) {
      this.logger.log(
        `First run: escrow ${escrowAddress} indexer starting at block ${startBlock}`,
      );
    }
    const lease = await this.acquireLease(state.id, chainId, escrowAddress);
    if (!lease) return;
    state = await prisma.showEscrowIndexerState.findUniqueOrThrow({
      where: { id: state.id },
    });

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
        await this.fenceCursor(lease, safeBlock);
      } else {
        // Caught up: heartbeat the cursor row.
        await this.fenceCursor(lease, state.lastBlockNumber);
      }
      return;
    }

    let batches = 0;
    while (fromBlock <= currentBlock && batches < this.maxBatchesPerCycle) {
      await this.fenceCursor(lease, fromBlock - 1n);
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
        await this.processLog(log, chainId, escrowAddress, lease);
      }
      await this.fenceCursor(lease, effectiveToBlock);
      fromBlock = effectiveToBlock + 1n;
      batches++;
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
  async processLog(
    log: Log,
    chainId: number,
    escrowAddress: string,
    lease?: Lease,
  ) {
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
    const settlementEvents: ShowCampaignSettledEvent[] = [];

    try {
      await prisma.$transaction(async (tx) => {
        if (lease) {
          const count = await tx.$executeRaw(Prisma.sql`
            UPDATE "ShowEscrowIndexerState"
            SET "leaseHeartbeatAt" = NOW(),
                "leaseExpiresAt" = NOW() + (${this.leaseTtlMs} * INTERVAL '1 millisecond'), "updatedAt" = NOW()
            WHERE id = ${lease.stateId} AND "leaseOwnerId" = ${this.leaseOwnerId}
              AND "leaseEpoch" = ${lease.epoch} AND "leaseExpiresAt" > NOW()
          `);
          if (count !== 1) throw new ShowsEscrowLeaseLostError();
        }
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

        await this.reconcile(
          tx,
          eventName,
          args,
          ctx,
          (m) => mismatches.push(m),
          (e) => settlementEvents.push(e),
        );

        await tx.showCampaignEscrowEvent.update({
          where: { transactionHash_logIndex: { transactionHash, logIndex } },
          data: { processedAt: new Date() },
        });
      });
      // Side effects only after the durable state committed.
      for (const m of mismatches) this.emitMismatch(m);
      for (const e of settlementEvents) this.eventBus.publish(e);
    } catch (error) {
      if (lease && error instanceof ShowsEscrowLeaseLostError) {
        this.emitLeaseLost(
          chainId,
          escrowAddress,
          lease.epoch,
          "reconciliation",
          "owner, epoch, or database-time expiry fence rejected",
        );
      }
      this.logger.error(
        `Reconcile failed for ${eventName} (campaign ${contractCampaignId}); will retry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Propagate to the target loop so its cursor is not advanced past an
      // event that failed reconciliation. Other escrow targets still proceed.
      throw error;
    }
  }

  private decode(log: Log): { eventName: string; args: any } | null {
    for (const abiItem of ESCROW_EVENTS) {
      try {
        const out = decodeEventLog({
          abi: [abiItem],
          data: log.data,
          topics: log.topics,
        });
        return {
          eventName: (abiItem as any).name as string,
          args: out.args as any,
        };
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
    pushSettlement: (e: ShowCampaignSettledEvent) => void,
  ): Promise<void> {
    // Contract-only events with no campaign mapping: recorded, not reconciled.
    if (eventName === "FeeConfigUpdated") {
      await tx.showEscrowIndexerState.upsert({
        where: {
          chainId_contractAddress: {
            chainId: ctx.chainId,
            contractAddress: ctx.escrowAddress.toLowerCase(),
          },
        },
        create: {
          chainId: ctx.chainId,
          contractAddress: ctx.escrowAddress.toLowerCase(),
          currentFeeBps: Number(args.feeBps),
          feeRecipient: String(args.feeRecipient),
        },
        update: {
          currentFeeBps: Number(args.feeBps),
          feeRecipient: String(args.feeRecipient),
        },
      });
      return;
    }
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
        slug: true,
        artistId: true,
        paymentAssetSymbol: true,
        paymentAssetDecimals: true,
        paymentTokenAddress: true,
        totalRefundedUnits: true,
        totalReleasedUnits: true,
        feeBps: true,
        totalFeePaidUnits: true,
      },
      take: 2,
    });

    if (matches.length === 0) {
      const contractAddress = ctx.escrowAddress.toLowerCase();
      const acknowledgement =
        await tx.showEscrowReconciliationAcknowledgement.findUnique({
          where: {
            chainId_contractAddress_contractCampaignId: {
              chainId: ctx.chainId,
              contractAddress,
              contractCampaignId,
            },
          },
          select: { revokedAt: true },
        });
      if (!acknowledgement || acknowledgement.revokedAt !== null) {
        pushMismatch({
          chainId: ctx.chainId,
          contractAddress,
          contractCampaignId,
          transactionHash: ctx.transactionHash,
          blockNumber: ctx.blockNumber,
          reason: `no backend campaign bound to escrow campaign ${contractCampaignId}`,
          eventName,
        });
      }
      return;
    }
    if (matches.length > 1) {
      pushMismatch({
        chainId: ctx.chainId,
        contractAddress: ctx.escrowAddress.toLowerCase(),
        contractCampaignId,
        transactionHash: ctx.transactionHash,
        blockNumber: ctx.blockNumber,
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
      case "CampaignCreated": {
        data.onChainStatus = "Draft";
        const feeState = await tx.showEscrowIndexerState.findUnique({
          where: {
            chainId_contractAddress: {
              chainId: ctx.chainId,
              contractAddress: ctx.escrowAddress.toLowerCase(),
            },
          },
          select: { currentFeeBps: true },
        });
        if (
          feeState?.currentFeeBps !== null &&
          feeState?.currentFeeBps !== undefined
        ) {
          data.feeBps = feeState.currentFeeBps;
        }
        break;
      }
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
        await this.confirmPledgeFromChain(
          tx,
          campaign.id,
          args,
          ctx,
          pushMismatch,
        );
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
        // makes this read-modify-write safe under the fenced per-target lease.
        data.totalRefundedUnits = addUnits(
          campaign.totalRefundedUnits,
          String(args.amount),
        );
        break;
      case "FeeCharged":
        data.totalFeePaidUnits = addUnits(
          campaign.totalFeePaidUnits,
          String(args.amount),
        );
        break;
      case "DepositReleased":
      case "FundsReleased": {
        const feeAmount = await this.feeChargedInSameTransaction(
          tx,
          contractCampaignId,
          ctx,
        );
        const netAmount = BigInt(String(args.amount));
        const grossAmount = netAmount + feeAmount;
        if (campaign.feeBps === null || campaign.feeBps === undefined) {
          const inferredFeeBps = inferFeeBps(feeAmount, grossAmount);
          if (inferredFeeBps !== null) data.feeBps = inferredFeeBps;
        }
        const feeBps =
          (data.feeBps as number | undefined) ?? campaign.feeBps ?? null;
        data.totalReleasedUnits = addUnitBigInt(
          campaign.totalReleasedUnits,
          grossAmount,
        );
        if (eventName === "DepositReleased") {
          data.onChainStatus = "DepositReleased";
          if (this.canAdvance(campaign.status, "deposit_released"))
            data.status = "deposit_released";
          data.depositReleasedAt = new Date();
          eventType = "deposit_released";
        } else {
          data.onChainStatus = "Released";
          if (this.canAdvance(campaign.status, "released"))
            data.status = "released";
          data.releasedAt = new Date();
          eventType = "campaign_released";
          // #950: on-chain release is authoritative, but a release that lands
          // while an off-chain dispute is still open is an ops red flag — record
          // it (we can't undo the chain) and surface a reconciliation mismatch.
          const openDispute = await tx.showCampaignDispute.findFirst({
            where: { campaignId: campaign.id, status: "open" },
            select: { id: true },
          });
          if (openDispute) {
            pushMismatch({
              chainId: ctx.chainId,
              contractAddress: ctx.escrowAddress.toLowerCase(),
              contractCampaignId,
              transactionHash: ctx.transactionHash,
              blockNumber: ctx.blockNumber,
              reason: `funds released on-chain while an off-chain dispute is open`,
              eventName,
            });
          }
        }
        pushSettlement({
          eventName: "shows.campaign_settled",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          campaignId: campaign.id,
          campaignSlug: campaign.slug,
          artistId: campaign.artistId ?? undefined,
          contractCampaignId,
          settlementStage:
            eventName === "DepositReleased" ? "deposit" : "final",
          grossAmountUnits: grossAmount.toString(),
          feeAmountUnits: feeAmount.toString(),
          netAmountUnits: netAmount.toString(),
          feeBps: feeBps ?? undefined,
          totalFeePaidUnits: campaign.totalFeePaidUnits,
          paymentAssetSymbol: campaign.paymentAssetSymbol,
          paymentAssetDecimals: campaign.paymentAssetDecimals,
          paymentToken: campaign.paymentTokenAddress ?? undefined,
          chainId: ctx.chainId,
          contractAddress: ctx.escrowAddress,
          transactionHash: ctx.transactionHash,
          blockNumber: ctx.blockNumber.toString(),
        });
        break;
      }
      case "FulfillmentConfirmed":
        data.onChainStatus = "Fulfilled";
        if (this.canAdvance(campaign.status, "fulfilled"))
          data.status = "fulfilled";
        data.fulfilledAt = new Date();
        eventType = "fulfillment_confirmed";
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
          metadata: {
            source: "escrow-indexer",
            onChainStatus: data.onChainStatus ?? null,
          },
        },
      });
    }
  }

  private async feeChargedInSameTransaction(
    tx: Prisma.TransactionClient,
    contractCampaignId: string,
    ctx: {
      chainId: number;
      escrowAddress: string;
      transactionHash: string;
    },
  ): Promise<bigint> {
    const feeEvents = await tx.showCampaignEscrowEvent.findMany({
      where: {
        chainId: ctx.chainId,
        contractAddress: { equals: ctx.escrowAddress, mode: "insensitive" },
        transactionHash: ctx.transactionHash,
        eventName: "FeeCharged",
        contractCampaignId,
      },
      select: { args: true },
    });
    return feeEvents.reduce((sum, event) => {
      const args = event.args as Record<string, unknown>;
      try {
        return sum + BigInt(String(args.amount ?? "0"));
      } catch {
        return sum;
      }
    }, 0n);
  }

  /** Confirm a backer's pledge from an on-chain Pledged event (not client claim). */
  private async confirmPledgeFromChain(
    tx: Prisma.TransactionClient,
    campaignId: string,
    args: any,
    ctx: {
      chainId: number;
      escrowAddress: string;
      transactionHash: string;
      blockNumber: bigint;
    },
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
        chainId: ctx.chainId,
        contractAddress: ctx.escrowAddress.toLowerCase(),
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
        receipt: {
          ...((pledge.receipt as object) ?? {}),
          onChainAmountUnits: amount,
        },
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
    const uniqueWallets = new Set(
      confirmed.map((p) => p.walletAddress.toLowerCase()),
    );
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
    // Structured app-event line the iac log-based metric parses
    // (jsonPayload.event="shows.campaign_reconciliation_mismatch"). This is the
    // surface Cloud Monitoring alerts on — keep the event name identical to the
    // domain event and the iac local.backend_app_event_names entry.
    writeStructuredLog({
      level: "warn",
      event: "shows.campaign_reconciliation_mismatch",
      message: "Show campaign reconciliation mismatch detected",
      contractCampaignId: input.contractCampaignId,
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      escrowEventName: input.eventName,
      transactionHash: input.transactionHash,
      blockNumber: input.blockNumber.toString(),
      reason: input.reason,
    });
    this.eventBus.publish({
      eventName: "shows.campaign_reconciliation_mismatch",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      contractCampaignId: input.contractCampaignId,
      escrowEventName: input.eventName,
      transactionHash: input.transactionHash,
      blockNumber: input.blockNumber.toString(),
      reason: input.reason,
    });
  }
}
