import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { CrateQuote, CrateQuoteLine, LicenseType } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AgentLearningService, buildAgentSignalMetadata } from "../agents/agent_learning.service";
import { AgentStemQualityService } from "../agents/agent_stem_quality.service";
import { classifyTrackAvailability, isPlayableAvailability } from "../catalog/track-availability";
import {
  decoratePaymentAmount,
  loadPaymentAssetsForIndexing,
  normalizePaymentToken,
  ZERO_PAYMENT_TOKEN,
} from "../payments/payment-asset-metadata";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import {
  CRATE_LICENSE_TYPES,
  CRATE_STEM_TYPES,
  type CrateLicenseType,
  type CrateStemType,
} from "./crate.types";
import { sanitizeCrateFilters } from "./crate_filters";
import { crateTierRights } from "./crate_license_rights";
import {
  CRATE_MARKETPLACE_READER,
  type CrateMarketplaceReader,
  type MarketplaceSoldLogs,
} from "./crate_marketplace_reader";
import {
  aggregateQuoteTotals,
  chooseQuoteStemTypes,
  chooseQuoteTier,
  classifyChainListing,
  CRATE_QUOTE_MAX_LINES,
  CRATE_QUOTE_MAX_STEM_TYPES,
  CRATE_QUOTE_SETTLE_DROP_REASONS,
  CRATE_QUOTE_TTL_MS,
  CRATE_QUOTE_UNITS_PER_STEM,
  isTransactionHash,
  matchReceipts,
  pickListing,
  settlementStatus,
  sumUsd,
  type CrateQuoteDropReason,
  type CrateQuoteSettleDropReason,
  type DecorateUnits,
  type QuoteListingCandidate,
} from "./crate_quote";
import {
  CRATE_QUOTE_MAX_ITEMS,
  type CrateQuoteDto,
  type CrateQuoteItemDto,
  type CrateQuoteLineDto,
} from "./crate_quote.dto";

/**
 * Crate quote and settlement (#1964, docs/rfc/taste-engine.md §5.4).
 *
 * A quote prices the lines of a DJ's crate from ON-CHAIN facts (`getListing`
 * and `quoteBuy`), never from the possibly stale database listing, so the DJ
 * approves the real price and payment token. The DJ's browser then signs and
 * sends ONE batched user operation from their smart account (the web slice);
 * the backend never holds a key and never buys. Settlement is verified from the
 * transaction receipt: a stem counts as bought only when the marketplace
 * emitted a `Sold` log for it to the quote's buyer. Nothing is learned from a
 * purchase before then (ADR-TE-1: purchases happen only on a quote the DJ
 * approved).
 *
 * Business model: ADR-BM-6 Line 3 (marketplace take-rate, 10%), phase 2. The
 * fee, royalty and seller split are the contract's; this service reads them and
 * adds nothing.
 */

/** Fixed codes for 4xx responses; never echo the input. */
export const CRATE_QUOTE_ERROR_CODES = {
  invalidLines: "invalid_lines",
  invalidTransactionHash: "invalid_transaction_hash",
  invalidDropped: "invalid_dropped",
  noWallet: "no_wallet",
  marketplaceUnavailable: "marketplace_unavailable",
  alreadySubmitted: "already_submitted",
} as const;

/** How many chain reads run at once while quoting. */
const CHAIN_READ_CONCURRENCY = 6;

type QuoteRow = CrateQuote & { lines: CrateQuoteLine[] };

type LineInput = {
  trackId: string;
  licenseType?: CrateLicenseType;
  stemTypes?: CrateStemType[];
};

/** A database listing of one stem, with the stem it belongs to. */
type StemListingCandidate = QuoteListingCandidate & {
  stemId: string;
  stemType: string;
  listingId: bigint;
  tokenId: bigint;
};

/** One (track, stem) result before it is stored. */
type DraftItem = {
  position: number;
  trackId: string;
  stemId: string;
  stemType: string;
  licenseType: CrateLicenseType;
  status: "quoted" | "dropped";
  reason: CrateQuoteDropReason | null;
  listing: StemListingCandidate | null;
  paymentToken: string | null;
  units: { total: bigint; royalty: bigint; fee: bigint; seller: bigint } | null;
  /** On-chain expiry (unix seconds) of a quoted item. */
  chainExpiry: number | null;
};

