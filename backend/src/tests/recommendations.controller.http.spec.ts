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
  previewTasteEdits: jest.fn().mockResolvedValue({ items: [] }),
  applyTasteEdits: jest.fn().mockResolvedValue({ controls: [] }),
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


  it.each(['/recommendations/another-user/home-feed', '/recommendations/another-user'])('refuses another listener on %s before reading or reserving exposure', async (path) => {
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`).expect(403);
    expect(mockRecommendationsService.getRecommendations).not.toHaveBeenCalled();
    expect(mockHomeFeedService.getHomeFeed).not.toHaveBeenCalled();
  });

  it('refuses preferences written for another listener', async () => {
    await request(app.getHttpServer()).post('/recommendations/preferences')
      .set('Authorization', `Bearer ${token}`).send({ userId: 'another-user', preferences: { genres: ['Jazz'] } }).expect(403);
    expect(mockRecommendationsService.setPreferences).not.toHaveBeenCalled();
  });

  describe('taste edits (#1961)', () => {
    const validItem = { signalType: 'genre', value: 'Drill', action: 'downranked' };

    it('POST /recommendations/taste-memory/edits/preview → 401 without JWT', async () => {
      await request(app.getHttpServer())
        .post('/recommendations/taste-memory/edits/preview')
        .send({ text: 'less drill' })
        .expect(401);
      expect(mockTasteMemoryService.previewTasteEdits).not.toHaveBeenCalled();
    });

    it('POST /recommendations/taste-memory/edits/preview → passes only the text', async () => {
      await request(app.getHttpServer())
        .post('/recommendations/taste-memory/edits/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'less drill, more live instruments' })
        .expect(201);
      expect(mockTasteMemoryService.previewTasteEdits).toHaveBeenCalledWith('less drill, more live instruments');
    });

    it.each([
      ['a missing text', {}],
      ['an empty text', { text: '' }],
      ['a non-string text', { text: 42 }],
      ['a text over 500 characters', { text: 'a'.repeat(501) }],
    ])('POST /recommendations/taste-memory/edits/preview → 400 for %s', async (_label, body) => {
      await request(app.getHttpServer())
        .post('/recommendations/taste-memory/edits/preview')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);
      expect(mockTasteMemoryService.previewTasteEdits).not.toHaveBeenCalled();
    });

    it('POST /recommendations/taste-memory/edits/apply → 401 without JWT', async () => {
      await request(app.getHttpServer())
        .post('/recommendations/taste-memory/edits/apply')
        .send({ items: [validItem] })
        .expect(401);
      expect(mockTasteMemoryService.applyTasteEdits).not.toHaveBeenCalled();
    });

    it('POST /recommendations/taste-memory/edits/apply → applies for the JWT user only', async () => {
      await request(app.getHttpServer())
        .post('/recommendations/taste-memory/edits/apply')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [validItem], userId: 'someone-else' })
        .expect(201);
      expect(mockTasteMemoryService.applyTasteEdits).toHaveBeenCalledWith('user-1', [validItem]);
    });

    it.each([
      ['a missing items list', {}],
      ['a non-array items', { items: 'genre' }],
      ['an empty items list', { items: [] }],
      ['more than 20 items', { items: Array.from({ length: 21 }, () => validItem) }],
      ['an item without a value', { items: [{ signalType: 'genre', action: 'boosted' }] }],
      ['an item with an over-long value', { items: [{ ...validItem, value: 'x'.repeat(81) }] }],
      ['an item with a non-string action', { items: [{ ...validItem, action: 7 }] }],
      ['an item that is not an object', { items: ['genre'] }],
    ])('POST /recommendations/taste-memory/edits/apply → 400 for %s', async (_label, body) => {
      await request(app.getHttpServer())
        .post('/recommendations/taste-memory/edits/apply')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);
      expect(mockTasteMemoryService.applyTasteEdits).not.toHaveBeenCalled();
    });
  });
});
