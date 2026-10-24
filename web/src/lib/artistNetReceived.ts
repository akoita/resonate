import type { ArtistNetReceivedReport, ArtistNetReceivedSale } from "./api";

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
  if (report.saleCount === 0) return "No sales yet";
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
  lines.push("x402 sales are not included: no per-sale split is recorded for them yet.");
  return lines.join(" ");
}

export function isNetReceivedReady(report: ArtistNetReceivedReport | undefined): report is Ready {
  return report?.status === "ready";
}
