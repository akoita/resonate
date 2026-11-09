/**
 * StemPricingController — Unit Test
 *
 * Tests controller-specific concern:
 *   - batchGetPricing: stemIds string splitting, empty guard, cap at 100
 *   - batchUpdate: destructures releaseId from body, passes rest as dto
 */

import { StemPricingController } from '../modules/pricing/stem-pricing.controller';

const mockPricingService = {
  getTemplates: jest.fn().mockReturnValue([]),
  batchGetPricing: jest.fn().mockResolvedValue({}),
  getPricing: jest.fn().mockResolvedValue({}),
  upsertPricing: jest.fn().mockResolvedValue({}),
  batchUpdateByRelease: jest.fn().mockResolvedValue({}),
  batchUpsertByMap: jest.fn().mockResolvedValue({}),
};

const licensePricing = {
  personal: { amountUsd: 0.05, feeBps: 1500 },
  remix: { amountUsd: 5, feeBps: 1000 },
  commercial: { amountUsd: 25, feeBps: 1000 },
};

function makeController(pricing = licensePricing) {
  return new StemPricingController(
    mockPricingService as any,
    { licensePricing: pricing } as any,
  );
}

const req = { user: { userId: 'user-1' } };

beforeEach(() => jest.clearAllMocks());

describe('StemPricingController', () => {
  describe('getSaleSplit — canonical split per licence tier (#2599)', () => {
    it('returns the configured take-rate and the artist share for each tier', () => {
      expect(makeController().getSaleSplit()).toEqual({
        minArtistBps: 8500,
        tiers: {
          personal: { platformFeeBps: 1500, artistBps: 8500 },
          remix: { platformFeeBps: 1000, artistBps: 9000 },
          commercial: { platformFeeBps: 1000, artistBps: 9000 },
        },
      });
    });

    it('never reports an artist share under 85% (ADR-BM-4)', () => {
      const split = makeController().getSaleSplit();
      for (const tier of Object.values(split.tiers)) {
        expect(tier.artistBps).toBeGreaterThanOrEqual(8500);
        expect(tier.artistBps + tier.platformFeeBps).toBe(10000);
      }
    });

    it('refuses a take-rate that would break the 85% floor instead of showing it', () => {
      const ctrl = makeController({
        ...licensePricing,
        remix: { amountUsd: 5, feeBps: 2000 },
      });
      expect(() => ctrl.getSaleSplit()).toThrow(/ADR-BM-4/);
    });
  });

  describe('batchGetPricing — stemIds parsing', () => {
    it('splits comma-separated stemIds string', () => {
      const ctrl = makeController();
      ctrl.batchGetPricing('id1,id2,id3');
      expect(mockPricingService.batchGetPricing).toHaveBeenCalledWith(['id1', 'id2', 'id3']);
    });

    it('handles empty/undefined stemIds', () => {
      const ctrl = makeController();
      ctrl.batchGetPricing(undefined as any);
      expect(mockPricingService.batchGetPricing).toHaveBeenCalledWith([]);
    });

    it('filters empty strings from split', () => {
      const ctrl = makeController();
      ctrl.batchGetPricing('id1,,id2,');
      expect(mockPricingService.batchGetPricing).toHaveBeenCalledWith(['id1', 'id2']);
    });

    it('caps at 100 stemIds', () => {
      const ctrl = makeController();
      const manyIds = Array.from({ length: 150 }, (_, i) => `id${i}`).join(',');
      ctrl.batchGetPricing(manyIds);
      const args = mockPricingService.batchGetPricing.mock.calls[0][0];
      expect(args.length).toBe(100);
    });
  });

  describe('batchUpdate — body destructuring', () => {
    it('separates releaseId from dto fields', () => {
      const ctrl = makeController();
      ctrl.batchUpdate(
        { releaseId: 'rel-1', personalUsd: 1.5, remixUsd: 3.0 } as any,
        req as any,
      );
      expect(mockPricingService.batchUpdateByRelease).toHaveBeenCalledWith(
        'rel-1',
        'user-1',
        expect.objectContaining({ personalUsd: 1.5, remixUsd: 3.0 }),
        undefined,
      );
      // releaseId should NOT be in the dto
      const dto = mockPricingService.batchUpdateByRelease.mock.calls[0][2];
      expect(dto.releaseId).toBeUndefined();
    });

    it('passes the source apart from the dto so official and separated stems price separately (#1976)', () => {
      const ctrl = makeController();
      ctrl.batchUpdate(
        { releaseId: 'rel-1', source: 'official', basePlayPriceUsd: 2 } as any,
        req as any,
      );
      expect(mockPricingService.batchUpdateByRelease).toHaveBeenCalledWith(
        'rel-1',
        'user-1',
        expect.objectContaining({ basePlayPriceUsd: 2 }),
        'official',
      );
      const dto = mockPricingService.batchUpdateByRelease.mock.calls[0][2];
      expect(dto.source).toBeUndefined();
    });
  });
});
