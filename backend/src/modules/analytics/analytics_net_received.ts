import { formatUnits } from "viem";
import { prisma } from "../../db/prisma";
import { resolvePaymentAssetForToken } from "../payments/payment-asset-metadata";
import { exactStablecoinUsd, marketplaceCommerceSettlementKey } from "./analytics_commerce_settled";
import {
  buildArtistEntitledNet,
  loadArtistEntitledNetSales,
  type ArtistEntitledNet,
  type EntitledNetSaleInput,
} from "./analytics_entitled_net";

/**
 * #2172: what an artist actually received from marketplace sales, beside the
 * gross settled figure.
 *
 * Read-only reporting. The gross `commerce.settled` fact is left exactly as it
 * was emitted (an immutable, auditable ledger row); the net is joined at read
 * time from the settlement record the indexer keeps, `StemPurchase`, whose split
 * (royalty, platform fee, seller proceeds) is finalised from the on-chain
 * RoyaltyPaid log and the fee rate at the Sold block (marketplace_sale_split.ts).
 * A change to the emitted fact would also have to change the warehouse
 * mappings and the Dataflow transform for no gain.
 *
 * What counts as received: the part of a sale paid straight to the artist's own
 * addresses: the seller proceeds when the artist was the seller, plus the
 * royalty when the artist was its recipient. In a first sale by the artist that
 * is the gross minus the platform fee; in a resale by a collector it is the
 * royalty alone. A sale whose split is not final is PENDING: it is counted
 * apart and never as zero or as the gross.
 *
 * x402 sales that never touch the marketplace contract are NOT part of this net:
 * their proceeds reach the platform payout address and no per-sale artist payout
 * is recorded. Since #2344 they are reported in the separate `entitled` block as
 * the artist's ENTITLED net (the quoted `netToSeller` recorded at the time of
 * sale, analytics_entitled_net.ts), never added to the on-chain figures above.
 */

export const ARTIST_NET_RECEIVED_SOURCE = Symbol("ARTIST_NET_RECEIVED_SOURCE");

/** What `netAmount*` measures: the gross minus the platform fee and every other party's share. */
export const ARTIST_NET_RECEIVED_BASIS = "net_after_fee_and_split" as const;

/** Sales listed individually; the aggregates always cover every sale in the window (up to MAX_SALES). */
export const NET_RECEIVED_RECENT_SALES = 20;
const MAX_SALES = 2000;
const MAX_FALLBACK_MINTS = 500;

export type NetReceivedSaleInput = {
  settlementKey: string;
  purchasedAt: Date;
  trackId: string | null;
  trackTitle: string | null;
  paymentToken: string;
  paymentAssetId: string | null;
  symbol: string;
  decimals: number;
  pricingStrategy?: string | null;
  totalPaid: string;
  sellerAddress: string;
  royaltyRecipient: string | null;
  /** Null while the split is pending. */
  split: { protocolFee: string; royalty: string; seller: string } | null;
};

export type ArtistNetReceivedSale = {
  settlementKey: string;
  occurredAt: string;
  trackId: string | null;
  trackTitle: string | null;
  symbol: string;
  decimals: number;
  grossAmountUnits: string;
  grossAmount: string;
  grossUsd: number | null;
  status: "final" | "pending";
  /** Present only when final. */
  platformFeeUnits?: string;
  otherPartiesUnits?: string;
  netAmountUnits?: string;
  netAmount?: string;
  netUsd?: number | null;
};

export type ArtistNetReceivedAsset = {
  paymentToken: string;
  assetId: string | null;
  symbol: string;
  decimals: number;
  sales: number;
  finalizedSales: number;
  pendingSales: number;
  /** Gross of the sales whose split is final: net + platform fee + other parties = this. */
  grossFinalizedUnits: string;
  grossFinalizedAmount: string;
  platformFeeUnits: string;
  otherPartiesUnits: string;
  netAmountUnits: string;
  netAmount: string;
  /** USD only for the configured stablecoin; null for any other asset (no invented price). */
  grossFinalizedUsd: number | null;
  netUsd: number | null;
  /** Gross of the pending sales, shown apart so it is neither lost nor passed off as net. */
  pendingGrossUnits: string;
  pendingGrossAmount: string;
};

