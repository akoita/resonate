/**
 * Stem Pricing Service — Integration Test (Testcontainers)
 *
 * Tests StemPricingService with real Postgres for ownership and pricing CRUD.
 * Seeds real User → Artist → Release → Track → Stem chain.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { StemPricingService, StemPricingDto } from '../modules/pricing/stem-pricing.service';

const TEST_PREFIX = `sp_${Date.now()}_`;

let service: StemPricingService;
let ownedStemId: string;
let otherStemId: string;
let releaseId: string;

describe('StemPricingService (integration)', () => {
  beforeAll(async () => {
    service = new StemPricingService();

    // Seed owner chain: User → Artist → Release → Track → Stems
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}owner`, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}owner`,
        displayName: 'Pricing Test Artist',
        payoutAddress: '0x' + 'F'.repeat(40),
      },
    });

    releaseId = `${TEST_PREFIX}release`;
    await prisma.release.create({
      data: {
        id: releaseId,
        title: 'Pricing Test Release',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
      },
    });

    const track = await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        title: 'Pricing Track',
        releaseId,
        position: 1,
      },
    });

    const stem1 = await prisma.stem.create({
      data: { trackId: track.id, type: 'vocals', uri: '/test/vocals.mp3' },
    });
    ownedStemId = stem1.id;

    const stem2 = await prisma.stem.create({
      data: { trackId: track.id, type: 'drums', uri: '/test/drums.mp3' },
    });
    otherStemId = stem2.id;

    // Seed non-owner user
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}other`, email: `${TEST_PREFIX}other@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.stemPricing.deleteMany({ where: { stemId: { in: [ownedStemId, otherStemId] } } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.delete({ where: { id: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [`${TEST_PREFIX}owner`, `${TEST_PREFIX}other`] } } }).catch(() => {});
  });

  // ===== Templates (pure logic, no DB) =====

  describe('getTemplates', () => {
    it('returns 4 pricing templates with flat USD license prices', () => {
      const templates = service.getTemplates();
      expect(templates).toHaveLength(4);
      expect(templates.map(t => t.id)).toEqual(['free', 'standard', 'premium', 'exclusive']);
      const standard = templates.find(t => t.id === 'standard')!;
      expect(standard.pricing.remixLicenseUsd).toBe(5.0);
      expect(standard.pricing.commercialLicenseUsd).toBe(25.0);
    });
  });

  // ===== Pricing CRUD (real DB) =====

  describe('getPricing', () => {
    it('returns defaults when no pricing exists', async () => {
      const result = await service.getPricing(ownedStemId);
      expect(result.stemId).toBe(ownedStemId);
      expect(result.basePlayPriceUsd).toBe(0.05);
      expect(result.computed.personal).toBe(0.05);
    });
  });

  describe('validateOwnership', () => {
    it('allows owner to modify their stem', async () => {
      await expect(service.validateOwnership(ownedStemId, `${TEST_PREFIX}owner`)).resolves.toBeUndefined();
    });

    it('rejects non-owner', async () => {
      await expect(service.validateOwnership(ownedStemId, `${TEST_PREFIX}other`)).rejects.toThrow('You do not own this stem');
    });

    it('rejects missing stem', async () => {
      await expect(service.validateOwnership('nonexistent-stem', `${TEST_PREFIX}owner`)).rejects.toThrow('not found');
    });
  });

  describe('upsertPricing', () => {
    it('creates pricing with flat license USD amounts', async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.10,
        remixLicenseUsd: 10.0,
        commercialLicenseUsd: 50.0,
        floorUsd: 0.01,
        ceilingUsd: 100.0,
        listingDurationDays: 30,
      };
      const result = await service.upsertPricing(ownedStemId, `${TEST_PREFIX}owner`, dto);
      expect(result.basePlayPriceUsd).toBe(0.10);
      expect(result.computed.remix).toBe(10.0);
      expect(result.computed.commercial).toBe(50.0);
    });

    it('rejects when non-owner tries to update', async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 999,
        remixLicenseUsd: 999,
        commercialLicenseUsd: 999,
        floorUsd: 0,
        ceilingUsd: 1000,
        listingDurationDays: null,
      };
      await expect(service.upsertPricing(otherStemId, `${TEST_PREFIX}other`, dto)).rejects.toThrow('You do not own this stem');
    });
  });

  describe('batchUpdateByRelease', () => {
    it('updates all stems in a release', async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.15,
        remixLicenseUsd: 15.0,
        commercialLicenseUsd: 75.0,
        floorUsd: 0.05,
        ceilingUsd: 100.0,
        listingDurationDays: null,
      };
      const result = await service.batchUpdateByRelease(releaseId, `${TEST_PREFIX}owner`, dto);
      expect(result.updated).toBe(2);
      expect(result.stemIds).toContain(ownedStemId);
      expect(result.stemIds).toContain(otherStemId);
    });

    it('rejects non-owner batch update', async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.15,
        remixLicenseUsd: 15.0,
        commercialLicenseUsd: 75.0,
        floorUsd: 0.05,
        ceilingUsd: 100.0,
        listingDurationDays: null,
      };
      await expect(service.batchUpdateByRelease(releaseId, `${TEST_PREFIX}other`, dto)).rejects.toThrow('You do not own this release');
    });

    it('rejects missing release', async () => {
      const dto: StemPricingDto = {
        basePlayPriceUsd: 0.15,
        remixLicenseUsd: 15.0,
        commercialLicenseUsd: 75.0,
        floorUsd: 0.05,
        ceilingUsd: 100.0,
        listingDurationDays: null,
      };
      await expect(service.batchUpdateByRelease('nonexistent', `${TEST_PREFIX}owner`, dto)).rejects.toThrow('not found');
    });
  });

  describe('pricing model sanity', () => {
    it('remix license is significantly more than per-play price', () => {
      const templates = service.getTemplates();
      for (const t of templates) {
        if (t.pricing.basePlayPriceUsd > 0) {
          expect(t.pricing.remixLicenseUsd).toBeGreaterThan(t.pricing.basePlayPriceUsd * 10);
        }
      }
    });

    it('commercial license is more than remix license', () => {
      const templates = service.getTemplates();
      for (const t of templates) {
        expect(t.pricing.commercialLicenseUsd).toBeGreaterThanOrEqual(t.pricing.remixLicenseUsd);
      }
    });
  });
});
