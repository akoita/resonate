/**
 * Crate quote and settlement — Integration (#1964, docs/rfc/taste-engine.md §5.4)
 *
 * Real Prisma (Testcontainers Postgres). The chain is the one external boundary
 * and is replaced by a fake `CrateMarketplaceReader` (listings, quotes and
 * receipts are plain data here); nothing about Prisma is mocked.
 *
 * Covers: default tier and stems, drop reasons, a stale database payment token
 * overridden by the chain, totals per payment token, the quote TTL, settlement
 * (happy path, partial, reverted, wrong buyer, pending, browser-dropped lines,
 * one log for two lines, idempotent re-settle, expired quote), taste signals
 * recorded once and only after settlement, ownership (404 for other users) and
 * `latestQuote` on the crate.
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='crate_quote.integration'
 */

import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { AgentStemQualityService } from "../modules/agents/agent_stem_quality.service";
import { CrateEntitlementsService } from "../modules/crates/crate-entitlements";
import type {
  CrateMarketplaceReader,
  MarketplaceListing,
  MarketplaceQuote,
  MarketplaceSoldLogs,
} from "../modules/crates/crate_marketplace_reader";
import { CRATE_QUOTE_TTL_MS } from "../modules/crates/crate_quote";
import type { CrateQuoteDto } from "../modules/crates/crate_quote.dto";
import { CrateQuoteService } from "../modules/crates/crate_quote.service";
import type { CrateTransactionIndexer } from "../modules/crates/crate_transaction_indexer";
import { deterministicCrateRequestParser } from "../modules/crates/crate_request_parser";
import { CratesService } from "../modules/crates/crates.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const TEST_PREFIX = `cquote_${Date.now()}_`;
const id = (key: string) => `${TEST_PREFIX}${key}`;
const hex = (key: string) => `0x${Buffer.from(`${TEST_PREFIX}${key}`).toString("hex").padEnd(64, "0").slice(0, 64)}`;

const DJ = id("dj");
const NO_WALLET_DJ = id("nowallet");
const OTHER_DJ = id("other");
const ARTIST_USER = id("artistuser");
const ARTIST = id("artist");

const CHAIN_ID = 31337;
const MARKETPLACE = `0x${"aB".repeat(20)}`;
const DJ_WALLET = `0x${"Dd".repeat(20)}`;
const OTHER_BUYER = `0x${"ee".repeat(20)}`;
const USDC = `0x${"11".repeat(20)}`;
const UNKNOWN_TOKEN = `0x${"99".repeat(20)}`;
const ZERO = `0x${"0".repeat(40)}`;
const SELLER = `0x${"5".repeat(40)}`;

/** One whole USDC (6 decimals) in units. */
const USDC_UNIT = 1_000_000n;

// ---------------------------------------------------------------------------
// The fake chain
// ---------------------------------------------------------------------------

class FakeMarketplaceReader implements CrateMarketplaceReader {
  readonly chainId = CHAIN_ID;
  readonly marketplaceAddress = MARKETPLACE.toLowerCase();
  configured = true;
  readonly listings = new Map<bigint, MarketplaceListing | Error>();
  /** The chain head; a receipt without an explicit block is mined one past it. */
  head = 5_000n;
  headError: Error | null = null;
  readonly receipts = new Map<
    string,
    (Omit<MarketplaceSoldLogs, "blockNumber"> & { blockNumber?: bigint | null }) | Error
  >();
  readonly receiptReads: string[] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async getBlockNumber(): Promise<bigint> {
    if (this.headError) throw this.headError;
    return this.head;
  }

  async getListing(listingId: bigint): Promise<MarketplaceListing> {
    const listing = this.listings.get(listingId);
    if (listing instanceof Error) throw listing;
    // A deleted listing reads as zeros, like the contract's mapping.
    return (
      listing ?? {
        seller: ZERO,
        tokenId: 0n,
        amount: 0n,
        pricePerUnit: 0n,
        paymentToken: ZERO,
        expiry: 0,
      }
    );
  }

  async quoteBuy(listingId: bigint, amount: bigint): Promise<MarketplaceQuote> {
    const listing = await this.getListing(listingId);
    const totalPrice = amount * listing.pricePerUnit;
    const royaltyAmount = (totalPrice * 500n) / 10_000n;
    const protocolFee = (totalPrice * 1_000n) / 10_000n;
    return {
      totalPrice,
      royaltyAmount,
      protocolFee,
      sellerAmount: totalPrice - royaltyAmount - protocolFee,
    };
  }

  async getSoldLogs(transactionHash: string): Promise<MarketplaceSoldLogs> {
    this.receiptReads.push(transactionHash);
    const receipt = this.receipts.get(transactionHash.toLowerCase());
    if (receipt instanceof Error) throw receipt;
    if (!receipt || receipt.status === "pending") return { status: "pending", logs: [], blockNumber: null };
    return { ...receipt, blockNumber: receipt.blockNumber ?? this.head + 1n };
  }
}

/**
 * Stands in for the contract indexer. Like the real handler chain it records one
 * `StemPurchase` per Sold log of the fake receipt, asynchronously (the real rows
 * are written by an EventBus subscriber after `indexTransaction` returns).
 */
class FakeTransactionIndexer implements CrateTransactionIndexer {
  readonly calls: Array<{ txHash: string; chainId: number }> = [];
  error: Error | null = null;
  /** Delay before the rows appear, to exercise the wait. */
  writeDelayMs = 50;
  /** Never write the rows (the real handler is slow or failed). */
  skipWrite = false;

  constructor(private readonly chain: FakeMarketplaceReader) {}

  async indexTransaction(txHash: string, chainId: number): Promise<unknown> {
    this.calls.push({ txHash, chainId });
    if (this.error) throw this.error;
    const receipt = this.chain.receipts.get(txHash.toLowerCase());
    if (!receipt || receipt instanceof Error) return { processed: 0 };
    const write = async () => {
      for (const log of receipt.logs) {
        const listing = seeded.find((entry) => entry.listingId === log.listingId);
        if (!listing) continue;
        await prisma.stemPurchase.create({
          data: {
            listingId: listing.rowId,
            buyerAddress: log.buyer,
            amount: log.amount,
            totalPaid: log.totalPaid.toString(),
            royaltyPaid: "0",
            protocolFeePaid: "0",
            sellerReceived: "0",
            transactionHash: txHash,
            logIndex: log.logIndex,
            blockNumber: 1n,
            purchasedAt: new Date(),
          },
        });
      }
    };
    if (this.skipWrite) return { processed: receipt.logs.length };
    if (this.writeDelayMs <= 0) await write();
    else setTimeout(() => void write().catch(() => {}), this.writeDelayMs);
    return { processed: receipt.logs.length };
  }
}

