/**
 * #2344: the one-off backfill of marketplace sales whose split is still pending.
 *
 * Real Postgres and a real Anvil node (Testcontainers), with the test-only
 * SplitMarketplaceHarness contract paying the royalty, the platform fee and the
 * seller exactly as the marketplace does. The "legacy" sales are StemPurchase
 * rows with no split (as indexed before #2172) beside the raw RoyaltyPaid events
 * the indexer kept. The production chain reader finalises them from the chain.
 *
 * NO MOCKS of Prisma or the chain; the only wrapper makes ONE block unreadable,
 * to prove a sale the RPC cannot serve stays pending.
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
import { createMarketplaceSplitChainReader } from "../modules/contracts/contracts.service";
import type { MarketplaceSplitChainReader } from "../modules/contracts/marketplace_sale_split";
import {
  formatSaleSplitBackfillSummary,
  parseSaleSplitBackfillArgs,
  runBackfillSaleSplits,
} from "../scripts/backfill_sale_splits";
import {
  SPLIT_MARKETPLACE_HARNESS_ABI,
  SPLIT_MARKETPLACE_HARNESS_BYTECODE,
} from "./fixtures/split_marketplace_harness";

const anvilUrl = process.env.ANVIL_RPC_URL;
const describeWithAnvil = anvilUrl ? describe : describe.skip;

const P = `sbackfill_${Date.now()}_`;
const chainId = 31337;
const ETH = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
const DEV_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// Far in the future, so the newest-first scan reaches these sales before any other pending row.
const FUTURE = Date.UTC(2100, 0, 1);

describeWithAnvil("#2344 sale split backfill (Anvil)", () => {
  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;
  const baseToken = BigInt(Date.now()) * 100n;
  const tokenRoyalty = baseToken + 1n;
  const tokenNoRoyalty = baseToken + 2n;
  const listingBase = BigInt(Date.now()) * 100n;

  const artist = privateKeyToAccount(generatePrivateKey()).address;
  const feeRecipient = privateKeyToAccount(generatePrivateKey()).address;
  const dev = privateKeyToAccount(DEV_KEY);
  const publicClient = createPublicClient({ chain: foundry, transport: http(anvilUrl) });
  const walletClient = createWalletClient({ account: dev, chain: foundry, transport: http(anvilUrl) });

  let harness: Address;
  let stemId: string;
  let indexer: IndexerService;
  const txHashes: string[] = [];
  const purchaseIds: Record<string, string> = {};
  let unreadableBlock = -1n;

  const realReader = createMarketplaceSplitChainReader();
  const reader: MarketplaceSplitChainReader = {
    protocolFeeBpsAt: async (input) => {
      if (input.blockNumber === unreadableBlock) throw new Error("block not served by this RPC");
      return realReader.protocolFeeBpsAt(input);
    },
    royaltyAmountAt: (input) => realReader.royaltyAmountAt(input),
  };

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

  type Receipt = Awaited<ReturnType<typeof write>>;
  const lastLog = (receipt: Receipt) => receipt.logs.at(-1)!;

  /** The legacy shape: the sale recorded with no split, as before #2172. */
  async function seedLegacySale(name: string, offset: bigint, tokenId: bigint, receipt: Receipt, options: { logIndex: boolean }) {
    const listing = await prisma.stemListing.create({
      data: {
        listingId: listingBase + offset,
        stemId,
        tokenId,
        chainId,
        contractAddress: harness,
        sellerAddress: artist,
        pricePerUnit: ETH.toString(),
        amount: 10n,
        paymentToken: ZERO,
        expiresAt: new Date(Date.now() + 86_400_000),
        transactionHash: `0x${P}list_${offset}`,
        blockNumber: 1n,
        listedAt: new Date(),
      },
    });
    const purchase = await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: artist,
        amount: 1n,
        totalPaid: ETH.toString(),
        royaltyPaid: "0",
        protocolFeePaid: "0",
        sellerReceived: "0",
        transactionHash: receipt.transactionHash,
        logIndex: options.logIndex ? lastLog(receipt).logIndex! : null,
        blockNumber: receipt.blockNumber,
        purchasedAt: new Date(FUTURE + Number(offset) * 1000),
      },
    });
    purchaseIds[name] = purchase.id;
    return purchase;
  }

  const row = (name: string) => prisma.stemPurchase.findUniqueOrThrow({ where: { id: purchaseIds[name] } });

  beforeAll(async () => {
    const hash = await walletClient.deployContract({
      abi: SPLIT_MARKETPLACE_HARNESS_ABI,
      bytecode: SPLIT_MARKETPLACE_HARNESS_BYTECODE,
      args: [1000n, feeRecipient],
    });
    harness = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress as Address;
    await write("setRoyalty", [tokenRoyalty, artist, 500]);
    await write("setRoyalty", [tokenNoRoyalty, artist, 0]);

    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({ data: { id: artistId, userId, displayName: "Backfill Artist", payoutAddress: artist } });
    await prisma.release.create({ data: { id: releaseId, title: "Backfill Release", artistId, status: "ready" } });
    await prisma.track.create({ data: { id: trackId, title: "Backfill Track", releaseId, position: 1 } });
    const stem = await prisma.stem.create({ data: { trackId, type: "vocals", uri: "/catalog/stems/backfill.mp3" } });
    stemId = stem.id;
    const stem2 = await prisma.stem.create({ data: { trackId, type: "drums", uri: "/catalog/stems/backfill2.mp3" } });
    for (const [id, tokenId, bps, tag] of [
      [stem.id, tokenRoyalty, 500, "0"],
      [stem2.id, tokenNoRoyalty, 0, "1"],
    ] as const) {
      await prisma.stemNftMint.create({
        data: {
          stemId: id,
          tokenId,
          chainId,
          contractAddress: harness,
          creatorAddress: artist,
          royaltyBps: bps,
          remixable: true,
          metadataUri: `resonate://backfill${tag}`,
          transactionHash: `0x${P}mint_${tag}`,
          blockNumber: 1n,
          mintedAt: new Date(),
        },
      });
    }
    // An indexer with NO sale handlers subscribed: it only keeps the raw events.
    indexer = new IndexerService(new EventBus());
  });

  afterAll(async () => {
    if (previousRpcUrl === undefined) delete process.env.RPC_URL;
    else process.env.RPC_URL = previousRpcUrl;
    if (!anvilUrl) return;
    await prisma.stemPurchase.deleteMany({ where: { listing: { transactionHash: { startsWith: `0x${P}` } } } }).catch(() => {});
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

  const processLogs = async (receipt: Receipt) => {
    for (const log of receipt.logs) await (indexer as any).processLog(log, chainId);
  };

  it("finalises what can be proven, reports why the rest stays pending, and never writes on a dry run", async () => {
    // (1) a resale with a royalty, RoyaltyPaid indexed -> finalisable.
    const withRoyalty = await write("buy", [listingBase + 1n, tokenRoyalty, artist], ETH);
    await processLogs(withRoyalty);
    await seedLegacySale("withRoyalty", 1n, tokenRoyalty, withRoyalty, { logIndex: true });

    // (2) no royalty at all (the contract emits no RoyaltyPaid) -> final with a proven-zero royalty.
    const noRoyalty = await write("buy", [listingBase + 2n, tokenNoRoyalty, artist], ETH);
    await processLogs(noRoyalty);
    await seedLegacySale("noRoyalty", 2n, tokenNoRoyalty, noRoyalty, { logIndex: true });

    // (3) a royalty was paid but its log was never indexed -> stays pending, not zero.
    const royaltyMissing = await write("buy", [listingBase + 3n, tokenRoyalty, artist], ETH);
    await seedLegacySale("royaltyMissing", 3n, tokenRoyalty, royaltyMissing, { logIndex: true });

    // (4) the RPC cannot serve the sale's block -> stays pending.
    const unreadable = await write("buy", [listingBase + 4n, tokenNoRoyalty, artist], ETH);
    unreadableBlock = unreadable.blockNumber;
    await seedLegacySale("unreadable", 4n, tokenNoRoyalty, unreadable, { logIndex: true });

    // (5) indexed before the Sold log position was kept -> can never be matched.
    const noLogIndex = await write("buy", [listingBase + 5n, tokenRoyalty, artist], ETH);
    await processLogs(noLogIndex);
    await seedLegacySale("noLogIndex", 5n, tokenRoyalty, noLogIndex, { logIndex: false });

    // Dry run: the report is complete and NOTHING is written.
    const dry = await runBackfillSaleSplits(["--limit", "4"], reader);
    expect(dry.dryRun).toBe(true);
    expect(dry.scanned).toBe(4);
    expect(dry.finalizable).toBe(2);
    expect(dry.stillPending.royalty_not_indexed).toBe(1);
    expect(dry.stillPending.fee_unreadable).toBe(1);
    expect(dry.stillPending.no_log_index).toBeGreaterThanOrEqual(1);
    for (const name of Object.keys(purchaseIds)) {
      const stored = await row(name);
      expect(stored.splitFinalizedAt).toBeNull();
      expect(stored.sellerReceived).toBe("0");
    }
    expect(formatSaleSplitBackfillSummary(dry)).toContain("DRY RUN");
    expect(formatSaleSplitBackfillSummary(dry)).toContain("would finalise");

    // Apply: the two provable sales are finalised from the chain.
    const applied = await runBackfillSaleSplits(["--apply", "--limit", "4"], reader);
    expect(applied.dryRun).toBe(false);
    expect(applied.finalizable).toBe(2);

    const royaltySale = await row("withRoyalty");
    expect(royaltySale.splitFinalizedAt).not.toBeNull();
    expect(royaltySale.royaltyPaid).toBe((ETH / 20n).toString());
    expect(royaltySale.protocolFeePaid).toBe((ETH / 10n).toString());
    expect(royaltySale.sellerReceived).toBe(((ETH * 85n) / 100n).toString());
    expect(royaltySale.royaltyRecipient).toBe(artist.toLowerCase());
    // What was recorded is what the chain really paid.
    expect(await gained(feeRecipient, withRoyalty.blockNumber)).toBe(BigInt(royaltySale.protocolFeePaid));
    expect(await gained(artist, withRoyalty.blockNumber)).toBe(
      BigInt(royaltySale.sellerReceived) + BigInt(royaltySale.royaltyPaid),
    );

    const zeroRoyaltySale = await row("noRoyalty");
    expect(zeroRoyaltySale.splitFinalizedAt).not.toBeNull();
    expect(zeroRoyaltySale.royaltyPaid).toBe("0");
    expect(zeroRoyaltySale.sellerReceived).toBe(((ETH * 9n) / 10n).toString());

    // The rest stays pending: not zero, not guessed.
    for (const name of ["royaltyMissing", "unreadable", "noLogIndex"]) {
      const pending = await row(name);
      expect(pending.splitFinalizedAt).toBeNull();
      expect(pending.sellerReceived).toBe("0");
    }
  });

  it("is idempotent: a second apply changes nothing, and the leftovers keep their reasons", async () => {
    const before = await row("withRoyalty");
    const second = await runBackfillSaleSplits(["--apply", "--limit", "4"], reader);
    expect(second.finalizable).toBe(0);
    expect(second.stillPending.royalty_not_indexed).toBe(1);
    expect(second.stillPending.fee_unreadable).toBe(1);
    const after = await row("withRoyalty");
    expect(after.splitFinalizedAt!.getTime()).toBe(before.splitFinalizedAt!.getTime());
    expect(after.sellerReceived).toBe(before.sellerReceived);
  });

  it("finalises a sale once what was missing is available (the RPC serves the block, the log is indexed)", async () => {
    unreadableBlock = -1n;
    const receipt = await publicClient.getTransactionReceipt({ hash: (await row("royaltyMissing")).transactionHash as Hex });
    await processLogs(receipt as unknown as Receipt);
    const third = await runBackfillSaleSplits(["--apply", "--limit", "4"], reader);
    expect(third.finalizable).toBe(2);
    expect((await row("royaltyMissing")).royaltyPaid).toBe((ETH / 20n).toString());
    expect((await row("unreadable")).sellerReceived).toBe(((ETH * 9n) / 10n).toString());
    // Only the sale with no Sold log position remains pending.
    expect((await row("noLogIndex")).splitFinalizedAt).toBeNull();
  });

  describe("limits and arguments", () => {
    it("stops at --limit and reports where to continue", async () => {
      const ids = await prisma.stemPurchase.findMany({
        where: { id: { in: Object.values(purchaseIds) } },
        select: { id: true },
      });
      expect(ids).toHaveLength(5);
      // Reopen two finalised sales to pending so there is a backlog to page through.
      await prisma.stemPurchase.updateMany({
        where: { id: { in: [purchaseIds.withRoyalty, purchaseIds.noRoyalty] } },
        data: { splitFinalizedAt: null, royaltyPaid: "0", protocolFeePaid: "0", sellerReceived: "0" },
      });
      const first = await runBackfillSaleSplits(["--limit", "1"], reader);
      expect(first.scanned).toBe(1);
      expect(first.deferred).toBeGreaterThanOrEqual(1);
      expect(first.nextBefore).not.toBeNull();
      const next = await runBackfillSaleSplits(["--limit", "1", "--before", first.nextBefore!], reader);
      expect(next.before).toBe(first.nextBefore);
      expect(next.scanned).toBe(1);
    });

    it("rejects ambiguous or malformed arguments", () => {
      expect(() => parseSaleSplitBackfillArgs(["--apply", "--dry-run"])).toThrow(/mutually exclusive/);
      expect(() => parseSaleSplitBackfillArgs(["--limit", "0"])).toThrow(/positive integer/);
      expect(() => parseSaleSplitBackfillArgs(["--limit"])).toThrow(/needs a number/);
      expect(() => parseSaleSplitBackfillArgs(["--before", "not-a-date"])).toThrow(/ISO timestamp/);
      expect(() => parseSaleSplitBackfillArgs(["--force"])).toThrow(/Unknown argument/);
      expect(parseSaleSplitBackfillArgs([]).apply).toBe(false);
    });
  });
});
