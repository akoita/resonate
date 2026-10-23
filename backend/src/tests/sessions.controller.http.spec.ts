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
    expect(mockSessionsService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('POST /sessions/agent/next binds private next-pick responses to the JWT owner', async () => {
    await request(app.getHttpServer())
      .post('/sessions/agent/next')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'attacker', sessionId: 'owned-session' })
      .expect(201);

    expect(mockSessionsService.agentNext).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'owned-session',
    });
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

  // ----- Body validation (#1890) -----

  it('rejects wrongly typed session bodies with 400 before the service runs', async () => {
    const post = (path: string, body: unknown) =>
      request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body as object);

    await post('/sessions/start', { budgetCapUsd: '10' }).expect(400);
    await post('/sessions/start', { budgetCapUsd: -1 }).expect(400);
    await post('/sessions/start', { budgetCapUsd: 10, preferences: { genres: 'jazz' } }).expect(400);
    await post('/sessions/start', { budgetCapUsd: 10, preferences: { allowExplicit: 'yes' } }).expect(400);
    await post('/sessions/stop', { sessionId: 42 }).expect(400);
    await post('/sessions/play', { sessionId: 's1', trackId: 't1', priceUsd: -1 }).expect(400);
    await post('/sessions/agent/next', { sessionId: ['s1'] }).expect(400);
    await post('/sessions/agent/next', { sessionId: 's1', preferences: 'chill' }).expect(400);

    expect(mockSessionsService.startSession).not.toHaveBeenCalled();
    expect(mockSessionsService.stopSession).not.toHaveBeenCalled();
    expect(mockSessionsService.playTrack).not.toHaveBeenCalled();
    expect(mockSessionsService.agentNext).not.toHaveBeenCalled();
  });

  it('validates the session seed (#2244) before the service runs', async () => {
    const post = (path: string, body: unknown) =>
      request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body as object);
    const seed = (value: unknown) => ({ budgetCapUsd: 10, preferences: { seed: value } });

    await post('/sessions/start', seed({ kind: 'album', id: 'x', label: 'X' })).expect(400);
    await post('/sessions/start', seed({ kind: 'playlist' })).expect(400);
    await post('/sessions/start', seed({ kind: 'playlist', id: '' })).expect(400);
    await post('/sessions/start', seed({ kind: 'playlist', id: 'p'.repeat(101) })).expect(400);
    await post('/sessions/start', seed({ kind: 'track', id: 42 })).expect(400);
    await post('/sessions/start', seed({ kind: 'track', id: 't1', label: 'l'.repeat(121) })).expect(400);
    await post('/sessions/start', seed('playlist:p1')).expect(400);
    await post('/sessions/agent/next', { sessionId: 's1', preferences: { seed: { kind: 'nope', id: 'x' } } }).expect(400);
    expect(mockSessionsService.startSession).not.toHaveBeenCalled();
    expect(mockSessionsService.agentNext).not.toHaveBeenCalled();

    // A well-formed seed, a removed seed (null) and an absent one all reach the service.
    await post('/sessions/start', seed({ kind: 'playlist', id: 'p1', label: 'Late night' })).expect(201);
    await post('/sessions/agent/next', { sessionId: 's1', preferences: { seed: null } }).expect(201);
    expect(mockSessionsService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ seed: expect.objectContaining({ kind: 'playlist', id: 'p1' }) }),
      }),
    );
    expect(mockSessionsService.agentNext).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: expect.objectContaining({ seed: null }) }),
    );
  });

  it('accepts well-typed session bodies, including the runtime-validated fields', async () => {
    await request(app.getHttpServer())
      .post('/sessions/agent/next')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionId: 's1',
        preferences: { genres: ['Jazz'], allowExplicit: false, myMix: null, request: { genres: ['jazz'] } },
      })
      .expect(201);
    expect(mockSessionsService.agentNext).toHaveBeenCalledTimes(1);
  });
});
