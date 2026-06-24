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

const EVENT_ABIS = {
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
  RefundClaimed: parseAbiItem(
    "event RefundClaimed(uint256 indexed campaignId, address indexed backer, uint256 amount)",
  ),
} as const;

let logCounter = 0;
function buildLog(
  eventName: keyof typeof EVENT_ABIS,
  args: Record<string, unknown>,
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
    transactionHash: ("0x" + logCounter.toString(16).padStart(64, "0")) as `0x${string}`,
    logIndex: 0,
    blockHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    removed: false,
    transactionIndex: 0,
  } as Log;
}

describe("ShowsEscrowIndexerService reconciliation (integration)", () => {
  const eventBus = new EventBus();
  const service = new ShowsEscrowIndexerService(eventBus);
  const mismatches: any[] = [];
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
  });

  afterAll(async () => {
    await prisma.showCampaignEscrowEvent.deleteMany({ where: { contractAddress: ESCROW } });
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

  it("emits a reconciliation mismatch for an on-chain pledge with no backend intent", async () => {
    await seedCampaign("mismatch", "4");
    mismatches.length = 0;

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

    expect(mismatches.length).toBeGreaterThanOrEqual(1);
    expect(mismatches[0]).toMatchObject({
      eventName: "shows.campaign_reconciliation_mismatch",
      escrowEventName: "Pledged",
    });
    // No secret leakage in the audit event.
    expect(JSON.stringify(mismatches[0])).not.toContain(ESCROW);
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
