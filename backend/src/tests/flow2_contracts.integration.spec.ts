/**
 * Choreography Flow 2 — Contract Indexing → Marketplace Lifecycle
 *
 * Tests the event chain: contract.stem_minted → ContractsService → StemNftMint
 * → contract.stem_listed → StemListing → contract.stem_sold → listing "sold"
 * → contract.royalty_paid → RoyaltyPayment
 * → contract.listing_cancelled → listing "cancelled"
 *
 * NO MOCKS. Real EventBus + real ContractsService + real Postgres.
 *
 * See: backend/CHOREOGRAPHY.md (Flow 2) for sequence diagrams.
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { ContractsService } from '../modules/contracts/contracts.service';
import type {
  ContractStemMintedEvent,
  ContractStemListedEvent,
  ContractStemSoldEvent,
  ContractListingCancelledEvent,
  ContractRoyaltyPaidEvent,
} from '../events/event_types';

const P = `cf2_${Date.now()}_`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Choreography Flow 2: Contract Indexing → Marketplace Lifecycle', () => {
  let eventBus: EventBus;
  let contractsService: ContractsService;

  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;
  let stemId: string;
  const tokenId = '200';
  const chainId = 31337;
  const contractAddr = '0x' + 'F'.repeat(40);

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: 'NFT Artist', payoutAddress: '0x' + 'D'.repeat(40) },
    });
    await prisma.release.create({
      data: { id: releaseId, title: 'NFT Release', artistId, status: 'ready' },
    });
    await prisma.track.create({
      data: { id: trackId, title: 'NFT Track', releaseId, position: 1 },
    });
    const stem = await prisma.stem.create({
      data: { trackId, type: 'vocals', uri: '/catalog/stems/nft_vocals.mp3' },
    });
    stemId = stem.id;

    // Real EventBus → real ContractsService (no mocks)
    eventBus = new EventBus();
    contractsService = new ContractsService(eventBus as any, {} as any);
    (contractsService as any).subscribeToContractEvents();
  });

  afterAll(async () => {
    await prisma.royaltyPayment.deleteMany({ where: { transactionHash: { startsWith: `0x${P}` } } }).catch(() => {});
    await prisma.stemPurchase.deleteMany({ where: { transactionHash: { startsWith: `0x${P}` } } }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { chainId, contractAddress: contractAddr } }).catch(() => {});
    await prisma.stemNftMint.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('Mint → List → Sell full lifecycle', async () => {
    const metadataUri = `http://localhost:3000/contracts/metadata/${chainId}/${stemId}`;

    // Step 1: Mint
    const mintEvent: ContractStemMintedEvent = {
      eventName: 'contract.stem_minted',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      tokenId,
      creatorAddress: '0xCreator',
      parentIds: [],
      tokenUri: metadataUri,
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}mint_tx`,
      blockNumber: '1',
    };
    eventBus.publish(mintEvent);
    await wait(1000);

    const nftMint = await prisma.stemNftMint.findFirst({ where: { stemId } });
    expect(nftMint).not.toBeNull();
    expect(nftMint!.tokenId).toBe(BigInt(tokenId));

    const stemAfterMint = await prisma.stem.findUnique({ where: { id: stemId } });
    expect(stemAfterMint!.ipnftId).toBe(tokenId);

    // Step 2: List
    await prisma.stemListingIntent.create({
      data: {
        transactionHash: `0x${P}list_tx`,
        tokenId: BigInt(tokenId),
        stemId,
        chainId,
        sellerAddress: '0xcreator',
        pricePerUnit: '50000',
        amount: 5n,
        paymentToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        licenseType: 'remix',
      },
    });
    const listEvent: ContractStemListedEvent = {
      eventName: 'contract.stem_listed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '10',
      sellerAddress: '0xCreator',
      tokenId,
      amount: '5',
      pricePerUnit: '50000',
      paymentToken: '0x0000000000000000000000000000000000000000',
      licenseType: 'remix',
      expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}list_tx`,
      blockNumber: '2',
    };
    eventBus.publish(listEvent);
    await wait(1000);

    const listing = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_tx` },
    });
    expect(listing).not.toBeNull();
    expect(listing!.status).toBe('active');
    expect(listing!.licenseType).toBe('remix');
    expect(listing!.paymentToken).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');

    const commercialListEvent: ContractStemListedEvent = {
      ...listEvent,
      listingId: '11',
      amount: '2',
      pricePerUnit: '250000000000000000',
      licenseType: 'commercial',
      transactionHash: `0x${P}list_commercial_tx`,
      blockNumber: '3',
    };
    eventBus.publish(commercialListEvent);
    await wait(1000);

    const remixListingAfterCommercial = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_tx` },
    });
    const commercialListing = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_commercial_tx` },
    });
    expect(remixListingAfterCommercial!.status).toBe('active');
    expect(commercialListing!.status).toBe('active');
    expect(commercialListing!.licenseType).toBe('commercial');

    // Step 3: Sell (full amount to trigger "sold" status)
    const soldEvent: ContractStemSoldEvent = {
      eventName: 'contract.stem_sold',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '10',
      buyerAddress: '0xBuyer',
      amount: '5',
      totalPaid: '250000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}sold_tx`,
      logIndex: 0,
      blockNumber: '4',
    };
    eventBus.publish(soldEvent);
    await wait(1000);

    const listingAfterSold = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_tx` },
    });
    expect(listingAfterSold!.status).toBe('sold');

    const purchase = await prisma.stemPurchase.findFirst({
      where: { transactionHash: `0x${P}sold_tx` },
    });
    expect(purchase).not.toBeNull();
    expect(purchase!.buyerAddress).toBe('0xbuyer');
    expect(purchase!.paymentToken).toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
    expect(purchase!.paymentAssetSymbol).toBe('TOKEN');
    expect(purchase!.settlementAmountUnits).toBe('250000');
    expect(purchase!.licenseType).toBe('remix');
    expect(purchase!.logIndex).toBe(0);
  }, 20000);

  it('Batched purchase: two Sold logs in one transaction record two purchases', async () => {
    // A batched user operation (#1964) buys several listings in ONE transaction,
    // so the transaction hash alone no longer identifies a purchase.
    const seedListing = (listingId: bigint, amount: bigint, licenseType: 'personal' | 'sync') =>
      prisma.stemListing.create({
        data: {
          listingId,
          stemId,
          tokenId: BigInt(tokenId),
          chainId,
          contractAddress: contractAddr,
          sellerAddress: '0x' + 'a'.repeat(40),
          pricePerUnit: '1000',
          amount,
          paymentToken: '0x0000000000000000000000000000000000000000',
          expiresAt: new Date(Date.now() + 86_400_000),
          transactionHash: `0x${P}batch_list_${listingId}`,
          blockNumber: 7n,
          licenseType,
          status: 'active',
          listedAt: new Date(),
        },
      });
    const first = await seedListing(30n, 3n, 'personal');
    const second = await seedListing(31n, 1n, 'sync');

    const batchTx = `0x${P}batch_tx`;
    const sold = (listingId: string, logIndex: number, amount: string): ContractStemSoldEvent => ({
      eventName: 'contract.stem_sold',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId,
      buyerAddress: '0xBatchBuyer',
      amount,
      totalPaid: '1000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: batchTx,
      logIndex,
      blockNumber: '8',
    });

    eventBus.publish(sold('30', 4, '1'));
    eventBus.publish(sold('31', 7, '1'));
    await wait(1500);

    const purchases = await prisma.stemPurchase.findMany({
      where: { transactionHash: batchTx },
      orderBy: { logIndex: 'asc' },
    });
    expect(purchases.map((purchase) => purchase.logIndex)).toEqual([4, 7]);
    expect(purchases.map((purchase) => purchase.listingId)).toEqual([first.id, second.id]);

    const firstAfter = await prisma.stemListing.findUnique({ where: { id: first.id } });
    const secondAfter = await prisma.stemListing.findUnique({ where: { id: second.id } });
    expect(firstAfter!.amount).toBe(2n);
    expect(firstAfter!.status).toBe('active');
    expect(secondAfter!.amount).toBe(0n);
    expect(secondAfter!.status).toBe('sold');

    // Replaying either log (reindex) changes nothing.
    eventBus.publish(sold('30', 4, '1'));
    eventBus.publish(sold('31', 7, '1'));
    await wait(1500);

    expect(await prisma.stemPurchase.count({ where: { transactionHash: batchTx } })).toBe(2);
    const firstReplayed = await prisma.stemListing.findUnique({ where: { id: first.id } });
    expect(firstReplayed!.amount).toBe(2n);
  }, 20000);

  it('Batched purchase: two Sold logs for one listing row decrement it twice, replay-safe', async () => {
    const listing = await prisma.stemListing.create({
      data: {
        listingId: 32n,
        stemId,
        tokenId: BigInt(tokenId),
        chainId,
        contractAddress: contractAddr,
        sellerAddress: '0x' + 'b'.repeat(40),
        pricePerUnit: '1000',
        amount: 5n,
        paymentToken: '0x0000000000000000000000000000000000000000',
        expiresAt: new Date(Date.now() + 86_400_000),
        transactionHash: `0x${P}batch_list_32`,
        blockNumber: 7n,
        licenseType: 'personal',
        status: 'active',
        listedAt: new Date(),
      },
    });
    const sameListingTx = `0x${P}batch_same_listing_tx`;
    const sold = (logIndex: number): ContractStemSoldEvent => ({
      eventName: 'contract.stem_sold',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '32',
      buyerAddress: '0xBatchBuyer',
      amount: '1',
      totalPaid: '1000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: sameListingTx,
      logIndex,
      blockNumber: '9',
    });

    eventBus.publish(sold(1));
    eventBus.publish(sold(2));
    await wait(1500);
    eventBus.publish(sold(1));
    await wait(1000);

    expect(await prisma.stemPurchase.count({ where: { transactionHash: sameListingTx } })).toBe(2);
    expect((await prisma.stemListing.findUnique({ where: { id: listing.id } }))!.amount).toBe(3n);
  }, 20000);

  it('A purchase indexed before logIndex existed is not recorded twice on replay', async () => {
    const listing = await prisma.stemListing.create({
      data: {
        listingId: 33n,
        stemId,
        tokenId: BigInt(tokenId),
        chainId,
        contractAddress: contractAddr,
        sellerAddress: '0x' + 'c'.repeat(40),
        pricePerUnit: '1000',
        amount: 3n,
        paymentToken: '0x0000000000000000000000000000000000000000',
        expiresAt: new Date(Date.now() + 86_400_000),
        transactionHash: `0x${P}batch_list_33`,
        blockNumber: 7n,
        licenseType: 'personal',
        status: 'active',
        listedAt: new Date(),
      },
    });
    const legacyTx = `0x${P}legacy_tx`;
    // The row the old indexer wrote: no logIndex, listing already decremented.
    await prisma.stemListing.update({ where: { id: listing.id }, data: { amount: 2n } });
    await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: '0xlegacybuyer',
        amount: 1n,
        totalPaid: '1000',
        royaltyPaid: '0',
        protocolFeePaid: '0',
        sellerReceived: '0',
        transactionHash: legacyTx,
        logIndex: null,
        blockNumber: 6n,
        purchasedAt: new Date(),
      },
    });

    eventBus.publish({
      eventName: 'contract.stem_sold',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '33',
      buyerAddress: '0xLegacyBuyer',
      amount: '1',
      totalPaid: '1000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: legacyTx,
      logIndex: 3,
      blockNumber: '6',
    } satisfies ContractStemSoldEvent);
    await wait(1500);

    expect(await prisma.stemPurchase.count({ where: { transactionHash: legacyTx } })).toBe(1);
    expect((await prisma.stemListing.findUnique({ where: { id: listing.id } }))!.amount).toBe(2n);
  }, 20000);

  it('Listing cancellation', async () => {
    const listEvent: ContractStemListedEvent = {
      eventName: 'contract.stem_listed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '99',
      sellerAddress: '0xCreator',
      tokenId,
      amount: '5',
      pricePerUnit: '100000000000000000',
      paymentToken: '0x0000000000000000000000000000000000000000',
      expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}list_cancel_tx`,
      blockNumber: '4',
    };
    eventBus.publish(listEvent);
    await wait(1000);

    const activeListing = await prisma.stemListing.findFirst({
      where: { transactionHash: `0x${P}list_cancel_tx` },
    });
    expect(activeListing!.status).toBe('active');

    const cancelEvent: ContractListingCancelledEvent = {
      eventName: 'contract.listing_cancelled',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '99',
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}cancel_tx`,
      blockNumber: '5',
    };
    eventBus.publish(cancelEvent);
    await wait(1000);

    const cancelledListing = await prisma.stemListing.findFirst({
      where: { listingId: 99n, chainId },
    });
    expect(cancelledListing!.status).toBe('cancelled');
  }, 15000);

  it('Royalty payment', async () => {
    const royaltyEvent: ContractRoyaltyPaidEvent = {
      eventName: 'contract.royalty_paid',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      tokenId,
      recipientAddress: '0xCreator',
      amount: '2500000000000000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}royalty_tx`,
      blockNumber: '6',
    };
    eventBus.publish(royaltyEvent);
    await wait(1000);

    const royalty = await prisma.royaltyPayment.findFirst({
      where: { transactionHash: `0x${P}royalty_tx` },
    });
    expect(royalty).not.toBeNull();
    expect(royalty!.recipientAddress).toBe('0xCreator');
    expect(royalty!.paymentAssetSymbol).toBe('ETH');
    expect(royalty!.settlementAmountUnits).toBe('2500000000000000');
  }, 10000);
});
