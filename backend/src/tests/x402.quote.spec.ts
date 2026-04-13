import { buildStemX402Quote } from "../modules/x402/x402.quote";

describe("buildStemX402Quote", () => {
  it("returns storefront-grade quote metadata with license options and purchase info", () => {
    const quote = buildStemX402Quote({
      stemId: "stem_1",
      type: "vocals",
      title: "Hook Vocals",
      trackTitle: "Midnight Run",
      artist: "Koita",
      releaseTitle: "Neon Heat",
      hasNft: true,
      tokenId: "42",
      basePlayPriceUsd: 0.05,
      remixLicenseUsd: 5,
      commercialLicenseUsd: 25,
      listingWei: "10000000000000000",
      network: "eip155:84532",
      payTo: "0xPayTo",
    });

    expect(quote.price).toEqual({
      currency: "USDC",
      amount: "0.05",
      display: "0.05 USDC",
      usd: 0.05,
    });
    expect(quote.priceSummary).toEqual({
      currency: "USDC",
      from: "0.05",
      to: "25",
      display: "0.05-25 USDC",
    });
    expect(quote.licenseOptions).toEqual([
      {
        key: "personal",
        price: { currency: "USDC", amount: "0.05" },
        displayPrice: "0.05 USDC",
      },
      {
        key: "remix",
        price: { currency: "USDC", amount: "5" },
        displayPrice: "5 USDC",
      },
      {
        key: "commercial",
        price: { currency: "USDC", amount: "25" },
        displayPrice: "25 USDC",
      },
    ]);
    expect(quote.purchase).toEqual({
      protocol: "x402",
      scheme: "exact",
      network: "eip155:84532",
      payTo: "0xPayTo",
      endpoint: "/api/stems/stem_1/x402",
      quoteUrl: "/api/stems/stem_1/x402/info",
    });
    expect(quote.alternativeOffers).toEqual([
      {
        type: "marketplace_listing",
        currency: "ETH",
        amountWei: "10000000000000000",
      },
    ]);
  });

  it("falls back to default pricing when explicit pricing is missing", () => {
    const quote = buildStemX402Quote({
      stemId: "stem_2",
      type: "drums",
      title: null,
      trackTitle: null,
      artist: null,
      releaseTitle: null,
      hasNft: false,
      tokenId: null,
      network: "eip155:84532",
      payTo: "0xPayTo",
    });

    expect(quote.price.amount).toBe("0.02");
    expect(quote.licenseOptions[1].price.amount).toBe("5");
    expect(quote.licenseOptions[2].price.amount).toBe("25");
    expect(quote.alternativeOffers).toEqual([]);
  });
});
