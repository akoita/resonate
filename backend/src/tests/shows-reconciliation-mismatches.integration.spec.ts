/**
 * ShowsService.listReconciliationMismatches (#1271) — integration
 * (Testcontainers Postgres).
 *
 * The operator endpoint GET /shows/operator/reconciliation-mismatches reads the
 * durable analytics facts the domain-event bridge writes for
 * `shows.campaign_reconciliation_mismatch`. This suite seeds real analyticsEvent
 * rows and asserts the query's filtering (event name, contractCampaignId,
 * sinceMinutes window), ordering (newest first), caps, and access control.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { ShowsService } from "../modules/shows/shows.service";

const TEST_PREFIX = `recon_mismatch_${Date.now()}_`;
const CAMPAIGN_A = `${TEST_PREFIX}101`;
const CAMPAIGN_B = `${TEST_PREFIX}202`;
const CHAIN_ID = 31337;
const ESCROW = "0x" + "7".repeat(40);
const OTHER_ESCROW = "0x" + "8".repeat(40);
const ACK_CAMPAIGN = String(Date.now());
const ACK_TX = txHash(ACK_CAMPAIGN);

const operator = { userId: "op-1", role: "operator" };

function txHash(seed: string): string {
  return "0x" + seed.padStart(64, "0");
}

// Seed a mismatch analyticsEvent row exactly as the bridge would write it:
// eventName + subjectId(contractCampaignId) + payload fields.
async function seedMismatch(params: {
  suffix: string;
  contractCampaignId: string;
  occurredAt: Date;
  transactionHash: string;
  blockNumber: string;
  reason: string;
  escrowEventName?: string;
  chainId?: number;
  contractAddress?: string;
}): Promise<void> {
  await prisma.analyticsEvent.create({
    data: {
      eventId: `${TEST_PREFIX}${params.suffix}`,
      eventName: "shows.campaign_reconciliation_mismatch",
      eventVersion: 1,
      occurredAt: params.occurredAt,
      receivedAt: params.occurredAt,
      producer: "shows-escrow-indexer",
      environment: "test",
      privacyTier: "pseudonymous",
      subjectType: "show_campaign",
      subjectId: params.contractCampaignId,
      payload: {
        contractCampaignId: params.contractCampaignId,
        ...(params.chainId ? { chainId: params.chainId } : {}),
        ...(params.contractAddress ? { contractAddress: params.contractAddress } : {}),
        escrowEventName: params.escrowEventName ?? "Pledged",
        transactionHash: params.transactionHash,
        blockNumber: params.blockNumber,
        reason: params.reason,
      },
      envelope: { schema: "test" },
    },
  });
}

describe("ShowsService.listReconciliationMismatches (integration)", () => {
  const service = new ShowsService();

  beforeAll(async () => {
    const now = Date.now();
    // Campaign A: two mismatches, distinct times (newest = mismatch2).
    await seedMismatch({
      suffix: "a1",
      contractCampaignId: CAMPAIGN_A,
      occurredAt: new Date(now - 30 * 60 * 1000),
      transactionHash: txHash("a1"),
      blockNumber: "1000",
      reason: `on-chain pledge from ${txHash("dead")} (99) has no matching backend intent`,
    });
    await seedMismatch({
      suffix: "a2",
      contractCampaignId: CAMPAIGN_A,
      occurredAt: new Date(now - 10 * 60 * 1000),
      transactionHash: txHash("a2"),
      blockNumber: "1010",
      reason: `no backend campaign bound to escrow campaign ${CAMPAIGN_A}`,
      escrowEventName: "CampaignFunded",
    });
    // Campaign B: one recent mismatch (isolation check).
    await seedMismatch({
      suffix: "b1",
      contractCampaignId: CAMPAIGN_B,
      occurredAt: new Date(now - 5 * 60 * 1000),
      transactionHash: txHash("b1"),
      blockNumber: "2000",
      reason: "has no matching backend intent",
    });
    // Campaign A: an OLD mismatch outside a short lookback window.
    await seedMismatch({
      suffix: "aold",
      contractCampaignId: CAMPAIGN_A,
      occurredAt: new Date(now - 8 * 24 * 60 * 60 * 1000), // 8 days ago
      transactionHash: txHash("aold"),
      blockNumber: "900",
      reason: "stale mismatch outside the window",
    });
    // A non-mismatch analytics row that must never be returned.
    await prisma.analyticsEvent.create({
      data: {
        eventId: `${TEST_PREFIX}other`,
        eventName: "shows.campaign_settled",
        eventVersion: 1,
        occurredAt: new Date(now - 1 * 60 * 1000),
        receivedAt: new Date(now - 1 * 60 * 1000),
        producer: "shows-escrow-indexer",
        environment: "test",
        privacyTier: "pseudonymous",
        subjectId: CAMPAIGN_A,
        payload: { contractCampaignId: CAMPAIGN_A },
        envelope: { schema: "test" },
      },
    });
    await prisma.showCampaignEscrowEvent.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: ESCROW,
        eventName: "CampaignCreated",
        contractCampaignId: ACK_CAMPAIGN,
        transactionHash: ACK_TX,
        logIndex: 0,
        blockNumber: 3000n,
        blockHash: txHash("bc"),
        args: { campaignId: ACK_CAMPAIGN },
        processedAt: new Date(),
      },
    });
    await seedMismatch({
      suffix: "ack",
      contractCampaignId: ACK_CAMPAIGN,
      occurredAt: new Date(now - 2 * 60 * 1000),
      transactionHash: ACK_TX,
      blockNumber: "3000",
      reason: `no backend campaign bound to escrow campaign ${ACK_CAMPAIGN}`,
      escrowEventName: "CampaignCreated",
      // Legacy fact: #1534 identity fields were not present yet. The list must
      // correlate this through the durable escrow event, not campaign id alone.
    });
  });

  afterAll(async () => {
    await prisma.showEscrowReconciliationAcknowledgement.deleteMany({
      where: { chainId: CHAIN_ID, contractCampaignId: ACK_CAMPAIGN },
    });
    await prisma.showCampaignEscrowEvent.deleteMany({ where: { transactionHash: ACK_TX } });
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: TEST_PREFIX } } });
  });

  it("returns only mismatch events, newest first, mapped to the operator shape", async () => {
    const rows = await service.listReconciliationMismatches(operator, {
      contractCampaignId: CAMPAIGN_A,
    });

    // Two in-window mismatches for campaign A (the 8-day-old one is excluded by
    // the default 24h window; the settled row is excluded by event name).
    expect(rows).toHaveLength(2);
    expect(rows[0].transactionHash).toBe(txHash("a2")); // newest first
    expect(rows[1].transactionHash).toBe(txHash("a1"));
    expect(rows[0]).toMatchObject({
      contractCampaignId: CAMPAIGN_A,
      escrowEventName: "CampaignFunded",
      blockNumber: "1010",
    });
    expect(rows[1].reason).toContain("no matching backend intent");
  });

  it("filters by contractCampaignId (campaign B isolated from A)", async () => {
    const rows = await service.listReconciliationMismatches(operator, {
      contractCampaignId: CAMPAIGN_B,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].contractCampaignId).toBe(CAMPAIGN_B);
    expect(rows[0].transactionHash).toBe(txHash("b1"));
  });

  it("honors the sinceMinutes window (excludes the 8-day-old row, includes it when widened)", async () => {
    const narrow = await service.listReconciliationMismatches(operator, {
      contractCampaignId: CAMPAIGN_A,
      sinceMinutes: 60,
    });
    expect(narrow).toHaveLength(2);

    const wide = await service.listReconciliationMismatches(operator, {
      contractCampaignId: CAMPAIGN_A,
      sinceMinutes: 10080, // 7 days max — still excludes the 8-day-old row
    });
    expect(wide).toHaveLength(2);
    expect(wide.every((r) => r.transactionHash !== txHash("aold"))).toBe(true);
  });

  it("applies the limit cap", async () => {
    const rows = await service.listReconciliationMismatches(operator, {
      contractCampaignId: CAMPAIGN_A,
      limit: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].transactionHash).toBe(txHash("a2")); // newest under the cap
  });

  it("rejects a non-privileged actor", async () => {
    await expect(
      service.listReconciliationMismatches({ userId: "u-1", role: "listener" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("acknowledges an indexed exact identity idempotently and flags its mismatch", async () => {
    const first = await service.acknowledgeReconciliationMismatch(operator, `000${ACK_CAMPAIGN}`, {
      chainId: String(CHAIN_ID),
      contractAddress: ESCROW.toUpperCase().replace("0X", "0x"),
      note: "  Known staging artifact  ",
    });
    expect(first).toMatchObject({
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
      contractCampaignId: ACK_CAMPAIGN,
      acknowledged: true,
      acknowledgedByUserId: "op-1",
      acknowledgementNote: "Known staging artifact",
    });

    const second = await service.acknowledgeReconciliationMismatch(
      { userId: "op-2", role: "admin" },
      ACK_CAMPAIGN,
      { chainId: CHAIN_ID, contractAddress: ESCROW, note: "must not replace first note" },
    );
    expect(second.acknowledgedAt).toBe(first.acknowledgedAt);
    expect(second.acknowledgedByUserId).toBe("op-1");
    expect(second.acknowledgementNote).toBe("Known staging artifact");

    const rows = await service.listReconciliationMismatches(operator, {
      contractCampaignId: ACK_CAMPAIGN,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
      acknowledged: true,
      acknowledgedByUserId: "op-1",
      acknowledgementNote: "Known staging artifact",
    });
  });

  it("retains revocation audit state idempotently and supports re-acknowledgement", async () => {
    const removed = await service.removeReconciliationAcknowledgement(operator, ACK_CAMPAIGN, {
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
    });
    expect(removed).toMatchObject({
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
      contractCampaignId: ACK_CAMPAIGN,
      acknowledged: false,
      acknowledgedByUserId: "op-1",
      acknowledgementNote: "Known staging artifact",
      revokedByUserId: "op-1",
    });
    expect(removed.revokedAt).toEqual(expect.any(String));
    const repeated = await service.removeReconciliationAcknowledgement(
      { userId: "op-2", role: "admin" },
      ACK_CAMPAIGN,
      {
        chainId: CHAIN_ID,
        contractAddress: ESCROW,
      },
    );
    expect(repeated.revokedAt).toBe(removed.revokedAt);
    expect(repeated.revokedByUserId).toBe("op-1");
    const revokedRows = await service.listReconciliationMismatches(operator, {
      contractCampaignId: ACK_CAMPAIGN,
    });
    expect(revokedRows[0]).toMatchObject({
      acknowledged: false,
      revokedAt: removed.revokedAt,
      revokedByUserId: "op-1",
    });

    const reactivated = await service.acknowledgeReconciliationMismatch(
      { userId: "op-3", role: "operator" },
      ACK_CAMPAIGN,
      {
        chainId: CHAIN_ID,
        contractAddress: ESCROW,
        note: "Reconfirmed after review",
      },
    );
    expect(reactivated).toMatchObject({
      acknowledged: true,
      acknowledgedByUserId: "op-3",
      acknowledgementNote: "Reconfirmed after review",
      revokedAt: null,
      revokedByUserId: null,
    });
    const rows = await service.listReconciliationMismatches(operator, {
      contractCampaignId: ACK_CAMPAIGN,
    });
    expect(rows[0]).toMatchObject({
      acknowledged: true,
      acknowledgedByUserId: "op-3",
      revokedAt: null,
      revokedByUserId: null,
    });

    await expect(service.removeReconciliationAcknowledgement(operator, ACK_CAMPAIGN, {
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
    })).resolves.toMatchObject({ acknowledged: false });
  });

  it("requires an indexed exact triple and validates acknowledgement identities", async () => {
    await expect(service.acknowledgeReconciliationMismatch(operator, ACK_CAMPAIGN, {
      chainId: CHAIN_ID,
      contractAddress: OTHER_ESCROW,
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.acknowledgeReconciliationMismatch(operator, "0", {
      chainId: CHAIN_ID,
      contractAddress: ESCROW,
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.acknowledgeReconciliationMismatch(operator, ACK_CAMPAIGN, {
      chainId: 0,
      contractAddress: ESCROW,
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.acknowledgeReconciliationMismatch(operator, ACK_CAMPAIGN, {
      chainId: 2_147_483_648,
      contractAddress: ESCROW,
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.acknowledgeReconciliationMismatch(operator, ACK_CAMPAIGN, {
      chainId: CHAIN_ID,
      contractAddress: "0x" + "0".repeat(40),
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.acknowledgeReconciliationMismatch(
      { userId: "listener", role: "listener" },
      ACK_CAMPAIGN,
      { chainId: CHAIN_ID, contractAddress: ESCROW },
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
});