export type ArtistNetReceived = {
  basis: typeof ARTIST_NET_RECEIVED_BASIS;
  /** Rails the net covers, and the ones it does not (and why). */
  coverage: { marketplace: true; x402: "entitled_only"; x402Note: string };
  saleCount: number;
  finalizedSales: number;
  pendingSales: number;
  /** Stablecoin sales only; the per-asset rows carry every asset. */
  totals: { grossFinalizedUsd: number; netUsd: number; pendingGrossUsd: number };
  byAsset: ArtistNetReceivedAsset[];
  recentSales: ArtistNetReceivedSale[];
  /** True when more sales than the cap matched; the newest are counted. */
  truncated: boolean;
  /**
   * x402 sales (#2344): the artist's entitled net from the quote recorded at the
   * time of sale. A separate block, never summed into the on-chain figures above.
   */
  entitled: ArtistEntitledNet;
};

export type ArtistNetReceivedReport =
  | ({ status: "ready" } & ArtistNetReceived)
  | { status: "unavailable"; reason: string };

export interface ArtistNetReceivedSource {
  getArtistNetReceived(input: { artistId: string; from: Date; to: Date }): Promise<ArtistNetReceivedReport>;
}

export const X402_ENTITLED_ONLY_NOTE =
  "x402 sales that settle outside the marketplace contract are paid to the platform payout address and no per-sale artist payout is recorded, so they are not part of net received. They are reported apart as entitled net, from the quote recorded at the time of sale.";

function lower(value: string | null | undefined) {
  return value ? value.toLowerCase() : "";
}

type MutableAsset = {
  paymentToken: string;
  assetId: string | null;
  symbol: string;
  decimals: number;
  sales: number;
  finalizedSales: number;
  pendingSales: number;
  grossFinalized: bigint;
  platformFee: bigint;
  otherParties: bigint;
  net: bigint;
  pendingGross: bigint;
  pricingStrategy?: string | null;
};

/**
 * Pure: turns the settlement records into the report. `artistAddresses` are the
 * lower-cased addresses the artist is paid at (payout address, wallet, token
 * creator).
 */
