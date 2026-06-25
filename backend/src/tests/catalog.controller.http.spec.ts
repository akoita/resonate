/**
 * CatalogController — E2E Test
 *
 * Tests the HTTP contract:
 *   - Routing (GET /catalog/published, /catalog/releases/:id, etc.)
 *   - Guard enforcement (401 on protected routes without JWT)
 *   - HTTP status codes (200, 201, 404)
 *   - Response headers (Content-Type, Accept-Ranges)
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { CatalogController } from '../modules/catalog/catalog.controller';
import { CatalogService } from '../modules/catalog/catalog.service';
import { PlaylistService } from '../modules/playlist/playlist.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockCatalogService = {
  getReleaseArtwork: jest.fn(),
  getStemBlob: jest.fn(),
  getTrackStream: jest.fn(),
  getStemPreview: jest.fn(),
  listByUserId: jest.fn().mockResolvedValue([]),
  getReleaseForUser: jest.fn(),
  createRelease: jest.fn().mockResolvedValue({ id: 'rel-1', title: 'Test' }),
  listPublished: jest.fn().mockResolvedValue([]),
  getRelease: jest.fn(),
  getTrack: jest.fn(),
  getPlayerTrackActions: jest.fn(),
  updateRelease: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  deleteRelease: jest.fn().mockResolvedValue({ deleted: true }),
  updateReleaseArtwork: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  listByArtist: jest.fn().mockResolvedValue([]),
  search: jest.fn().mockResolvedValue([]),
};

const mockPlaylistService = {
  listPublicPlaylists: jest.fn().mockResolvedValue([]),
};

describe('CatalogController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(CatalogController, [
      { provide: CatalogService, useValue: mockCatalogService },
      { provide: PlaylistService, useValue: mockPlaylistService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCatalogService.listPublished.mockResolvedValue([]);
    mockCatalogService.getRelease.mockResolvedValue({ id: 'rel-1', title: 'Test' });
    mockCatalogService.getTrack.mockResolvedValue({ id: 'trk-1', title: 'Track' });
    mockCatalogService.getPlayerTrackActions.mockResolvedValue({ track: { id: 'trk-1' }, actions: [] });
  });

  // ----- Public routes -----

  it('GET /catalog/published → 200 (no auth required)', async () => {
    await request(app.getHttpServer())
      .get('/catalog/published')
      .expect(200);
  });

  it('GET /catalog/playlists → 200 (no auth required) and coerces the limit', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/playlists?limit=12')
      .expect(200);

    expect(res.body).toEqual([]);
    expect(mockPlaylistService.listPublicPlaylists).toHaveBeenCalledWith({ limit: 12 });
  });

  it('GET /catalog/releases/:id → 200 (no auth required)', async () => {
    await request(app.getHttpServer())
      .get('/catalog/releases/rel-1')
      .expect(200);
  });

  it('GET /catalog/tracks/:id/actions → 200 (no auth required)', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/tracks/trk-1/actions?reason=genre%3Ajazz')
      .expect(200);

    expect(res.body.actions).toEqual([]);
    expect(mockCatalogService.getPlayerTrackActions).toHaveBeenCalledWith('trk-1', {
      recommendationReasons: ['genre:jazz'],
    });
  });

  it('GET /catalog/artist/:artistId → 200 (no auth required)', async () => {
    await request(app.getHttpServer())
      .get('/catalog/artist/art-1')
      .expect(200);
  });

  // ----- Guard enforcement -----

  it('GET /catalog/me → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/catalog/me')
      .expect(401);
  });

  it('GET /catalog/me → 200 with JWT', async () => {
    await request(app.getHttpServer())
      .get('/catalog/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /catalog/me/releases/:id → 200 with JWT', async () => {
    mockCatalogService.getReleaseForUser.mockResolvedValue({ id: 'rel-1', title: 'Mine' });

    await request(app.getHttpServer())
      .get('/catalog/me/releases/rel-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('POST /catalog → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/catalog')
      .send({ title: 'New Release' })
      .expect(401);
  });

  it('POST /catalog → 201 with JWT', async () => {
    await request(app.getHttpServer())
      .post('/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Release' })
      .expect(201);
  });

  it('DELETE /catalog/releases/:id → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .delete('/catalog/releases/rel-1')
      .expect(401);
  });

  // ----- Streaming response headers -----

  it('GET /catalog/stems/:id/blob → correct Content-Type and Accept-Ranges', async () => {
    mockCatalogService.getStemBlob.mockResolvedValue({
      data: Buffer.alloc(100),
      mimeType: 'audio/mpeg',
    });

    const res = await request(app.getHttpServer())
      .get('/catalog/stems/stem-1/blob')
      .expect(200);

    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('GET /catalog/stems/:id/blob → preserves provider-backed byte ranges', async () => {
    mockCatalogService.getStemBlob.mockResolvedValue({
      data: Buffer.alloc(20),
      mimeType: 'audio/mpeg',
      range: { start: 10, end: 29, total: 100 },
    });

    const res = await request(app.getHttpServer())
      .get('/catalog/stems/stem-1/blob')
      .set('Range', 'bytes=10-29')
      .expect(206);

    expect(res.headers['content-range']).toBe('bytes 10-29/100');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('20');
    expect(res.headers['content-type']).toContain('audio/mpeg');
  });

  it('GET /catalog/stems/:id/preview → supports byte-range streaming', async () => {
    mockCatalogService.getStemPreview.mockResolvedValue({
      data: Buffer.alloc(100),
      mimeType: 'audio/mpeg',
    });

    const res = await request(app.getHttpServer())
      .get('/catalog/stems/stem-1/preview')
      .set('Range', 'bytes=10-29')
      .expect(206);

    expect(res.headers['content-range']).toBe('bytes 10-29/100');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('20');
    expect(res.headers['content-type']).toContain('audio/mpeg');
  });

  it('GET /catalog/releases/:id/artwork → 404 when not found', async () => {
    mockCatalogService.getReleaseArtwork.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/catalog/releases/rel-1/artwork')
      .expect(404);
  });
});
