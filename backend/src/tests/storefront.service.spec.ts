import { StorefrontService } from "../modules/storefront/storefront.service";
import { X402Config } from "../modules/x402/x402.config";

function createMockConfig(overrides: Partial<X402Config> = {}): X402Config {
  return {
    enabled: true,
    payoutAddress: "0xTestPayoutAddr",
    facilitatorUrl: "https://x402.org/facilitator",
    network: "eip155:84532",
    chainId: 84532,
    ...overrides,
  } as X402Config;
}

describe("StorefrontService", () => {
  it("maps public stem rows into machine-friendly storefront items", async () => {
    const service = new StorefrontService(createMockConfig());
    jest
      .spyOn(service as any, "findPublicStems")
      .mockResolvedValue([
        {
          id: "stem_1",
          type: "vocals",
          title: "Hook Vocals",
          ipnftId: "ipnft_1",
          pricing: {
            basePlayPriceUsd: 0.05,
            remixLicenseUsd: 5,
            commercialLicenseUsd: 25,
          },
          track: {
            id: "track_1",
            title: "Midnight Run",
            artist: "Koita",
            contentStatus: "clean",
            stems: [
              { id: "stem_1", type: "vocals" },
              { id: "stem_2", type: "drums" },
            ],
            release: {
              id: "release_1",
              title: "Neon Heat",
              primaryArtist: "Koita",
              status: "published",
            },
          },
        },
      ]);

    const result = await service.searchStems({ q: "vocals", limit: 10 });

    expect(result.meta).toEqual({ count: 1, limit: 10 });
    expect(result.items[0]).toEqual({
      id: "stem_1",
      title: "Hook Vocals",
      artist: "Koita",
      releaseId: "release_1",
      releaseTitle: "Neon Heat",
      trackId: "track_1",
      trackTitle: "Midnight Run",
      stemType: "vocals",
      stemTypes: ["vocals", "drums"],
      hasIpnft: true,
      price: {
        currency: "USDC",
        amount: "0.05",
        display: "0.05 USDC",
        usd: 0.05,
      },
      licenseOptions: [
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
      ],
      priceSummary: {
        currency: "USDC",
        from: "0.05",
        to: "25",
        display: "0.05-25 USDC",
      },
      alternativeOffers: [],
      previewUrl: "/catalog/stems/stem_1/preview",
      quoteUrl: "/api/stems/stem_1/x402/info",
      purchaseUrl: "/api/stems/stem_1/x402",
    });
  });

  it("returns a storefront stem detail shape that separates preview from paid access", async () => {
    const service = new StorefrontService(createMockConfig());
    jest
      .spyOn(service as any, "findPublicStemById")
      .mockResolvedValue({
        id: "stem_1",
        type: "vocals",
        title: "Hook Vocals",
        ipnftId: null,
        mimeType: "audio/mpeg",
        durationSeconds: 12.5,
        pricing: {
          basePlayPriceUsd: 0.05,
          remixLicenseUsd: 5,
          commercialLicenseUsd: 25,
        },
        track: {
          id: "track_1",
          title: "Midnight Run",
          artist: "Koita",
          contentStatus: "clean",
          stems: [
            { id: "stem_1", type: "vocals" },
            { id: "stem_2", type: "drums" },
          ],
          release: {
            id: "release_1",
            title: "Neon Heat",
            primaryArtist: "Koita",
            status: "published",
          },
        },
      });

    const result = await service.getStemDetail("stem_1");

    expect(result.preview).toEqual({
      url: "/catalog/stems/stem_1/preview",
      mimeType: "audio/mpeg",
    });
    expect(result.payment).toEqual({
      protocol: "x402",
      network: "eip155:84532",
      quoteUrl: "/api/stems/stem_1/x402/info",
      purchaseUrl: "/api/stems/stem_1/x402",
    });
    expect(result.price).toEqual({
      currency: "USDC",
      amount: "0.05",
      display: "0.05 USDC",
      usd: 0.05,
    });
    expect(result.pricing).toEqual({
      currency: "USDC",
      licenses: [
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
      ],
      summary: {
        currency: "USDC",
        from: "0.05",
        to: "25",
        display: "0.05-25 USDC",
      },
    });
    expect(result.asset).toEqual({
      kind: "stem",
      delivery: "audio-download",
      mimeType: "audio/mpeg",
      durationSeconds: 12.5,
    });
    expect(result.rights).toEqual({
      availableLicenses: ["personal", "remix", "commercial"],
      assetAccess: "paid",
      discoveryAccess: "public",
    });
  });
});
