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

const mockTasteMemoryService = {
  getTasteMemory: jest.fn(),
  updateSettings: jest.fn(),
  resetTasteMemory: jest.fn(),
  upsertSignalControl: jest.fn(),
  removeSignalControl: jest.fn(),
};

const mockHomeFeedService = {
  getHomeFeed: jest.fn().mockResolvedValue({ rails: [], cold: true }),
};

function makeController() {
  return new RecommendationsController(
    mockService as any,
    mockTasteMemoryService as any,
    mockHomeFeedService as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('RecommendationsController', () => {
  describe('taste memory controls', () => {
    const req = { user: { userId: 'listener-1' } };

    it('loads the authenticated listener taste memory', () => {
      const ctrl = makeController();
      ctrl.getTasteMemory(req);
      expect(mockTasteMemoryService.getTasteMemory).toHaveBeenCalledWith('listener-1');
    });

    it('updates authenticated listener taste settings', () => {
      const ctrl = makeController();
      ctrl.updateTasteMemorySettings(req, { socialMatchingEnabled: true });
      expect(mockTasteMemoryService.updateSettings).toHaveBeenCalledWith('listener-1', {
        socialMatchingEnabled: true,
      });
    });

    it('adds and removes signal controls for the authenticated listener', () => {
      const ctrl = makeController();
      ctrl.upsertTasteSignalControl(req, { signalType: 'genre', value: 'Techno', action: 'hidden' });
      ctrl.removeTasteSignalControl(req, 'control-1');

      expect(mockTasteMemoryService.upsertSignalControl).toHaveBeenCalledWith('listener-1', {
        signalType: 'genre',
        value: 'Techno',
        action: 'hidden',
      });
      expect(mockTasteMemoryService.removeSignalControl).toHaveBeenCalledWith('listener-1', 'control-1');
    });
  });

  describe('getRecommendations — limit parsing', () => {
    it('defaults to 10 when limit is undefined', () => {
      const ctrl = makeController();
      ctrl.getRecommendations('user-1', undefined);
      expect(mockService.getRecommendations).toHaveBeenCalledWith('user-1', 10, {});
    });

    it('parses valid limit', () => {
      const ctrl = makeController();
      ctrl.getRecommendations('user-1', '15');
      expect(mockService.getRecommendations).toHaveBeenCalledWith('user-1', 15, {});
    });

    it('falls back to 10 for NaN', () => {
      const ctrl = makeController();
      ctrl.getRecommendations('user-1', 'abc');
      expect(mockService.getRecommendations).toHaveBeenCalledWith('user-1', 10, {});
    });

    it('passes vibe query overrides to the recommendation service', () => {
      const ctrl = makeController();
      ctrl.getRecommendations('user-1', '6', 'Focus', 'Ambient,Electronic', 'medium', 'true');
      expect(mockService.getRecommendations).toHaveBeenCalledWith('user-1', 6, {
        mood: 'Focus',
        genres: ['Ambient', 'Electronic'],
        energy: 'medium',
        allowExplicit: true,
      });
    });
  });
});
