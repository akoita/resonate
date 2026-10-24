/**
 * #2172: a marketplace sale's real split, and what the artist actually received.
 *
 * Real Postgres and a real Anvil node (Testcontainers). A test-only contract
 * (fixtures/SplitMarketplaceHarness.sol) pays the royalty, the platform fee and
 * the seller exactly as StemMarketplaceV2._buy does and emits the same
 * RoyaltyPaid-then-Sold logs. The real IndexerService decodes and stores the
 * logs, the real ContractsService handlers record the sale and finalise its
 * split (reading the fee rate and royalty from the chain at the Sold block), and
 * the real artist net-received source reads it back. The net is compared with
 * the balance each address really gained on-chain.
 *
 * NO MOCKS of Prisma, the indexer, the handlers or the chain.
 */

// Chain config is read from the environment when the services load.
const previousRpcUrl = process.env.RPC_URL;
process.env.RPC_URL = process.env.ANVIL_RPC_URL ?? "";

import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { IndexerService } from "../modules/contracts/indexer.service";
import { ContractsService } from "../modules/contracts/contracts.service";
import { PrismaArtistNetReceivedSource } from "../modules/analytics/analytics_net_received";
import {
  SPLIT_MARKETPLACE_HARNESS_ABI,
  SPLIT_MARKETPLACE_HARNESS_BYTECODE,
} from "./fixtures/split_marketplace_harness";

const anvilUrl = process.env.ANVIL_RPC_URL;
const describeWithAnvil = anvilUrl ? describe : describe.skip;

const P = `msplit_${Date.now()}_`;
const chainId = 31337;
const ETH = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
// Anvil's well-known first dev account; it deploys and buys.
const DEV_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, attempts = 80): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read();
    if (value) return value;
    await wait(100);
  }
  throw new Error("condition not met in time");
}

