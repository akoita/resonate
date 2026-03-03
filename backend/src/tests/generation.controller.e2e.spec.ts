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
});
