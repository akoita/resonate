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

import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { ShowsService } from "../modules/shows/shows.service";

const TEST_PREFIX = `recon_mismatch_${Date.now()}_`;
const CAMPAIGN_A = `${TEST_PREFIX}101`;
const CAMPAIGN_B = `${TEST_PREFIX}202`;

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
  });

  afterAll(async () => {
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
});
