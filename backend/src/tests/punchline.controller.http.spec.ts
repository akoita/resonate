/**
 * PunchlineController — HTTP contract (#1479 featured shelf)
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
});
