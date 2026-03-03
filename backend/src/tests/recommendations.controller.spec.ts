/**
 * RecommendationsController — Unit Test
 *
 * Tests controller-specific concern:
 *   - getRecommendations limit string → Number with NaN fallback
 */

import { RecommendationsController } from '../modules/recommendations/recommendations.controller';

const mockService = {
  setPreferences: jest.fn().mockResolvedValue({ ok: true }),
  getRecommendations: jest.fn().mockResolvedValue([]),
};

function makeController() {
  return new RecommendationsController(mockService as any);
}

beforeEach(() => jest.clearAllMocks());

describe('RecommendationsController', () => {
  describe('getRecommendations — limit parsing', () => {
    it('defaults to 10 when limit is undefined', () => {
      const ctrl = makeController();
      ctrl.getRecommendations('user-1', undefined);
      expect(mockService.getRecommendations).toHaveBeenCalledWith('user-1', 10);
    });

    it('parses valid limit', () => {
      const ctrl = makeController();
      ctrl.getRecommendations('user-1', '15');
      expect(mockService.getRecommendations).toHaveBeenCalledWith('user-1', 15);
    });

    it('falls back to 10 for NaN', () => {
      const ctrl = makeController();
      ctrl.getRecommendations('user-1', 'abc');
      expect(mockService.getRecommendations).toHaveBeenCalledWith('user-1', 10);
    });
  });
});
