import type { X402LicenseKey, X402LicensePricing } from "./x402.config";

export type QuoteLicenseKey = X402LicenseKey;

export type X402QuoteInput = {
  stemId: string;
  type: string;
  title: string | null;
  trackTitle: string | null;
  artist: string | null;
  releaseTitle: string | null;
  hasNft: boolean;
  tokenId: string | null;
  basePlayPriceUsd?: number | null;
  remixLicenseUsd?: number | null;
  commercialLicenseUsd?: number | null;
  listingWei?: string | null;
  network: string;
  payTo: string;
  licensePricing: X402LicensePricing;
};

export function formatUsdcAmount(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function toUsdBreakdown(amount: number, feeBps: number) {
  const feeUsd = amount * feeBps / 10_000;
  const netToSellerUsd = Math.max(0, amount - feeUsd);
  return {
    feeBps,
    royaltyBps: null,
    platformFee: {
      currency: "USDC",
      amount: formatUsdcAmount(feeUsd),
      usd: feeUsd,
    },
    royalty: null,
    netToSeller: {
      currency: "USDC",
      amount: formatUsdcAmount(netToSellerUsd),
      usd: netToSellerUsd,
    },
  };
}

function makeLicenseOption(key: QuoteLicenseKey, amount: number, feeBps: number) {
  const normalized = formatUsdcAmount(amount);
  return {
    key,
    price: {
      currency: "USDC",
      amount: normalized,
    },
    displayPrice: `${normalized} USDC`,
    breakdown: toUsdBreakdown(amount, feeBps),
  };
}

export function buildStemX402Quote(input: X402QuoteInput) {
  const personalPrice = input.basePlayPriceUsd ?? input.licensePricing.personal.amountUsd;
  const remixPrice = input.remixLicenseUsd ?? input.licensePricing.remix.amountUsd;
  const commercialPrice =
    input.commercialLicenseUsd ?? input.licensePricing.commercial.amountUsd;

  const purchaseUrl = `/api/stems/${input.stemId}/x402`;
  const quoteUrl = `/api/stems/${input.stemId}/x402/info`;

  const licenseOptions = [
    makeLicenseOption("personal", personalPrice, input.licensePricing.personal.feeBps),
    makeLicenseOption("remix", remixPrice, input.licensePricing.remix.feeBps),
    makeLicenseOption("commercial", commercialPrice, input.licensePricing.commercial.feeBps),
  ];

  const fromAmount = formatUsdcAmount(personalPrice);
  const toAmount = formatUsdcAmount(commercialPrice);

  return {
    stemId: input.stemId,
    type: input.type,
    title: input.title,
    trackTitle: input.trackTitle,
    artist: input.artist,
    releaseTitle: input.releaseTitle,
    hasNft: input.hasNft,
    tokenId: input.tokenId,
    price: {
      currency: "USDC",
      amount: fromAmount,
      display: `${fromAmount} USDC`,
      usd: personalPrice,
    },
    priceSummary: {
      currency: "USDC",
      from: fromAmount,
      to: toAmount,
      display:
        fromAmount === toAmount
          ? `${fromAmount} USDC`
          : `${fromAmount}-${toAmount} USDC`,
    },
    licenseOptions,
    purchase: {
      protocol: "x402",
      scheme: "exact",
      network: input.network,
      payTo: input.payTo,
      endpoint: purchaseUrl,
      quoteUrl,
    },
    x402: {
      network: input.network,
      payTo: input.payTo,
      scheme: "exact",
      endpoint: purchaseUrl,
      quoteUrl,
    },
    alternativeOffers: input.listingWei
      ? [
          {
            type: "marketplace_listing",
            currency: "ETH",
            amountWei: input.listingWei,
          },
        ]
      : [],
  };
}