const ZERO_ADDRESS = ZERO_PAYMENT_TOKEN;

@Injectable()
export class CrateQuoteService {
  private readonly logger = new Logger(CrateQuoteService.name);

  constructor(
    @Inject(CRATE_MARKETPLACE_READER) private readonly reader: CrateMarketplaceReader,
    // Both optional: without them settlement still records the receipts, it just
    // learns nothing from the purchase.
    @Optional() private readonly learning?: AgentLearningService,
    @Optional() private readonly stemQuality?: AgentStemQualityService,
  ) {}

  // -------------------------------------------------------------------------
  // POST /crates/:id/quote
  // -------------------------------------------------------------------------

  async createQuote(
    userId: string,
    crateId: string,
    input: { lines?: unknown } = {},
  ): Promise<CrateQuoteDto> {
    const requested = parseLineInputs(input.lines);

    // Someone else's crate and an unknown id look identical: 404, never 403.
    const crate = await prisma.crate.findFirst({
      where: { id: crateId, userId },
      include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    if (!crate) throw new NotFoundException("Crate not found");

    const inCrate = new Set(crate.items.map((item) => item.trackId));
    if (requested && requested.some((line) => !inCrate.has(line.trackId))) {
      throw new BadRequestException({
        code: CRATE_QUOTE_ERROR_CODES.invalidLines,
        message: "lines must be lines of the crate, each at most once",
      });
    }
    const overrides = new Map((requested ?? []).map((line) => [line.trackId, line]));
    const targets = crate.items.filter((item) => !requested || overrides.has(item.trackId));
    if (targets.length === 0) {
      throw new BadRequestException({
        code: CRATE_QUOTE_ERROR_CODES.invalidLines,
        message: "The crate has no lines to quote",
      });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet?.address) {
      throw new ConflictException({
        code: CRATE_QUOTE_ERROR_CODES.noWallet,
        message: "A wallet is needed to buy; create one first",
      });
    }
    if (!this.reader.isConfigured()) {
      throw new MarketplaceUnavailableException();
    }

    const buyerAddress = wallet.address.toLowerCase();
    const filters = sanitizeCrateFilters(crate.filters).filters;
    const now = new Date();
    const chainId = this.reader.chainId;
    const marketplaceAddress = this.reader.marketplaceAddress.toLowerCase();

    const rows = await prisma.track.findMany({
      where: { id: { in: targets.map((item) => item.trackId) } },
      select: {
        id: true,
        contentStatus: true,
        rightsRoute: true,
        release: {
          select: { status: true, rightsRoute: true, withdrawnAt: true, withdrawalReason: true },
        },
        stems: {
          where: { isCurrent: true },
          select: {
            id: true,
            type: true,
            listings: {
              where: {
                status: "active",
                expiresAt: { gt: now },
                chainId,
                contractAddress: { equals: marketplaceAddress, mode: "insensitive" },
              },
              select: {
                id: true,
                listingId: true,
                tokenId: true,
                licenseType: true,
                pricePerUnit: true,
                paymentToken: true,
                listedAt: true,
              },
            },
          },
        },
      },
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));

    // The decision per (track, stem), before any chain read.
    type Plan = {
      position: number;
      trackId: string;
      tier: CrateLicenseType;
      stemId: string;
      stemType: string;
      listing: StemListingCandidate | null;
    };
    const plans: Plan[] = [];
    for (const item of targets) {
      const row = rowById.get(item.trackId);
      if (!row) continue;
      const playable = isPlayableAvailability(classifyTrackAvailability(row));
      const stems = row.stems
        .filter((stem) => {
          const type = stem.type.toLowerCase();
          return type !== "original" && type !== "master";
        })
        .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));

      // A track that is no longer playable is never bought: its stems are
      // reported as not listed.
      const candidates: StemListingCandidate[] = playable
        ? stems.flatMap((stem) =>
            stem.listings.map((listing) => ({
              id: listing.id,
              licenseType: listing.licenseType,
              pricePerUnitUnits: BigInt(listing.pricePerUnit),
              canonicalUsd: storedListingUsd(chainId, listing.paymentToken, listing.pricePerUnit),
              listedAt: listing.listedAt,
              stemId: stem.id,
              stemType: stem.type.toLowerCase(),
              listingId: listing.listingId,
              tokenId: listing.tokenId,
            })),
          )
        : [];

      const override = overrides.get(item.trackId);
      const tier = chooseQuoteTier({
        lineLicenseType: override?.licenseType ?? null,
        filterLicenseType: filters.licenseType,
        listings: candidates,
      });
      const atTier = candidates.filter((candidate) => candidate.licenseType === tier);
      const stemTypes = chooseQuoteStemTypes({
        lineStemTypes: override?.stemTypes ?? null,
        filterRequiredStems: filters.requiredStems,
        listedAtTier: atTier.map((candidate) => candidate.stemType),
        trackStemTypes: stems.map((stem) => stem.type.toLowerCase()),
      });

      for (const stemType of stemTypes) {
        // A stem type the track does not have has nothing to report.
        const ofType = stems.filter((stem) => stem.type.toLowerCase() === stemType);
        if (ofType.length === 0) continue;
        const listing = pickListing(atTier.filter((candidate) => candidate.stemType === stemType));
        plans.push({
          position: item.position,
          trackId: item.trackId,
          tier,
          stemId: listing?.stemId ?? ofType[0].id,
          stemType,
          listing,
        });
      }
    }

    const nowSeconds = Math.floor(now.getTime() / 1000);
    const drafts = await mapWithConcurrency(plans, CHAIN_READ_CONCURRENCY, (plan) =>
      this.verifyOnChain(plan, buyerAddress, nowSeconds),
    );

    const chainExpiries = drafts
      .map((draft) => draft.chainExpiry)
      .filter((expiry): expiry is number => expiry !== null);
    const ttlEnd = now.getTime() + CRATE_QUOTE_TTL_MS;
    const expiresAt = new Date(
      chainExpiries.length > 0 ? Math.min(ttlEnd, Math.min(...chainExpiries) * 1000) : ttlEnd,
    );

    const created = await prisma.$transaction(async (tx) => {
      const quote = await tx.crateQuote.create({
        data: {
          crateId,
          userId,
          status: "open",
          chainId,
          marketplaceAddress,
          buyerAddress,
          expiresAt,
        },
      });
      if (drafts.length > 0) {
        await tx.crateQuoteLine.createMany({
          data: drafts.map((draft) => ({
            quoteId: quote.id,
            // Always the quote owner (denormalized for export and erasure).
            userId,
            position: draft.position,
            trackId: draft.trackId,
            stemId: draft.stemId,
            stemType: draft.stemType,
            licenseType: draft.licenseType as LicenseType,
            listingRowId: draft.listing?.id ?? null,
            listingId: draft.listing?.listingId ?? null,
            tokenId: draft.listing?.tokenId ?? null,
            amount: CRATE_QUOTE_UNITS_PER_STEM,
            paymentToken: draft.paymentToken,
            totalPriceUnits: draft.units?.total.toString() ?? null,
            royaltyUnits: draft.units?.royalty.toString() ?? null,
            protocolFeeUnits: draft.units?.fee.toString() ?? null,
            sellerUnits: draft.units?.seller.toString() ?? null,
            status: draft.status,
            reason: draft.reason,
          })),
        });
      }
      return quote.id;
    });

    return this.loadQuoteDto(userId, crateId, created);
  }

