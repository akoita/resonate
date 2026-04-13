import { StorefrontService } from "../modules/storefront/storefront.service";

describe("StorefrontService", () => {
  it("maps public stem rows into machine-friendly storefront items", async () => {
    const service = new StorefrontService();
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
      licenseOptions: [
        { key: "personal", priceUsd: 0.05 },
        { key: "remix", priceUsd: 5 },
        { key: "commercial", priceUsd: 25 },
      ],
      priceSummary: {
        currency: "USD",
        fromUsd: 0.05,
        toUsd: 25,
      },
      previewUrl: "/catalog/stems/stem_1/preview",
      quoteUrl: "/api/stems/stem_1/x402/info",
      purchaseUrl: "/api/stems/stem_1/x402",
    });
  });
});
