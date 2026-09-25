/**
 * GenerationController — E2E Test
 *
 * Tests the HTTP contract:
 *   - Guard enforcement (401 on all protected routes)
 *   - Routing (POST /generation/create, GET /generation/mine, etc.)
 *   - HTTP status codes
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { GenerationController } from '../modules/generation/generation.controller';
import { GenerationService } from '../modules/generation/generation.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
  createGenerationForCaller: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
  listUserGenerations: jest.fn().mockResolvedValue([]),
  getAnalytics: jest.fn().mockResolvedValue({ totalGenerations: 0 }),
  analyzeTrackStems: jest.fn().mockResolvedValue({ presentTypes: [], missingTypes: [] }),
  generateComplementaryStem: jest.fn().mockResolvedValue({ jobId: 'job-2' }),
  getStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
  publishGeneration: jest.fn().mockResolvedValue({ ok: true }),
  generateArtwork: jest.fn().mockResolvedValue({ image: 'base64data' }),
};

describe('GenerationController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(GenerationController, [
      { provide: GenerationService, useValue: mockGenerationService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ----- Guard enforcement -----

  it('POST /generation/create → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/generation/create')
      .send({ prompt: 'test' })
      .expect(401);
  });

  it('GET /generation/mine → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/generation/mine')
      .expect(401);
  });

  it('GET /generation/analytics → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/generation/analytics')
      .expect(401);
  });

  // ----- Routing with auth -----

  it('POST /generation/create → 201 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/generation/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'lo-fi beat' })
      .expect(201);

    expect(res.body.jobId).toBe('job-1');
  });

  it('GET /generation/mine → 200 with JWT', async () => {
    await request(app.getHttpServer())
      .get('/generation/mine')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /generation/:jobId/status → 200 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/generation/job-1/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('completed');
  });

  it('POST /generation/artwork → 201 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/generation/artwork')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'abstract album art' })
      .expect(201);

    expect(res.body.image).toBeDefined();
  });

  // ----- DTO validation (#1888: global ValidationPipe) -----

  describe('POST /generation/create validation', () => {
    const invalidBodies: Array<[string, Record<string, unknown>]> = [
      ['missing prompt', { durationSeconds: 30 }],
      ['prompt over 1000 chars', { prompt: 'a'.repeat(1001) }],
      ['unsupported durationSeconds', { prompt: 'lo-fi beat', durationSeconds: 45 }],
      ['string durationSeconds', { prompt: 'lo-fi beat', durationSeconds: '180' }],
      ['non-integer seed', { prompt: 'lo-fi beat', seed: 1.5 }],
      ['empty artistId', { prompt: 'lo-fi beat', artistId: '' }],
    ];

    it.each(invalidBodies)('→ 400 for %s and never reaches the service', async (_label, body) => {
      await request(app.getHttpServer())
        .post('/generation/create')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);

      expect(mockGenerationService.createGenerationForCaller).not.toHaveBeenCalled();
      expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
    });

    it('→ 201 and passes the body through unchanged (no whitelist, no transform)', async () => {
      const body = {
        prompt: 'lo-fi beat',
        negativePrompt: 'distortion',
        seed: 123456789,
        durationSeconds: 180,
        artistId: 'artist-1',
        unknownField: 'kept',
      };

      await request(app.getHttpServer())
        .post('/generation/create')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);

      expect(mockGenerationService.createGenerationForCaller).toHaveBeenCalledTimes(1);
      const [dto, userId] = mockGenerationService.createGenerationForCaller.mock.calls[0];
      expect(dto).toEqual(body);
      expect(userId).toBe('user-1');
    });
  });

  it('POST /generation/complementary → 400 without trackId', async () => {
    await request(app.getHttpServer())
      .post('/generation/complementary')
      .set('Authorization', `Bearer ${token}`)
      .send({ stemType: 'drums' })
      .expect(400);

    expect(mockGenerationService.generateComplementaryStem).not.toHaveBeenCalled();
  });

  describe('PATCH /generation/:trackId/publish validation (multipart)', () => {
    it('→ 400 for a title over 100 chars', async () => {
      await request(app.getHttpServer())
        .patch('/generation/track-1/publish')
        .set('Authorization', `Bearer ${token}`)
        .field('title', 't'.repeat(101))
        .field('artist', 'Test Artist')
        .expect(400);

      expect(mockGenerationService.publishGeneration).not.toHaveBeenCalled();
    });

    it('→ 200 for valid multipart fields', async () => {
      await request(app.getHttpServer())
        .patch('/generation/track-1/publish')
        .set('Authorization', `Bearer ${token}`)
        .field('title', 'Night Drive')
        .field('artist', 'Test Artist')
        .field('genre', 'Lo-fi')
        .field('releaseDate', '2026-09-25')
        .expect(200);

      expect(mockGenerationService.publishGeneration).toHaveBeenCalledTimes(1);
      const [trackId, dto, userId] = mockGenerationService.publishGeneration.mock.calls[0];
      expect(trackId).toBe('track-1');
      expect({ ...dto }).toEqual({
        title: 'Night Drive',
        artist: 'Test Artist',
        genre: 'Lo-fi',
        releaseDate: '2026-09-25',
      });
      expect(userId).toBe('user-1');
    });
  });
});
