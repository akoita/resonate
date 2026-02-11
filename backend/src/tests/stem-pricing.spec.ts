import { StemPricingService, StemPricingDto } from "../modules/pricing/stem-pricing.service";

// Mock prisma
jest.mock("../db/prisma", () => {
  const stemPricingStore: Record<string, StemPricingDto & { id: string; stemId: string }> = {};

  return {
    prisma: {
      stem: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === "stem-owned") {
            return Promise.resolve({
              id: "stem-owned",
              track: {
                release: {
                  artist: { userId: "user-owner" },
                },
              },
            });
          }
          if (where.id === "stem-other") {
            return Promise.resolve({
              id: "stem-other",
              track: {
                release: {
                  artist: { userId: "user-other" },
                },
              },
            });
          }
          return Promise.resolve(null);
        }),
      },
      stemPricing: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { stemId: string } }) => {
          return Promise.resolve(stemPricingStore[where.stemId] || null);
        }),
        upsert: jest.fn().mockImplementation(({ where, create, update }: {
          where: { stemId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = stemPricingStore[where.stemId];
          if (existing) {
            const updated = { ...existing, ...update };
            stemPricingStore[where.stemId] = updated as typeof existing;
            return Promise.resolve(updated);
          }
          const created = { id: `pricing-${where.stemId}`, ...create };
          stemPricingStore[where.stemId] = created as typeof existing;
          return Promise.resolve(created);
        }),
      },
      release: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === "release-owned") {
            return Promise.resolve({
              id: "release-owned",
              artist: { userId: "user-owner" },
              tracks: [
                { stems: [{ id: "stem-a", type: "vocals" }, { id: "stem-b", type: "drums" }] },
              ],
            });
          }
          return Promise.resolve(null);
        }),
      },
      $transaction: jest.fn().mockImplementation((promises: Promise<unknown>[]) => {
        return Promise.all(promises);
      }),
    },
  };
});

describe("StemPricingService", () => {
  let service: StemPricingService;

  beforeEach(() => {
    service = new StemPricingService();
  });

  describe("getTemplates", () => {
    it("returns 4 pricing templates with flat USD license prices", () => {
      const templates = service.getTemplates();
      expect(templates).toHaveLength(4);
      expect(templates.map(t => t.id)).toEqual(["free", "standard", "premium", "exclusive"]);
      // Verify decoupled pricing — remix and commercial are flat USD, not multipliers
      const standard = templates.find(t => t.id === "standard")!;
      expect(standard.pricing.remixLicenseUsd).toBe(5.0);
      expect(standard.pricing.commercialLicenseUsd).toBe(25.0);
    });
  });

  describe("getPricing", () => {
    it("returns defaults with flat license prices when no pricing exists", async () => {
      const result = await service.getPricing("stem-new");
      expect(result.stemId).toBe("stem-new");
      expect(result.basePlayPriceUsd).toBe(0.05);
      expect(result.remixLicenseUsd).toBe(5.0);
      expect(result.commercialLicenseUsd).toBe(25.0);
      expect(result.computed).toBeDefined();
      expect(result.computed.personal).toBe(0.05);
      expect(result.computed.remix).toBe(5.0);
      expect(result.computed.commercial).toBe(25.0);
    });
  });

  describe("validateOwnership", () => {
    it("allows owner to modify their stem", async () => {
      await expect(service.validateOwnership("stem-owned", "user-owner")).resolves.toBeUndefined();
    });

    it("rejects non-owner", async () => {
      await expect(service.validateOwnership("stem-owned", "user-hacker")).rejects.toThrow("You do not own this stem");
    });

    it("rejects missing stem", async () => {
      await expect(service.validateOwnership("stem-missing", "user-owner")).rejects.toThrow("not found");
    });
  });

  describe("upsertPricing", () => {
    it("creates pricing with flat license USD amounts", async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.10,
        remixLicenseUsd: 10.0,
        commercialLicenseUsd: 50.0,
        floorUsd: 0.01,
        ceilingUsd: 100.0,
        listingDurationDays: 30,
      };
      const result = await service.upsertPricing("stem-owned", "user-owner", dto);
      expect(result.basePlayPriceUsd).toBe(0.10);
      expect(result.computed).toBeDefined();
      expect(result.computed.remix).toBe(10.0);
      expect(result.computed.commercial).toBe(50.0);
    });

    it("rejects when non-owner tries to update", async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 999,
        remixLicenseUsd: 999,
        commercialLicenseUsd: 999,
        floorUsd: 0,
        ceilingUsd: 1000,
        listingDurationDays: null,
      };
      await expect(service.upsertPricing("stem-other", "user-owner", dto)).rejects.toThrow("You do not own this stem");
    });
  });

  describe("batchUpdateByRelease", () => {
    it("updates all stems in a release with flat license prices", async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.15,
        remixLicenseUsd: 15.0,
        commercialLicenseUsd: 75.0,
        floorUsd: 0.05,
        ceilingUsd: 100.0,
        listingDurationDays: null,
      };
      const result = await service.batchUpdateByRelease("release-owned", "user-owner", dto);
      expect(result.updated).toBe(2);
      expect(result.stemIds).toEqual(["stem-a", "stem-b"]);
    });

    it("rejects non-owner batch update", async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.15,
        remixLicenseUsd: 15.0,
        commercialLicenseUsd: 75.0,
        floorUsd: 0.05,
        ceilingUsd: 100.0,
        listingDurationDays: null,
      };
      await expect(service.batchUpdateByRelease("release-owned", "user-hacker", dto)).rejects.toThrow("You do not own this release");
    });

    it("rejects missing release", async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.15,
        remixLicenseUsd: 15.0,
        commercialLicenseUsd: 75.0,
        floorUsd: 0.05,
        ceilingUsd: 100.0,
        listingDurationDays: null,
      };
      await expect(service.batchUpdateByRelease("release-missing", "user-owner", dto)).rejects.toThrow("not found");
    });
  });

  describe("pricing model sanity", () => {
    it("remix license is significantly more than per-play price", () => {
      const templates = service.getTemplates();
      for (const t of templates) {
        if (t.pricing.basePlayPriceUsd > 0) {
          expect(t.pricing.remixLicenseUsd).toBeGreaterThan(t.pricing.basePlayPriceUsd * 10);
        }
      }
    });

    it("commercial license is more than remix license", () => {
      const templates = service.getTemplates();
      for (const t of templates) {
        expect(t.pricing.commercialLicenseUsd).toBeGreaterThanOrEqual(t.pricing.remixLicenseUsd);
      }
    });
  });
});
