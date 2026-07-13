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

const EVENT_ABIS = {
  CampaignCreated: parseAbiItem(
    "event CampaignCreated(uint256 indexed campaignId, bytes32 indexed artistIdHash, bytes32 indexed authorityHash, address beneficiary, address paymentToken, uint256 goalAmount, uint256 minimumBackers, uint256 deadline, uint256 bookingDeadline)",
  ),
  CampaignActivated: parseAbiItem("event CampaignActivated(uint256 indexed campaignId)"),
  Pledged: parseAbiItem(
    "event Pledged(uint256 indexed campaignId, address indexed backer, uint256 amount, uint256 totalPledged)",
  ),
  CampaignFunded: parseAbiItem(
    "event CampaignFunded(uint256 indexed campaignId, uint256 totalPledged, uint256 uniqueBackers)",
  ),
  RefundAvailable: parseAbiItem("event RefundAvailable(uint256 indexed campaignId)"),
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

  beforeAll(async () => {
    savedEscrowAddr = process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS;
    savedChainId = process.env.INDEXER_CHAIN_ID;
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
    await prisma.showCampaignEscrowEvent.deleteMany({ where: { contractAddress: ESCROW } });
    await prisma.showEscrowIndexerState.deleteMany({ where: { contractAddress: ESCROW } });
    await prisma.showPledge.deleteMany({ where: { campaign: { slug: { startsWith: TEST_PREFIX } } } });
    await prisma.showCampaignEvent.deleteMany({ where: { campaign: { slug: { startsWith: TEST_PREFIX } } } });
    await prisma.showCampaign.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    if (savedEscrowAddr === undefined) delete process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS;
    else process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = savedEscrowAddr;
    if (savedChainId === undefined) delete process.env.INDEXER_CHAIN_ID;
    else process.env.INDEXER_CHAIN_ID = savedChainId;
  });

  // Each test uses a distinct on-chain campaign id so reconcile() binds to the
  // right backend row (it matches on chainId + contractAddress + contractCampaignId).
  async function seedCampaign(slugSuffix: string, contractCampaignId: string) {
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
        contractAddress: ESCROW,
        contractCampaignId,
        status: "active",
        campaignLevel: "active_escrow_campaign",
      },
    });
  }

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

    const confirmed = await prisma.showPledge.findUniqueOrThrow({ where: { id: pledge.id } });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmationStatus).toBe("confirmed");

    const afterPledge = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(afterPledge.raisedAmountUnits).toBe("600");
    expect(afterPledge.confirmedPledgeCount).toBe(1);
    expect(afterPledge.uniqueBackerCount).toBe(1);

    await service.processLog(
      buildLog("CampaignFunded", { campaignId: 1n, totalPledged: 600n, uniqueBackers: 1n }),
      CHAIN_ID,
      ESCROW,
    );
    const funded = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
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

    await service.processLog(buildLog("RefundAvailable", { campaignId: 3n }), CHAIN_ID, ESCROW);
    await service.processLog(
      buildLog("RefundClaimed", { campaignId: 3n, backer: BACKER as `0x${string}`, amount: 400n }),
      CHAIN_ID,
      ESCROW,
    );

    const refunded = await prisma.showPledge.findUniqueOrThrow({ where: { id: pledge.id } });
    expect(refunded.status).toBe("refunded");
    const after = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
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

    const updated = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(updated.feeBps).toBe(600);
  });

  it("reconciles net release events with same-transaction FeeCharged gross accounting", async () => {
    const campaign = await seedCampaign("release-fee", "7");
    settlements.length = 0;
    const txHash = ("0x" + "77".repeat(32)) as `0x${string}`;

    await service.processLog(
      buildLog("FeeCharged", {
        campaignId: 7n,
        feeRecipient: FEE_RECIPIENT as `0x${string}`,
        amount: 60n,
      }, { transactionHash: txHash, logIndex: 0 }),
      CHAIN_ID,
      ESCROW,
    );
    await service.processLog(
      buildLog("FundsReleased", {
        campaignId: 7n,
        beneficiary: BACKER as `0x${string}`,
        amount: 940n,
      }, { transactionHash: txHash, logIndex: 1 }),
      CHAIN_ID,
      ESCROW,
    );

    const released = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(released.status).toBe("released");
    expect(released.totalFeePaidUnits).toBe("60");
    expect(released.totalReleasedUnits).toBe("1000");
    expect(released.feeBps).toBe(600);
    expect(settlements).toContainEqual(expect.objectContaining({
      eventName: "shows.campaign_settled",
      settlementStage: "final",
      grossAmountUnits: "1000",
      feeAmountUnits: "60",
      netAmountUnits: "940",
      feeBps: 600,
      totalFeePaidUnits: "60",
      transactionHash: txHash,
    }));
  });

  it("emits a reconciliation mismatch for an on-chain pledge with no backend intent", async () => {
    await seedCampaign("mismatch", "4");
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
        .filter((line) => line.includes('"event":"shows.campaign_reconciliation_mismatch"'));
      infoSpy.mockRestore();
    }

    expect(mismatches.length).toBeGreaterThanOrEqual(1);
    expect(mismatches[0]).toMatchObject({
      eventName: "shows.campaign_reconciliation_mismatch",
      escrowEventName: "Pledged",
    });
    // No secret leakage in the audit event.
    expect(JSON.stringify(mismatches[0])).not.toContain(ESCROW);

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
    });
    expect(String(structured.reason)).toContain("no matching backend intent");
  });

  it("alerts when funds are released on-chain while an off-chain dispute is open (#950)", async () => {
    const campaign = await seedCampaign("release-dispute", "5");
    await prisma.showCampaignDispute.create({
      data: { campaignId: campaign.id, initiatorRole: "operator", status: "open" },
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
    const released = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(released.onChainStatus).toBe("Released");
    expect(
      mismatches.some(
        (m) => m.escrowEventName === "FundsReleased" && /dispute is open/.test(m.reason),
      ),
    ).toBe(true);
  });
});
