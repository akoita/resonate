import type { ArtistEntitledNet, ArtistEntitledNetSale, ArtistNetReceivedReport, ArtistNetReceivedSale } from "./api";

/**
 * #2172: wording for the artist's net received, beside the gross sales figure.
 * Pure helpers so the dashboard stays presentational. The rule they enforce: a
 * sale whose split is not final is "Pending", never $0 and never the gross.
 */

type Ready = Extract<ArtistNetReceivedReport, { status: "ready" }>;

export const PENDING_NET_LABEL = "Pending";

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

/** A sale's amount in its own asset, trimmed like a price ("0.9 ETH", "9 USDC"). */
export function formatAssetAmount(amount: string, symbol: string) {
  return `${amount} ${symbol}`;
}

/** The net of one sale, or "Pending" while its split is not final. */
export function saleNetLabel(sale: ArtistNetReceivedSale) {
  if (sale.status === "pending" || sale.netAmount === undefined) return PENDING_NET_LABEL;
  if (sale.netUsd != null) return formatUsd(sale.netUsd);
  return formatAssetAmount(sale.netAmount, sale.symbol);
}

export function saleGrossLabel(sale: ArtistNetReceivedSale) {
  return sale.grossUsd != null ? formatUsd(sale.grossUsd) : formatAssetAmount(sale.grossAmount, sale.symbol);
}

/** The platform fee of a final sale, or null while pending. */
export function salePlatformFeeLabel(sale: ArtistNetReceivedSale) {
  if (sale.status === "pending" || sale.platformFeeUnits === undefined) return null;
  const decimals = sale.decimals;
  const units = BigInt(sale.platformFeeUnits);
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return formatAssetAmount(fraction ? `${whole}.${fraction}` : `${whole}`, sale.symbol);
}

/**
 * The headline number for the "Net received" card. USD when the net is in the
 * stablecoin; otherwise the first asset's own amount (no invented USD price).
 */
export function netReceivedHeadline(report: ArtistNetReceivedReport | undefined) {
  if (!report) return null;
  if (report.status === "unavailable") return "Unavailable";
  if (report.saleCount === 0) return "No marketplace sales";
  if (report.finalizedSales === 0) return PENDING_NET_LABEL;
  if (report.totals.netUsd > 0) return formatUsd(report.totals.netUsd);
  const asset = report.byAsset.find((entry) => entry.finalizedSales > 0);
  return asset ? formatAssetAmount(asset.netAmount, asset.symbol) : formatUsd(0);
}

export function netReceivedDetail(report: ArtistNetReceivedReport | undefined) {
  if (!report) return "";
  if (report.status === "unavailable") return report.reason;
  if (report.saleCount === 0) return "No marketplace sales in this window";
  const parts = [`${report.finalizedSales} of ${report.saleCount} marketplace ${report.saleCount === 1 ? "sale" : "sales"} counted`];
  if (report.pendingSales > 0) parts.push(`${report.pendingSales} pending`);
  return parts.join(", ");
}

/** What the figure is and what it leaves out, in plain words. */
export function netReceivedNote(report: ArtistNetReceivedReport | undefined) {
  if (!report || report.status === "unavailable") return "";
  const lines = [
    "What reached your own addresses from marketplace sales, after the platform fee and any share paid to someone else (a collector reselling, another creator's royalty).",
  ];
  if (report.pendingSales > 0) {
    lines.push(
      `${report.pendingSales} ${report.pendingSales === 1 ? "sale is" : "sales are"} pending: the split is not final yet, so ${report.pendingSales === 1 ? "it is" : "they are"} not counted.`,
    );
  }
  lines.push("x402 sales are not included here: they are shown apart as entitled net.");
  return lines.join(" ");
}

export function isNetReceivedReady(report: ArtistNetReceivedReport | undefined): report is Ready {
  return report?.status === "ready";
}

/**
 * #2344: x402 sales are paid to the platform, and no per-sale payout to the artist
 * is recorded. The artist is shown what the quote entitles them to, in its own
 * words, never mixed into "Net received".
 */
export const ENTITLED_NET_LABEL = "Entitled net (x402)";
export const ENTITLED_BADGE = "Entitled — owed to you";
export const UNQUOTED_NET_LABEL = "Not recorded";

/** The entitled block when there is something to show, else null. */
export function entitledNetOf(report: ArtistNetReceivedReport | undefined): ArtistEntitledNet | null {
  if (!report || report.status !== "ready") return null;
  return report.entitled && report.entitled.saleCount > 0 ? report.entitled : null;
}

export function entitledNetHeadline(entitled: ArtistEntitledNet) {
  if (entitled.quotedSales === 0) return UNQUOTED_NET_LABEL;
  if (entitled.totals.entitledNetUsd > 0) return formatUsd(entitled.totals.entitledNetUsd);
  const asset = entitled.byAsset.find((entry) => entry.quotedSales > 0);
  return asset ? formatAssetAmount(asset.entitledNetAmount, asset.symbol) : formatUsd(0);
}

export function entitledNetDetail(entitled: ArtistEntitledNet) {
  const parts = [`${entitled.quotedSales} of ${entitled.saleCount} x402 ${entitled.saleCount === 1 ? "sale" : "sales"} counted`];
  if (entitled.unquotedSales > 0) parts.push(`${entitled.unquotedSales} without a recorded quote`);
  return parts.join(", ");
}

export function entitledNetNote(entitled: ArtistEntitledNet) {
  return `${ENTITLED_BADGE}. ${entitled.note}`;
}

export function entitledSaleGrossLabel(sale: ArtistEntitledNetSale) {
  return sale.grossUsd != null ? formatUsd(sale.grossUsd) : formatAssetAmount(sale.grossAmount, sale.symbol);
}

/** The entitled net of one sale, or "Not recorded" while it has no quote: never $0 and never the gross. */
export function entitledSaleNetLabel(sale: ArtistEntitledNetSale) {
  if (sale.status === "unquoted" || sale.entitledNetAmount === undefined) return UNQUOTED_NET_LABEL;
  if (sale.entitledNetUsd != null) return formatUsd(sale.entitledNetUsd);
  return formatAssetAmount(sale.entitledNetAmount, sale.symbol);
}

export function entitledSaleFeeLabel(sale: ArtistEntitledNetSale) {
  if (sale.status === "unquoted" || sale.platformFeeUnits === undefined) return null;
  const decimals = sale.decimals;
  const units = BigInt(sale.platformFeeUnits);
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return formatAssetAmount(fraction ? `${whole}.${fraction}` : `${whole}`, sale.symbol);
}
