import { Prisma } from "@prisma/client";
import { formatUnits } from "viem";
import { prisma } from "../../db/prisma";
import {
  X402_DIRECT_PURCHASE_SOURCES,
  X402_FINAL_SETTLEMENT_STATUSES,
  exactStablecoinUsd,
  x402CommerceSettlementKey,
  x402DirectPurchaseSettlementKey,
} from "./analytics_commerce_settled";

/**
 * #2344: the artist's ENTITLED net from x402 sales, beside the on-chain net
 * received (#2172).
 *
 * x402 sales that settle outside the marketplace contract (the facilitator
 * route, the agent payment router and MCP downloads) are paid to the platform
 * payout address. No per-sale artist payout is recorded, so what the artist
 * actually received cannot be reported for them. What CAN be reported is what
 * the quote promised them: the gross minus the platform fee at the license's
 * rate, `netToSeller`. It is recorded on the settlement at the time of sale
 * (`receipt.payment.quote`, and `quote` in the direct purchases' event args), so
 * a later change to the configured rate never rewrites a past sale.
 *
 * It is an ENTITLEMENT, never merged into the on-chain net: it has its own block,
 * its own totals and its own wording ("Entitled", owed to the artist). A sale
 * with no recorded quote (settled before this change) is counted apart as
 * `unquotedSales` and contributes no net: the quote is not reconstructed from
 * today's configuration. USD only for the configured stablecoin; any other
 * asset is reported in its own units.
 *
 * Read-only reporting. No fee, split or payout changes (ADR-BM-4 untouched).
 * Revenue line: ADR-BM-6 x402 personal/licence rail.
 */

export const ENTITLED_NET_BASIS = "quoted_net_to_seller" as const;
export const ENTITLED_NET_RECENT_SALES = 20;
const MAX_SALES = 2000;
const MAX_STEMS = 5000;

export const ENTITLED_NET_NOTE =
  "What your x402 sales entitle you to: the price minus the platform fee quoted at the time of sale. It is owed to you; the payout itself is not recorded per sale yet, so it is not counted as received.";

export type EntitledQuote = { feeBps: number; platformFeeUnits: string; netToSellerUnits: string };

export type EntitledNetSaleInput = {
  settlementKey: string;
  occurredAt: Date;
  paymentRail: string;
  resourceKind: "stem" | "punchline_moment";
  trackId: string | null;
  trackTitle: string | null;
  paymentToken: string;
  paymentAssetId: string | null;
  symbol: string;
  decimals: number;
  grossUnits: string;
  /** The raw recorded quote, or anything else when none was recorded. */
  quote: unknown;
};

export type ArtistEntitledNetSale = {
  settlementKey: string;
  occurredAt: string;
  paymentRail: string;
  resourceKind: "stem" | "punchline_moment";
  trackId: string | null;
  trackTitle: string | null;
  symbol: string;
  decimals: number;
  grossAmountUnits: string;
  grossAmount: string;
  grossUsd: number | null;
  /** `quoted` carries the entitled net; `unquoted` has no recorded quote and no net. */
  status: "quoted" | "unquoted";
  feeBps?: number;
  platformFeeUnits?: string;
  entitledNetUnits?: string;
  entitledNetAmount?: string;
  entitledNetUsd?: number | null;
};

export type ArtistEntitledNetAsset = {
  paymentToken: string;
  assetId: string | null;
  symbol: string;
  decimals: number;
  sales: number;
  quotedSales: number;
  unquotedSales: number;
  /** Gross of the quoted sales: platform fee + entitled net = this. */
  grossQuotedUnits: string;
  grossQuotedAmount: string;
  platformFeeUnits: string;
  entitledNetUnits: string;
  entitledNetAmount: string;
  grossQuotedUsd: number | null;
  entitledNetUsd: number | null;
  /** Gross of the sales without a recorded quote, shown apart. */
  unquotedGrossUnits: string;
  unquotedGrossAmount: string;
};

