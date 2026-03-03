/**
 * GenerationController — Unit Test
 *
 * Tests controller-specific concerns ONLY:
 *   - userId extraction 3-way fallback (req.user?.userId || req.user?.id || req.user?.sub)
 *   - listMine limit/offset string → parseInt with defaults
 *   - generateArtwork empty prompt rejection (controller-level throw)
 */

import { GenerationController } from '../modules/generation/generation.controller';

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
  listUserGenerations: jest.fn().mockResolvedValue([]),
  getAnalytics: jest.fn().mockResolvedValue({}),
  analyzeTrackStems: jest.fn().mockResolvedValue({}),
  generateComplementaryStem: jest.fn().mockResolvedValue({}),
  getStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
  publishGeneration: jest.fn().mockResolvedValue({ ok: true }),
  generateArtwork: jest.fn().mockResolvedValue({ image: 'base64data' }),
};

function makeController() {
  return new GenerationController(mockGenerationService as any);
}

beforeEach(() => jest.clearAllMocks());

describe('GenerationController', () => {

  // ===== userId extraction — 3-way fallback (controller logic) =====

  describe('userId extraction', () => {
    it('uses req.user.userId when available', async () => {
      const ctrl = makeController();
      await ctrl.create({ prompt: 'test' } as any, { user: { userId: 'u1' } });
      expect(mockGenerationService.createGeneration).toHaveBeenCalledWith(
        expect.anything(),
        'u1',
      );
    });

    it('falls back to req.user.id when userId is missing', async () => {
      const ctrl = makeController();
      await ctrl.create({ prompt: 'test' } as any, { user: { id: 'u2' } });
      expect(mockGenerationService.createGeneration).toHaveBeenCalledWith(
        expect.anything(),
        'u2',
      );
    });

    it('falls back to req.user.sub when userId and id are missing', async () => {
      const ctrl = makeController();
      await ctrl.create({ prompt: 'test' } as any, { user: { sub: 'u3' } });
      expect(mockGenerationService.createGeneration).toHaveBeenCalledWith(
        expect.anything(),
        'u3',
      );
    });
  });

  // ===== listMine — limit/offset parsing =====

  describe('listMine — param parsing', () => {
    const req = { user: { userId: 'u1' } };

    it('defaults limit to 50 and offset to 0 when omitted', async () => {
      const ctrl = makeController();
      await ctrl.listMine(req, undefined, undefined);
      expect(mockGenerationService.listUserGenerations).toHaveBeenCalledWith('u1', 50, 0);
    });

    it('parses valid limit and offset strings', async () => {
      const ctrl = makeController();
      await ctrl.listMine(req, '10', '5');
      expect(mockGenerationService.listUserGenerations).toHaveBeenCalledWith('u1', 10, 5);
    });
  });

  // ===== generateArtwork — empty prompt rejection =====

  describe('generateArtwork', () => {
    it('throws when prompt is empty string', async () => {
      const ctrl = makeController();
      await expect(ctrl.generateArtwork({ prompt: '' })).rejects.toThrow('Prompt is required');
    });

    it('throws when prompt is only whitespace', async () => {
      const ctrl = makeController();
      await expect(ctrl.generateArtwork({ prompt: '   ' })).rejects.toThrow('Prompt is required');
    });

    it('trims prompt before passing to service', async () => {
      const ctrl = makeController();
      await ctrl.generateArtwork({ prompt: '  cool album art  ' });
      expect(mockGenerationService.generateArtwork).toHaveBeenCalledWith('cool album art');
    });
  });
});
