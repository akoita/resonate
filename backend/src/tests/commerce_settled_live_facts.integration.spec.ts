/**
 * #1894: live `commerce.settled` facts from the real settlement rails.
 *
 * NO MOCKS. Real EventBus + real ContractsService (Sold-log indexing) + real
 * analytics bridge/ingest + real Postgres. Asserts one fact per settlement,
 * idempotent replays, the contract-backed x402 exclusion, exact stablecoin USD,
 * the native-token null-USD rule, and that `payoutUsd` is computed from these
 * real facts.
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { ContractsService } from '../modules/contracts/contracts.service';
import { AnalyticsIngestService } from '../modules/analytics/analytics_ingest.service';
import { PrismaAnalyticsEventStore } from '../modules/analytics/analytics_event_store';
import { AnalyticsDiscoveryMetadataService } from '../modules/analytics/analytics_discovery_metadata.service';
import { AnalyticsDomainEventBridgeService } from '../modules/analytics/analytics_domain_event_bridge.service';
import { buildAnalyticsWarehouseExport } from '../modules/analytics/analytics_warehouse';
import { pseudonymousAnalyticsActorId } from '../modules/analytics/analytics_identity';
import {
  commerceSettledEventId,
  loadX402CommerceSettled,
  marketplaceCommerceSettlementKey,
  publishCommerceSettled,
  x402CommerceSettlementKey,
} from '../modules/analytics/analytics_commerce_settled';
import type { ContractStemSoldEvent } from '../events/event_types';

const P = `csl_${Date.now()}_`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chainId = 31337;
const contractAddr = '0x' + 'C'.repeat(40);
const usdcToken = '0x' + 'a'.repeat(40);
const nativeToken = '0x0000000000000000000000000000000000000000';
const buyerAddress = '0x' + 'b'.repeat(40);
const listingBase = BigInt(Date.now()) * 10n;

async function waitForEvent(eventId: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const row = await prisma.analyticsEvent.findUnique({ where: { eventId } });
    if (row) return row;
    await wait(100);
  }
  return null;
}

function settledFactsFor(settlementKey: string) {
  return prisma.analyticsEvent.findMany({
    where: { eventName: 'commerce.settled', payload: { path: ['settlementKey'], equals: settlementKey } },
  });
}

describe('#1894 live commerce.settled facts', () => {
  const userId = `${P}user`;
  const buyerUserId = `${P}buyer`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;
  let stemId: string;
  let eventBus: EventBus;
  let bridge: AnalyticsDomainEventBridgeService;
  const previousAssets = process.env.PAYMENT_ASSETS_JSON;
  const logger = { warn: jest.fn() };

  beforeAll(async () => {
    process.env.PAYMENT_ASSETS_JSON = JSON.stringify([
      {
        assetId: 'local:usdc',
        chainId,
        symbol: 'USDC',
        tokenAddress: usdcToken,
        decimals: 6,
        enabled: true,
        pricingStrategy: 'usd_pegged',
      },
    ]);
    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.user.create({ data: { id: buyerUserId, email: `${P}buyer@test.resonate` } });
    await prisma.wallet.create({ data: { userId: buyerUserId, address: buyerAddress, chainId } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'Settled Artist', payoutAddress: '0x' + 'D'.repeat(40) },
    });
    await prisma.release.create({ data: { id: releaseId, title: 'Settled Release', artistId, status: 'ready' } });
    await prisma.track.create({ data: { id: trackId, title: 'Settled Track', releaseId, position: 1 } });
    const stem = await prisma.stem.create({
      data: { trackId, type: 'vocals', uri: '/catalog/stems/settled_vocals.mp3' },
    });
    stemId = stem.id;

    for (const [offset, paymentToken, licenseType] of [
      [1n, usdcToken, 'remix'],
      [2n, nativeToken, 'personal'],
    ] as const) {
      await prisma.stemListing.create({
        data: {
          listingId: listingBase + offset,
          stemId,
          tokenId: 900n,
          chainId,
          contractAddress: contractAddr,
          sellerAddress: '0x' + 'e'.repeat(40),
          pricePerUnit: '1',
          amount: 10n,
          paymentToken,
          expiresAt: new Date(Date.now() + 86_400_000),
          transactionHash: `0x${P}list_${offset}`,
          blockNumber: 1n,
          licenseType,
          listedAt: new Date(),
        },
      });
    }

    eventBus = new EventBus();
    const contractsService = new ContractsService(eventBus as any, {} as any);
    (contractsService as any).subscribeToContractEvents();
    const ingest = new AnalyticsIngestService(
      new PrismaAnalyticsEventStore(),
      undefined,
      new AnalyticsDiscoveryMetadataService(),
    );
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();
  });

  afterAll(async () => {
    bridge.onModuleDestroy();
    if (previousAssets === undefined) delete process.env.PAYMENT_ASSETS_JSON;
    else process.env.PAYMENT_ASSETS_JSON = previousAssets;
    await prisma.analyticsEvent
      .deleteMany({ where: { eventName: 'commerce.settled', payload: { path: ['artistId'], equals: artistId } } })
      .catch(() => {});
    await prisma.x402Settlement.deleteMany({ where: { receiptId: { startsWith: P } } }).catch(() => {});
    await prisma.stemPurchase.deleteMany({ where: { transactionHash: { startsWith: `0x${P}` } } }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { transactionHash: { startsWith: `0x${P}` } } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: buyerUserId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userId, buyerUserId] } } }).catch(() => {});
  });

  function soldEvent(offset: bigint, txSuffix: string, totalPaid: string): ContractStemSoldEvent {
    return {
      eventName: 'contract.stem_sold',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: String(listingBase + offset),
      buyerAddress,
      amount: '1',
      totalPaid,
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}${txSuffix}`,
      logIndex: 3,
      blockNumber: '10',
    };
  }

  async function payoutViewFor(eventIds: string[]) {
    const rows = await prisma.analyticsEvent.findMany({ where: { eventId: { in: eventIds } } });
    const exported = buildAnalyticsWarehouseExport(rows.map((row) => row.envelope));
    return exported.analyticsViews.filter(
      (view) => view.eventName === 'commerce.settled' && view.artistId === artistId,
    );
  }

  it('emits exactly one stablecoin fact per marketplace sale, even when the Sold log is re-processed', async () => {
    const event = soldEvent(1n, 'usdc_sold', '2500000');
    const key = marketplaceCommerceSettlementKey(chainId, event.transactionHash, event.logIndex);
    const eventId = commerceSettledEventId(key);

    eventBus.publish(event);
    const row = await waitForEvent(eventId);
    expect(row).not.toBeNull();

    eventBus.publish(event);
    await wait(1000);

    expect(await prisma.stemPurchase.count({ where: { transactionHash: event.transactionHash } })).toBe(1);
    const facts = await settledFactsFor(key);
    expect(facts).toHaveLength(1);
    const payload = facts[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      rail: 'marketplace',
      resourceKind: 'stem',
      stemId,
      trackId,
      releaseId,
      artistId,
      licenseType: 'remix',
      amountUsd: 2.5,
      canonicalAmountUsd: 2.5,
      paymentAssetSymbol: 'USDC',
      settlementAmountUnits: '2500000',
      status: 'settled',
    });
    expect(facts[0].actorId).toBe(pseudonymousAnalyticsActorId(buyerUserId));
    expect(JSON.stringify(facts[0].payload)).not.toContain(buyerAddress);
    expect(facts[0].actorId).not.toContain(buyerAddress);

    const views = await payoutViewFor([eventId]);
    expect(views).toHaveLength(1);
    expect(views[0].payoutUsd).toBe(2.5);
    expect(views[0].eventCount).toBe(1);
  }, 20000);

  it('counts a native-token sale as settled commerce without inventing a USD amount', async () => {
    const event = soldEvent(2n, 'eth_sold', '1000000000000000');
    const key = marketplaceCommerceSettlementKey(chainId, event.transactionHash, event.logIndex);
    const eventId = commerceSettledEventId(key);

    eventBus.publish(event);
    const row = await waitForEvent(eventId);
    expect(row).not.toBeNull();
    const payload = row!.payload as Record<string, unknown>;
    expect(payload.amountUsd).toBeNull();
    expect(payload.canonicalAmountUsd).toBeNull();
    expect(payload.paymentAssetSymbol).toBe('ETH');
    expect(payload.licenseType).toBe('personal');

    const views = await payoutViewFor([eventId]);
    expect(views).toHaveLength(1);
    expect(views[0].eventCount).toBe(1);
    expect(views[0].payoutUsd).toBe(0);
  }, 20000);

  async function seedX402Settlement(suffix: string, overrides: Record<string, unknown>) {
    return prisma.x402Settlement.create({
      data: {
        stemId,
        payerAddress: buyerAddress,
        paymentRail: 'facilitator',
        receiptId: `${P}${suffix}`,
        receipt: { license: { key: 'personal' } },
        status: 'download_granted',
        contractSettlementStatus: 'download_only',
        paymentToken: usdcToken,
        paymentAssetSymbol: 'USDC',
        paymentAssetDecimals: 6,
        settlementAmount: '1',
        settlementAmountUnits: '1000000',
        canonicalAmountUsd: '1',
        purchasedAt: new Date(),
        ...overrides,
      },
    });
  }

  it('emits one fact for an x402 settlement outside the marketplace contract, idempotently', async () => {
    const settlement = await seedX402Settlement('offchain', {});
    const key = x402CommerceSettlementKey(settlement.id);

    await publishCommerceSettled(eventBus, () => loadX402CommerceSettled({ id: settlement.id }), logger, 'test');
    expect(await waitForEvent(commerceSettledEventId(key))).not.toBeNull();
    await publishCommerceSettled(eventBus, () => loadX402CommerceSettled({ receiptId: settlement.receiptId }), logger, 'test');
    await wait(500);

    const facts = await settledFactsFor(key);
    expect(facts).toHaveLength(1);
    expect(facts[0].payload).toMatchObject({
      rail: 'x402',
      paymentRail: 'facilitator',
      stemId,
      trackId,
      artistId,
      licenseType: 'personal',
      amountUsd: 1,
      canonicalAmountUsd: 1,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  }, 20000);

  it('emits no x402 fact for contract-backed or unfinished settlements', async () => {
    const contractBacked = await seedX402Settlement('backed', { contractSettlementStatus: 'contract_backed' });
    const refundDue = await seedX402Settlement('refund', { status: 'refund_due', contractSettlementStatus: 'not_applicable' });

    for (const settlement of [contractBacked, refundDue]) {
      expect(await loadX402CommerceSettled({ id: settlement.id })).toBeNull();
      await publishCommerceSettled(eventBus, () => loadX402CommerceSettled({ id: settlement.id }), logger, 'test');
    }
    await wait(500);

    expect(await settledFactsFor(x402CommerceSettlementKey(contractBacked.id))).toHaveLength(0);
    expect(await settledFactsFor(x402CommerceSettlementKey(refundDue.id))).toHaveLength(0);
  }, 20000);
});