export type ArtistEntitledNet = {
  basis: typeof ENTITLED_NET_BASIS;
  /** Plain-words statement of what the figure is and is not. */
  note: string;
  saleCount: number;
  quotedSales: number;
  unquotedSales: number;
  /** Stablecoin sales only; the per-asset rows carry every asset. */
  totals: { grossQuotedUsd: number; entitledNetUsd: number };
  byAsset: ArtistEntitledNetAsset[];
  recentSales: ArtistEntitledNetSale[];
  /** True when more sales than the cap matched; the newest are counted. */
  truncated: boolean;
};

/** A recorded quote that is internally consistent with the gross, or null. */
export function readRecordedQuote(raw: unknown, grossUnits: string): EntitledQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const quote = raw as Record<string, unknown>;
  const { feeBps, platformFeeUnits, netToSellerUnits } = quote;
  if (typeof feeBps !== "number" || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) return null;
  if (typeof platformFeeUnits !== "string" || !/^\d+$/.test(platformFeeUnits)) return null;
  if (typeof netToSellerUnits !== "string" || !/^\d+$/.test(netToSellerUnits)) return null;
  if (!/^\d+$/.test(grossUnits)) return null;
  // The parts must add up to what was paid; otherwise the record is not trusted.
  if (BigInt(platformFeeUnits) + BigInt(netToSellerUnits) !== BigInt(grossUnits)) return null;
  return { feeBps, platformFeeUnits, netToSellerUnits };
}

type MutableAsset = {
  paymentToken: string;
  assetId: string | null;
  symbol: string;
  decimals: number;
  sales: number;
  quotedSales: number;
  unquotedSales: number;
  grossQuoted: bigint;
  platformFee: bigint;
  net: bigint;
  unquotedGross: bigint;
};

/** Pure: turns the x402 settlement records into the entitled-net block. */
export function buildArtistEntitledNet(
  sales: EntitledNetSaleInput[],
  options: { truncated?: boolean; recentLimit?: number } = {},
): ArtistEntitledNet {
  const assets = new Map<string, MutableAsset>();
  const listed: ArtistEntitledNetSale[] = [];
  let quotedSales = 0;
  let unquotedSales = 0;

  for (const sale of sales) {
    const key = `${sale.paymentToken}:${sale.paymentAssetId ?? ""}:${sale.symbol}`;
    const asset = assets.get(key) ?? {
      paymentToken: sale.paymentToken,
      assetId: sale.paymentAssetId,
      symbol: sale.symbol,
      decimals: sale.decimals,
      sales: 0,
      quotedSales: 0,
      unquotedSales: 0,
      grossQuoted: 0n,
      platformFee: 0n,
      net: 0n,
      unquotedGross: 0n,
    };
    assets.set(key, asset);
    asset.sales += 1;

    const gross = BigInt(sale.grossUnits);
    const usd = (units: bigint) =>
      exactStablecoinUsd({
        symbol: sale.symbol,
        amountUnits: units.toString(),
        decimals: sale.decimals,
      });
    const base: ArtistEntitledNetSale = {
      settlementKey: sale.settlementKey,
      occurredAt: sale.occurredAt.toISOString(),
      paymentRail: sale.paymentRail,
      resourceKind: sale.resourceKind,
      trackId: sale.trackId,
      trackTitle: sale.trackTitle,
      symbol: sale.symbol,
      decimals: sale.decimals,
      grossAmountUnits: gross.toString(),
      grossAmount: formatUnits(gross, sale.decimals),
      grossUsd: usd(gross),
      status: "unquoted",
    };

    const quote = readRecordedQuote(sale.quote, sale.grossUnits);
    if (!quote) {
      asset.unquotedSales += 1;
      asset.unquotedGross += gross;
      unquotedSales += 1;
      listed.push(base);
      continue;
    }

    const fee = BigInt(quote.platformFeeUnits);
    const net = BigInt(quote.netToSellerUnits);
    asset.quotedSales += 1;
    asset.grossQuoted += gross;
    asset.platformFee += fee;
    asset.net += net;
    quotedSales += 1;
    listed.push({
      ...base,
      status: "quoted",
      feeBps: quote.feeBps,
      platformFeeUnits: fee.toString(),
      entitledNetUnits: net.toString(),
      entitledNetAmount: formatUnits(net, sale.decimals),
      entitledNetUsd: usd(net),
    });
  }

  const byAsset: ArtistEntitledNetAsset[] = [...assets.values()].map((asset) => {
    const usd = (units: bigint) =>
      exactStablecoinUsd({
        symbol: asset.symbol,
        amountUnits: units.toString(),
        decimals: asset.decimals,
      });
    return {
      paymentToken: asset.paymentToken,
      assetId: asset.assetId,
      symbol: asset.symbol,
      decimals: asset.decimals,
      sales: asset.sales,
      quotedSales: asset.quotedSales,
      unquotedSales: asset.unquotedSales,
      grossQuotedUnits: asset.grossQuoted.toString(),
      grossQuotedAmount: formatUnits(asset.grossQuoted, asset.decimals),
      platformFeeUnits: asset.platformFee.toString(),
      entitledNetUnits: asset.net.toString(),
      entitledNetAmount: formatUnits(asset.net, asset.decimals),
      grossQuotedUsd: usd(asset.grossQuoted),
      entitledNetUsd: usd(asset.net),
      unquotedGrossUnits: asset.unquotedGross.toString(),
      unquotedGrossAmount: formatUnits(asset.unquotedGross, asset.decimals),
    };
  });
  const sumUsd = (pick: (asset: ArtistEntitledNetAsset) => number | null) =>
    Number(byAsset.reduce((total, asset) => total + (pick(asset) ?? 0), 0).toFixed(12));

  return {
    basis: ENTITLED_NET_BASIS,
    note: ENTITLED_NET_NOTE,
    saleCount: sales.length,
    quotedSales,
    unquotedSales,
    totals: {
      grossQuotedUsd: sumUsd((asset) => asset.grossQuotedUsd),
      entitledNetUsd: sumUsd((asset) => asset.entitledNetUsd),
    },
    byAsset,
    recentSales: listed.slice(0, options.recentLimit ?? ENTITLED_NET_RECENT_SALES),
    truncated: options.truncated ?? false,
  };
}

