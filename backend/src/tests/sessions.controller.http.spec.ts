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
import { PlaybackIntentsService } from '../modules/sessions/playback_intents.service';
import { SessionsService } from '../modules/sessions/sessions.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockSessionsService = {
  startSession: jest.fn().mockResolvedValue({ sessionId: 's1' }),
  stopSession: jest.fn().mockResolvedValue({ ok: true }),
  playTrack: jest.fn().mockResolvedValue({ ok: true }),
  agentNext: jest.fn().mockResolvedValue({ trackId: 'trk-1' }),
  getPlaylist: jest.fn().mockResolvedValue([{ id: 'trk-1', title: 'Track 1' }]),
};

const mockPlaybackIntentsService = {
  capabilitiesForOwner: jest.fn().mockReturnValue({ ownerUserId: 'user-1', available: false }),
  createCapability: jest.fn().mockReturnValue({ id: 'cap-1' }),
  revokeCapability: jest.fn().mockReturnValue({ status: 'revoked' }),
  registerDevice: jest.fn().mockReturnValue({ deviceId: 'web-1' }),
  resolve: jest.fn().mockResolvedValue({ outcome: 'queued', candidates: [] }),
  requestQueue: jest.fn().mockReturnValue({ outcome: 'queued', commandId: 'cmd-1' }),
  requestPlay: jest.fn().mockReturnValue({ outcome: 'confirmation_required', commandId: 'cmd-2' }),
  requestControl: jest.fn().mockReturnValue({ outcome: 'queued', commandId: 'cmd-3' }),
  confirmCommand: jest.fn().mockReturnValue({ outcome: 'playing', commandId: 'cmd-2' }),
  status: jest.fn().mockReturnValue({ commands: [] }),
};

describe('SessionsController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(SessionsController, [
      { provide: SessionsService, useValue: mockSessionsService },
      { provide: PlaybackIntentsService, useValue: mockPlaybackIntentsService },
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

  it('POST /sessions/playback/resolve → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/sessions/playback/resolve')
      .send({ query: 'late night' })
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

  it('POST /sessions/playback/resolve → 201 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/sessions/playback/resolve')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'late night', constraints: { maxTracks: 2 } })
      .expect(201);

    expect(res.body.outcome).toBe('queued');
    expect(mockPlaybackIntentsService.resolve).toHaveBeenCalledWith('user-1', expect.objectContaining({
      query: 'late night',
    }));
  });

  it('POST /sessions/playback/play → 201 with explicit confirmation outcome', async () => {
    const res = await request(app.getHttpServer())
      .post('/sessions/playback/play')
      .set('Authorization', `Bearer ${token}`)
      .send({ trackIds: ['track-1'], deviceId: 'web-1' })
      .expect(201);

    expect(res.body.outcome).toBe('confirmation_required');
  });
});
