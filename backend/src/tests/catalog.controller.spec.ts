/**
 * CatalogController — Unit Test
 *
 * Tests controller-specific concerns ONLY:
 *   - Range header parsing → 206 partial content, 416 out-of-range
 *   - Response headers (Content-Range, Accept-Ranges, Content-Type)
 *   - listPublished/search limit string → number coercion with NaN fallback
 *   - search hasIpnft string → boolean conversion
 *   - getReleaseArtwork 404 when null
 *   - userId extraction from req.user
 *
 * Service business logic is NOT re-tested here.
 */

import { CatalogController } from '../modules/catalog/catalog.controller';

const mockCatalogService = {
  getReleaseArtwork: jest.fn(),
  getStemBlob: jest.fn(),
  getTrackStream: jest.fn(),
  getStemPreview: jest.fn(),
  listByUserId: jest.fn().mockResolvedValue([]),
  getReleaseForUser: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  createRelease: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  listPublished: jest.fn().mockResolvedValue([]),
  getRelease: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  getTrack: jest.fn().mockResolvedValue({ id: 'trk-1' }),
  updateRelease: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  deleteRelease: jest.fn().mockResolvedValue({ deleted: true }),
  updateReleaseArtwork: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  listByArtist: jest.fn().mockResolvedValue([]),
  search: jest.fn().mockResolvedValue([]),
};

function makeController() {
  return new CatalogController(mockCatalogService as any);
}

/** Minimal Express Response mock with chainable .status().set() */
function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    set(headers: Record<string, any>) { Object.assign(res.headers, headers); return res; },
    send(data?: any) { res.body = data; },
    end(data?: any) { res.body = data; },
  };
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('CatalogController', () => {

  // ===== range header parsing (controller-only logic) =====

  describe('getStemBlob — range requests', () => {
    const stemData = { data: Buffer.alloc(1000), mimeType: 'audio/mpeg' };

    it('returns 206 with correct Content-Range for valid range', async () => {
      mockCatalogService.getStemBlob.mockResolvedValue(stemData);
      const ctrl = makeController();
      const res = mockRes();

      await ctrl.getStemBlob('stem-1', 'bytes=0-499', res);

      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 0-499/1000');
      expect(res.headers['Content-Length']).toBe(500);
    });

    it('returns 416 when range start exceeds file size', async () => {
      mockCatalogService.getStemBlob.mockResolvedValue(stemData);
      const ctrl = makeController();
      const res = mockRes();

      await ctrl.getStemBlob('stem-1', 'bytes=2000-', res);

      expect(res.statusCode).toBe(416);
      expect(res.headers['Content-Range']).toBe('bytes */1000');
    });

    it('returns full response when no range header', async () => {
      mockCatalogService.getStemBlob.mockResolvedValue(stemData);
      const ctrl = makeController();
      const res = mockRes();

      await ctrl.getStemBlob('stem-1', undefined as any, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Length']).toBe(1000);
      expect(res.headers['Accept-Ranges']).toBe('bytes');
    });

    it('returns 404 when stem not found', async () => {
      mockCatalogService.getStemBlob.mockResolvedValue(null);
      const ctrl = makeController();
      const res = mockRes();

      await ctrl.getStemBlob('missing', 'bytes=0-99', res);

      expect(res.statusCode).toBe(404);
    });
  });

  describe('getTrackStream — range requests', () => {
    const streamData = { data: Buffer.alloc(2000), mimeType: 'audio/wav' };

    it('returns 206 with correct headers for range request', async () => {
      mockCatalogService.getTrackStream.mockResolvedValue(streamData);
      const ctrl = makeController();
      const res = mockRes();

      await ctrl.getTrackStream('trk-1', 'bytes=100-599', res);

      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 100-599/2000');
      expect(res.headers['Content-Length']).toBe(500);
      expect(res.headers['Content-Type']).toBe('audio/wav');
    });

    it('returns 404 when track audio not found', async () => {
      mockCatalogService.getTrackStream.mockResolvedValue(null);
      const ctrl = makeController();
      const res = mockRes();

      await ctrl.getTrackStream('missing', '', res);

      expect(res.statusCode).toBe(404);
    });
  });

  // ===== getReleaseArtwork — response shaping =====

  describe('getReleaseArtwork', () => {
    it('returns 404 when artwork is null', async () => {
      mockCatalogService.getReleaseArtwork.mockResolvedValue(null);
      const ctrl = makeController();
      const res = mockRes();

      await ctrl.getReleaseArtwork('rel-1', res);

      expect(res.statusCode).toBe(404);
    });
  });

  describe('getMyRelease', () => {
    it('passes req.user.userId through to the service', async () => {
      const ctrl = makeController();

      await ctrl.getMyRelease('rel-1', { user: { userId: 'user-123' } });

      expect(mockCatalogService.getReleaseForUser).toHaveBeenCalledWith('rel-1', 'user-123');
    });
  });

  // ===== listPublished — limit coercion =====

  describe('listPublished — limit parsing', () => {
    it('defaults to 20 when limit is undefined', async () => {
      const ctrl = makeController();
      await ctrl.listPublished(undefined);
      expect(mockCatalogService.listPublished).toHaveBeenCalledWith(20, undefined);
    });

    it('parses valid limit string to number', async () => {
      const ctrl = makeController();
      await ctrl.listPublished('5');
      expect(mockCatalogService.listPublished).toHaveBeenCalledWith(5, undefined);
    });

    it('falls back to 20 for NaN limit', async () => {
      const ctrl = makeController();
      await ctrl.listPublished('abc');
      expect(mockCatalogService.listPublished).toHaveBeenCalledWith(20, undefined);
    });
  });

  // ===== search — query param transformation =====

  describe('search — param parsing', () => {
    it('converts hasIpnft "true" string to boolean true', async () => {
      const ctrl = makeController();
      await ctrl.search(undefined, undefined, 'true', undefined);
      expect(mockCatalogService.search).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ hasIpnft: true }),
      );
    });

    it('converts hasIpnft "false" string to boolean false', async () => {
      const ctrl = makeController();
      await ctrl.search(undefined, undefined, 'false', undefined);
      expect(mockCatalogService.search).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ hasIpnft: false }),
      );
    });

    it('passes undefined hasIpnft when param omitted', async () => {
      const ctrl = makeController();
      await ctrl.search(undefined, undefined, undefined, undefined);
      expect(mockCatalogService.search).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ hasIpnft: undefined }),
      );
    });

    it('falls back to limit 50 for NaN', async () => {
      const ctrl = makeController();
      await ctrl.search(undefined, undefined, undefined, 'xyz');
      expect(mockCatalogService.search).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ limit: 50 }),
      );
    });
  });

  // ===== listMe / create — userId extraction =====

  describe('listMe', () => {
    it('extracts userId from req.user', () => {
      const ctrl = makeController();
      ctrl.listMe({ user: { userId: 'user-42' } });
      expect(mockCatalogService.listByUserId).toHaveBeenCalledWith('user-42');
    });
  });

  describe('create', () => {
    it('merges userId into body before calling service', () => {
      const ctrl = makeController();
      ctrl.create(
        { user: { userId: 'user-42' } },
        { title: 'My Release' },
      );
      expect(mockCatalogService.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My Release', userId: 'user-42' }),
      );
    });
  });
});
