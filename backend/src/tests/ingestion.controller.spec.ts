/**
 * IngestionController — Unit Test
 *
 * Tests controller-specific concerns ONLY:
 *   - upload(): metadata JSON string parsing from FormData
 *   - upload(): BadRequestException on invalid JSON
 *   - userId extraction from req.user
 */

import { BadRequestException } from '@nestjs/common';
import { IngestionController } from '../modules/ingestion/ingestion.controller';

const mockIngestionService = {
  handleFileUpload: jest.fn().mockResolvedValue({ releaseId: 'rel-1' }),
  handleProgress: jest.fn().mockResolvedValue({ ok: true }),
  retryRelease: jest.fn().mockResolvedValue({ ok: true }),
  cancelProcessing: jest.fn().mockResolvedValue({ ok: true }),
  getStatus: jest.fn().mockResolvedValue({ status: 'processing' }),
  enqueueUpload: jest.fn().mockResolvedValue({ queued: true }),
};

function makeController() {
  return new IngestionController(mockIngestionService as any);
}

beforeEach(() => jest.clearAllMocks());

describe('IngestionController', () => {

  // ===== upload() — metadata JSON parsing (controller-level logic) =====

  describe('upload() — metadata parsing', () => {
    const files = { files: [{ originalname: 'track.mp3', buffer: Buffer.from('audio') }] as any };
    const req = { user: { userId: 'u1' } };

    it('parses metadata from JSON string (FormData)', () => {
      const ctrl = makeController();
      const meta = JSON.stringify({ title: 'My Track', genre: 'electronic' });

      ctrl.upload(files, { metadata: meta }, req);

      expect(mockIngestionService.handleFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { title: 'My Track', genre: 'electronic' },
        }),
      );
    });

    it('passes metadata object directly when not a string', () => {
      const ctrl = makeController();
      const meta = { title: 'Direct' };

      ctrl.upload(files, { metadata: meta }, req);

      expect(mockIngestionService.handleFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { title: 'Direct' } }),
      );
    });

    it('throws BadRequestException for invalid JSON string', () => {
      const ctrl = makeController();

      expect(() =>
        ctrl.upload(files, { metadata: '{bad json' }, req),
      ).toThrow(BadRequestException);
    });

    it('extracts userId from req.user', () => {
      const ctrl = makeController();

      ctrl.upload(files, {}, { user: { userId: 'user-42' } });

      expect(mockIngestionService.handleFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-42' }),
      );
    });

    it('defaults files to empty array when missing from multipart', () => {
      const ctrl = makeController();

      ctrl.upload({} as any, {}, req);

      expect(mockIngestionService.handleFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({ files: [] }),
      );
    });
  });
});
