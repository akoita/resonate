/**
 * Multi-tier listing in one transaction — Integration Test (#2041)
 *
 * An artist lists one stem under several license tiers in a single batched
 * UserOperation (one StemMarketplaceV2.list() per tier). Each indexed
 * StemListing must carry the tier its own list() call was made for, whether
 * the client's notify-listing call reaches the backend before or after the
 * indexer, and whatever order the Listed handlers run in.
 *
 * Real EventBus + real ContractsService + real MetadataController against
 * Testcontainer Postgres; only the IndexerService (RPC) is stubbed.
 *
 * Run: npm run test:integration -- multi_tier_listing
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { ContractsService } from '../modules/contracts/contracts.service';
import { MetadataController } from '../modules/contracts/metadata.controller';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ContractStemListedEvent } from '../events/event_types';

const P = `mtl_${Date.now()}_`;
const CHAIN_ID = 31337;
const MARKETPLACE = '0x' + 'e'.repeat(40);
const SELLER = ('0x' + 'a7'.repeat(20)).toLowerCase();
const OTHER_SELLER = ('0x' + 'c9'.repeat(20)).toLowerCase();
const asUser = (address: string) => ({ user: { userId: address, role: 'listener' } });
const STABLECOIN = ('0x' + '5'.repeat(40)).toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';
// Token ids unique to this run so supersession never crosses other suites.
const TOKEN_BASE = 7_000_000 + Math.floor(Math.random() * 1_000_000) * 10;

const tx = (label: string) => `0x${P}${label}`;

async function waitForListing(transactionHash: string, listingId: bigint, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listing = await prisma.stemListing.findFirst({ where: { transactionHash, listingId } });
    if (listing) return listing;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`listing ${listingId} of ${transactionHash} was not indexed`);
}

describe('Multi-tier listing in one transaction (#2041)', () => {
  let eventBus: EventBus;
  let contractsService: ContractsService;
  let controller: MetadataController;
  let indexerService: { indexTransaction: jest.Mock };
  let stemId: string;
  let previousIndexerChainId: string | undefined;
  let previousAaChainId: string | undefined;

  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;

  beforeAll(async () => {
    previousIndexerChainId = process.env.INDEXER_CHAIN_ID;
    previousAaChainId = process.env.AA_CHAIN_ID;
    process.env.INDEXER_CHAIN_ID = String(CHAIN_ID);
    process.env.AA_CHAIN_ID = String(CHAIN_ID);

    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'Tier Artist', payoutAddress: SELLER },
    });
    await prisma.release.create({
      data: { id: releaseId, title: 'Tier Release', artistId, status: 'published' },
    });
    await prisma.track.create({ data: { id: trackId, title: 'Tier Track', releaseId, position: 1 } });
    const stem = await prisma.stem.create({
      data: { trackId, type: 'vocals', uri: '/catalog/stems/tier_vocals.mp3' },
    });
    stemId = stem.id;

    eventBus = new EventBus();
    contractsService = new ContractsService(eventBus as any, {} as any);
    (contractsService as any).subscribeToContractEvents();
    indexerService = { indexTransaction: jest.fn().mockResolvedValue({ processed: 0 }) };
    controller = new MetadataController(contractsService, indexerService as any, undefined as any, eventBus);
  });

  afterAll(async () => {
    if (previousIndexerChainId === undefined) delete process.env.INDEXER_CHAIN_ID;
    else process.env.INDEXER_CHAIN_ID = previousIndexerChainId;
    if (previousAaChainId === undefined) delete process.env.AA_CHAIN_ID;
    else process.env.AA_CHAIN_ID = previousAaChainId;

    const ours = { transactionHash: { startsWith: `0x${P}` } };
    await prisma.stemListing.deleteMany({ where: ours }).catch(() => {});
    await prisma.stemListingIntent.deleteMany({ where: ours }).catch(() => {});
    await prisma.contractEvent.deleteMany({ where: ours }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  /** What the indexer persists for a Listed log before publishing it. */
  async function seedRawListed(
    transactionHash: string,
    logIndex: number,
    listingId: bigint,
    tokenId: number,
    seller = SELLER,
  ) {
    await prisma.contractEvent.create({
      data: {
        eventName: 'Listed',
        chainId: CHAIN_ID,
        contractAddress: MARKETPLACE,
        transactionHash,
        logIndex,
        blockNumber: 10n,
        blockHash: '0x' + 'b'.repeat(64),
        args: {
          listingId: listingId.toString(),
          // viem decodes addresses checksummed; matching is case-insensitive.
          seller: seller.toUpperCase().replace(/^0X/, '0x'),
          tokenId: String(tokenId),
          amount: '1',
          price: '1',
        },
      },
    });
  }

  async function publishListed(
    transactionHash: string,
    listingId: bigint,
    tokenId: number,
    opts: { logIndex?: number; pricePerUnit?: string; amount?: string; seller?: string } = {},
  ) {
    const event: ContractStemListedEvent = {
      eventName: 'contract.stem_listed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: listingId.toString(),
      sellerAddress: opts.seller ?? SELLER,
      tokenId: String(tokenId),
      amount: opts.amount ?? '1',
      pricePerUnit: opts.pricePerUnit ?? '1',
      paymentToken: ZERO,
      expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
      chainId: CHAIN_ID,
      contractAddress: MARKETPLACE,
      transactionHash,
      logIndex: opts.logIndex,
      blockNumber: '10',
    };
    eventBus.publish(event);
    return waitForListing(transactionHash, listingId);
  }

  function notifyTiers(
    transactionHash: string,
    tokenId: number,
    tiers: Array<{ licenseType: 'personal' | 'remix' | 'commercial'; pricePerUnit: string; ordinal: number; listingId?: string }>,
    seller = SELLER,
  ) {
    return controller.notifyListingCreated(asUser(seller), {
      tokenId: String(tokenId),
      chainId: CHAIN_ID,
      sellerAddress: seller,
      paymentToken: STABLECOIN,
      durationSeconds: '86400',
      transactionHash,
      stemId,
      tiers: tiers.map((tier) => ({ ...tier, amount: '1' })),
    });
  }

  it('stores one intent per tier and maps each listing by its on-chain listingId (notify first)', async () => {
    const token = TOKEN_BASE + 1;
    const hash = tx('by_listing_id');
    const result = await notifyTiers(hash, token, [
      { licenseType: 'personal', pricePerUnit: '1000', ordinal: 0, listingId: '501' },
      { licenseType: 'remix', pricePerUnit: '5000', ordinal: 1, listingId: '502' },
    ]);
    expect(result.success).toBe(true);

    const intents = await prisma.stemListingIntent.findMany({
      where: { transactionHash: hash },
      orderBy: { logOrdinal: 'asc' },
    });
    expect(intents.map((i) => [i.licenseType, i.logOrdinal, i.listingId, i.pricePerUnit])).toEqual([
      ['personal', 0, 501n, '1000'],
      ['remix', 1, 502n, '5000'],
    ]);

    // Listing ids decide, even when handled out of log order and without raw rows.
    const remix = await publishListed(hash, 502n, token);
    const personal = await publishListed(hash, 501n, token);
    expect(remix.licenseType).toBe('remix');
    expect(personal.licenseType).toBe('personal');
    expect(remix.paymentToken).toBe(STABLECOIN);
    expect(remix.stemId).toBe(stemId);
    expect(remix.status).toBe('active');
    expect(personal.status).toBe('active');
  });

  it('maps each listing by its log ordinal when the client had no listing ids, handled out of log order', async () => {
    const token = TOKEN_BASE + 2;
    const otherToken = TOKEN_BASE + 3;
    const hash = tx('by_ordinal');
    // Tier array order deliberately differs from the on-chain call order.
    await notifyTiers(hash, token, [
      { licenseType: 'commercial', pricePerUnit: '9000', ordinal: 1 },
      { licenseType: 'remix', pricePerUnit: '5000', ordinal: 0 },
    ]);

    // Receipt: token's first list() (id 41), an unrelated token (id 42), token's second list() (id 43).
    await seedRawListed(hash, 2, 41n, token);
    await seedRawListed(hash, 3, 42n, otherToken);
    await seedRawListed(hash, 4, 43n, token);

    const second = await publishListed(hash, 43n, token, { logIndex: 4 });
    const first = await publishListed(hash, 41n, token, { logIndex: 2 });
    expect(first.licenseType).toBe('remix');
    expect(second.licenseType).toBe('commercial');
    expect(first.status).toBe('active');
    expect(second.status).toBe('active');
  });

  it('reconciles already-indexed listings per tier when notify arrives after the indexer', async () => {
    const token = TOKEN_BASE + 4;
    const hash = tx('index_first');
    await seedRawListed(hash, 0, 71n, token);
    await seedRawListed(hash, 1, 72n, token);
    await publishListed(hash, 71n, token, { logIndex: 0, pricePerUnit: '1000', amount: '3' });
    await publishListed(hash, 72n, token, { logIndex: 1, pricePerUnit: '5000', amount: '3' });

    const before = await prisma.stemListing.findMany({ where: { transactionHash: hash } });
    expect(before.map((l) => l.licenseType)).toEqual(['personal', 'personal']);

    // Client prices/amounts differ from the chain: the chain values must win.
    await notifyTiers(hash, token, [
      { licenseType: 'personal', pricePerUnit: '1', ordinal: 0 },
      { licenseType: 'remix', pricePerUnit: '2', ordinal: 1 },
    ]);

    const after = await prisma.stemListing.findMany({
      where: { transactionHash: hash },
      orderBy: { listingId: 'asc' },
    });
    expect(after.map((l) => [l.listingId, l.licenseType, l.pricePerUnit, l.amount, l.sellerAddress, l.paymentToken, l.status])).toEqual([
      [71n, 'personal', '1000', 3n, SELLER, STABLECOIN, 'active'],
      [72n, 'remix', '5000', 3n, SELLER, STABLECOIN, 'active'],
    ]);
    expect(indexerService.indexTransaction).toHaveBeenCalledWith(hash, CHAIN_ID);
  });

  it('reconciles by listing id without raw log rows', async () => {
    const token = TOKEN_BASE + 5;
    const hash = tx('index_first_ids');
    await publishListed(hash, 81n, token);
    await publishListed(hash, 82n, token);

    await notifyTiers(hash, token, [
      { licenseType: 'commercial', pricePerUnit: '9000', ordinal: 0, listingId: '82' },
      { licenseType: 'remix', pricePerUnit: '5000', ordinal: 1, listingId: '81' },
    ]);

    const after = await prisma.stemListing.findMany({
      where: { transactionHash: hash },
      orderBy: { listingId: 'asc' },
    });
    expect(after.map((l) => [l.listingId, l.licenseType])).toEqual([
      [81n, 'remix'],
      [82n, 'commercial'],
    ]);
  });

  it('hydrates native fallback rows with the payment asset only, keeping chain prices', async () => {
    const token = TOKEN_BASE + 6;
    const hash = tx('hydrate');
    for (const [listingId, licenseType, chainPrice] of [[91n, 'personal', '1000'], [92n, 'remix', '5000']] as const) {
      await prisma.stemListing.create({
        data: {
          listingId,
          stemId,
          tokenId: BigInt(token),
          chainId: CHAIN_ID,
          contractAddress: MARKETPLACE,
          sellerAddress: SELLER,
          pricePerUnit: chainPrice,
          amount: 1n,
          paymentToken: ZERO,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          transactionHash: hash,
          blockNumber: 10n,
          licenseType,
          status: 'active',
          listedAt: new Date(),
        },
      });
    }
    for (const [licenseType, pricePerUnit, logOrdinal] of [['personal', '7', 0], ['remix', '8', 1]] as const) {
      await prisma.stemListingIntent.create({
        data: {
          transactionHash: hash,
          tokenId: BigInt(token),
          chainId: CHAIN_ID,
          stemId,
          sellerAddress: SELLER,
          pricePerUnit,
          amount: 1n,
          paymentToken: STABLECOIN,
          licenseType,
          logOrdinal,
        },
      });
    }

    const listings = await contractsService.getListings({ chainId: CHAIN_ID, stemId, limit: 100 });
    const byId = new Map(listings.filter((l) => l.transactionHash === hash).map((l) => [l.listingId, l]));
    expect(byId.get(91n)?.pricePerUnit).toBe('1000');
    expect(byId.get(92n)?.pricePerUnit).toBe('5000');
    expect(byId.get(91n)?.paymentToken).toBe(STABLECOIN);
    expect(byId.get(92n)?.paymentToken).toBe(STABLECOIN);
  });

  it('keeps the legacy single-tier body, and supersedes only the same tier of the same seller', async () => {
    const token = TOKEN_BASE + 7;
    const legacy = (hash: string, licenseType: 'personal' | 'remix', price: string) =>
      controller.notifyListingCreated(asUser(SELLER), {
        tokenId: String(token),
        chainId: CHAIN_ID,
        sellerAddress: SELLER,
        price,
        amount: '1',
        paymentToken: STABLECOIN,
        durationSeconds: '86400',
        transactionHash: hash,
        stemId,
        licenseType,
      });

    await legacy(tx('legacy_1'), 'remix', '5000');
    const legacyIntent = await prisma.stemListingIntent.findFirst({ where: { transactionHash: tx('legacy_1') } });
    expect(legacyIntent).toMatchObject({ licenseType: 'remix', logOrdinal: null, listingId: null, pricePerUnit: '5000' });
    const first = await publishListed(tx('legacy_1'), 101n, token);
    expect(first.licenseType).toBe('remix');

    // A different tier from the same seller leaves the remix listing active.
    await legacy(tx('legacy_2'), 'personal', '1000');
    const personal = await publishListed(tx('legacy_2'), 102n, token);
    expect(personal.licenseType).toBe('personal');
    expect((await prisma.stemListing.findUnique({ where: { id: first.id } }))!.status).toBe('active');

    // Relisting the same tier supersedes the older remix listing only.
    await legacy(tx('legacy_3'), 'remix', '6000');
    const relisted = await publishListed(tx('legacy_3'), 103n, token);
    expect(relisted.licenseType).toBe('remix');
    expect((await prisma.stemListing.findUnique({ where: { id: first.id } }))!.status).toBe('cancelled');
    expect((await prisma.stemListing.findUnique({ where: { id: personal.id } }))!.status).toBe('active');
  });

  it('rejects malformed tiers with 400 before writing anything', async () => {
    const hash = tx('invalid');
    const base = {
      tokenId: String(TOKEN_BASE + 8),
      chainId: CHAIN_ID,
      sellerAddress: SELLER,
      transactionHash: hash,
      stemId,
    };
    await expect(controller.notifyListingCreated(asUser(SELLER), {
      ...base,
      tiers: [
        { licenseType: 'remix', pricePerUnit: '1', amount: '1', ordinal: 0 },
        { licenseType: 'remix', pricePerUnit: '2', amount: '1', ordinal: 1 },
      ],
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.notifyListingCreated(asUser(SELLER), {
      ...base,
      tiers: [
        { licenseType: 'personal', pricePerUnit: '1', amount: '1', ordinal: 0 },
        { licenseType: 'remix', pricePerUnit: '2', amount: '1', ordinal: 0 },
      ],
    })).rejects.toBeInstanceOf(BadRequestException);
    // A caller notifying for someone else's address is refused.
    await expect(controller.notifyListingCreated(asUser(SELLER), {
      ...base,
      sellerAddress: OTHER_SELLER,
      licenseType: 'remix',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.stemListingIntent.count({ where: { transactionHash: hash } })).toBe(0);
  });

  it('links the stem to the token only for its own artist or an operator', async () => {
    const linkNotify = (req: any, sellerAddress: string, tokenId: number) =>
      controller.notifyListingCreated(req, {
        tokenId: String(tokenId),
        chainId: CHAIN_ID,
        sellerAddress,
        paymentToken: STABLECOIN,
        transactionHash: tx(`link_${tokenId}`),
        stemId,
        licenseType: 'personal',
        pricePerUnit: '1',
        amount: '1',
      } as any);
    const ipnftId = async () =>
      (await prisma.stem.findUniqueOrThrow({ where: { id: stemId }, select: { ipnftId: true } })).ipnftId;
    await prisma.stem.update({ where: { id: stemId }, data: { ipnftId: null } });

    // Another signed-in seller cannot point this stem at their token.
    await linkNotify(asUser(OTHER_SELLER), OTHER_SELLER, TOKEN_BASE + 20);
    expect(await ipnftId()).toBeNull();

    // The stem's own artist (whose wallet is the seller) can.
    const wallet = await prisma.wallet.create({
      data: { userId, address: SELLER, chainId: CHAIN_ID },
    });
    try {
      await linkNotify(asUser(userId), SELLER, TOKEN_BASE + 21);
      expect(await ipnftId()).toBe(String(TOKEN_BASE + 21));
    } finally {
      await prisma.wallet.delete({ where: { id: wallet.id } });
    }

    // An operator may relink it for support.
    await linkNotify({ user: { userId: 'operator-user', role: 'operator' } }, SELLER, TOKEN_BASE + 22);
    expect(await ipnftId()).toBe(String(TOKEN_BASE + 22));
  });

  it('ignores an intent from a different seller than the on-chain listing', async () => {
    const token = TOKEN_BASE + 9;
    const hash = tx('foreign_seller');
    // Another account records a commercial intent for the same tx/token.
    await notifyTiers(hash, token, [
      { licenseType: 'commercial', pricePerUnit: '9', ordinal: 0, listingId: '201' },
    ], OTHER_SELLER);

    const listing = await publishListed(hash, 201n, token);
    expect(listing.licenseType).toBe('personal');
    expect(listing.paymentToken).toBe(ZERO);

    // ...and reconciliation does not apply it either.
    await controller.notifyListingCreated(asUser(OTHER_SELLER), {
      tokenId: String(token),
      chainId: CHAIN_ID,
      sellerAddress: OTHER_SELLER,
      paymentToken: STABLECOIN,
      transactionHash: hash,
      stemId,
      tiers: [{ licenseType: 'remix', pricePerUnit: '9', amount: '1', ordinal: 0, listingId: '201' }],
    });
    const after = await prisma.stemListing.findUnique({ where: { id: listing.id } });
    expect(after!.licenseType).toBe('personal');
    expect(after!.paymentToken).toBe(ZERO);
  });

  it('lets a corrected single-tier retry win over the earlier tier', async () => {
    const token = TOKEN_BASE + 10;
    const hash = tx('legacy_retry');
    const notify = (licenseType: 'personal' | 'remix') =>
      controller.notifyListingCreated(asUser(SELLER), {
        tokenId: String(token),
        chainId: CHAIN_ID,
        sellerAddress: SELLER,
        price: '1000',
        amount: '1',
        paymentToken: STABLECOIN,
        transactionHash: hash,
        stemId,
        licenseType,
      });

    await notify('personal');
    const indexed = await publishListed(hash, 301n, token);
    expect(indexed.licenseType).toBe('personal');

    await notify('remix');
    const intents = await prisma.stemListingIntent.findMany({ where: { transactionHash: hash } });
    expect(intents.map((i) => i.licenseType)).toEqual(['remix']);
    const after = await prisma.stemListing.findUnique({ where: { id: indexed.id } });
    expect(after!.licenseType).toBe('remix');
  });

  it('replaces every earlier intent of the seller when a tiers notify arrives', async () => {
    const token = TOKEN_BASE + 11;
    const hash = tx('tiers_replace');
    await notifyTiers(hash, token, [
      { licenseType: 'personal', pricePerUnit: '1', ordinal: 0 },
      { licenseType: 'commercial', pricePerUnit: '2', ordinal: 1 },
    ]);
    await notifyTiers(hash, token, [
      { licenseType: 'remix', pricePerUnit: '3', ordinal: 0 },
      { licenseType: 'personal', pricePerUnit: '4', ordinal: 1 },
    ]);
    const intents = await prisma.stemListingIntent.findMany({
      where: { transactionHash: hash },
      orderBy: { logOrdinal: 'asc' },
    });
    expect(intents.map((i) => [i.licenseType, i.logOrdinal, i.sellerAddress])).toEqual([
      ['remix', 0, SELLER],
      ['personal', 1, SELLER],
    ]);
  });
});
