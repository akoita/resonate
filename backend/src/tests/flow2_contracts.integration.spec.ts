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
    contractsService = new ContractsService(eventBus as any);
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
    const listEvent: ContractStemListedEvent = {
      eventName: 'contract.stem_listed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '10',
      sellerAddress: '0xCreator',
      tokenId,
      amount: '5',
      pricePerUnit: '50000000000000000',
      paymentToken: '0x0000000000000000000000000000000000000000',
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

    // Step 3: Sell (full amount to trigger "sold" status)
    const soldEvent: ContractStemSoldEvent = {
      eventName: 'contract.stem_sold',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      listingId: '10',
      buyerAddress: '0xBuyer',
      amount: '5',
      totalPaid: '250000000000000000',
      chainId,
      contractAddress: contractAddr,
      transactionHash: `0x${P}sold_tx`,
      blockNumber: '3',
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
  }, 10000);
});
