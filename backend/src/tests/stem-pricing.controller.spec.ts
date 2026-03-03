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

function makeController() {
  return new StemPricingController(mockPricingService as any);
}

const req = { user: { userId: 'user-1' } };

beforeEach(() => jest.clearAllMocks());

describe('StemPricingController', () => {
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
      );
      // releaseId should NOT be in the dto
      const dto = mockPricingService.batchUpdateByRelease.mock.calls[0][2];
      expect(dto.releaseId).toBeUndefined();
    });
  });
});