  /**
   * Reads one planned stem from the chain and decides whether it can be quoted.
   * A stem is quoted only when the chain was read, agrees with the database on
   * the token, and its payment asset is known; anything else is dropped with a
   * fixed reason, never guessed.
   */
  private async verifyOnChain(
    plan: {
      position: number;
      trackId: string;
      tier: CrateLicenseType;
      stemId: string;
      stemType: string;
      listing: StemListingCandidate | null;
    },
    buyerAddress: string,
    nowSeconds: number,
  ): Promise<DraftItem> {
    const base = {
      position: plan.position,
      trackId: plan.trackId,
      stemId: plan.stemId,
      stemType: plan.stemType,
      licenseType: plan.tier,
      listing: plan.listing,
    };
    const dropped = (
      reason: CrateQuoteDropReason,
      paymentToken: string | null = null,
    ): DraftItem => ({
      ...base,
      status: "dropped",
      reason,
      paymentToken,
      units: null,
      chainExpiry: null,
    });

    const listing = plan.listing;
    if (!listing) return dropped("not_listed");

    let onChain;
    try {
      onChain = await this.reader.getListing(listing.listingId);
    } catch (error) {
      this.logger.warn(`Quote: listing ${listing.listingId} could not be read from the chain`);
      return dropped("unverifiable");
    }

    const reason = classifyChainListing({
      listing: onChain,
      buyerAddress,
      nowSeconds,
      units: CRATE_QUOTE_UNITS_PER_STEM,
    });
    if (reason) return dropped(reason, reason === "sold_out" ? null : onChain.paymentToken);

    // The database says which stem this listing sells; the chain must say the
    // same token, or the quote would buy something other than what is shown.
    if (onChain.tokenId !== listing.tokenId) return dropped("unverifiable", onChain.paymentToken);

    if (!isKnownPaymentAsset(this.reader.chainId, onChain.paymentToken)) {
      return dropped("token_not_supported", onChain.paymentToken);
    }

    let quote;
    try {
      quote = await this.reader.quoteBuy(listing.listingId, CRATE_QUOTE_UNITS_PER_STEM);
    } catch (error) {
      this.logger.warn(`Quote: listing ${listing.listingId} could not be priced on the chain`);
      return dropped("unverifiable", onChain.paymentToken);
    }

    return {
      ...base,
      status: "quoted",
      reason: null,
      paymentToken: onChain.paymentToken,
      units: {
        total: quote.totalPrice,
        royalty: quote.royaltyAmount,
        fee: quote.protocolFee,
        seller: quote.sellerAmount,
      },
      chainExpiry: onChain.expiry,
    };
  }