// ---------------------------------------------------------------------------
// Fixture catalog
// ---------------------------------------------------------------------------

type SeedListing = {
  stemType: string;
  tier: "personal" | "remix" | "commercial";
  /** Price per unit in units of the chain token. */
  units: bigint;
  /** What the chain says; the database may disagree (stale). */
  chainToken: string;
  dbToken: string;
};

type SeedTrack = { key: string; stems: string[]; listings: SeedListing[] };

const usdc = (stemType: string, units: bigint, tier: SeedListing["tier"] = "personal"): SeedListing => ({
  stemType,
  tier,
  units,
  chainToken: USDC,
  dbToken: USDC,
});

const TRACKS: SeedTrack[] = [
  {
    key: "tA",
    stems: ["vocals", "drums", "bass", "guitar"],
    listings: [
      usdc("vocals", 1n * USDC_UNIT),
      usdc("drums", 2n * USDC_UNIT),
      usdc("bass", (3n * USDC_UNIT) / 2n),
      usdc("vocals", 8n * USDC_UNIT, "remix"),
    ],
  },
  {
    key: "tB",
    stems: ["vocals"],
    // The indexer stored a native payment token; the chain says USDC.
    listings: [{ stemType: "vocals", tier: "personal", units: 3n * USDC_UNIT, chainToken: USDC, dbToken: ZERO }],
  },
  {
    key: "tC",
    stems: ["vocals", "drums", "bass", "guitar"],
    listings: [usdc("vocals", USDC_UNIT), usdc("drums", USDC_UNIT), usdc("bass", USDC_UNIT)],
  },
  {
    key: "tE",
    stems: ["other"],
    listings: [
      { stemType: "other", tier: "personal", units: 10n ** 15n, chainToken: ZERO, dbToken: ZERO },
    ],
  },
];

type SeededListing = SeedListing & {
  trackKey: string;
  listingId: bigint;
  rowId: string;
  tokenId: bigint;
  stemId: string;
};
const seeded: SeededListing[] = [];
const listingFor = (trackKey: string, stemType: string, tier = "personal") => {
  const found = seeded.find(
    (entry) => entry.trackKey === trackKey && entry.stemType === stemType && entry.tier === tier,
  );
  if (!found) throw new Error(`no seeded listing ${trackKey}/${stemType}/${tier}`);
  return found;
};

type FakeReceipt = Omit<MarketplaceSoldLogs, "blockNumber"> & { blockNumber?: bigint | null };

const fake = new FakeMarketplaceReader();

function resetChain() {
  fake.configured = true;
  fake.head = 5_000n;
  fake.headError = null;
  fake.listings.clear();
  fake.receipts.clear();
  fake.receiptReads.length = 0;
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  for (const entry of seeded) {
    fake.listings.set(entry.listingId, {
      seller: SELLER,
      tokenId: entry.tokenId,
      amount: 3n,
      pricePerUnit: entry.units,
      paymentToken: entry.chainToken,
      expiry,
    });
  }
}

async function seedCatalog() {
  let counter = 0;
  const baseListingId = 7_100_000n + BigInt(Date.now() % 100_000) * 100n;
  for (const track of TRACKS) {
    await prisma.release.create({
      data: {
        id: id(`${track.key}_release`),
        title: `Release ${track.key}`,
        artistId: ARTIST,
        status: "published",
        genre: "Techno",
      },
    });
    await prisma.track.create({
      data: {
        id: id(track.key),
        title: `Track ${track.key}`,
        releaseId: id(`${track.key}_release`),
        position: 1,
        contentStatus: "clean",
      },
    });
    await prisma.stem.create({
      data: { id: id(`${track.key}_original`), trackId: id(track.key), type: "original", uri: "local://o.mp3" },
    });
    for (const stemType of track.stems) {
      await prisma.stem.create({
        data: {
          id: id(`${track.key}_${stemType}`),
          trackId: id(track.key),
          type: stemType,
          uri: `local://${track.key}-${stemType}.mp3`,
        },
      });
    }
    for (const listing of track.listings) {
      counter += 1;
      const listingId = baseListingId + BigInt(counter);
      const row = await prisma.stemListing.create({
        data: {
          listingId,
          stemId: id(`${track.key}_${listing.stemType}`),
          tokenId: listingId + 1000n,
          chainId: CHAIN_ID,
          // Mixed case on purpose: the marketplace match is case-insensitive.
          contractAddress: MARKETPLACE,
          sellerAddress: SELLER,
          pricePerUnit: listing.units.toString(),
          amount: 3n,
          paymentToken: listing.dbToken,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          transactionHash: hex(`list${counter}`),
          blockNumber: 1n,
          licenseType: listing.tier,
          status: "active",
          listedAt: new Date(Date.now() - counter * 1000),
        },
      });
      seeded.push({
        ...listing,
        trackKey: track.key,
        listingId,
        rowId: row.id,
        tokenId: listingId + 1000n,
        stemId: id(`${track.key}_${listing.stemType}`),
      });
    }
  }
}

async function makeCrate(
  userId: string,
  trackKeys: string[],
  filters: Record<string, unknown> = {},
): Promise<string> {
  const crate = await prisma.crate.create({
    data: { userId, filters: { count: 8, ...filters } as never, status: "draft" },
  });
  await prisma.crateItem.createMany({
    data: trackKeys.map((key, position) => ({ crateId: crate.id, userId, trackId: id(key), position })),
  });
  return crate.id;
}

const allItems = (quote: CrateQuoteDto) => quote.lines.flatMap((line) => line.items);
const itemOf = (quote: CrateQuoteDto, trackKey: string, stemType: string) => {
  const line = quote.lines.find((entry) => entry.trackId === id(trackKey));
  const item = line?.items.find((entry) => entry.stemType === stemType);
  if (!item) throw new Error(`no item ${trackKey}/${stemType}`);
  return item;
};