function receiptQuote(receipt: unknown): unknown {
  const payment = (receipt as { payment?: { quote?: unknown } } | null)?.payment;
  return payment?.quote ?? null;
}

type DirectPurchaseRow = {
  id: string;
  transactionHash: string;
  logIndex: number;
  chainId: number;
  occurredAt: Date;
  args: Record<string, unknown>;
};

/**
 * x402 sales of the artist's stems and Punchline moments that settled outside
 * the marketplace contract, in the window. Mirrors what the gross
 * `commerce.settled` x402 facts count, so the two figures cover the same sales.
 */
export async function loadArtistEntitledNetSales(input: {
  artistId: string;
  from: Date;
  to: Date;
}): Promise<{ sales: EntitledNetSaleInput[]; truncated: boolean }> {
  const settlements = await prisma.x402Settlement.findMany({
    where: {
      purchasedAt: { gte: input.from, lt: input.to },
      status: { in: [...X402_FINAL_SETTLEMENT_STATUSES] },
      // Contract-backed rows are counted by the marketplace rail (their Sold log).
      NOT: { contractSettlementStatus: "contract_backed" },
      OR: [
        { stem: { track: { release: { artistId: input.artistId } } } },
        { moment: { drop: { artistId: input.artistId } } },
      ],
    },
    orderBy: { purchasedAt: "desc" },
    take: MAX_SALES + 1,
    include: {
      stem: { select: { trackId: true, track: { select: { title: true } } } },
      moment: { select: { drop: { select: { trackId: true, track: { select: { title: true } } } } } },
    },
  });

  const stems = await prisma.stem.findMany({
    where: { track: { release: { artistId: input.artistId } } },
    select: { id: true, trackId: true, track: { select: { title: true } } },
    take: MAX_STEMS,
  });
  const stemById = new Map(stems.map((stem) => [stem.id, stem]));
  const directRows =
    stems.length === 0
      ? []
      : await prisma.$queryRaw<
          Array<{
            id: string;
            transactionHash: string;
            logIndex: number;
            chainId: number;
            occurredAt: Date;
            args: Record<string, unknown>;
          }>
        >(Prisma.sql`
          SELECT "id", "transactionHash", "logIndex", "chainId", COALESCE("processedAt", "createdAt") AS "occurredAt", "args"
          FROM "ContractEvent"
          WHERE "eventName" = 'x402.purchase'
            AND "args"->>'source' IN (${Prisma.join([...X402_DIRECT_PURCHASE_SOURCES])})
            AND "args"->>'stemId' IN (${Prisma.join(stems.map((stem) => stem.id))})
            AND COALESCE("processedAt", "createdAt") >= ${input.from}
            AND COALESCE("processedAt", "createdAt") < ${input.to}
          ORDER BY COALESCE("processedAt", "createdAt") DESC
          LIMIT ${MAX_SALES + 1}
        `);

  // The same payment already recorded by the HTTP x402 rail is counted there.
  const proofs = directRows
    .map((row) => (typeof row.args.paymentProofSha256 === "string" ? row.args.paymentProofSha256 : null))
    .filter((proof): proof is string => proof != null);
  const redeemed = new Set(
    proofs.length === 0
      ? []
      : (
          await prisma.x402Settlement.findMany({
            where: { paymentProofSha256: { in: proofs } },
            select: { paymentProofSha256: true },
          })
        ).map((row) => row.paymentProofSha256),
  );

  const sales: EntitledNetSaleInput[] = [];
  for (const settlement of settlements) {
    const isMoment = settlement.resourceKind !== "stem" || Boolean(settlement.momentId);
    const track = isMoment
      ? { trackId: settlement.moment?.drop.trackId ?? null, title: settlement.moment?.drop.track?.title ?? null }
      : { trackId: settlement.stem?.trackId ?? null, title: settlement.stem?.track?.title ?? null };
    sales.push({
      settlementKey: x402CommerceSettlementKey(settlement.id),
      occurredAt: settlement.purchasedAt,
      paymentRail: settlement.paymentRail,
      resourceKind: isMoment ? "punchline_moment" : "stem",
      trackId: track.trackId,
      trackTitle: track.title,
      paymentToken: settlement.paymentToken,
      paymentAssetId: settlement.paymentAssetId,
      symbol: settlement.paymentAssetSymbol,
      decimals: settlement.paymentAssetDecimals,
      grossUnits: settlement.settlementAmountUnits,
      quote: receiptQuote(settlement.receipt),
    });
  }
  for (const row of directRows as DirectPurchaseRow[]) {
    const args = row.args ?? {};
    const proof = typeof args.paymentProofSha256 === "string" ? args.paymentProofSha256 : undefined;
    if (proof && redeemed.has(proof)) continue;
    const grossUnits = typeof args.settlementAmountUnits === "string" ? args.settlementAmountUnits : null;
    const decimals = typeof args.paymentAssetDecimals === "number" ? args.paymentAssetDecimals : null;
    const symbol = typeof args.paymentAssetSymbol === "string" ? args.paymentAssetSymbol : null;
    const paymentToken = typeof args.paymentToken === "string" ? args.paymentToken : null;
    if (!grossUnits || !/^\d+$/.test(grossUnits) || decimals == null || !symbol || !paymentToken) continue;
    const stem = typeof args.stemId === "string" ? stemById.get(args.stemId) : undefined;
    sales.push({
      settlementKey: x402DirectPurchaseSettlementKey({
        paymentProofSha256: proof,
        transactionHash: row.transactionHash,
        logIndex: row.logIndex,
      }),
      occurredAt: new Date(row.occurredAt),
      paymentRail: typeof args.source === "string" ? args.source : "x402",
      resourceKind: "stem",
      trackId: stem?.trackId ?? null,
      trackTitle: stem?.track?.title ?? null,
      paymentToken,
      paymentAssetId: typeof args.paymentAssetId === "string" ? args.paymentAssetId : null,
      symbol,
      decimals,
      grossUnits,
      quote: args.quote ?? null,
    });
  }

  sales.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
  const truncated = sales.length > MAX_SALES;
  return { sales: sales.slice(0, MAX_SALES), truncated };
}
