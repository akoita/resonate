/**
 * PublicPlaylistDiscoveryController — Unit + HTTP contract
 *
 * Serves the public catalog discovery feed at GET /catalog/playlists. Lives in
 * PlaylistModule (not CatalogModule) to avoid a module cycle; these tests pin
 * the route, its public access, and the limit-string → number coercion.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PublicPlaylistDiscoveryController } from '../modules/playlist/playlist.controller';
import { PlaylistService } from '../modules/playlist/playlist.service';
import { createControllerTestApp } from './e2e-helpers';

const mockPlaylistService = {
  listPublicPlaylists: jest.fn().mockResolvedValue([]),
};

function makeController() {
  return new PublicPlaylistDiscoveryController(mockPlaylistService as any);
}

beforeEach(() => jest.clearAllMocks());

describe('PublicPlaylistDiscoveryController (unit)', () => {
  it('passes undefined limit through (service applies its own default)', async () => {
    await makeController().listPublicPlaylists(undefined);
    expect(mockPlaylistService.listPublicPlaylists).toHaveBeenCalledWith({ limit: undefined });
  });

  it('parses a valid limit string to a number', async () => {
    await makeController().listPublicPlaylists('12');
    expect(mockPlaylistService.listPublicPlaylists).toHaveBeenCalledWith({ limit: 12 });
  });

  it('falls back to undefined for a NaN limit', async () => {
    await makeController().listPublicPlaylists('abc');
    expect(mockPlaylistService.listPublicPlaylists).toHaveBeenCalledWith({ limit: undefined });
  });
});

describe('PublicPlaylistDiscoveryController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(PublicPlaylistDiscoveryController, [
      { provide: PlaylistService, useValue: mockPlaylistService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /catalog/playlists → 200 (no auth required) and coerces the limit', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/playlists?limit=12')
      .expect(200);

    expect(res.body).toEqual([]);
    expect(mockPlaylistService.listPublicPlaylists).toHaveBeenCalledWith({ limit: 12 });
  });
});