describe("CrateQuoteService (integration)", () => {
  let learning: AgentLearningService;
  let stemQuality: AgentStemQualityService;
  let service: CrateQuoteService;
  let signalSpy: jest.SpyInstance;
  let validationSpy: jest.SpyInstance;
  let previousAssets: string | undefined;

  beforeAll(async () => {
    previousAssets = process.env.PAYMENT_ASSETS_JSON;
    process.env.PAYMENT_ASSETS_JSON = JSON.stringify([
      {
        assetId: "local:usdc",
        chainId: CHAIN_ID,
        symbol: "USDC",
        kind: "stablecoin",
        tokenAddress: USDC,
        decimals: 6,
        enabled: true,
        pricingStrategy: "usd_pegged",
      },
    ]);

    for (const userId of [DJ, NO_WALLET_DJ, OTHER_DJ, ARTIST_USER]) {
      await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    }
    await prisma.wallet.create({
      data: { userId: DJ, address: DJ_WALLET, chainId: CHAIN_ID },
    });
    await prisma.wallet.create({
      data: { userId: OTHER_DJ, address: OTHER_BUYER, chainId: CHAIN_ID },
    });
    await prisma.artist.create({
      data: { id: ARTIST, userId: ARTIST_USER, displayName: "Quote Artist", payoutAddress: `0x${"A".repeat(40)}` },
    });
    await seedCatalog();

    learning = new AgentLearningService();
    // The identity service only refreshes curator reputation; no rating is
    // seeded here, so it is never reached.
    stemQuality = new AgentStemQualityService({} as never, { enrichConfig: async () => undefined } as never);
    signalSpy = jest.spyOn(learning, "recordSignal");
    validationSpy = jest.spyOn(stemQuality, "recordValidation");
    service = new CrateQuoteService(fake, learning, stemQuality);
  });

  afterAll(async () => {
    if (previousAssets === undefined) delete process.env.PAYMENT_ASSETS_JSON;
    else process.env.PAYMENT_ASSETS_JSON = previousAssets;

    await prisma.agentSignal.deleteMany({ where: { userId: DJ } }).catch(() => {});
    await prisma.crateQuote.deleteMany({ where: { userId: { in: [DJ, OTHER_DJ] } } }).catch(() => {});
    await prisma.crate.deleteMany({ where: { userId: { in: [DJ, NO_WALLET_DJ, OTHER_DJ] } } }).catch(() => {});
    await prisma.stemPurchase.deleteMany({ where: { transactionHash: { startsWith: "0x" + Buffer.from(TEST_PREFIX).toString("hex").slice(0, 16) } } }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { stemId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ARTIST } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: { in: [DJ, OTHER_DJ] } } }).catch(() => {});
    await prisma.user
      .deleteMany({ where: { id: { in: [DJ, NO_WALLET_DJ, OTHER_DJ, ARTIST_USER] } } })
      .catch(() => {});
  });

  beforeEach(() => {
    resetChain();
    signalSpy.mockClear();
    validationSpy.mockClear();
  });

  // -------------------------------------------------------------------------
  describe("POST quote", () => {
    it("defaults to the cheapest listed tier and every listed stem at it", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      const quote = await service.createQuote(DJ, crateId, {});

      expect(quote).toMatchObject({
        crateId,
        status: "open",
        chainId: CHAIN_ID,
        marketplaceAddress: MARKETPLACE.toLowerCase(),
        buyerAddress: DJ_WALLET.toLowerCase(),
        transactionHash: null,
      });
      expect(quote.lines).toHaveLength(1);
      const [line] = quote.lines;
      expect(line).toMatchObject({
        position: 0,
        trackId: id("tA"),
        title: "Track tA",
        licenseType: "personal",
        rights: { licenseType: "personal", standardTerms: true },
      });
      expect(line.rights.grants).toEqual(["Stream & collect — personal listening"]);
      // The remix-only price of vocals is not used; guitar has no listing at all.
      expect(line.items.map((item) => item.stemType)).toEqual(["bass", "drums", "vocals"]);
      expect(line.items.every((item) => item.status === "quoted" && item.reason === null)).toBe(true);
    });

    it("prices from the chain: units, split, payment token and display", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      const quote = await service.createQuote(DJ, crateId, {});
      const vocals = itemOf(quote, "tA", "vocals");
      const listing = listingFor("tA", "vocals");

      expect(vocals).toMatchObject({
        stemId: id("tA_vocals"),
        listingId: listing.listingId.toString(),
        tokenId: listing.tokenId.toString(),
        paymentToken: USDC,
        symbol: "USDC",
        decimals: 6,
        totalUnits: "1000000",
        total: "1",
        totalUsd: "1",
        // seller (85%) + royalty (5%); the 10% platform fee is the contract's.
        artistShareUnits: "900000",
        platformFeeUnits: "100000",
        receipt: null,
      });
      // Persisted as raw units, with the owner denormalized onto every row.
      const rows = await prisma.crateQuoteLine.findMany({ where: { quoteId: quote.id } });
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.userId === DJ && row.amount === 1n)).toBe(true);
      expect(rows.find((row) => row.stemType === "vocals")).toMatchObject({
        totalPriceUnits: "1000000",
        royaltyUnits: "50000",
        protocolFeeUnits: "100000",
        sellerUnits: "850000",
      });
    });

    it("totals per payment token and in USD, against the crate budget", async () => {
      const crateId = await makeCrate(DJ, ["tA", "tE"], { maxTotalUsd: 5 });
      const quote = await service.createQuote(DJ, crateId, {});
      expect(quote.totals).toEqual([
        {
          paymentToken: ZERO,
          symbol: "ETH",
          decimals: 18,
          totalUnits: (10n ** 15n).toString(),
          total: "0.001",
          totalUsd: "3",
        },
        {
          paymentToken: USDC,
          symbol: "USDC",
          decimals: 6,
          totalUnits: "4500000",
          total: "4.5",
          totalUsd: "4.5",
        },
      ]);
      expect(quote.totalUsd).toBe("7.5");
      expect(quote.budgetUsd).toBe(5);
      expect(quote.overBudget).toBe(true);
    });

    it("has a null total USD when a token's USD value is unknown", async () => {
      const previousPrices = process.env.PAYMENT_ASSET_PRICES_JSON;
      // Native ETH keeps its fixed test price, so make an unknown-USD token via
      // an asset with no pricing strategy and no configured price.
      const assets = JSON.parse(process.env.PAYMENT_ASSETS_JSON as string);
      const mystery = `0x${"77".repeat(20)}`;
      process.env.PAYMENT_ASSETS_JSON = JSON.stringify([
        ...assets,
        { assetId: "local:mys", chainId: CHAIN_ID, symbol: "MYS", tokenAddress: mystery, decimals: 18, enabled: true },
      ]);
      try {
        const listing = listingFor("tB", "vocals");
        fake.listings.set(listing.listingId, {
          ...(fake.listings.get(listing.listingId) as MarketplaceListing),
          paymentToken: mystery,
        });
        const crateId = await makeCrate(DJ, ["tB"]);
        const quote = await service.createQuote(DJ, crateId, {});
        expect(itemOf(quote, "tB", "vocals").totalUsd).toBeNull();
        expect(quote.totalUsd).toBeNull();
        expect(quote.overBudget).toBe(false);
      } finally {
        process.env.PAYMENT_ASSETS_JSON = JSON.stringify(assets);
        if (previousPrices === undefined) delete process.env.PAYMENT_ASSET_PRICES_JSON;
      }
    });

    it("overrides a stale database payment token with the chain's", async () => {
      const crateId = await makeCrate(DJ, ["tB"]);
      const quote = await service.createQuote(DJ, crateId, {});
      const row = await prisma.stemListing.findUniqueOrThrow({ where: { id: listingFor("tB", "vocals").rowId } });
      expect(row.paymentToken).toBe(ZERO); // the database is stale
      expect(itemOf(quote, "tB", "vocals")).toMatchObject({
        status: "quoted",
        paymentToken: USDC,
        symbol: "USDC",
        total: "3",
        totalUsd: "3",
      });
    });

    it("uses the crate's license filter and required stems, and per-line overrides win", async () => {
      const filtered = await makeCrate(DJ, ["tA"], { licenseType: "remix" });
      const quote = await service.createQuote(DJ, filtered, {});
      expect(quote.lines[0].licenseType).toBe("remix");
      expect(quote.lines[0].rights.grants).toContain("Includes personal rights");
      expect(quote.lines[0].items.map((item) => item.stemType)).toEqual(["vocals"]);
      expect(itemOf(quote, "tA", "vocals").total).toBe("8");

      const required = await makeCrate(DJ, ["tA"], { requiredStems: ["drums"] });
      const byStems = await service.createQuote(DJ, required, {});
      expect(byStems.lines[0].items.map((item) => item.stemType)).toEqual(["drums"]);

      const overridden = await service.createQuote(DJ, required, {
        lines: [{ trackId: id("tA"), licenseType: "personal", stemTypes: ["vocals", "bass"] }],
      });
      expect(overridden.lines[0].licenseType).toBe("personal");
      expect(overridden.lines[0].items.map((item) => item.stemType)).toEqual(["bass", "vocals"]);
    });

    it("quotes only the requested lines, in crate order", async () => {
      const crateId = await makeCrate(DJ, ["tA", "tB", "tC"]);
      const quote = await service.createQuote(DJ, crateId, {
        lines: [{ trackId: id("tC") }, { trackId: id("tB") }],
      });
      expect(quote.lines.map((line) => [line.position, line.trackId])).toEqual([
        [1, id("tB")],
        [2, id("tC")],
      ]);
    });

    it("drops a stem with a fixed reason instead of quoting what it cannot verify", async () => {
      const crateId = await makeCrate(DJ, ["tB", "tC", "tE"]);
      // sold_out: the contract deleted the listing.
      fake.listings.delete(listingFor("tC", "vocals").listingId);
      // expired: the chain expiry has passed (the database still says active).
      fake.listings.set(listingFor("tC", "drums").listingId, {
        ...(fake.listings.get(listingFor("tC", "drums").listingId) as MarketplaceListing),
        expiry: Math.floor(Date.now() / 1000) - 5,
      });
      // own_listing: the DJ's smart account is the seller.
      fake.listings.set(listingFor("tC", "bass").listingId, {
        ...(fake.listings.get(listingFor("tC", "bass").listingId) as MarketplaceListing),
        seller: DJ_WALLET.toLowerCase(),
      });
      // unverifiable: the RPC fails.
      fake.listings.set(listingFor("tB", "vocals").listingId, new Error("rpc down"));
      // token_not_supported: an ERC-20 no payment asset is configured for.
      fake.listings.set(listingFor("tE", "other").listingId, {
        ...(fake.listings.get(listingFor("tE", "other").listingId) as MarketplaceListing),
        paymentToken: UNKNOWN_TOKEN,
      });

      const quote = await service.createQuote(DJ, crateId, {
        lines: [
          { trackId: id("tB"), stemTypes: ["vocals"] },
          { trackId: id("tC"), stemTypes: ["vocals", "drums", "bass", "guitar"] },
          { trackId: id("tE"), stemTypes: ["other"] },
        ],
      });

      const reasons = Object.fromEntries(
        quote.lines.flatMap((line) =>
          line.items.map((item) => [`${line.trackId.replace(TEST_PREFIX, "")}/${item.stemType}`, [item.status, item.reason]]),
        ),
      );
      expect(reasons).toEqual({
        "tB/vocals": ["dropped", "unverifiable"],
        "tC/vocals": ["dropped", "sold_out"],
        "tC/drums": ["dropped", "expired"],
        "tC/bass": ["dropped", "own_listing"],
        "tC/guitar": ["dropped", "not_listed"],
        "tE/other": ["dropped", "token_not_supported"],
      });
      // Nothing is priced, so nothing counts toward the totals.
      expect(quote.totals).toEqual([]);
      expect(quote.totalUsd).toBe("0");
      const guitar = itemOf(quote, "tC", "guitar");
      expect(guitar).toMatchObject({
        stemId: id("tC_guitar"),
        listingId: null,
        paymentToken: null,
        totalUnits: null,
        total: null,
        artistShareUnits: null,
        platformFeeUnits: null,
      });
    });

    it("never quotes a listing whose on-chain token differs from the database's", async () => {
      const crateId = await makeCrate(DJ, ["tB"]);
      const listing = listingFor("tB", "vocals");
      fake.listings.set(listing.listingId, {
        ...(fake.listings.get(listing.listingId) as MarketplaceListing),
        tokenId: listing.tokenId + 1n,
      });
      const quote = await service.createQuote(DJ, crateId, {});
      expect(itemOf(quote, "tB", "vocals")).toMatchObject({ status: "dropped", reason: "unverifiable" });
    });

    it("expires at the quote TTL, or at the earliest on-chain expiry if sooner", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      const before = Date.now();
      const standard = await service.createQuote(DJ, crateId, {});
      const ttl = new Date(standard.expiresAt).getTime();
      expect(ttl).toBeGreaterThanOrEqual(before + CRATE_QUOTE_TTL_MS - 1000);
      expect(ttl).toBeLessThanOrEqual(Date.now() + CRATE_QUOTE_TTL_MS + 1000);

      const soon = Math.floor(Date.now() / 1000) + 90;
      const listing = listingFor("tA", "drums");
      fake.listings.set(listing.listingId, {
        ...(fake.listings.get(listing.listingId) as MarketplaceListing),
        expiry: soon,
      });
      const shortened = await service.createQuote(DJ, crateId, {});
      expect(new Date(shortened.expiresAt).getTime()).toBe(soon * 1000);
    });

    it("ignores a database listing that is not on the configured marketplace or is expired", async () => {
      const listing = listingFor("tB", "vocals");
      await prisma.stemListing.update({
        where: { id: listing.rowId },
        data: { contractAddress: `0x${"12".repeat(20)}` },
      });
      try {
        const crateId = await makeCrate(DJ, ["tB"]);
        const quote = await service.createQuote(DJ, crateId, {});
        expect(itemOf(quote, "tB", "vocals")).toMatchObject({ status: "dropped", reason: "not_listed" });
      } finally {
        await prisma.stemListing.update({ where: { id: listing.rowId }, data: { contractAddress: MARKETPLACE } });
      }
    });

    it("rejects bad lines, a missing wallet and an unconfigured marketplace", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      const invalid = async (lines: unknown) => {
        const error = await service.createQuote(DJ, crateId, { lines }).catch((caught) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({ code: "invalid_lines" });
      };
      await invalid([{ trackId: id("tB") }]); // not a line of the crate
      await invalid([{ trackId: id("tA") }, { trackId: id("tA") }]); // twice
      await invalid([]);
      await invalid("tA");
      await invalid([{ trackId: id("tA"), licenseType: "free" }]);
      await invalid([{ trackId: id("tA"), stemTypes: ["original"] }]);

      const noWalletCrate = await makeCrate(NO_WALLET_DJ, ["tA"]);
      const noWallet = await service.createQuote(NO_WALLET_DJ, noWalletCrate, {}).catch((caught) => caught);
      expect(noWallet).toBeInstanceOf(ConflictException);
      expect((noWallet as ConflictException).getResponse()).toMatchObject({ code: "no_wallet" });

      fake.configured = false;
      const unavailable = await service.createQuote(DJ, crateId, {}).catch((caught) => caught);
      expect(unavailable).toBeInstanceOf(ServiceUnavailableException);
      expect((unavailable as ServiceUnavailableException).getResponse()).toMatchObject({
        code: "marketplace_unavailable",
      });
    });

    it("checks the claimed buyer against the wallet on file: mismatch is 409, a match (any case) or none is fine", async () => {
      const crateId = await makeCrate(DJ, ["tB"]);
      const mismatch = await service
        .createQuote(DJ, crateId, { buyerAddress: OTHER_BUYER })
        .catch((caught) => caught);
      expect(mismatch).toBeInstanceOf(ConflictException);
      expect((mismatch as ConflictException).getResponse()).toMatchObject({ code: "wallet_mismatch" });
      expect(await prisma.crateQuote.count({ where: { crateId } })).toBe(0);

      const matched = await service.createQuote(DJ, crateId, { buyerAddress: DJ_WALLET.toUpperCase().replace("0X", "0x") });
      expect(matched.buyerAddress).toBe(DJ_WALLET.toLowerCase());
      const absent = await service.createQuote(DJ, crateId, {});
      expect(absent.buyerAddress).toBe(DJ_WALLET.toLowerCase());

      const invalid = await service.createQuote(DJ, crateId, { buyerAddress: "0x12" }).catch((caught) => caught);
      expect(invalid).toBeInstanceOf(BadRequestException);
      expect((invalid as BadRequestException).getResponse()).toMatchObject({ code: "invalid_buyer_address" });
    });

    it("another user's crate and an unknown id are a 404", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      await expect(service.createQuote(OTHER_DJ, crateId, {})).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.createQuote(DJ, "nope", {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it("records no taste signal and no validation when only quoting", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      await service.createQuote(DJ, crateId, {});
      expect(signalSpy).not.toHaveBeenCalled();
      expect(validationSpy).not.toHaveBeenCalled();
      expect(await prisma.agentSignal.count({ where: { userId: DJ, action: "purchase" } })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("settle", () => {
    /** The receipt a batched user operation would leave for these items. */
    function receiptFor(
      quote: CrateQuoteDto,
      pick: (item: ReturnType<typeof allItems>[number]) => boolean = () => true,
      buyer = DJ_WALLET.toLowerCase(),
    ): FakeReceipt {
      return {
        status: "success",
        logs: allItems(quote)
          .filter((item) => item.status === "quoted" && pick(item))
          .map((item, index) => ({
            listingId: BigInt(item.listingId as string),
            buyer,
            amount: 1n,
            totalPaid: BigInt(item.totalUnits as string),
            logIndex: 10 + index * 2,
          })),
      };
    }

    async function quoteOf(trackKeys: string[]) {
      const crateId = await makeCrate(DJ, trackKeys);
      return { crateId, quote: await service.createQuote(DJ, crateId, {}) };
    }

    it("settles every quoted line from the receipt, with the logs and purchases", async () => {
      const { crateId, quote } = await quoteOf(["tA", "tB"]);
      const hash = hex(`tx_${quote.id}`);
      fake.receipts.set(hash, receiptFor(quote));

      // The indexer already recorded one of the sales.
      const vocals = listingFor("tA", "vocals");
      const purchase = await prisma.stemPurchase.create({
        data: {
          listingId: vocals.rowId,
          buyerAddress: DJ_WALLET.toLowerCase(),
          amount: 1n,
          totalPaid: "1000000",
          royaltyPaid: "0",
          protocolFeePaid: "0",
          sellerReceived: "0",
          transactionHash: hash,
          logIndex: 10 + 2 * 2, // bass, drums, vocals: vocals is the third
          blockNumber: 1n,
          purchasedAt: new Date(),
        },
      });

      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash.toUpperCase().replace("0X", "0x") });
      expect(settled.status).toBe("settled");
      expect(settled.transactionHash).toBe(hash);
      for (const item of allItems(settled)) {
        expect(item.status).toBe("settled");
        expect(item.receipt).toMatchObject({ transactionHash: hash, totalPaidUnits: item.totalUnits });
      }
      expect(itemOf(settled, "tA", "vocals").receipt).toMatchObject({ logIndex: 14, purchaseId: purchase.id });
      expect(itemOf(settled, "tA", "bass").receipt?.purchaseId).toBeNull();

      const stored = await prisma.crateQuote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(stored.status).toBe("settled");
      expect(stored.submittedAt).not.toBeNull();
      expect(stored.settledAt).not.toBeNull();

      // GET returns the same receipts.
      const fetched = await service.getQuote(DJ, crateId, quote.id);
      expect(fetched).toEqual(settled);
    });

    it("learns from the purchase once per settled track and stem, only after settlement", async () => {
      const { crateId, quote } = await quoteOf(["tA", "tB"]);
      expect(signalSpy).not.toHaveBeenCalled();

      const hash = hex(`tx_${quote.id}`);
      fake.receipts.set(hash, receiptFor(quote));
      await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });

      // Two tracks, four stems.
      expect(signalSpy).toHaveBeenCalledTimes(2);
      expect(signalSpy.mock.calls.map(([input]) => input.trackId).sort()).toEqual([id("tA"), id("tB")]);
      for (const [input] of signalSpy.mock.calls) {
        expect(input).toMatchObject({ userId: DJ, action: "purchase" });
        expect(input.metadata).toMatchObject({
          source: "crate_purchase",
          licenseType: "personal",
          outcome: { type: "purchase" },
        });
      }
      const forA = signalSpy.mock.calls.find(([input]) => input.trackId === id("tA"))![0];
      expect(forA.metadata.outcome.priceUsd).toBe(4.5);
      expect(validationSpy).toHaveBeenCalledTimes(4);
      expect(validationSpy.mock.calls.map(([input]) => input.stemId).sort()).toEqual(
        [id("tA_bass"), id("tA_drums"), id("tA_vocals"), id("tB_vocals")].sort(),
      );
      expect(validationSpy.mock.calls.every(([input]) => input.validation === "purchase")).toBe(true);
      expect(await prisma.agentSignal.count({ where: { userId: DJ, action: "purchase", trackId: id("tA") } })).toBeGreaterThanOrEqual(1);

      // Re-settling the same hash is idempotent and learns nothing more.
      const again = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(again.status).toBe("settled");
      expect(signalSpy).toHaveBeenCalledTimes(2);
      expect(validationSpy).toHaveBeenCalledTimes(4);
    });

    it("still settles when learning fails (best effort)", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      const hash = hex(`tx_${quote.id}`);
      fake.receipts.set(hash, receiptFor(quote));
      signalSpy.mockRejectedValueOnce(new Error("learning down"));
      validationSpy.mockRejectedValueOnce(new Error("quality down"));
      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(settled.status).toBe("settled");
    });

    describe("recording purchases at settlement", () => {
      let indexer: FakeTransactionIndexer;
      let indexed: CrateQuoteService;

      beforeEach(() => {
        indexer = new FakeTransactionIndexer(fake);
        indexed = new CrateQuoteService(fake, learning, stemQuality, indexer);
        indexed.purchaseWait = { timeoutMs: 1_000, intervalMs: 10 };
      });

      it("indexes the purchase transaction once on settlement, so the purchases exist when the receipts show", async () => {
        const { crateId, quote } = await quoteOf(["tA", "tB"]);
        const hash = hex(`tx_${quote.id}`);
        fake.receipts.set(hash, receiptFor(quote));

        const settled = await indexed.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
        expect(settled.status).toBe("settled");
        expect(indexer.calls).toEqual([{ txHash: hash, chainId: CHAIN_ID }]);

        const purchases = await prisma.stemPurchase.findMany({ where: { transactionHash: hash } });
        expect(purchases).toHaveLength(allItems(settled).length);
        for (const item of allItems(settled)) {
          expect(item.receipt?.purchaseId).toEqual(expect.any(String));
        }

        // A second settle of the settled quote does not index again.
        await indexed.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
        expect(indexer.calls).toHaveLength(1);
      });

      it("does not index while the transaction is pending, when it reverted, or when no service indexer is set", async () => {
        const { crateId, quote } = await quoteOf(["tB"]);
        const hash = hex(`tx_${quote.id}`);

        const pending = await indexed.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
        expect(pending.status).toBe("submitted");
        expect(indexer.calls).toHaveLength(0);

        fake.receipts.set(hash, { status: "reverted", logs: [] });
        const failed = await indexed.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
        expect(failed.status).toBe("failed");
        expect(indexer.calls).toHaveLength(0);

        // The default service has no indexer and still settles.
        const second = await quoteOf(["tB"]);
        const secondHash = hex(`tx_${second.quote.id}`);
        fake.receipts.set(secondHash, receiptFor(second.quote));
        const settled = await service.settleQuote(DJ, second.crateId, second.quote.id, {
          transactionHash: secondHash,
        });
        expect(settled.status).toBe("settled");
        expect(indexer.calls).toHaveLength(0);
      });

      it("still returns settled receipts when the indexer throws", async () => {
        const { crateId, quote } = await quoteOf(["tB"]);
        const hash = hex(`tx_${quote.id}`);
        fake.receipts.set(hash, receiptFor(quote));
        indexer.error = new Error("rpc down");

        const settled = await indexed.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
        expect(settled.status).toBe("settled");
        expect(indexer.calls).toHaveLength(1);
        for (const item of allItems(settled)) expect(item.receipt?.purchaseId).toBeNull();
      });

      it("gives up waiting after the timeout and still settles", async () => {
        const { crateId, quote } = await quoteOf(["tB"]);
        const hash = hex(`tx_${quote.id}`);
        fake.receipts.set(hash, receiptFor(quote));
        // The rows never appear within the (short) wait.
        indexer.skipWrite = true;
        indexed.purchaseWait = { timeoutMs: 100, intervalMs: 10 };

        const started = Date.now();
        const settled = await indexed.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(settled.status).toBe("settled");
      });
    });

    it("partly settles when the transaction carried only some lines", async () => {
      const { crateId, quote } = await quoteOf(["tA", "tB"]);
      const hash = hex(`tx_${quote.id}`);
      fake.receipts.set(hash, receiptFor(quote, (item) => item.stemType !== "drums"));

      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(settled.status).toBe("partial");
      expect(itemOf(settled, "tA", "drums")).toMatchObject({
        status: "failed",
        reason: "not_in_transaction",
        receipt: null,
      });
      expect(itemOf(settled, "tA", "vocals").status).toBe("settled");
      // Only settled stems teach anything.
      expect(validationSpy.mock.calls.map(([input]) => input.stemId)).not.toContain(id("tA_drums"));
      expect(validationSpy).toHaveBeenCalledTimes(3);
      expect(signalSpy).toHaveBeenCalledTimes(2);
    });

    it("fails the quote when the transaction reverted, and learns nothing", async () => {
      const { crateId, quote } = await quoteOf(["tA"]);
      const hash = hex(`tx_${quote.id}`);
      fake.receipts.set(hash, { status: "reverted", logs: [] });

      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(settled.status).toBe("failed");
      expect(allItems(settled).every((item) => item.status === "failed" && item.reason === "transaction_reverted")).toBe(true);
      expect(signalSpy).not.toHaveBeenCalled();
      expect(validationSpy).not.toHaveBeenCalled();
      expect((await prisma.crateQuote.findUniqueOrThrow({ where: { id: quote.id } })).settledAt).not.toBeNull();
    });

    it("ignores Sold logs for another buyer", async () => {
      const { crateId, quote } = await quoteOf(["tA"]);
      const hash = hex(`tx_${quote.id}`);
      fake.receipts.set(hash, receiptFor(quote, () => true, OTHER_BUYER));

      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(settled.status).toBe("failed");
      expect(allItems(settled).every((item) => item.reason === "not_in_transaction")).toBe(true);
      expect(signalSpy).not.toHaveBeenCalled();
    });

    it("stays submitted while the transaction has no receipt, then settles on retry", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      const hash = hex(`tx_${quote.id}`);

      const pending = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(pending.status).toBe("submitted");
      expect(pending.transactionHash).toBe(hash);
      expect(signalSpy).not.toHaveBeenCalled();

      // The chain cannot be read: still submitted, not an error.
      fake.receipts.set(hash, new Error("rpc down"));
      expect((await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash })).status).toBe("submitted");

      fake.receipts.set(hash, receiptFor(quote));
      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(settled.status).toBe("settled");
      expect(signalSpy).toHaveBeenCalledTimes(1);
    });

    it("refuses a different transaction once one was submitted (409), but returns a final quote", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      const hash = hex(`tx_${quote.id}`);
      await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });

      const other = hex(`other_${quote.id}`);
      const conflict = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: other }).catch((e) => e);
      expect(conflict).toBeInstanceOf(ConflictException);
      expect((conflict as ConflictException).getResponse()).toMatchObject({ code: "already_submitted" });

      fake.receipts.set(hash, receiptFor(quote));
      await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      // Settled: any later call just returns the current state.
      const final = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: other });
      expect(final.status).toBe("settled");
      expect(final.transactionHash).toBe(hash);
    });

    it("leaves browser-dropped lines out of the settlement", async () => {
      const { crateId, quote } = await quoteOf(["tA"]);
      const hash = hex(`tx_${quote.id}`);
      const drums = itemOf(quote, "tA", "drums");
      fake.receipts.set(hash, receiptFor(quote, (item) => item.stemType !== "drums"));

      const settled = await service.settleQuote(DJ, crateId, quote.id, {
        transactionHash: hash,
        dropped: [{ quoteLineId: drums.quoteLineId, reason: "simulation_failed" }],
      });
      expect(settled.status).toBe("settled");
      expect(itemOf(settled, "tA", "drums")).toMatchObject({ status: "dropped", reason: "simulation_failed" });
      expect(validationSpy.mock.calls.map(([input]) => input.stemId)).not.toContain(id("tA_drums"));
      // A dropped stem is not part of the totals.
      expect(settled.totals[0].totalUnits).toBe("2500000");
    });

    it("rejects dropped lines that are not the quote's, and a bad hash", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      const hash = hex(`tx_${quote.id}`);
      const bad = await service
        .settleQuote(DJ, crateId, quote.id, { transactionHash: hash, dropped: [{ quoteLineId: "nope", reason: "deselected" }] })
        .catch((e) => e);
      expect(bad).toBeInstanceOf(BadRequestException);
      expect((bad as BadRequestException).getResponse()).toMatchObject({ code: "invalid_dropped" });
      // Nothing was stored by the rejected call.
      expect((await prisma.crateQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("open");

      const noHash = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: "0x12" }).catch((e) => e);
      expect(noHash).toBeInstanceOf(BadRequestException);
      expect((noHash as BadRequestException).getResponse()).toMatchObject({ code: "invalid_transaction_hash" });
    });

    it("stores the chain head at quote time", async () => {
      fake.head = 7_777n;
      const { quote } = await quoteOf(["tB"]);
      expect((await prisma.crateQuote.findUniqueOrThrow({ where: { id: quote.id } })).quotedAtBlock).toBe(7_777n);
    });

    it("answers 503 when the chain head cannot be read while quoting", async () => {
      fake.headError = new Error("rpc down");
      const crateId = await makeCrate(DJ, ["tB"]);
      await expect(service.createQuote(DJ, crateId, {})).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await prisma.crateQuote.count({ where: { crateId } })).toBe(0);
    });

    it("fails a quote whose transaction was mined at or before the quote's block, and learns nothing", async () => {
      for (const minedAt of [4_999n, 5_000n]) {
        const { crateId, quote } = await quoteOf(["tA"]);
        const hash = hex(`tx_old_${minedAt}_${quote.id}`);
        // A perfectly matching purchase, but older than the quote (head is 5000).
        fake.receipts.set(hash, { ...receiptFor(quote), blockNumber: minedAt });

        const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
        expect(settled.status).toBe("failed");
        expect(
          allItems(settled).every((item) => item.status === "failed" && item.reason === "transaction_before_quote" && item.receipt === null),
        ).toBe(true);
        expect(signalSpy).not.toHaveBeenCalled();
        expect(validationSpy).not.toHaveBeenCalled();
      }
    });

    it("settles a transaction mined after the quote's block", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      const hash = hex(`tx_new_${quote.id}`);
      fake.receipts.set(hash, { ...receiptFor(quote), blockNumber: 5_001n });
      expect((await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash })).status).toBe("settled");
    });

    it("fails every line when a successful bundle transaction has no Sold logs (the user operation reverted inside it)", async () => {
      const { crateId, quote } = await quoteOf(["tA"]);
      const hash = hex(`tx_bundle_${quote.id}`);
      fake.receipts.set(hash, { status: "success", logs: [] });

      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(settled.status).toBe("failed");
      expect(allItems(settled).every((item) => item.status === "failed" && item.reason === "not_in_transaction")).toBe(true);
      expect(signalSpy).not.toHaveBeenCalled();
      expect(validationSpy).not.toHaveBeenCalled();
    });

    it("lets one transaction settle at most one quote (409 transaction_already_used)", async () => {
      const first = await quoteOf(["tB"]);
      const second = await quoteOf(["tB"]);
      const hash = hex(`tx_shared_${first.quote.id}`);
      fake.receipts.set(hash, receiptFor(first.quote));
      expect((await service.settleQuote(DJ, first.crateId, first.quote.id, { transactionHash: hash })).status).toBe("settled");

      const error = await service
        .settleQuote(DJ, second.crateId, second.quote.id, { transactionHash: hash.toUpperCase().replace("0X", "0x") })
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: "transaction_already_used" });
      // The refused quote is untouched and nothing was learned twice.
      const untouched = await prisma.crateQuote.findUniqueOrThrow({ where: { id: second.quote.id } });
      expect(untouched).toMatchObject({ status: "open", transactionHash: null });
      expect(signalSpy).toHaveBeenCalledTimes(1);
    });

    it("refuses the same transaction for two quotes settled at the same time", async () => {
      const first = await quoteOf(["tB"]);
      const second = await quoteOf(["tB"]);
      const hash = hex(`tx_race_${first.quote.id}`);
      fake.receipts.set(hash, receiptFor(first.quote));

      const results = await Promise.allSettled([
        service.settleQuote(DJ, first.crateId, first.quote.id, { transactionHash: hash }),
        service.settleQuote(DJ, second.crateId, second.quote.id, { transactionHash: hash }),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect((rejected[0].reason as ConflictException).getResponse()).toMatchObject({ code: "transaction_already_used" });
      expect(await prisma.crateQuote.count({ where: { id: { in: [first.quote.id, second.quote.id] }, transactionHash: hash } })).toBe(1);
    });

    it("settles one of two lines for the same listing when the transaction has one log", async () => {
      const crateId = await makeCrate(DJ, ["tB"]);
      const listing = listingFor("tB", "vocals");
      const quote = await prisma.crateQuote.create({
        data: {
          crateId,
          userId: DJ,
          status: "open",
          chainId: CHAIN_ID,
          marketplaceAddress: MARKETPLACE.toLowerCase(),
          buyerAddress: DJ_WALLET.toLowerCase(),
          expiresAt: new Date(Date.now() + 600_000),
          quotedAtBlock: fake.head,
        },
      });
      const line = (position: number) => ({
        quoteId: quote.id,
        userId: DJ,
        position,
        trackId: id("tB"),
        stemId: listing.stemId,
        stemType: "vocals",
        licenseType: "personal" as const,
        listingRowId: listing.rowId,
        listingId: listing.listingId,
        tokenId: listing.tokenId,
        amount: 1n,
        paymentToken: USDC,
        totalPriceUnits: listing.units.toString(),
        royaltyUnits: "0",
        protocolFeeUnits: "0",
        sellerUnits: listing.units.toString(),
        status: "quoted",
      });
      await prisma.crateQuoteLine.createMany({ data: [line(0), line(1)] });

      const hash = hex(`tx_dup_${quote.id}`);
      fake.receipts.set(hash, {
        status: "success",
        logs: [
          {
            listingId: listing.listingId,
            buyer: DJ_WALLET.toLowerCase(),
            amount: 1n,
            totalPaid: listing.units,
            logIndex: 3,
          },
        ],
      });
      const settled = await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash });
      expect(settled.status).toBe("partial");
      const rows = await prisma.crateQuoteLine.findMany({ where: { quoteId: quote.id }, orderBy: { position: "asc" } });
      expect(rows.map((row) => [row.status, row.reason, row.logIndex])).toEqual([
        ["settled", null, 3],
        ["failed", "not_in_transaction", null],
      ]);
    });

    it("settles a mined transaction even after the quote expired", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      await prisma.crateQuote.update({ where: { id: quote.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      const hash = hex(`tx_${quote.id}`);
      fake.receipts.set(hash, receiptFor(quote));
      expect((await service.settleQuote(DJ, crateId, quote.id, { transactionHash: hash })).status).toBe("settled");
    });

    it("answers 503 when the configured marketplace is not the one the quote used", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      await prisma.crateQuote.update({ where: { id: quote.id }, data: { marketplaceAddress: `0x${"12".repeat(20)}` } });
      const error = await service
        .settleQuote(DJ, crateId, quote.id, { transactionHash: hex(`tx_${quote.id}`) })
        .catch((e) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
    });

    it("hides quotes from other users and from other crates (404)", async () => {
      const { crateId, quote } = await quoteOf(["tB"]);
      const hash = hex(`tx_${quote.id}`);
      await expect(service.getQuote(OTHER_DJ, crateId, quote.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.settleQuote(OTHER_DJ, crateId, quote.id, { transactionHash: hash }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const otherCrate = await makeCrate(DJ, ["tA"]);
      await expect(service.getQuote(DJ, otherCrate, quote.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getQuote(DJ, crateId, "nope")).rejects.toBeInstanceOf(NotFoundException);
      // The 404 changed nothing.
      expect((await prisma.crateQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("open");
    });
  });

  // -------------------------------------------------------------------------
  describe("GET crate latestQuote", () => {
    it("is null without a quote, then the most recent quote", async () => {
      const crates = new CratesService(
        deterministicCrateRequestParser,
        new DiscoveryRankingService(),
        new DiscoveryPolicyContextService(),
        new CrateEntitlementsService(),
        undefined,
        undefined,
        service,
      );
      const crateId = await makeCrate(DJ, ["tB"]);
      expect((await crates.getCrate(DJ, crateId)).latestQuote).toBeNull();

      await service.createQuote(DJ, crateId, {});
      const second = await service.createQuote(DJ, crateId, {});
      const response = await crates.getCrate(DJ, crateId);
      expect(response.latestQuote?.id).toBe(second.id);
      expect(response.crate.id).toBe(crateId);
    });
  });

  // -------------------------------------------------------------------------
  describe("personal data", () => {
    it("deleting the crate deletes its quotes and their lines", async () => {
      const crateId = await makeCrate(DJ, ["tB"]);
      const quote = await service.createQuote(DJ, crateId, {});
      await prisma.crate.delete({ where: { id: crateId } });
      expect(await prisma.crateQuote.count({ where: { id: quote.id } })).toBe(0);
      expect(await prisma.crateQuoteLine.count({ where: { quoteId: quote.id } })).toBe(0);
    });
  });
});