describeWithAnvil("#2172 marketplace sale split and artist net received (Anvil)", () => {
  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;
  const baseToken = BigInt(Date.now()) * 100n;
  const tokenRoyalty = baseToken + 1n; // 5% royalty to the artist
  const tokenNoRoyalty = baseToken + 2n; // 0% royalty
  const listingBase = BigInt(Date.now()) * 100n;

  const artist = privateKeyToAccount(generatePrivateKey()).address;
  const collector = privateKeyToAccount(generatePrivateKey()).address;
  const feeRecipient = privateKeyToAccount(generatePrivateKey()).address;
  const dev = privateKeyToAccount(DEV_KEY);

  const publicClient = createPublicClient({ chain: foundry, transport: http(anvilUrl) });
  const walletClient = createWalletClient({ account: dev, chain: foundry, transport: http(anvilUrl) });

  let harness: Address;
  let stemId: string;
  let eventBus: EventBus;
  let indexer: IndexerService;
  const netSource = new PrismaArtistNetReceivedSource();
  const txHashes: string[] = [];

  async function write(functionName: string, args: unknown[], value?: bigint) {
    const hash = await walletClient.writeContract({
      address: harness,
      abi: SPLIT_MARKETPLACE_HARNESS_ABI,
      functionName: functionName as never,
      args: args as never,
      value,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    txHashes.push(hash);
    return receipt;
  }

  async function gained(address: Address, blockNumber: bigint) {
    const [after, before] = await Promise.all([
      publicClient.getBalance({ address, blockNumber }),
      publicClient.getBalance({ address, blockNumber: blockNumber - 1n }),
    ]);
    return after - before;
  }

  async function seedListing(offset: bigint, tokenId: bigint, seller: Address) {
    await prisma.stemListing.create({
      data: {
        listingId: listingBase + offset,
        stemId,
        tokenId,
        chainId,
        contractAddress: harness,
        sellerAddress: seller,
        pricePerUnit: ETH.toString(),
        amount: 10n,
        paymentToken: ZERO,
        expiresAt: new Date(Date.now() + 86_400_000),
        transactionHash: `0x${P}list_${offset}`,
        blockNumber: 1n,
        listedAt: new Date(),
      },
    });
    return listingBase + offset;
  }

  type ReceiptLog = Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>["logs"][number];
  const processLog = (log: ReceiptLog) => (indexer as any).processLog(log, chainId);

  async function purchaseOf(transactionHash: string, logIndex: number) {
    return waitFor(() =>
      prisma.stemPurchase.findUnique({ where: { transactionHash_logIndex: { transactionHash, logIndex } } }),
    );
  }

  async function report() {
    const result = await netSource.getArtistNetReceived({
      artistId,
      from: new Date(Date.now() - 3_600_000),
      to: new Date(Date.now() + 3_600_000),
    });
    if (result.status !== "ready") throw new Error("net received unavailable");
    return result;
  }

  beforeAll(async () => {
    harness = await (async () => {
      const hash = await walletClient.deployContract({
        abi: SPLIT_MARKETPLACE_HARNESS_ABI,
        bytecode: SPLIT_MARKETPLACE_HARNESS_BYTECODE,
        args: [1000n, feeRecipient],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return receipt.contractAddress as Address;
    })();
    await write("setRoyalty", [tokenRoyalty, artist, 500]);
    await write("setRoyalty", [tokenNoRoyalty, artist, 0]);

    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({ data: { id: artistId, userId, displayName: "Split Artist", payoutAddress: artist } });
    await prisma.release.create({ data: { id: releaseId, title: "Split Release", artistId, status: "ready" } });
    await prisma.track.create({ data: { id: trackId, title: "Split Track", releaseId, position: 1 } });
    const stem = await prisma.stem.create({ data: { trackId, type: "vocals", uri: "/catalog/stems/split.mp3" } });
    stemId = stem.id;
    for (const [offset, tokenId] of [[0n, tokenRoyalty], [1n, tokenNoRoyalty]] as const) {
      // StemNftMint.stemId is unique: only the royalty token carries the real stem row link.
      if (offset === 0n) {
        await prisma.stemNftMint.create({
          data: {
            stemId,
            tokenId,
            chainId,
            contractAddress: harness,
            creatorAddress: artist,
            royaltyBps: 500,
            remixable: true,
            metadataUri: "resonate://split",
            transactionHash: `0x${P}mint_${offset}`,
            blockNumber: 1n,
            mintedAt: new Date(),
          },
        });
      }
    }
    // The zero-royalty token needs its own stem (one mint per stem) of the same artist.
    const stem2 = await prisma.stem.create({ data: { trackId, type: "drums", uri: "/catalog/stems/split2.mp3" } });
    await prisma.stemNftMint.create({
      data: {
        stemId: stem2.id,
        tokenId: tokenNoRoyalty,
        chainId,
        contractAddress: harness,
        creatorAddress: artist,
        royaltyBps: 0,
        remixable: true,
        metadataUri: "resonate://split2",
        transactionHash: `0x${P}mint_1`,
        blockNumber: 1n,
        mintedAt: new Date(),
      },
    });

    eventBus = new EventBus();
    const contractsService = new ContractsService(eventBus, {} as any);
    (contractsService as any).subscribeToContractEvents();
    indexer = new IndexerService(eventBus);
  });

  afterAll(async () => {
    if (previousRpcUrl === undefined) delete process.env.RPC_URL;
    else process.env.RPC_URL = previousRpcUrl;
    if (!anvilUrl) return;
    const listings = { listing: { transactionHash: { startsWith: `0x${P}` } } };
    await prisma.stemPurchase.deleteMany({ where: listings }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { transactionHash: { startsWith: `0x${P}` } } }).catch(() => {});
    await prisma.stemNftMint.deleteMany({ where: { transactionHash: { startsWith: `0x${P}` } } }).catch(() => {});
    await prisma.royaltyPayment.deleteMany({ where: { transactionHash: { in: txHashes } } }).catch(() => {});
    await prisma.contractEvent.deleteMany({ where: { transactionHash: { in: txHashes } } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: trackId } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: artistId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  it("a first sale by the artist: the recorded split and the net match what the chain paid", async () => {
    const listingId = await seedListing(10n, tokenRoyalty, artist);
    const receipt = await write("buy", [listingId, tokenRoyalty, artist], ETH);
    for (const log of receipt.logs) await processLog(log);

    const soldLog = receipt.logs.at(-1)!;
    const purchase = await waitFor(async () => {
      const row = await purchaseOf(receipt.transactionHash, soldLog.logIndex!);
      return row.splitFinalizedAt ? row : null;
    });

    // 10% fee, 5% royalty, the rest to the seller.
    expect(purchase.totalPaid).toBe(ETH.toString());
    expect(purchase.protocolFeePaid).toBe((ETH / 10n).toString());
    expect(purchase.royaltyPaid).toBe((ETH / 20n).toString());
    expect(purchase.sellerReceived).toBe(((ETH * 85n) / 100n).toString());
    expect(purchase.protocolFeeBps).toBe(1000);
    expect(purchase.royaltyRecipient).toBe(artist.toLowerCase());

    // The recorded amounts are what each address really gained on-chain.
    expect(await gained(feeRecipient, receipt.blockNumber)).toBe(BigInt(purchase.protocolFeePaid));
    const artistGained = await gained(artist, receipt.blockNumber);
    expect(artistGained).toBe(BigInt(purchase.sellerReceived) + BigInt(purchase.royaltyPaid));

    const net = await report();
    const sale = net.recentSales.find((entry) => entry.grossAmountUnits === ETH.toString() && entry.status === "final")!;
    expect(sale).toBeDefined();
    expect(BigInt(sale.netAmountUnits!)).toBe(artistGained);
    expect(BigInt(sale.platformFeeUnits!)).toBe(ETH / 10n);
    expect(sale.otherPartiesUnits).toBe("0");
    expect(net.pendingSales).toBe(0);
  });

  it("a collector's resale pays the artist the royalty only, and the net says so", async () => {
    const listingId = await seedListing(11n, tokenRoyalty, collector);
    const before = await report();
    const receipt = await write("buy", [listingId, tokenRoyalty, collector], 2n * ETH);
    for (const log of receipt.logs) await processLog(log);
    const soldLog = receipt.logs.at(-1)!;
    const purchase = await waitFor(async () => {
      const row = await purchaseOf(receipt.transactionHash, soldLog.logIndex!);
      return row.splitFinalizedAt ? row : null;
    });

    const artistGained = await gained(artist, receipt.blockNumber);
    expect(artistGained).toBe(BigInt(purchase.royaltyPaid));
    expect(await gained(collector, receipt.blockNumber)).toBe(BigInt(purchase.sellerReceived));

    const after = await report();
    const sale = after.recentSales.find((entry) => entry.grossAmountUnits === (2n * ETH).toString())!;
    expect(BigInt(sale.netAmountUnits!)).toBe(artistGained);
    expect(after.finalizedSales).toBe(before.finalizedSales + 1);
    // The aggregate reconciles: net + platform fee + other parties = gross of the final sales.
    const [asset] = after.byAsset;
    expect(BigInt(asset.netAmountUnits) + BigInt(asset.platformFeeUnits) + BigInt(asset.otherPartiesUnits)).toBe(
      BigInt(asset.grossFinalizedUnits),
    );
  });

  it("pins the fee rate to the sale's block, not to the rate at indexing time", async () => {
    const listingId = await seedListing(12n, tokenRoyalty, artist);
    const receipt = await write("buy", [listingId, tokenRoyalty, artist], ETH);
    // The owner raises the fee BEFORE the sale is indexed.
    await write("setProtocolFee", [2000n]);
    for (const log of receipt.logs) await processLog(log);
    const soldLog = receipt.logs.at(-1)!;
    const purchase = await waitFor(async () => {
      const row = await purchaseOf(receipt.transactionHash, soldLog.logIndex!);
      return row.splitFinalizedAt ? row : null;
    });
    expect(purchase.protocolFeeBps).toBe(1000);
    expect(purchase.protocolFeePaid).toBe((ETH / 10n).toString());
    expect(await gained(feeRecipient, receipt.blockNumber)).toBe(BigInt(purchase.protocolFeePaid));
    await write("setProtocolFee", [1000n]);
  });

  it("a sale whose RoyaltyPaid is not indexed yet is pending, then final once it arrives", async () => {
    const listingId = await seedListing(13n, tokenRoyalty, artist);
    const receipt = await write("buy", [listingId, tokenRoyalty, artist], ETH);
    const royaltyLog = receipt.logs.find((log) => log.logIndex !== receipt.logs.at(-1)!.logIndex)!;
    const soldLog = receipt.logs.at(-1)!;
    const before = await report();

    // Only the Sold log reaches the indexer first.
    await processLog(soldLog);
    const pending = await purchaseOf(receipt.transactionHash, soldLog.logIndex!);
    await wait(500);
    const stillPending = await purchaseOf(receipt.transactionHash, soldLog.logIndex!);
    expect(stillPending.id).toBe(pending.id);
    expect(stillPending.splitFinalizedAt).toBeNull();
    // Not a split: the columns hold "0" only as "unknown".
    expect(stillPending.royaltyPaid).toBe("0");

    const during = await report();
    expect(during.pendingSales).toBe(before.pendingSales + 1);
    expect(during.finalizedSales).toBe(before.finalizedSales);
    const pendingSale = during.recentSales.find((entry) => entry.status === "pending")!;
    expect(pendingSale.grossAmountUnits).toBe(ETH.toString());
    expect(pendingSale.netAmountUnits).toBeUndefined();
    expect(pendingSale.netAmount).toBeUndefined();
    // The pending gross is neither net nor part of the finalised gross.
    expect(during.byAsset[0].netAmountUnits).toBe(before.byAsset[0].netAmountUnits);
    expect(during.byAsset[0].grossFinalizedUnits).toBe(before.byAsset[0].grossFinalizedUnits);
    expect(BigInt(during.byAsset[0].pendingGrossUnits)).toBe(BigInt(before.byAsset[0].pendingGrossUnits) + ETH);

    // The RoyaltyPaid log arrives: the same sale is finalised without a replay of the Sold log.
    await processLog(royaltyLog);
    const finalised = await waitFor(async () => {
      const row = await purchaseOf(receipt.transactionHash, soldLog.logIndex!);
      return row.splitFinalizedAt ? row : null;
    });
    expect(finalised.royaltyPaid).toBe((ETH / 20n).toString());
    const after = await report();
    expect(after.pendingSales).toBe(before.pendingSales);
    expect(after.finalizedSales).toBe(before.finalizedSales + 1);
    expect(BigInt(after.byAsset[0].netAmountUnits)).toBe(
      BigInt(before.byAsset[0].netAmountUnits) + (await gained(artist, receipt.blockNumber)),
    );
  });

  it("a sale that really paid no royalty is final with a zero royalty (proven on-chain, not assumed)", async () => {
    const listingId = await seedListing(14n, tokenNoRoyalty, artist);
    const receipt = await write("buy", [listingId, tokenNoRoyalty, artist], ETH);
    expect(receipt.logs).toHaveLength(1); // Sold only: no RoyaltyPaid
    for (const log of receipt.logs) await processLog(log);
    const purchase = await waitFor(async () => {
      const row = await purchaseOf(receipt.transactionHash, receipt.logs[0].logIndex!);
      return row.splitFinalizedAt ? row : null;
    });
    expect(purchase.royaltyPaid).toBe("0");
    expect(purchase.royaltyRecipient).toBeNull();
    expect(purchase.sellerReceived).toBe(((ETH * 9n) / 10n).toString());
    expect(await gained(artist, receipt.blockNumber)).toBe(BigInt(purchase.sellerReceived));
  });

  it("a batched transaction keeps each sale's royalty apart", async () => {
    const first = await seedListing(15n, tokenRoyalty, artist);
    const second = await seedListing(16n, tokenRoyalty, collector);
    const receipt = await write(
      "buyBatch",
      [[first, second], [tokenRoyalty, tokenRoyalty], [artist, collector], [ETH, 3n * ETH]],
      4n * ETH,
    );
    for (const log of receipt.logs) await processLog(log);
    const soldLogs = receipt.logs.filter((log) => log.topics[0] === receipt.logs.at(-1)!.topics[0]);
    expect(soldLogs).toHaveLength(2);

    const one = await waitFor(async () => {
      const row = await purchaseOf(receipt.transactionHash, soldLogs[0].logIndex!);
      return row.splitFinalizedAt ? row : null;
    });
    const two = await waitFor(async () => {
      const row = await purchaseOf(receipt.transactionHash, soldLogs[1].logIndex!);
      return row.splitFinalizedAt ? row : null;
    });
    expect(one.royaltyPaid).toBe((ETH / 20n).toString());
    expect(two.royaltyPaid).toBe(((3n * ETH) / 20n).toString());
    expect(one.sellerReceived).toBe(((ETH * 85n) / 100n).toString());
    expect(two.sellerReceived).toBe(((3n * ETH * 85n) / 100n).toString());
    // Both royalties and the first seller's proceeds reached the artist in one transaction.
    expect(await gained(artist, receipt.blockNumber)).toBe(
      BigInt(one.royaltyPaid) + BigInt(one.sellerReceived) + BigInt(two.royaltyPaid),
    );
  });
});
