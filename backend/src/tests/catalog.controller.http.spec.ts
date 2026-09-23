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
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { CatalogController } from '../modules/catalog/catalog.controller';
import { CatalogService } from '../modules/catalog/catalog.service';
import { DiscoveryPopularityService } from '../modules/catalog/discovery-popularity.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockCatalogService = {
  getReleaseArtwork: jest.fn(),
  getReleaseArtworkForUser: jest.fn(),
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
  updateTrackMetadata: jest.fn().mockResolvedValue({ id: 'trk-1', title: 'Edited Track', explicit: true }),
  withdrawRelease: jest.fn(),
  restoreRelease: jest.fn(),
  deleteRelease: jest.fn().mockResolvedValue({ deleted: true }),
  updateReleaseArtwork: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  listByArtist: jest.fn().mockResolvedValue([]),
  search: jest.fn().mockResolvedValue([]),
  reviewCreditIdentity: jest.fn().mockResolvedValue({ id: 'credit-1', artistId: 'artist-2', identityStatus: 'reviewed' }),
};

const mockDiscoveryPopularityService = {
  getTrendingTracks: jest.fn().mockResolvedValue({ window: '7d', genre: null, minimumAudience: 3, items: [] }),
  getTopArtists: jest.fn().mockResolvedValue({ window: '7d', genre: null, minimumAudience: 3, items: [] }),
};

