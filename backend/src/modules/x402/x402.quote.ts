export type QuoteLicenseKey = "personal" | "remix" | "commercial";

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
};

const DEFAULT_PRICING = {
  personal: 0.05,
  remix: 5,
  commercial: 25,
} as const;

export function formatUsdcAmount(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function makeLicenseOption(key: QuoteLicenseKey, amount: number) {
  const normalized = formatUsdcAmount(amount);
  return {
    key,
    price: {
      currency: "USDC",
      amount: normalized,
    },
    displayPrice: `${normalized} USDC`,
  };
}

export function buildStemX402Quote(input: X402QuoteInput) {
  const personalPrice = input.basePlayPriceUsd ?? DEFAULT_PRICING.personal;
  const remixPrice = input.remixLicenseUsd ?? DEFAULT_PRICING.remix;
  const commercialPrice =
    input.commercialLicenseUsd ?? DEFAULT_PRICING.commercial;

  const purchaseUrl = `/api/stems/${input.stemId}/x402`;
  const quoteUrl = `/api/stems/${input.stemId}/x402/info`;

  const licenseOptions = [
    makeLicenseOption("personal", personalPrice),
    makeLicenseOption("remix", remixPrice),
    makeLicenseOption("commercial", commercialPrice),
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
