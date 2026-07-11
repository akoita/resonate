/**
 * RecommendationsController — HTTP contract (#1454 WS-7 home feed)
 *
 * Tests routing, guard enforcement, and the rail response shape consumed by
 * the Home page.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { RecommendationsController } from '../modules/recommendations/recommendations.controller';
import { RecommendationsService } from '../modules/recommendations/recommendations.service';
import { TasteMemoryService } from '../modules/recommendations/taste_memory.service';
import { HomeFeedService } from '../modules/recommendations/home-feed.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockRecommendationsService = {
  getRecommendations: jest.fn().mockResolvedValue({ items: [] }),
  setPreferences: jest.fn().mockResolvedValue({ ok: true }),
};

const mockTasteMemoryService = {
  getTasteMemory: jest.fn().mockResolvedValue({}),
};

const mockHomeFeedService = {
  getHomeFeed: jest.fn().mockResolvedValue({
    userId: 'user-1',
    requestId: 'req-1',
    cold: false,
    rails: [
      {
        id: 'because_genre',
        kind: 'because_genre',
        title: 'Because you save a lot of Afrobeat',
        explanation: 'Ranked for your Afrobeat taste.',
        items: [],
      },
    ],
  }),
};

describe('RecommendationsController home feed (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(RecommendationsController, [
      { provide: RecommendationsService, useValue: mockRecommendationsService },
      { provide: TasteMemoryService, useValue: mockTasteMemoryService },
      { provide: HomeFeedService, useValue: mockHomeFeedService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('GET /recommendations/:userId/home-feed → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/recommendations/user-1/home-feed')
      .expect(401);
  });

  it('GET /recommendations/:userId/home-feed → 200 with rails shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/recommendations/user-1/home-feed')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(mockHomeFeedService.getHomeFeed).toHaveBeenCalledWith('user-1');
    expect(res.body.cold).toBe(false);
    expect(res.body.rails).toHaveLength(1);
    expect(res.body.rails[0]).toMatchObject({
      id: 'because_genre',
      kind: 'because_genre',
      title: 'Because you save a lot of Afrobeat',
    });
  });

  it('does not shadow GET /recommendations/:userId (flat list still routes)', async () => {
    await request(app.getHttpServer())
      .get('/recommendations/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mockRecommendationsService.getRecommendations).toHaveBeenCalled();
    expect(mockHomeFeedService.getHomeFeed).not.toHaveBeenCalled();
  });
});
