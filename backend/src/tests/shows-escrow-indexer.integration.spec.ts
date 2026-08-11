/**
 * ShowsEscrowIndexerService (#948) — integration (Testcontainers Postgres).
 *
 * Drives the real decode → reconcile → idempotency paths by feeding correctly
 * ABI-encoded ShowCampaignEscrow logs (built with viem encodeEventLog) into
 * processLog, against the real database. This exercises on-chain-truth
 * reconciliation without needing a deployed contract or ERC20 plumbing; the
 * deploy/poll mechanics mirror the marketplace IndexerService and are covered
 * by its suite + the #947 Anvil smoke flow.
 */

import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Log,
} from "viem";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { ShowsEscrowIndexerService } from "../modules/shows/shows-escrow-indexer.service";

const CHAIN_ID = 31337;
const ESCROW = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const TEST_PREFIX = `escrowidx_${Date.now()}_`;
const BACKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER_BACKER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const FEE_RECIPIENT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const INDEX_OLD = "0x1111111111111111111111111111111111111111";
const INDEX_NEW = "0x2222222222222222222222222222222222222222";
const INDEX_FAIL = "0x3333333333333333333333333333333333333333";
const LEASE_ONE = "0x4444444444444444444444444444444444444444";
const LEASE_TWO = "0x5555555555555555555555555555555555555555";

const EVENT_ABIS = {
  CampaignCreated: parseAbiItem(
    "event CampaignCreated(uint256 indexed campaignId, bytes32 indexed artistIdHash, bytes32 indexed authorityHash, address beneficiary, address paymentToken, uint256 goalAmount, uint256 minimumBackers, uint256 deadline, uint256 bookingDeadline)",
  ),
  CampaignActivated: parseAbiItem(
    "event CampaignActivated(uint256 indexed campaignId)",
  ),
  Pledged: parseAbiItem(
    "event Pledged(uint256 indexed campaignId, address indexed backer, uint256 amount, uint256 totalPledged)",
  ),
  CampaignFunded: parseAbiItem(
    "event CampaignFunded(uint256 indexed campaignId, uint256 totalPledged, uint256 uniqueBackers)",
  ),
  RefundAvailable: parseAbiItem(
    "event RefundAvailable(uint256 indexed campaignId)",
  ),
  FundsReleased: parseAbiItem(
    "event FundsReleased(uint256 indexed campaignId, address indexed beneficiary, uint256 amount)",
  ),
  DepositReleased: parseAbiItem(
    "event DepositReleased(uint256 indexed campaignId, address indexed beneficiary, uint256 amount)",
  ),
  FeeCharged: parseAbiItem(
    "event FeeCharged(uint256 indexed campaignId, address indexed feeRecipient, uint256 amount)",
  ),
  FeeConfigUpdated: parseAbiItem(
    "event FeeConfigUpdated(uint256 feeBps, address feeRecipient)",
  ),
  RefundClaimed: parseAbiItem(
    "event RefundClaimed(uint256 indexed campaignId, address indexed backer, uint256 amount)",
  ),
} as const;

let logCounter = 0;
function buildLog(
  eventName: keyof typeof EVENT_ABIS,
  args: Record<string, unknown>,
  overrides: { transactionHash?: `0x${string}`; logIndex?: number } = {},
): Log {
  const item = EVENT_ABIS[eventName] as any;
  const topics = encodeEventTopics({ abi: [item], eventName, args } as any);
  const nonIndexed = item.inputs.filter((i: any) => !i.indexed);
  const data =
    nonIndexed.length > 0
      ? encodeAbiParameters(
          nonIndexed,
          nonIndexed.map((i: any) => (args as any)[i.name]),
        )
      : "0x";
  logCounter += 1;
  return {
    address: ESCROW as `0x${string}`,
    topics,
    data,
    blockNumber: BigInt(1000 + logCounter),
    transactionHash:
      overrides.transactionHash ??
      (("0x" + logCounter.toString(16).padStart(64, "0")) as `0x${string}`),
    logIndex: overrides.logIndex ?? 0,
    blockHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    removed: false,
    transactionIndex: 0,
  } as Log;
}