export function buildArtistNetReceived(
  sales: NetReceivedSaleInput[],
  artistAddresses: ReadonlySet<string>,
  options: {
    truncated?: boolean;
    recentLimit?: number;
    /** x402 sales for the separate entitled-net block (#2344). */
    x402Sales?: EntitledNetSaleInput[];
    x402Truncated?: boolean;
    x402RecentLimit?: number;
  } = {},
): ArtistNetReceived {
  const assets = new Map<string, MutableAsset>();
  const listed: ArtistNetReceivedSale[] = [];
  let finalizedSales = 0;
  let pendingSales = 0;

  for (const sale of sales) {
    const key = `${sale.paymentToken}:${sale.paymentAssetId ?? ""}:${sale.symbol}`;
    const asset = assets.get(key) ?? {
      paymentToken: sale.paymentToken,
      assetId: sale.paymentAssetId,
      symbol: sale.symbol,
      decimals: sale.decimals,
      sales: 0,
      finalizedSales: 0,
      pendingSales: 0,
      grossFinalized: 0n,
      platformFee: 0n,
      otherParties: 0n,
      net: 0n,
      pendingGross: 0n,
      pricingStrategy: sale.pricingStrategy,
    };
    assets.set(key, asset);
    asset.sales += 1;

    const gross = BigInt(sale.totalPaid);
    const usd = (units: bigint) =>
      exactStablecoinUsd({
        symbol: sale.symbol,
        pricingStrategy: sale.pricingStrategy,
        amountUnits: units.toString(),
        decimals: sale.decimals,
      });
    const base: ArtistNetReceivedSale = {
      settlementKey: sale.settlementKey,
      occurredAt: sale.purchasedAt.toISOString(),
      trackId: sale.trackId,
      trackTitle: sale.trackTitle,
      symbol: sale.symbol,
      decimals: sale.decimals,
      grossAmountUnits: gross.toString(),
      grossAmount: formatUnits(gross, sale.decimals),
      grossUsd: usd(gross),
      status: "pending",
    };

    // Pending until the split is final AND the artist's own addresses are known:
    // without them "received by the artist" cannot be said, and it is not zero.
    if (!sale.split || artistAddresses.size === 0) {
      asset.pendingSales += 1;
      asset.pendingGross += gross;
      pendingSales += 1;
      listed.push(base);
      continue;
    }

    const fee = BigInt(sale.split.protocolFee);
    const royalty = BigInt(sale.split.royalty);
    const seller = BigInt(sale.split.seller);
    const sellerIsArtist = artistAddresses.has(lower(sale.sellerAddress));
    const royaltyIsArtist = sale.royaltyRecipient != null && artistAddresses.has(lower(sale.royaltyRecipient));
    const net = (sellerIsArtist ? seller : 0n) + (royaltyIsArtist ? royalty : 0n);
    const otherParties = gross - fee - net;

    asset.finalizedSales += 1;
    asset.grossFinalized += gross;
    asset.platformFee += fee;
    asset.otherParties += otherParties;
    asset.net += net;
    finalizedSales += 1;
    listed.push({
      ...base,
      status: "final",
      platformFeeUnits: fee.toString(),
      otherPartiesUnits: otherParties.toString(),
      netAmountUnits: net.toString(),
      netAmount: formatUnits(net, sale.decimals),
      netUsd: usd(net),
    });
  }

  const byAsset: ArtistNetReceivedAsset[] = [...assets.values()].map((asset) => {
    const usd = (units: bigint) =>
      exactStablecoinUsd({
        symbol: asset.symbol,
        pricingStrategy: asset.pricingStrategy,
        amountUnits: units.toString(),
        decimals: asset.decimals,
      });
    return {
      paymentToken: asset.paymentToken,
      assetId: asset.assetId,
      symbol: asset.symbol,
      decimals: asset.decimals,
      sales: asset.sales,
      finalizedSales: asset.finalizedSales,
      pendingSales: asset.pendingSales,
      grossFinalizedUnits: asset.grossFinalized.toString(),
      grossFinalizedAmount: formatUnits(asset.grossFinalized, asset.decimals),
      platformFeeUnits: asset.platformFee.toString(),
      otherPartiesUnits: asset.otherParties.toString(),
      netAmountUnits: asset.net.toString(),
      netAmount: formatUnits(asset.net, asset.decimals),
      grossFinalizedUsd: usd(asset.grossFinalized),
      netUsd: usd(asset.net),
      pendingGrossUnits: asset.pendingGross.toString(),
      pendingGrossAmount: formatUnits(asset.pendingGross, asset.decimals),
    };
  });

  const sumUsd = (pick: (asset: ArtistNetReceivedAsset) => number | null) =>
    Number(byAsset.reduce((total, asset) => total + (pick(asset) ?? 0), 0).toFixed(12));
  const pendingGrossUsd = Number(
    [...assets.values()]
      .reduce(
        (total, asset) =>
          total +
          (exactStablecoinUsd({
            symbol: asset.symbol,
            pricingStrategy: asset.pricingStrategy,
            amountUnits: asset.pendingGross.toString(),
            decimals: asset.decimals,
          }) ?? 0),
        0,
      )
      .toFixed(12),
  );

  return {
    basis: ARTIST_NET_RECEIVED_BASIS,
    coverage: { marketplace: true, x402: "entitled_only", x402Note: X402_ENTITLED_ONLY_NOTE },
    saleCount: sales.length,
    finalizedSales,
    pendingSales,
    totals: {
      grossFinalizedUsd: sumUsd((asset) => asset.grossFinalizedUsd),
      netUsd: sumUsd((asset) => asset.netUsd),
      pendingGrossUsd,
    },
    byAsset,
    recentSales: listed.slice(0, options.recentLimit ?? NET_RECEIVED_RECENT_SALES),
    truncated: options.truncated ?? false,
    entitled: buildArtistEntitledNet(options.x402Sales ?? [], {
      truncated: options.x402Truncated,
      recentLimit: options.x402RecentLimit,
    }),
  };
}