  // -------------------------------------------------------------------------
  // GET /crates/:id/quotes/:quoteId
  // -------------------------------------------------------------------------

  async getQuote(userId: string, crateId: string, quoteId: string): Promise<CrateQuoteDto> {
    return this.loadQuoteDto(userId, crateId, quoteId);
  }

  /** The caller's most recent quote of the crate, or null. */
  async latestQuote(userId: string, crateId: string): Promise<CrateQuoteDto | null> {
    const latest = await prisma.crateQuote.findFirst({
      where: { crateId, userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!latest) return null;
    return this.loadQuoteDto(userId, crateId, latest.id);
  }

  // -------------------------------------------------------------------------
  // POST /crates/:id/quotes/:quoteId/settle
  // -------------------------------------------------------------------------

  /**
   * Records the transaction the browser sent and verifies it from the chain. A
   * transaction without a receipt yet leaves the quote `submitted` (the web
   * retries); a mined one settles, partly settles or fails the quote from its
   * `Sold` logs. The chain is the truth: an expired quote still settles when its
   * transaction mined.
   */
  async settleQuote(
    userId: string,
    crateId: string,
    quoteId: string,
    input: { transactionHash?: unknown; dropped?: unknown },
  ): Promise<CrateQuoteDto> {
    if (!isTransactionHash(input.transactionHash)) {
      throw new BadRequestException({
        code: CRATE_QUOTE_ERROR_CODES.invalidTransactionHash,
        message: "transactionHash must be a 0x-prefixed 32-byte hash",
      });
    }
    const transactionHash = input.transactionHash.toLowerCase();
    const dropped = parseDroppedInputs(input.dropped);

    const quote = await this.requireQuote(userId, crateId, quoteId);

    // Final states are returned as they are; the first settlement already ran.
    if (quote.status === "settled" || quote.status === "partial" || quote.status === "failed") {
      return this.loadQuoteDto(userId, crateId, quoteId);
    }
    if (quote.status === "submitted" && quote.transactionHash?.toLowerCase() !== transactionHash) {
      throw new ConflictException({
        code: CRATE_QUOTE_ERROR_CODES.alreadySubmitted,
        message: "This quote was already submitted with a different transaction",
      });
    }

    if (quote.status === "open") {
      const lineIds = new Set(quote.lines.map((line) => line.id));
      if (dropped.some((entry) => !lineIds.has(entry.quoteLineId))) {
        throw new BadRequestException({
          code: CRATE_QUOTE_ERROR_CODES.invalidDropped,
          message: "dropped must name lines of this quote, each at most once",
        });
      }
      await prisma.$transaction(async (tx) => {
        // Dropped lines first, so they are never matched against a log.
        for (const entry of dropped) {
          await tx.crateQuoteLine.updateMany({
            where: { id: entry.quoteLineId, quoteId, status: "quoted" },
            data: { status: "dropped", reason: entry.reason },
          });
        }
        // Only one request wins the open -> submitted transition.
        await tx.crateQuote.updateMany({
          where: { id: quoteId, status: "open" },
          data: { status: "submitted", transactionHash, submittedAt: new Date() },
        });
      });
      // A concurrent request may have submitted a different hash first.
      const fresh = await this.requireQuote(userId, crateId, quoteId);
      if (fresh.transactionHash?.toLowerCase() !== transactionHash) {
        throw new ConflictException({
          code: CRATE_QUOTE_ERROR_CODES.alreadySubmitted,
          message: "This quote was already submitted with a different transaction",
        });
      }
    }

    if (!this.reader.isConfigured()) throw new MarketplaceUnavailableException();
    const submitted = await this.requireQuote(userId, crateId, quoteId);
    if (
      submitted.chainId !== this.reader.chainId
      || submitted.marketplaceAddress.toLowerCase() !== this.reader.marketplaceAddress.toLowerCase()
    ) {
      // The marketplace this quote was priced against is not the one configured
      // now, so its receipt cannot be verified here.
      throw new MarketplaceUnavailableException();
    }

    let receipt: MarketplaceSoldLogs;
    try {
      receipt = await this.reader.getSoldLogs(transactionHash);
    } catch (error) {
      // The chain could not be read: stay submitted so the web retries.
      this.logger.warn(`Crate quote ${quoteId}: receipt could not be read from the chain`);
      receipt = { status: "pending", logs: [] };
    }
    if (receipt.status === "pending") {
      return this.loadQuoteDto(userId, crateId, quoteId);
    }

    const quotedLines = submitted.lines
      .filter((line) => line.status === "quoted")
      .sort(compareQuoteLines);

    if (receipt.status === "reverted") {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.crateQuote.updateMany({
          where: { id: quoteId, status: "submitted" },
          data: { status: "failed", settledAt: new Date() },
        });
        if (claimed.count !== 1) return;
        await tx.crateQuoteLine.updateMany({
          where: { quoteId, status: "quoted" },
          data: { status: "failed", reason: "transaction_reverted" },
        });
      });
      return this.loadQuoteDto(userId, crateId, quoteId);
    }

    const { matched, unmatched } = matchReceipts(
      quotedLines.map((line) => ({
        id: line.id,
        listingId: line.listingId ?? -1n,
        amount: line.amount,
      })),
      receipt.logs,
      submitted.buyerAddress,
    );
    const status = settlementStatus(matched.length, quotedLines.length);

    const transitioned = await prisma.$transaction(async (tx) => {
      const claimed = await tx.crateQuote.updateMany({
        where: { id: quoteId, status: "submitted" },
        data: { status, settledAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      for (const { lineId, log } of matched) {
        await tx.crateQuoteLine.update({
          where: { id: lineId },
          data: {
            status: "settled",
            reason: null,
            logIndex: log.logIndex,
            settledTotalUnits: log.totalPaid.toString(),
          },
        });
      }
      if (unmatched.length > 0) {
        await tx.crateQuoteLine.updateMany({
          where: { id: { in: unmatched } },
          data: { status: "failed", reason: "not_in_transaction" },
        });
      }
      return true;
    });

    // Learn from the purchase once, on the transition, and only now.
    if (transitioned && matched.length > 0) {
      const settledIds = new Set(matched.map((entry) => entry.lineId));
      await this.recordPurchaseSignals(
        userId,
        quotedLines.filter((line) => settledIds.has(line.id)),
        new Map(matched.map((entry) => [entry.lineId, entry.log.totalPaid.toString()])),
        submitted.chainId,
      );
    }

    return this.loadQuoteDto(userId, crateId, quoteId);
  }

  /**
   * The taste purchase signal once per settled track and the stem quality
   * purchase validation once per settled stem. Best effort: learning never
   * undoes or fails a settlement.
   */
  private async recordPurchaseSignals(
    userId: string,
    settled: CrateQuoteLine[],
    paidUnitsByLine: ReadonlyMap<string, string>,
    chainId: number,
  ): Promise<void> {
    const byTrack = new Map<string, CrateQuoteLine[]>();
    for (const line of settled) {
      byTrack.set(line.trackId, [...(byTrack.get(line.trackId) ?? []), line]);
    }

    if (this.learning) {
      for (const [trackId, lines] of byTrack) {
        try {
          const priceUsd = sumUsd(
            lines.map(
              (line) =>
                decoratePaymentAmount({
                  chainId,
                  paymentToken: line.paymentToken,
                  amountUnits: paidUnitsByLine.get(line.id) ?? "0",
                }).canonicalAmountUsd,
            ),
          );
          await this.learning.recordSignal({
            userId,
            trackId,
            action: "purchase",
            metadata: buildAgentSignalMetadata({
              source: "crate_purchase",
              licenseType: lines[0].licenseType,
              outcome: {
                type: "purchase",
                ...(priceUsd !== null ? { priceUsd: Number(priceUsd) } : {}),
              },
            }),
          });
        } catch (error) {
          this.logger.warn(`Crate purchase signal for track ${trackId} not recorded: ${error}`);
        }
      }
    }

    if (this.stemQuality) {
      for (const stemId of new Set(settled.map((line) => line.stemId))) {
        try {
          await this.stemQuality.recordValidation({ stemId, validation: "purchase" });
        } catch (error) {
          this.logger.warn(`Crate purchase validation for stem ${stemId} not recorded: ${error}`);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // DTO
  // -------------------------------------------------------------------------

  /** The caller's quote of this crate; anyone else's is a 404. */
  private async requireQuote(userId: string, crateId: string, quoteId: string): Promise<QuoteRow> {
    const quote = await prisma.crateQuote.findFirst({
      where: { id: quoteId, crateId, userId },
      include: { lines: true },
    });
    if (!quote) throw new NotFoundException("Crate quote not found");
    return quote;
  }

  private async loadQuoteDto(
    userId: string,
    crateId: string,
    quoteId: string,
  ): Promise<CrateQuoteDto> {
    const quote = await this.requireQuote(userId, crateId, quoteId);
    const crate = await prisma.crate.findFirst({
      where: { id: crateId, userId },
      select: { filters: true },
    });
    const budgetUsd = sanitizeCrateFilters(crate?.filters).filters.maxTotalUsd;

    const trackIds = [...new Set(quote.lines.map((line) => line.trackId))];
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: {
        id: true,
        title: true,
        artist: true,
        release: { select: { primaryArtist: true, artist: { select: { displayName: true } } } },
      },
    });
    const trackById = new Map(tracks.map((track) => [track.id, track]));

    const settledLogIndexes = quote.lines
      .map((line) => line.logIndex)
      .filter((logIndex): logIndex is number => logIndex !== null);
    const purchaseIdByLog = new Map<number, string>();
    if (quote.transactionHash && settledLogIndexes.length > 0) {
      const purchases = await prisma.stemPurchase.findMany({
        where: {
          transactionHash: { equals: quote.transactionHash, mode: "insensitive" },
          logIndex: { in: settledLogIndexes },
        },
        select: { id: true, logIndex: true },
      });
      for (const purchase of purchases) {
        if (purchase.logIndex !== null) purchaseIdByLog.set(purchase.logIndex, purchase.id);
      }
    }

    const decorate: DecorateUnits = (paymentToken, units) => {
      const decorated = decoratePaymentAmount({
        chainId: quote.chainId,
        paymentToken,
        amountUnits: units,
      });
      return {
        symbol: decorated.paymentAssetSymbol,
        decimals: decorated.paymentAssetDecimals,
        total: decorated.settlementAmount,
        totalUsd: decorated.canonicalAmountUsd,
      };
    };

    const ordered = [...quote.lines].sort(compareQuoteLines);
    const lines: CrateQuoteLineDto[] = [];
    for (const row of ordered) {
      let line = lines.find((entry) => entry.position === row.position);
      if (!line) {
        const track = trackById.get(row.trackId);
        line = {
          position: row.position,
          trackId: row.trackId,
          title: track?.title ?? null,
          artistName: track
            ? resolveCreditedArtistName({
                trackArtist: track.artist,
                primaryArtist: track.release.primaryArtist,
                accountDisplayName: track.release.artist?.displayName ?? null,
              })
            : null,
          licenseType: row.licenseType as CrateLicenseType,
          rights: crateTierRights(row.licenseType as CrateLicenseType),
          items: [],
        };
        lines.push(line);
      }
      line.items.push(toItemDto(row, quote, decorate, purchaseIdByLog));
    }

    const totals = aggregateQuoteTotals(
      ordered
        .filter(
          (row) =>
            (row.status === "quoted" || row.status === "settled")
            && row.paymentToken !== null
            && row.totalPriceUnits !== null,
        )
        .map((row) => ({
          paymentToken: row.paymentToken as string,
          totalUnits: BigInt(row.totalPriceUnits as string),
        })),
      budgetUsd,
      decorate,
    );

    return {
      id: quote.id,
      crateId: quote.crateId,
      status: quote.status,
      chainId: quote.chainId,
      marketplaceAddress: quote.marketplaceAddress,
      buyerAddress: quote.buyerAddress,
      expiresAt: quote.expiresAt.toISOString(),
      transactionHash: quote.transactionHash,
      lines,
      totals: totals.totals,
      totalUsd: totals.totalUsd,
      budgetUsd: totals.budgetUsd,
      overBudget: totals.overBudget,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 503: the marketplace this quote needs is not configured here. */
class MarketplaceUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: CRATE_QUOTE_ERROR_CODES.marketplaceUnavailable,
      message: "The marketplace is not available",
    });
  }
}

/** Page order of a quote's stems: crate position, then stem type, then id. */
function compareQuoteLines(a: CrateQuoteLine, b: CrateQuoteLine): number {
  return (
    a.position - b.position || a.stemType.localeCompare(b.stemType) || a.stemId.localeCompare(b.stemId)
  );
}

function toItemDto(
  row: CrateQuoteLine,
  quote: CrateQuote,
  decorate: DecorateUnits,
  purchaseIdByLog: ReadonlyMap<number, string>,
): CrateQuoteItemDto {
  const priced =
    row.paymentToken !== null && row.totalPriceUnits !== null
      ? decorate(row.paymentToken, row.totalPriceUnits)
      : null;
  const artistShare =
    row.sellerUnits !== null && row.royaltyUnits !== null
      ? (BigInt(row.sellerUnits) + BigInt(row.royaltyUnits)).toString()
      : null;
  return {
    quoteLineId: row.id,
    stemId: row.stemId,
    stemType: row.stemType,
    status: row.status,
    reason: row.reason,
    listingId: row.listingId?.toString() ?? null,
    tokenId: row.tokenId?.toString() ?? null,
    paymentToken: row.paymentToken,
    symbol: priced?.symbol ?? null,
    decimals: priced?.decimals ?? null,
    totalUnits: row.totalPriceUnits,
    total: priced?.total ?? null,
    totalUsd: priced?.totalUsd ?? null,
    artistShareUnits: artistShare,
    platformFeeUnits: row.protocolFeeUnits,
    receipt:
      row.status === "settled" && row.logIndex !== null && quote.transactionHash
        ? {
            transactionHash: quote.transactionHash,
            logIndex: row.logIndex,
            totalPaidUnits: row.settledTotalUnits ?? row.totalPriceUnits ?? "0",
            purchaseId: purchaseIdByLog.get(row.logIndex) ?? null,
          }
        : null,
  };
}

/** Canonical USD of one unit of a stored listing (a ranking estimate only). */
function storedListingUsd(
  chainId: number,
  paymentToken: string,
  pricePerUnit: string,
): string | null {
  try {
    return decoratePaymentAmount({ chainId, paymentToken, amountUnits: pricePerUnit })
      .canonicalAmountUsd;
  } catch {
    return null;
  }
}

/**
 * Whether the payment asset is native or configured for the chain. An unknown
 * ERC-20 would be shown with guessed decimals, so it is never quoted.
 */
function isKnownPaymentAsset(chainId: number, paymentToken: string): boolean {
  const token = normalizePaymentToken(paymentToken);
  if (token === ZERO_ADDRESS) return true;
  return loadPaymentAssetsForIndexing().some(
    (asset) =>
      asset.chainId === chainId
      && asset.enabled !== false
      && normalizePaymentToken(asset.tokenAddress) === token,
  );
}

/** Validates the `lines` of a quote request; undefined means every crate line. */
function parseLineInputs(lines: unknown): LineInput[] | undefined {
  if (lines === undefined || lines === null) return undefined;
  const invalid = () =>
    new BadRequestException({
      code: CRATE_QUOTE_ERROR_CODES.invalidLines,
      message: "lines must be lines of the crate, each at most once",
    });
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > CRATE_QUOTE_MAX_LINES) {
    throw invalid();
  }
  const seen = new Set<string>();
  const parsed: LineInput[] = [];
  for (const entry of lines) {
    if (!entry || typeof entry !== "object") throw invalid();
    const { trackId, licenseType, stemTypes } = entry as Record<string, unknown>;
    if (typeof trackId !== "string" || trackId.trim() === "" || trackId.length > 200) throw invalid();
    if (seen.has(trackId)) throw invalid();
    seen.add(trackId);
    if (
      licenseType !== undefined
      && licenseType !== null
      && !(CRATE_LICENSE_TYPES as readonly string[]).includes(licenseType as string)
    ) {
      throw invalid();
    }
    if (stemTypes !== undefined && stemTypes !== null) {
      if (
        !Array.isArray(stemTypes)
        || stemTypes.length > CRATE_QUOTE_MAX_STEM_TYPES
        || stemTypes.some((type) => !(CRATE_STEM_TYPES as readonly string[]).includes(type))
      ) {
        throw invalid();
      }
    }
    parsed.push({
      trackId,
      ...(licenseType ? { licenseType: licenseType as CrateLicenseType } : {}),
      ...(Array.isArray(stemTypes) ? { stemTypes: stemTypes as CrateStemType[] } : {}),
    });
  }
  return parsed;
}

/** Validates the `dropped` list of a settle request. */
function parseDroppedInputs(
  dropped: unknown,
): Array<{ quoteLineId: string; reason: CrateQuoteSettleDropReason }> {
  if (dropped === undefined || dropped === null) return [];
  const invalid = () =>
    new BadRequestException({
      code: CRATE_QUOTE_ERROR_CODES.invalidDropped,
      message: "dropped must name lines of this quote, each at most once",
    });
  if (!Array.isArray(dropped) || dropped.length > CRATE_QUOTE_MAX_ITEMS) throw invalid();
  const seen = new Set<string>();
  const parsed: Array<{ quoteLineId: string; reason: CrateQuoteSettleDropReason }> = [];
  for (const entry of dropped) {
    if (!entry || typeof entry !== "object") throw invalid();
    const { quoteLineId, reason } = entry as Record<string, unknown>;
    if (typeof quoteLineId !== "string" || quoteLineId === "" || quoteLineId.length > 100) {
      throw invalid();
    }
    if (!(CRATE_QUOTE_SETTLE_DROP_REASONS as readonly string[]).includes(reason as string)) {
      throw invalid();
    }
    if (seen.has(quoteLineId)) throw invalid();
    seen.add(quoteLineId);
    parsed.push({ quoteLineId, reason: reason as CrateQuoteSettleDropReason });
  }
  return parsed;
}

/** Runs `work` over `items` with at most `limit` in flight, keeping input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
