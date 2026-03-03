/**
 * SessionsController — E2E Test
 *
 * Tests the HTTP contract:
 *   - Guard enforcement (401 on all routes)
 *   - Routing with auth
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { SessionsController } from '../modules/sessions/sessions.controller';
import { SessionsService } from '../modules/sessions/sessions.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockSessionsService = {
  startSession: jest.fn().mockResolvedValue({ sessionId: 's1' }),
  stopSession: jest.fn().mockResolvedValue({ ok: true }),
  playTrack: jest.fn().mockResolvedValue({ ok: true }),
  agentNext: jest.fn().mockResolvedValue({ trackId: 'trk-1' }),
  getPlaylist: jest.fn().mockResolvedValue([{ id: 'trk-1', title: 'Track 1' }]),
};

describe('SessionsController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(SessionsController, [
      { provide: SessionsService, useValue: mockSessionsService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ----- Guard enforcement -----

  it('POST /sessions/start → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/sessions/start')
      .send({ userId: 'u1', budgetCapUsd: 10 })
      .expect(401);
  });

  it('GET /sessions/playlist → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/sessions/playlist')
      .expect(401);
  });

  // ----- Routing with auth -----

  it('POST /sessions/start → 201 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/sessions/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'u1', budgetCapUsd: 10 })
      .expect(201);

    expect(res.body.sessionId).toBe('s1');
  });

  it('POST /sessions/stop → 201 with JWT', async () => {
    await request(app.getHttpServer())
      .post('/sessions/stop')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 's1' })
      .expect(201);
  });

  it('GET /sessions/playlist → 200 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/sessions/playlist')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});
