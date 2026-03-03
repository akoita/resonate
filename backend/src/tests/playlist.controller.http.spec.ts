/**
 * PlaylistController — E2E Test
 *
 * Tests the HTTP contract:
 *   - Guard enforcement (401 on all routes — entire controller guarded)
 *   - CRUD routing with auth
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PlaylistController } from '../modules/playlist/playlist.controller';
import { PlaylistService } from '../modules/playlist/playlist.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockPlaylistService = {
  createFolder: jest.fn().mockResolvedValue({ id: 'f1', name: 'My Folder' }),
  listFolders: jest.fn().mockResolvedValue([]),
  updateFolder: jest.fn().mockResolvedValue({ id: 'f1' }),
  deleteFolder: jest.fn().mockResolvedValue({ ok: true }),
  createPlaylist: jest.fn().mockResolvedValue({ id: 'p1', name: 'Chill' }),
  listPlaylists: jest.fn().mockResolvedValue([]),
  getPlaylist: jest.fn().mockResolvedValue({ id: 'p1', name: 'Chill', tracks: [] }),
  updatePlaylist: jest.fn().mockResolvedValue({ id: 'p1' }),
  deletePlaylist: jest.fn().mockResolvedValue({ ok: true }),
};

describe('PlaylistController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(PlaylistController, [
      { provide: PlaylistService, useValue: mockPlaylistService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ----- Controller-level guard: all routes require JWT -----

  it('GET /playlists → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/playlists')
      .expect(401);
  });

  it('POST /playlists → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/playlists')
      .send({ name: 'Test' })
      .expect(401);
  });

  it('GET /playlists/folders → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/playlists/folders')
      .expect(401);
  });

  // ----- CRUD with auth -----

  it('POST /playlists → 201 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/playlists')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Chill Vibes' })
      .expect(201);

    expect(res.body.id).toBe('p1');
  });

  it('GET /playlists → 200 with JWT', async () => {
    await request(app.getHttpServer())
      .get('/playlists')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /playlists/:id → 200 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/playlists/p1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.name).toBe('Chill');
  });

  it('DELETE /playlists/:id → 200 with JWT', async () => {
    await request(app.getHttpServer())
      .delete('/playlists/p1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
