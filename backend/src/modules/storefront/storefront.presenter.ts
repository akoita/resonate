import { X402Config } from "../x402/x402.config";
import { buildStemX402Quote } from "../x402/x402.quote";

export type StorefrontStemPresentationRow = {
  id: string;
  type: string;
  title: string | null;
  ipnftId: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  track: {
    id: string;
    title: string;
    artist: string | null;
    stems: Array<{ id: string; type: string }>;
    release: {
      id: string;
      title: string;
      primaryArtist: string | null;
    };
  };
  pricing: {
    basePlayPriceUsd: number;
    remixLicenseUsd: number;
    commercialLicenseUsd: number;
  } | null;
  listingWei?: string | null;
};

export function buildStorefrontStemItem(
  row: StorefrontStemPresentationRow,
  x402Config: Pick<X402Config, "network" | "payoutAddress">,
) {
  const artist = row.track.release.primaryArtist ?? row.track.artist ?? null;
  const stemLabel = row.title ?? `${row.track.title} - ${row.type}`;
  const quote = buildStemX402Quote({
    stemId: row.id,
    type: row.type,
    title: row.title,
    trackTitle: row.track.title,
    artist,
    releaseTitle: row.track.release.title,
    hasNft: Boolean(row.ipnftId),
    tokenId: row.ipnftId,
    basePlayPriceUsd: row.pricing?.basePlayPriceUsd,
    remixLicenseUsd: row.pricing?.remixLicenseUsd,
    commercialLicenseUsd: row.pricing?.commercialLicenseUsd,
    listingWei: row.listingWei ?? null,
    network: x402Config.network,
    payTo: x402Config.payoutAddress,
  });

  return {
    id: row.id,
    title: stemLabel,
    artist,
    releaseId: row.track.release.id,
    releaseTitle: row.track.release.title,
    trackId: row.track.id,
    trackTitle: row.track.title,
    stemType: row.type,
    stemTypes: row.track.stems.map((stem) => stem.type),
    hasIpnft: Boolean(row.ipnftId),
    price: quote.price,
    licenseOptions: quote.licenseOptions,
    priceSummary: quote.priceSummary,
    alternativeOffers: quote.alternativeOffers,
    previewUrl: `/catalog/stems/${row.id}/preview`,
    quoteUrl: quote.purchase.quoteUrl,
    purchaseUrl: quote.purchase.endpoint,
  };
}

export function buildStorefrontStemDetail(
  row: StorefrontStemPresentationRow,
  x402Config: Pick<X402Config, "network" | "payoutAddress">,
) {
  const item = buildStorefrontStemItem(row, x402Config);

  return {
    ...item,
    preview: {
      url: item.previewUrl,
      mimeType: row.mimeType ?? "audio/mpeg",
    },
    pricing: {
      currency: item.price.currency,
      licenses: item.licenseOptions,
      summary: item.priceSummary,
    },
    rights: {
      availableLicenses: item.licenseOptions.map((option) => option.key),
      assetAccess: "paid",
      discoveryAccess: "public",
    },
    payment: {
      protocol: "x402",
      network: x402Config.network,
      quoteUrl: item.quoteUrl,
      purchaseUrl: item.purchaseUrl,
    },
    asset: {
      kind: "stem",
      delivery: "audio-download",
      mimeType: row.mimeType ?? "audio/mpeg",
      durationSeconds: row.durationSeconds ?? null,
    },
  };
}
