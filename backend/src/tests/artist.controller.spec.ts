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
});
