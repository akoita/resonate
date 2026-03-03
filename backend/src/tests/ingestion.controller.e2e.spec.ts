/**
 * IngestionController — E2E Test
 *
 * Tests the HTTP contract:
 *   - Guard enforcement (401 on protected routes)
 *   - Routing (POST /ingestion/upload, GET /ingestion/status/:trackId)
 *   - HTTP status codes
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { IngestionController } from '../modules/ingestion/ingestion.controller';
import { IngestionService } from '../modules/ingestion/ingestion.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockIngestionService = {
  handleFileUpload: jest.fn().mockResolvedValue({ releaseId: 'rel-1', status: 'queued' }),
  handleProgress: jest.fn().mockResolvedValue({ ok: true }),
  retryRelease: jest.fn().mockResolvedValue({ ok: true }),
  cancelProcessing: jest.fn().mockResolvedValue({ ok: true }),
  getStatus: jest.fn().mockResolvedValue({ status: 'processing' }),
  enqueueUpload: jest.fn().mockResolvedValue({ trackId: 'trk-1', status: 'queued' }),
};

describe('IngestionController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(IngestionController, [
      { provide: IngestionService, useValue: mockIngestionService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ----- Guard enforcement -----

  it('POST /ingestion/upload → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/ingestion/upload')
      .expect(401);
  });

  it('POST /ingestion/retry/:releaseId → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/ingestion/retry/rel-1')
      .expect(401);
  });

  it('GET /ingestion/status/:trackId → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/ingestion/status/trk-1')
      .expect(401);
  });

  // ----- Routing with auth -----

  it('GET /ingestion/status/:trackId → 200 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/ingestion/status/trk-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('processing');
  });

  it('POST /ingestion/enqueue → 201 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/ingestion/enqueue')
      .set('Authorization', `Bearer ${token}`)
      .send({ artistId: 'art-1', fileUris: ['gs://bucket/track.wav'] })
      .expect(201);

    expect(res.body.trackId).toBeDefined();
  });

  // ----- Public route (progress webhook) -----

  it('POST /ingestion/progress/:releaseId/:trackId → 201 (no auth)', async () => {
    await request(app.getHttpServer())
      .post('/ingestion/progress/rel-1/trk-1')
      .send({ progress: 50 })
      .expect(201);
  });
});