describe("ShowsEscrowIndexerService reconciliation (integration)", () => {
  const eventBus = new EventBus();
  const service = new ShowsEscrowIndexerService(eventBus);
  const mismatches: any[] = [];
  const settlements: any[] = [];
  let savedEscrowAddr: string | undefined;
  let savedChainId: string | undefined;
  let savedIndexerTargets: string | undefined;

  beforeAll(async () => {
    savedEscrowAddr = process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS;
    savedChainId = process.env.INDEXER_CHAIN_ID;
    savedIndexerTargets = process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS;
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ESCROW;
    process.env.INDEXER_CHAIN_ID = String(CHAIN_ID);
    eventBus.subscribe("shows.campaign_reconciliation_mismatch", (e) => {
      mismatches.push(e);
    });
    eventBus.subscribe("shows.campaign_settled", (e) => {
      settlements.push(e);
    });
  });

  afterAll(async () => {
    await prisma.showEscrowReconciliationAcknowledgement.deleteMany({
      where: {
        chainId: CHAIN_ID,
        contractAddress: {
          in: [ESCROW, INDEX_OLD, INDEX_NEW, INDEX_FAIL, LEASE_ONE, LEASE_TWO],
        },
      },
    });
    await prisma.showCampaignEscrowEvent.deleteMany({
      where: {
        contractAddress: { in: [ESCROW, INDEX_OLD, INDEX_NEW, INDEX_FAIL] },
      },
    });
    await prisma.showEscrowIndexerState.deleteMany({
      where: { contractAddress: ESCROW },
    });
    await prisma.showEscrowIndexerState.deleteMany({
      where: {
        contractAddress: {
          in: [INDEX_OLD, INDEX_NEW, INDEX_FAIL, LEASE_ONE, LEASE_TWO],
        },
      },
    });
    await prisma.showPledge.deleteMany({
      where: { campaign: { slug: { startsWith: TEST_PREFIX } } },
    });
    await prisma.showCampaignEvent.deleteMany({
      where: { campaign: { slug: { startsWith: TEST_PREFIX } } },
    });
    await prisma.showCampaign.deleteMany({
      where: { slug: { startsWith: TEST_PREFIX } },
    });
    if (savedEscrowAddr === undefined)
      delete process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS;
    else process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = savedEscrowAddr;
    if (savedChainId === undefined) delete process.env.INDEXER_CHAIN_ID;
    else process.env.INDEXER_CHAIN_ID = savedChainId;
    if (savedIndexerTargets === undefined)
      delete process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS;
    else process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS = savedIndexerTargets;
  });

  // Each test uses a distinct on-chain campaign id so reconcile() binds to the
  // right backend row (it matches on chainId + contractAddress + contractCampaignId).
  async function seedCampaign(
    slugSuffix: string,
    contractCampaignId: string,
    contractAddress = ESCROW,
  ) {
    return prisma.showCampaign.create({
      data: {
        slug: `${TEST_PREFIX}${slugSuffix}`,
        artistDisplayName: "Indexer Artist",
        title: "Indexer Show",
        city: "Lyon",
        country: "FR",
        deadline: new Date(Date.now() + 7 * 86400_000),
        goalAmountUnits: "1000",
        chainId: CHAIN_ID,
        contractAddress,
        contractCampaignId,
        status: "active",
        campaignLevel: "active_escrow_campaign",
      },
    });
  }

  it("elects exactly one active writer across two service instances", async () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = LEASE_ONE;
    process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS = `${LEASE_ONE}:100`;
    await prisma.showEscrowIndexerState.deleteMany({
      where: { chainId: CHAIN_ID, contractAddress: LEASE_ONE },
    });
    await prisma.showEscrowIndexerState.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: LEASE_ONE,
        lastBlockNumber: 999n,
      },
    });
    const first = new ShowsEscrowIndexerService(new EventBus());
    const second = new ShowsEscrowIndexerService(new EventBus());
    const firstLogs = jest.fn().mockResolvedValue([]);
    const secondLogs = jest.fn().mockResolvedValue([]);
    (first as any).clientCache.set(CHAIN_ID, {
      getBlockNumber: jest.fn().mockResolvedValue(1000n),
      getLogs: firstLogs,
    });
    (second as any).clientCache.set(CHAIN_ID, {
      getBlockNumber: jest.fn().mockResolvedValue(1000n),
      getLogs: secondLogs,
    });

    await Promise.all([first.runIndexCycle(), second.runIndexCycle()]);

    expect(firstLogs.mock.calls.length + secondLogs.mock.calls.length).toBe(1);
    const state = await prisma.showEscrowIndexerState.findUniqueOrThrow({
      where: {
        chainId_contractAddress: {
          chainId: CHAIN_ID,
          contractAddress: LEASE_ONE,
        },
      },
    });
    expect(state.lastBlockNumber).toBe(1000n);
    expect(state.leaseEpoch).toBe(1n);
    await Promise.all([first.onModuleDestroy(), second.onModuleDestroy()]);
    delete process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS;
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ESCROW;
  });

  it("takes over an expired holder and fences its stale epoch", async () => {
    await prisma.showEscrowIndexerState.deleteMany({
      where: { chainId: CHAIN_ID, contractAddress: LEASE_ONE },
    });
    const state = await prisma.showEscrowIndexerState.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: LEASE_ONE,
        lastBlockNumber: 999n,
      },
    });
    const oldHolder = new ShowsEscrowIndexerService(new EventBus());
    const successor = new ShowsEscrowIndexerService(new EventBus());
    const oldLease = await (oldHolder as any).acquireLease(
      state.id,
      CHAIN_ID,
      LEASE_ONE,
    );
    await prisma.showEscrowIndexerState.update({
      where: { id: state.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const newLease = await (successor as any).acquireLease(
      state.id,
      CHAIN_ID,
      LEASE_ONE,
    );

    expect(newLease.epoch).toBe(oldLease.epoch + 1n);
    await expect(
      (oldHolder as any).fenceCursor(oldLease, 1000n),
    ).rejects.toThrow("lease lost");
    const staleLog = buildLog("CampaignActivated", { campaignId: 777001n });
    await expect(
      oldHolder.processLog(staleLog, CHAIN_ID, LEASE_ONE, oldLease),
    ).rejects.toThrow("lease lost");
    expect(
      await prisma.showCampaignEscrowEvent.findUnique({
        where: {
          transactionHash_logIndex: {
            transactionHash: staleLog.transactionHash!,
            logIndex: staleLog.logIndex!,
          },
        },
      }),
    ).toBeNull();
    const after = await prisma.showEscrowIndexerState.findUniqueOrThrow({
      where: { id: state.id },
    });
    expect(after.lastBlockNumber).toBe(999n);
    const successorLogs = jest.fn().mockResolvedValue([]);
    await (successor as any).indexTarget(
      { getLogs: successorLogs },
      CHAIN_ID,
      { address: LEASE_ONE, deploymentBlock: 100n },
      1001n,
    );
    expect(successorLogs).toHaveBeenCalledWith({
      address: LEASE_ONE,
      fromBlock: 1000n,
      toBlock: 1001n,
    });
    expect(
      (
        await prisma.showEscrowIndexerState.findUniqueOrThrow({
          where: { id: state.id },
        })
      ).lastBlockNumber,
    ).toBe(1001n);
    await Promise.all([
      oldHolder.onModuleDestroy(),
      successor.onModuleDestroy(),
    ]);
  });

  it("waits for an active cycle before releasing its lease", async () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = LEASE_ONE;
    process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS = `${LEASE_ONE}:100`;
    await prisma.showEscrowIndexerState.deleteMany({
      where: { chainId: CHAIN_ID, contractAddress: LEASE_ONE },
    });
    await prisma.showEscrowIndexerState.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: LEASE_ONE,
        lastBlockNumber: 999n,
      },
    });
    let resolveLogs!: (logs: Log[]) => void;
    const logsPending = new Promise<Log[]>((resolve) => {
      resolveLogs = resolve;
    });
    const holder = new ShowsEscrowIndexerService(new EventBus());
    (holder as any).clientCache.set(CHAIN_ID, {
      getBlockNumber: jest.fn().mockResolvedValue(1000n),
      getLogs: jest.fn().mockReturnValue(logsPending),
    });
    const cycle = holder.runIndexCycle();
    while (
      !(
        await prisma.showEscrowIndexerState.findUniqueOrThrow({
          where: {
            chainId_contractAddress: {
              chainId: CHAIN_ID,
              contractAddress: LEASE_ONE,
            },
          },
        })
      ).leaseOwnerId
    ) {
      await Promise.resolve();
    }
    const destroying = holder.onModuleDestroy();
    expect(
      (
        await prisma.showEscrowIndexerState.findUniqueOrThrow({
          where: {
            chainId_contractAddress: {
              chainId: CHAIN_ID,
              contractAddress: LEASE_ONE,
            },
          },
        })
      ).leaseOwnerId,
    ).not.toBeNull();
    resolveLogs([]);
    await Promise.all([cycle, destroying]);
    expect(
      (
        await prisma.showEscrowIndexerState.findUniqueOrThrow({
          where: {
            chainId_contractAddress: {
              chainId: CHAIN_ID,
              contractAddress: LEASE_ONE,
            },
          },
        })
      ).leaseOwnerId,
    ).toBeNull();
    delete process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS;
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ESCROW;
  });

  it("skips a contended target while another target progresses", async () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = LEASE_TWO;
    process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS = `${LEASE_ONE}:100,${LEASE_TWO}:100`;
    await prisma.showEscrowIndexerState.deleteMany({
      where: {
        chainId: CHAIN_ID,
        contractAddress: { in: [LEASE_ONE, LEASE_TWO] },
      },
    });
    await prisma.showEscrowIndexerState.createMany({
      data: [
        {
          chainId: CHAIN_ID,
          contractAddress: LEASE_ONE,
          lastBlockNumber: 999n,
          leaseOwnerId: "other-process",
          leaseEpoch: 1n,
          leaseExpiresAt: new Date(Date.now() + 300_000),
          leaseHeartbeatAt: new Date(),
        },
        {
          chainId: CHAIN_ID,
          contractAddress: LEASE_TWO,
          lastBlockNumber: 999n,
        },
      ],
    });
    const contender = new ShowsEscrowIndexerService(new EventBus());
    const getLogs = jest.fn().mockResolvedValue([]);
    (contender as any).clientCache.set(CHAIN_ID, {
      getBlockNumber: jest.fn().mockResolvedValue(1000n),
      getLogs,
    });

    await contender.runIndexCycle();

    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ address: LEASE_TWO }),
    );
    const states = await prisma.showEscrowIndexerState.findMany({
      where: {
        chainId: CHAIN_ID,
        contractAddress: { in: [LEASE_ONE, LEASE_TWO] },
      },
      orderBy: { contractAddress: "asc" },
    });
    expect(states.map((row) => row.lastBlockNumber)).toEqual([999n, 1000n]);
    await contender.onModuleDestroy();
    delete process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS;
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ESCROW;
  });

  it("maintains independent cursors for legacy and current escrow targets", async () => {
    process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS = `${ESCROW}:100,${INDEX_OLD}:100,${INDEX_NEW}:900`;
    await prisma.showEscrowIndexerState.deleteMany({
      where: {
        chainId: CHAIN_ID,
        contractAddress: { in: [INDEX_OLD, INDEX_NEW] },
      },
    });
    await prisma.showEscrowIndexerState.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: INDEX_OLD,
        lastBlockNumber: 995n,
      },
    });
    const getLogs = jest.fn().mockResolvedValue([]);
    (service as any).clientCache.set(CHAIN_ID, {
      getBlockNumber: jest.fn().mockResolvedValue(1000n),
      getLogs,
    });

    await service.runIndexCycle();

    expect(getLogs).toHaveBeenCalledWith({
      address: INDEX_OLD,
      fromBlock: 996n,
      toBlock: 1000n,
    });
    expect(getLogs).toHaveBeenCalledWith({
      address: INDEX_NEW,
      fromBlock: 900n,
      toBlock: 1000n,
    });
    const states = await prisma.showEscrowIndexerState.findMany({
      where: {
        chainId: CHAIN_ID,
        contractAddress: { in: [INDEX_OLD, INDEX_NEW] },
      },
      orderBy: { contractAddress: "asc" },
    });
    expect(
      states.map((state) => [state.contractAddress, state.lastBlockNumber]),
    ).toEqual([
      [INDEX_OLD, 1000n],
      [INDEX_NEW, 1000n],
    ]);

    delete process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS;
  });

  it("isolates fee snapshots and campaign ids by escrow address", async () => {
    const oldCampaign = await seedCampaign("old-address", "99", INDEX_OLD);
    const newCampaign = await seedCampaign("new-address", "99", INDEX_NEW);

    await service.processLog(
      buildLog("FeeConfigUpdated", {
        feeBps: 600n,
        feeRecipient: FEE_RECIPIENT as `0x${string}`,
      }),
      CHAIN_ID,
      INDEX_OLD,
    );
    await service.processLog(
      buildLog("FeeConfigUpdated", {
        feeBps: 300n,
        feeRecipient: BACKER as `0x${string}`,
      }),
      CHAIN_ID,
      INDEX_NEW,
    );
    const createdArgs = {
      campaignId: 99n,
      artistIdHash: `0x${"11".repeat(32)}`,
      authorityHash: `0x${"22".repeat(32)}`,
      beneficiary: BACKER as `0x${string}`,
      paymentToken: OTHER_BACKER as `0x${string}`,
      goalAmount: 1000n,
      minimumBackers: 2n,
      deadline: 2000n,
      bookingDeadline: 3000n,
    };
    await service.processLog(
      buildLog("CampaignCreated", createdArgs),
      CHAIN_ID,
      INDEX_OLD,
    );
    await service.processLog(
      buildLog("CampaignCreated", createdArgs),
      CHAIN_ID,
      INDEX_NEW,
    );

    const [oldAfter, newAfter] = await Promise.all([
      prisma.showCampaign.findUniqueOrThrow({ where: { id: oldCampaign.id } }),
      prisma.showCampaign.findUniqueOrThrow({ where: { id: newCampaign.id } }),
    ]);
    expect(oldAfter.feeBps).toBe(600);
    expect(newAfter.feeBps).toBe(300);
  });

  it("does not advance a target cursor past a failed reconciliation", async () => {
    process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS = `${ESCROW}:100,${INDEX_FAIL}:100`;
    await prisma.showEscrowIndexerState.deleteMany({
      where: { chainId: CHAIN_ID, contractAddress: INDEX_FAIL },
    });
    await prisma.showEscrowIndexerState.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: INDEX_FAIL,
        lastBlockNumber: 995n,
      },
    });
    const failedLog = buildLog("CampaignActivated", { campaignId: 404n });
    (service as any).clientCache.set(CHAIN_ID, {
      getBlockNumber: jest.fn().mockResolvedValue(1000n),
      getLogs: jest
        .fn()
        .mockImplementation(({ address }) =>
          address === INDEX_FAIL
            ? Promise.resolve([failedLog])
            : Promise.resolve([]),
        ),
    });
    const processSpy = jest
      .spyOn(service, "processLog")
      .mockRejectedValueOnce(new Error("db unavailable"));

    try {
      await service.runIndexCycle();
      const failedState = await prisma.showEscrowIndexerState.findUniqueOrThrow(
        {
          where: {
            chainId_contractAddress: {
              chainId: CHAIN_ID,
              contractAddress: INDEX_FAIL,
            },
          },
        },
      );
      expect(failedState.lastBlockNumber).toBe(995n);
    } finally {
      processSpy.mockRestore();
      delete process.env.SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS;
    }
  });

  it("confirms a pledge and reconciles funding from on-chain events (not client claims)", async () => {
    const campaign = await seedCampaign("fund", "1");
    const pledge = await prisma.showPledge.create({
      data: {
        campaignId: campaign.id,
        walletAddress: BACKER,
        amountUnits: "600",
        chainId: CHAIN_ID,
        status: "intent_created",
        confirmationStatus: "not_submitted",
      },
    });

    await service.processLog(
      buildLog("Pledged", {
        campaignId: 1n,
        backer: BACKER as `0x${string}`,
        amount: 600n,
        totalPledged: 600n,
      }),
      CHAIN_ID,
      ESCROW,
    );

    const confirmed = await prisma.showPledge.findUniqueOrThrow({
      where: { id: pledge.id },
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmationStatus).toBe("confirmed");

    const afterPledge = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(afterPledge.raisedAmountUnits).toBe("600");
    expect(afterPledge.confirmedPledgeCount).toBe(1);
    expect(afterPledge.uniqueBackerCount).toBe(1);

    await service.processLog(
      buildLog("CampaignFunded", {
        campaignId: 1n,
        totalPledged: 600n,
        uniqueBackers: 1n,
      }),
      CHAIN_ID,
      ESCROW,
    );
    const funded = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(funded.status).toBe("funded");
    expect(funded.onChainStatus).toBe("Funded");
    expect(funded.lastEscrowIndexedBlock).not.toBeNull();
  });

  it("is idempotent: replaying the same event does not double-process", async () => {
    const campaign = await seedCampaign("idem", "2");
    await prisma.showPledge.create({
      data: {
        campaignId: campaign.id,
        walletAddress: BACKER,
        amountUnits: "250",
        chainId: CHAIN_ID,
        status: "intent_created",
        confirmationStatus: "not_submitted",
      },
    });
    const log = buildLog("Pledged", {
      campaignId: 2n,
      backer: BACKER as `0x${string}`,
      amount: 250n,
      totalPledged: 250n,
    });

    await service.processLog(log, CHAIN_ID, ESCROW);
    await service.processLog(log, CHAIN_ID, ESCROW); // replay

    const rows = await prisma.showCampaignEscrowEvent.findMany({
      where: { transactionHash: log.transactionHash! },
    });
    expect(rows).toHaveLength(1);
    const confirmedCount = await prisma.showPledge.count({
      where: { campaignId: campaign.id, status: "confirmed" },
    });
    expect(confirmedCount).toBe(1);
  });

  it("marks pledges refunded and accumulates refund accounting", async () => {
    const campaign = await seedCampaign("refund", "3");
    const pledge = await prisma.showPledge.create({
      data: {
        campaignId: campaign.id,
        walletAddress: BACKER,
        amountUnits: "400",
        chainId: CHAIN_ID,
        status: "confirmed",
        confirmationStatus: "confirmed",
      },
    });

    await service.processLog(
      buildLog("RefundAvailable", { campaignId: 3n }),
      CHAIN_ID,
      ESCROW,
    );
    await service.processLog(
      buildLog("RefundClaimed", {
        campaignId: 3n,
        backer: BACKER as `0x${string}`,
        amount: 400n,
      }),
      CHAIN_ID,
      ESCROW,
    );

    const refunded = await prisma.showPledge.findUniqueOrThrow({
      where: { id: pledge.id },
    });
    expect(refunded.status).toBe("refunded");
    const after = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.status).toBe("refund_available");
    expect(after.totalRefundedUnits).toBe("400");
  });

  it("snapshots fee config on campaign creation", async () => {
    const campaign = await seedCampaign("fee-config", "6");

    await service.processLog(
      buildLog("FeeConfigUpdated", {
        feeBps: 600n,
        feeRecipient: FEE_RECIPIENT as `0x${string}`,
      }),
      CHAIN_ID,
      ESCROW,
    );
    await service.processLog(
      buildLog("CampaignCreated", {
        campaignId: 6n,
        artistIdHash: ("0x" + "11".repeat(32)) as `0x${string}`,
        authorityHash: ("0x" + "22".repeat(32)) as `0x${string}`,
        beneficiary: BACKER as `0x${string}`,
        paymentToken: ("0x" + "33".repeat(20)) as `0x${string}`,
        goalAmount: 1000n,
        minimumBackers: 1n,
        deadline: 1n,
        bookingDeadline: 2n,
      }),
      CHAIN_ID,
      ESCROW,
    );

    const updated = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(updated.feeBps).toBe(600);
  });

  it("reconciles net release events with same-transaction FeeCharged gross accounting", async () => {
    const campaign = await seedCampaign("release-fee", "7");
    settlements.length = 0;
    const txHash = ("0x" + "77".repeat(32)) as `0x${string}`;

    await service.processLog(
      buildLog(
        "FeeCharged",
        {
          campaignId: 7n,
          feeRecipient: FEE_RECIPIENT as `0x${string}`,
          amount: 60n,
        },
        { transactionHash: txHash, logIndex: 0 },
      ),
      CHAIN_ID,
      ESCROW,
    );
    await service.processLog(
      buildLog(
        "FundsReleased",
        {
          campaignId: 7n,
          beneficiary: BACKER as `0x${string}`,
          amount: 940n,
        },
        { transactionHash: txHash, logIndex: 1 },
      ),
      CHAIN_ID,
      ESCROW,
    );

    const released = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(released.status).toBe("released");
    expect(released.totalFeePaidUnits).toBe("60");
    expect(released.totalReleasedUnits).toBe("1000");
    expect(released.feeBps).toBe(600);
    expect(settlements).toContainEqual(
      expect.objectContaining({
        eventName: "shows.campaign_settled",
        settlementStage: "final",
        grossAmountUnits: "1000",
        feeAmountUnits: "60",
        netAmountUnits: "940",
        feeBps: 600,
        totalFeePaidUnits: "60",
        transactionHash: txHash,
      }),
    );
  });

  it("scopes same-transaction fees to the emitting escrow", async () => {
    await seedCampaign("legacy-release-fee", "8", INDEX_OLD);
    const campaign = await seedCampaign(
      "replacement-release-fee",
      "8",
      INDEX_NEW,
    );
    settlements.length = 0;
    const txHash = ("0x" + "88".repeat(32)) as `0x${string}`;

    await service.processLog(
      buildLog(
        "FeeCharged",
        {
          campaignId: 8n,
          feeRecipient: FEE_RECIPIENT as `0x${string}`,
          amount: 10n,
        },
        { transactionHash: txHash, logIndex: 0 },
      ),
      CHAIN_ID,
      INDEX_OLD,
    );
    await service.processLog(
      buildLog(
        "FeeCharged",
        {
          campaignId: 8n,
          feeRecipient: FEE_RECIPIENT as `0x${string}`,
          amount: 60n,
        },
        { transactionHash: txHash, logIndex: 1 },
      ),
      CHAIN_ID,
      INDEX_NEW,
    );
    await service.processLog(
      buildLog(
        "FundsReleased",
        {
          campaignId: 8n,
          beneficiary: BACKER as `0x${string}`,
          amount: 940n,
        },
        { transactionHash: txHash, logIndex: 2 },
      ),
      CHAIN_ID,
      INDEX_NEW,
    );

    const released = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(released.totalFeePaidUnits).toBe("60");
    expect(released.totalReleasedUnits).toBe("1000");
    expect(settlements).toContainEqual(
      expect.objectContaining({
        contractAddress: INDEX_NEW,
        grossAmountUnits: "1000",
        feeAmountUnits: "60",
        netAmountUnits: "940",
        transactionHash: txHash,
      }),
    );
  });

  it("emits a reconciliation mismatch for an on-chain pledge with no backend intent", async () => {
    await seedCampaign("mismatch", "4");
    // A known-foreign acknowledgement is intentionally narrow: once the
    // campaign is mapped, pledge drift must still alert.
    await prisma.showEscrowReconciliationAcknowledgement.upsert({
      where: {
        chainId_contractAddress_contractCampaignId: {
          chainId: CHAIN_ID,
          contractAddress: ESCROW,
          contractCampaignId: "4",
        },
      },
      create: {
        chainId: CHAIN_ID,
        contractAddress: ESCROW,
        contractCampaignId: "4",
        acknowledgedByUserId: "indexer-test",
      },
      update: {},
    });
    mismatches.length = 0;

    // writeStructuredLog defaults to console.info; capture the structured
    // app-event line the iac log-based metric parses (#1271).
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    let structuredLines: string[] = [];
    try {
      await service.processLog(
        buildLog("Pledged", {
          campaignId: 4n,
          backer: OTHER_BACKER as `0x${string}`,
          amount: 99n,
          totalPledged: 99n,
        }),
        CHAIN_ID,
        ESCROW,
      );
    } finally {
      structuredLines = infoSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) =>
          line.includes('"event":"shows.campaign_reconciliation_mismatch"'),
        );
      infoSpy.mockRestore();
    }

    expect(mismatches.length).toBeGreaterThanOrEqual(1);
    expect(mismatches[0]).toMatchObject({
      eventName: "shows.campaign_reconciliation_mismatch",
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
      escrowEventName: "Pledged",
    });

    // The structured app-event line drives the Cloud Monitoring alert: it must
    // carry service=resonate-backend, the event name, and the drift reason.
    expect(structuredLines.length).toBeGreaterThanOrEqual(1);
    const structured = JSON.parse(structuredLines[0]);
    expect(structured).toMatchObject({
      service: "resonate-backend",
      level: "warn",
      event: "shows.campaign_reconciliation_mismatch",
      escrowEventName: "Pledged",
      contractCampaignId: "4",
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
    });
    expect(String(structured.reason)).toContain("no matching backend intent");
  });

  it("suppresses only an exact acknowledged unbound campaign while processing its log", async () => {
    const campaignId = "404040";
    const acknowledgedTx = ("0x" + "c1".padStart(64, "0")) as `0x${string}`;
    await prisma.showEscrowReconciliationAcknowledgement.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: ESCROW,
        contractCampaignId: campaignId,
        acknowledgedByUserId: "indexer-test",
        note: "Known foreign campaign",
      },
    });
    mismatches.length = 0;
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    try {
      await service.processLog(
        buildLog(
          "CampaignActivated",
          { campaignId: BigInt(campaignId) },
          { transactionHash: acknowledgedTx },
        ),
        CHAIN_ID,
        ESCROW,
      );
    } finally {
      infoSpy.mockRestore();
    }

    expect(mismatches).toHaveLength(0);
    const processed = await prisma.showCampaignEscrowEvent.findUniqueOrThrow({
      where: {
        transactionHash_logIndex: {
          transactionHash: acknowledgedTx,
          logIndex: 0,
        },
      },
    });
    expect(processed.processedAt).not.toBeNull();

    // Revoked acknowledgements remain as audit rows but are inactive and must
    // no longer suppress alerts.
    await prisma.showEscrowReconciliationAcknowledgement.update({
      where: {
        chainId_contractAddress_contractCampaignId: {
          chainId: CHAIN_ID,
          contractAddress: ESCROW,
          contractCampaignId: campaignId,
        },
      },
      data: { revokedAt: new Date(), revokedByUserId: "indexer-reviewer" },
    });
    const revokedTx = ("0x" + "c3".padStart(64, "0")) as `0x${string}`;
    await service.processLog(
      buildLog(
        "CampaignActivated",
        { campaignId: BigInt(campaignId) },
        { transactionHash: revokedTx },
      ),
      CHAIN_ID,
      ESCROW,
    );
    expect(mismatches).toContainEqual(
      expect.objectContaining({
        chainId: CHAIN_ID,
        contractAddress: ESCROW,
        contractCampaignId: campaignId,
      }),
    );
    mismatches.length = 0;

    // The same numeric id on a different escrow is a distinct identity and must
    // still alert.
    const otherTx = ("0x" + "c2".padStart(64, "0")) as `0x${string}`;
    await service.processLog(
      buildLog(
        "CampaignActivated",
        { campaignId: BigInt(campaignId) },
        { transactionHash: otherTx },
      ),
      CHAIN_ID,
      INDEX_OLD,
    );
    expect(mismatches).toContainEqual(
      expect.objectContaining({
        chainId: CHAIN_ID,
        contractAddress: INDEX_OLD,
        contractCampaignId: campaignId,
      }),
    );
    mismatches.length = 0;

    // The same address/id on another chain is also a distinct identity.
    const otherChainTx = ("0x" + "c4".padStart(64, "0")) as `0x${string}`;
    await service.processLog(
      buildLog(
        "CampaignActivated",
        { campaignId: BigInt(campaignId) },
        { transactionHash: otherChainTx },
      ),
      CHAIN_ID + 1,
      ESCROW,
    );
    expect(mismatches).toContainEqual(
      expect.objectContaining({
        chainId: CHAIN_ID + 1,
        contractAddress: ESCROW,
        contractCampaignId: campaignId,
      }),
    );
  });

  it("alerts when funds are released on-chain while an off-chain dispute is open (#950)", async () => {
    const campaign = await seedCampaign("release-dispute", "5");
    await prisma.showCampaignDispute.create({
      data: {
        campaignId: campaign.id,
        initiatorRole: "operator",
        status: "open",
      },
    });
    mismatches.length = 0;

    await service.processLog(
      buildLog("FundsReleased", {
        campaignId: 5n,
        beneficiary: BACKER as `0x${string}`,
        amount: 1000n,
      }),
      CHAIN_ID,
      ESCROW,
    );

    // Chain is authoritative — status advances — but the open dispute is flagged.
    const released = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(released.onChainStatus).toBe("Released");
    expect(
      mismatches.some(
        (m) =>
          m.escrowEventName === "FundsReleased" &&
          /dispute is open/.test(m.reason),
      ),
    ).toBe(true);
  });
});