/** Marketplace sales of the artist's stems from the indexed settlement records. */
export class PrismaArtistNetReceivedSource implements ArtistNetReceivedSource {
  async getArtistNetReceived(input: { artistId: string; from: Date; to: Date }): Promise<ArtistNetReceivedReport> {
    const artist = await prisma.artist.findUnique({
      where: { id: input.artistId },
      select: { payoutAddress: true, userId: true },
    });
    const wallet = artist?.userId
      ? await prisma.wallet.findUnique({
          where: { userId: artist.userId },
          select: { address: true, ownerAddress: true },
        })
      : null;
    const mints = await prisma.stemNftMint.findMany({
      where: { stem: { track: { release: { artistId: input.artistId } } } },
      select: { tokenId: true, chainId: true, creatorAddress: true },
      take: 5000,
    });

    const artistAddresses = new Set<string>(
      [artist?.payoutAddress, wallet?.address, wallet?.ownerAddress, ...mints.map((mint) => mint.creatorAddress)]
        .map(lower)
        .filter((address) => address.length > 0),
    );

    // A listing normally links its stem; one that does not is matched through the
    // token's mint (the same fallback the gross commerce.settled fact uses).
    const unlinkedTokens = mints.length <= MAX_FALLBACK_MINTS ? mints : [];
    const purchases = await prisma.stemPurchase.findMany({
      where: {
        purchasedAt: { gte: input.from, lt: input.to },
        listing: {
          OR: [
            { stem: { track: { release: { artistId: input.artistId } } } },
            ...(unlinkedTokens.length > 0
              ? [{ stemId: null, OR: unlinkedTokens.map((mint) => ({ tokenId: mint.tokenId, chainId: mint.chainId })) }]
              : []),
          ],
        },
      },
      orderBy: { purchasedAt: "desc" },
      take: MAX_SALES + 1,
      include: {
        listing: {
          select: {
            chainId: true,
            sellerAddress: true,
            stem: { select: { trackId: true, track: { select: { title: true } } } },
          },
        },
      },
    });
    const truncated = purchases.length > MAX_SALES;

    const sales: NetReceivedSaleInput[] = purchases.slice(0, MAX_SALES).map((purchase) => {
      const asset = resolvePaymentAssetForToken({
        chainId: purchase.listing.chainId,
        tokenAddress: purchase.paymentToken,
      });
      return {
        // Rows indexed before the Sold log position was kept have no key of their own.
        settlementKey:
          purchase.logIndex == null
            ? `commerce.settled:marketplace:${purchase.listing.chainId}:${purchase.transactionHash.toLowerCase()}:unknown`
            : marketplaceCommerceSettlementKey(purchase.listing.chainId, purchase.transactionHash, purchase.logIndex),
        purchasedAt: purchase.purchasedAt,
        trackId: purchase.listing.stem?.trackId ?? null,
        trackTitle: purchase.listing.stem?.track?.title ?? null,
        paymentToken: purchase.paymentToken,
        paymentAssetId: purchase.paymentAssetId,
        symbol: purchase.paymentAssetSymbol,
        decimals: purchase.paymentAssetDecimals,
        pricingStrategy: asset.pricingStrategy,
        totalPaid: purchase.totalPaid,
        sellerAddress: purchase.listing.sellerAddress,
        royaltyRecipient: purchase.royaltyRecipient,
        split: purchase.splitFinalizedAt
          ? {
              protocolFee: purchase.protocolFeePaid,
              royalty: purchase.royaltyPaid,
              seller: purchase.sellerReceived,
            }
          : null,
      };
    });

    const x402 = await loadArtistEntitledNetSales(input);
    return {
      status: "ready",
      ...buildArtistNetReceived(sales, artistAddresses, {
        truncated,
        x402Sales: x402.sales,
        x402Truncated: x402.truncated,
      }),
    };
  }
}
