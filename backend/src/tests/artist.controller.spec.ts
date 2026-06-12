/**
 * ArtistController — Unit Test
 *
 * Tests controller-specific concern:
 *   - getById throws NotFoundException when service returns null
 *   - getMe / create extract userId from req.user
 */

import { NotFoundException } from '@nestjs/common';
import { ArtistController } from '../modules/artist/artist.controller';

const mockArtistService = {
  getProfile: jest.fn().mockResolvedValue({ id: 'a1' }),
  findById: jest.fn(),
  createProfile: jest.fn().mockResolvedValue({ id: 'a1' }),
  getSettings: jest.fn().mockResolvedValue({ artistId: 'a1', remixConsent: 'allowed' }),
  updateSettings: jest.fn().mockResolvedValue({ artistId: 'a1', remixConsent: 'disabled' }),
};

function makeController() {
  return new ArtistController(mockArtistService as any);
}

beforeEach(() => jest.clearAllMocks());

describe('ArtistController', () => {
  describe('getById', () => {
    it('throws NotFoundException when artist is null', async () => {
      mockArtistService.findById.mockResolvedValue(null);
      const ctrl = makeController();
      await expect(ctrl.getById('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns artist when found', async () => {
      mockArtistService.findById.mockResolvedValue({ id: 'a1', displayName: 'DJ Test' });
      const ctrl = makeController();
      const result = await ctrl.getById('a1');
      expect(result.displayName).toBe('DJ Test');
    });
  });

  describe('getMe — userId extraction', () => {
    it('passes req.user.userId to service', () => {
      const ctrl = makeController();
      ctrl.getMe({ user: { userId: 'user-42' } });
      expect(mockArtistService.getProfile).toHaveBeenCalledWith('user-42');
    });
  });

  describe('settings — userId extraction', () => {
    it('passes req.user.userId and route artist id to service for reads', () => {
      const ctrl = makeController();
      ctrl.getSettings({ user: { userId: 'user-42' } }, 'artist-42');
      expect(mockArtistService.getSettings).toHaveBeenCalledWith('user-42', 'artist-42');
    });

    it('passes req.user.userId and route artist id to service for updates', () => {
      const ctrl = makeController();
      ctrl.updateSettings({ user: { userId: 'user-42' } }, 'artist-42', { remixConsent: 'disabled' });
      expect(mockArtistService.updateSettings).toHaveBeenCalledWith(
        'user-42',
        'artist-42',
        { remixConsent: 'disabled' },
      );
    });
  });
});