describe('CatalogController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(CatalogController, [
      { provide: CatalogService, useValue: mockCatalogService },
      { provide: DiscoveryPopularityService, useValue: mockDiscoveryPopularityService },
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
      userId: undefined,
    });
  });

  it('GET /catalog/tracks/:id/actions passes optional authenticated identity', async () => {
    await request(app.getHttpServer())
      .get('/catalog/tracks/trk-1/actions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(mockCatalogService.getPlayerTrackActions).toHaveBeenCalledWith('trk-1', {
      recommendationReasons: [],
      userId: 'user-1',
    });
  });

  it('GET /catalog/artist/:artistId → 200 (no auth required)', async () => {
    await request(app.getHttpServer())
      .get('/catalog/artist/art-1')
      .expect(200);
  });

  it('GET /catalog/trending → 200 (no auth required)', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/trending?window=24h&genre=Hip%20Hop&limit=5')
      .expect(200);

    expect(res.body.items).toEqual([]);
    expect(mockDiscoveryPopularityService.getTrendingTracks).toHaveBeenCalledWith({
      window: '24h',
      genre: 'Hip Hop',
      limit: 5,
    });
  });

  it('GET /catalog/trending → 400 on unknown window', async () => {
    await request(app.getHttpServer())
      .get('/catalog/trending?window=1y')
      .expect(400);
  });

  it('GET /catalog/top-artists → 200 (no auth required)', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/top-artists')
      .expect(200);

    expect(res.body.items).toEqual([]);
    expect(mockDiscoveryPopularityService.getTopArtists).toHaveBeenCalledWith({
      window: undefined,
      genre: undefined,
      limit: undefined,
    });
  });

  // ----- Guard enforcement -----

  it('GET /catalog/me → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/catalog/me')
      .expect(401);
  });

  it('PATCH /catalog/credits/:id/identity requires operator role and passes exact target', async () => {
    const body = { artistId: 'artist-2', note: 'Reviewed matching source evidence.' };
    await request(app.getHttpServer()).patch('/catalog/credits/credit-1/identity').send(body).expect(401);
    await request(app.getHttpServer()).patch('/catalog/credits/credit-1/identity')
      .set('Authorization', `Bearer ${token}`).send(body).expect(403);
    await request(app.getHttpServer()).patch('/catalog/credits/credit-1/identity')
      .set('Authorization', `Bearer ${authToken('operator-1', 'operator')}`).send(body).expect(200);
    expect(mockCatalogService.reviewCreditIdentity).toHaveBeenCalledWith(
      'credit-1', 'operator-1', 'operator', 'artist-2', body.note,
    );
  });

  it('PATCH /catalog/releases/:releaseId/tracks/:trackId/metadata requires JWT and forwards the target and editable fields', async () => {
    const body = { title: 'Edited Track', explicit: true };
    await request(app.getHttpServer())
      .patch('/catalog/releases/rel-1/tracks/trk-1/metadata')
      .send(body)
      .expect(401);

    const res = await request(app.getHttpServer())
      .patch('/catalog/releases/rel-1/tracks/trk-1/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);

    expect(res.body).toMatchObject({ id: 'trk-1', title: 'Edited Track', explicit: true });
    expect(mockCatalogService.updateTrackMetadata).toHaveBeenCalledWith(
      'rel-1', 'trk-1', 'user-1', body,
    );
  });

  it('PATCH /catalog/releases/:releaseId/tracks/:trackId/metadata returns service authorization denials', async () => {
    mockCatalogService.updateTrackMetadata.mockRejectedValueOnce(
      new ForbiddenException('Not authorized to manage this release'),
    );
    await request(app.getHttpServer())
      .patch('/catalog/releases/rel-1/tracks/trk-1/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Denied' })
      .expect(403);
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

  it('GET /catalog/releases/:id/artwork/v:revision → serves versioned public artwork', async () => {
    mockCatalogService.getReleaseArtwork.mockResolvedValue({
      data: Buffer.from('artwork'),
      mimeType: 'image/png',
    });

    const res = await request(app.getHttpServer())
      .get('/catalog/releases/rel-1/artwork/v7')
      .expect(200);

    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(mockCatalogService.getReleaseArtwork).toHaveBeenCalledWith('rel-1', '7');
  });

  it('GET /catalog/me/releases/:id/artwork/v:revision → preserves owner auth and version', async () => {
    mockCatalogService.getReleaseArtworkForUser.mockResolvedValue({
      data: Buffer.from('owner-artwork'),
      mimeType: 'image/webp',
    });

    const res = await request(app.getHttpServer())
      .get('/catalog/me/releases/rel-1/artwork/v8')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(mockCatalogService.getReleaseArtworkForUser).toHaveBeenCalledWith('rel-1', 'user-1', '8');
  });

  it('GET /catalog/me/releases/:id/artwork/v:revision → requires JWT', async () => {
    await request(app.getHttpServer())
      .get('/catalog/me/releases/rel-1/artwork/v8')
      .expect(401);
  });

  // ----- Withdrawal (#1793): owner-scoped routes -----

  it('POST /catalog/me/releases/:id/withdraw → 401 without JWT, and the service is never reached', async () => {
    await request(app.getHttpServer())
      .post('/catalog/me/releases/rel-1/withdraw')
      .send({ reason: 'Pulled' })
      .expect(401);

    expect(mockCatalogService.withdrawRelease).not.toHaveBeenCalled();
  });

  it('POST /catalog/me/releases/:id/restore → 401 without JWT, and the service is never reached', async () => {
    await request(app.getHttpServer())
      .post('/catalog/me/releases/rel-1/restore')
      .expect(401);

    expect(mockCatalogService.restoreRelease).not.toHaveBeenCalled();
  });

  it('POST /catalog/me/releases/:id/withdraw → 200, release id from the path, owner from the token', async () => {
    mockCatalogService.withdrawRelease.mockResolvedValue({
      releaseId: 'rel-1',
      title: 'Test',
      status: 'withdrawn',
      statusBeforeWithdrawal: 'published',
      withdrawnAt: new Date('2026-09-17T10:00:00.000Z'),
      withdrawalReason: 'Sample not cleared',
      alreadyInState: false,
    });

    const res = await request(app.getHttpServer())
      .post('/catalog/me/releases/rel-1/withdraw')
      .set('Authorization', `Bearer ${token}`)
      // An attacker-supplied owner hint in the body must be ignored.
      .send({ reason: 'Sample not cleared', artistId: 'someone-else', userId: 'someone-else' })
      .expect(200);

    expect(res.body.status).toBe('withdrawn');
    expect(res.body.statusBeforeWithdrawal).toBe('published');
    expect(mockCatalogService.withdrawRelease).toHaveBeenCalledWith('rel-1', 'user-1', {
      reason: 'Sample not cleared',
    });
  });

  it('POST /catalog/me/releases/:id/withdraw → 200 with no body at all', async () => {
    mockCatalogService.withdrawRelease.mockResolvedValue({ releaseId: 'rel-1', status: 'withdrawn' });

    await request(app.getHttpServer())
      .post('/catalog/me/releases/rel-1/withdraw')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(mockCatalogService.withdrawRelease).toHaveBeenCalledWith('rel-1', 'user-1', {
      reason: undefined,
    });
  });

  it('POST /catalog/me/releases/:id/restore → 200, release id from the path, owner from the token', async () => {
    mockCatalogService.restoreRelease.mockResolvedValue({
      releaseId: 'rel-1',
      title: 'Test',
      status: 'published',
      statusBeforeWithdrawal: null,
      withdrawnAt: null,
      withdrawalReason: null,
      alreadyInState: false,
    });

    const res = await request(app.getHttpServer())
      .post('/catalog/me/releases/rel-1/restore')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'someone-else' })
      .expect(200);

    expect(res.body.status).toBe('published');
    expect(mockCatalogService.restoreRelease).toHaveBeenCalledWith('rel-1', 'user-1');
  });

  it("another artist's withdraw attempt surfaces as 403", async () => {
    mockCatalogService.withdrawRelease.mockRejectedValue(
      new ForbiddenException('Not authorized to withdraw this release'),
    );

    await request(app.getHttpServer())
      .post('/catalog/me/releases/rel-1/withdraw')
      .set('Authorization', `Bearer ${authToken('other-artist')}`)
      .expect(403);

    expect(mockCatalogService.withdrawRelease).toHaveBeenCalledWith('rel-1', 'other-artist', {
      reason: undefined,
    });
  });

  it("another artist's restore attempt surfaces as 403", async () => {
    mockCatalogService.restoreRelease.mockRejectedValue(
      new ForbiddenException('Not authorized to restore this release'),
    );

    await request(app.getHttpServer())
      .post('/catalog/me/releases/rel-1/restore')
      .set('Authorization', `Bearer ${authToken('other-artist')}`)
      .expect(403);

    expect(mockCatalogService.restoreRelease).toHaveBeenCalledWith('rel-1', 'other-artist');
  });
});
