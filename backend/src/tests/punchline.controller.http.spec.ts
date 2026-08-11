/**
 * PunchlineController — HTTP contract (#1479 featured shelf, #1510 browse)
 *
 * Tests routing and the public (no-auth) contract of GET /punchline/featured,
 * including limit parsing and that it does not shadow sibling routes.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PunchlineController } from '../modules/punchline/punchline.controller';
import { PunchlineCollectService } from '../modules/punchline/punchline-collect.service';
import { PunchlineDropService } from '../modules/punchline/punchline-drop.service';
import { PunchlineX402Service } from '../modules/punchline/punchline-x402.service';
import { PunchlineEligibilityService } from '../modules/punchline/punchline-eligibility.service';
import { PunchlineMetricsService } from '../modules/punchline/punchline-metrics.service';
import { PunchlineUnlockService } from '../modules/punchline/punchline-unlock.service';
import { createControllerTestApp } from './e2e-helpers';

const mockDropService = {
  listDrops: jest.fn().mockResolvedValue({
    items: [],
    meta: { count: 0, page: 1, limit: 24, totalCount: 0, totalPages: 0, hasNextPage: false },
    facets: { genres: [] },
  }),
  listFeaturedDrops: jest.fn().mockResolvedValue({
    items: [
      {
        id: 'drop-1',
        status: 'published',
        moments: [],
        context: { releaseId: 'rel-1', trackTitle: 'T', releaseTitle: 'R', artistName: 'A', releaseHasArtwork: false },
      },
    ],
    meta: { count: 1, limit: 6 },
  }),
  listPublishedDropsForTrack: jest.fn().mockResolvedValue({ items: [], meta: { count: 0, limit: 24 } }),
  getDropDetail: jest.fn().mockResolvedValue({ id: 'drop-1' }),
};

describe('PunchlineController featured (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(PunchlineController, [
      { provide: PunchlineDropService, useValue: mockDropService },
      { provide: PunchlineCollectService, useValue: {} },
      { provide: PunchlineX402Service, useValue: {} },
      { provide: PunchlineEligibilityService, useValue: {} },
      { provide: PunchlineMetricsService, useValue: {} },
      { provide: PunchlineUnlockService, useValue: {} },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('GET /punchline/featured → 200 without auth (public shelf)', async () => {
    const res = await request(app.getHttpServer())
      .get('/punchline/featured')
      .expect(200);

    expect(mockDropService.listFeaturedDrops).toHaveBeenCalledWith({ limit: undefined });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].context.releaseId).toBe('rel-1');
  });

  it('GET /punchline/featured?limit=3 → parses the limit', async () => {
    await request(app.getHttpServer())
      .get('/punchline/featured?limit=3')
      .expect(200);
    expect(mockDropService.listFeaturedDrops).toHaveBeenCalledWith({ limit: 3 });
  });

  it('does not shadow GET /punchline/tracks/:trackId/drops', async () => {
    await request(app.getHttpServer())
      .get('/punchline/tracks/trk-1/drops')
      .expect(200);
    expect(mockDropService.listPublishedDropsForTrack).toHaveBeenCalled();
    expect(mockDropService.listFeaturedDrops).not.toHaveBeenCalled();
  });

  it('GET /punchline/drops uses public browse defaults', async () => {
    await request(app.getHttpServer()).get('/punchline/drops').expect(200);

    expect(mockDropService.listDrops).toHaveBeenCalledWith({
      page: 1,
      limit: 24,
      kind: 'all',
      genre: undefined,
      price: 'all',
      availability: 'available',
    });
  });

  it('normalizes and forwards every browse query', async () => {
    await request(app.getHttpServer())
      .get('/punchline/drops?page=2&limit=48&kind=punchline&genre=%20Hip-Hop%20&price=paid&availability=all')
      .expect(200);

    expect(mockDropService.listDrops).toHaveBeenCalledWith({
      page: 2,
      limit: 48,
      kind: 'punchline',
      genre: 'Hip-Hop',
      price: 'paid',
      availability: 'all',
    });
  });

  it('treats a blank trimmed genre as no genre filter', async () => {
    await request(app.getHttpServer()).get('/punchline/drops?genre=%20%20').expect(200);
    expect(mockDropService.listDrops).toHaveBeenCalledWith(
      expect.objectContaining({ genre: undefined }),
    );
  });

  it.each([
    ['page partial integer', 'page=2x'],
    ['page zero', 'page=0'],
    ['page negative', 'page=-1'],
    ['page float', 'page=1.5'],
    ['limit zero', 'limit=0'],
    ['limit too large', 'limit=49'],
    ['unknown kind', 'kind=album'],
    ['unknown price', 'price=cheap'],
    ['unknown availability', 'availability=soon'],
    ['overlong genre', `genre=${'x'.repeat(101)}`],
    ['repeated scalar', 'kind=all&kind=punchline'],
  ])('rejects invalid browse query: %s', async (_label, query) => {
    await request(app.getHttpServer())
      .get(`/punchline/drops?${query}`)
      .expect(400);
    expect(mockDropService.listDrops).not.toHaveBeenCalled();
  });

  it('keeps browse, detail, and create routes separate', async () => {
    await request(app.getHttpServer()).get('/punchline/drops/drop-1').expect(200);
    expect(mockDropService.getDropDetail).toHaveBeenCalledWith('drop-1', undefined);
    expect(mockDropService.listDrops).not.toHaveBeenCalled();

    await request(app.getHttpServer()).post('/punchline/drops').send({}).expect(401);
    expect(mockDropService.listDrops).not.toHaveBeenCalled();
  });
});
