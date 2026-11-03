import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LibraryController } from '../modules/library/library.controller';
import { LibraryService } from '../modules/library/library.service';
import { AlbumLookupService } from '../modules/library/album_lookup.service';
import { authToken, createControllerTestApp } from './e2e-helpers';

const mockLibraryService = {
  saveTrack: jest.fn().mockResolvedValue({ id: 'local_1' }),
  deleteTrack: jest.fn().mockResolvedValue({ id: 'track-1' }),
  deleteTracks: jest.fn().mockResolvedValue({ count: 2 }),
  clearLocalTracks: jest.fn().mockResolvedValue({ count: 1 }),
};

const mockAlbumLookup = {
  search: jest.fn().mockResolvedValue({ matches: [] }),
  details: jest.fn().mockResolvedValue({ id: 'r', year: 2021, genre: null, label: null, sourceUrl: 'u' }),
};

describe('LibraryController (HTTP)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(LibraryController, [
      { provide: LibraryService, useValue: mockLibraryService },
      { provide: AlbumLookupService, useValue: mockAlbumLookup },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('routes DELETE /library/tracks/batch to the batch handler', async () => {
    const res = await request(app.getHttpServer())
      .delete('/library/tracks/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ['track-1', 'track-2'] })
      .expect(200);

    expect(res.body).toEqual({ count: 2 });
    expect(mockLibraryService.deleteTracks).toHaveBeenCalledWith('user-1', ['track-1', 'track-2']);
    expect(mockLibraryService.deleteTrack).not.toHaveBeenCalled();
  });

  it('routes DELETE /library/tracks/local to the local-clear handler', async () => {
    const res = await request(app.getHttpServer())
      .delete('/library/tracks/local')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ count: 1 });
    expect(mockLibraryService.clearLocalTracks).toHaveBeenCalledWith('user-1');
    expect(mockLibraryService.deleteTrack).not.toHaveBeenCalled();
  });

  it('requires a known source on POST /library/tracks (#2505)', async () => {
    await request(app.getHttpServer())
      .post('/library/tracks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'No source' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/library/tracks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Odd source', source: 'release' })
      .expect(400);
    expect(mockLibraryService.saveTrack).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/library/tracks')
      .set('Authorization', `Bearer ${token}`)
      .send({ id: 'local_1', title: 'Song', source: 'local' })
      .expect(201);
    expect(mockLibraryService.saveTrack).toHaveBeenCalledWith('user-1', expect.objectContaining({ source: 'local' }));
  });

  it('routes the album lookup with only artist, album and track count (#2538)', async () => {
    await request(app.getHttpServer())
      .get('/library/lookup/releases')
      .query({ artist: 'Furax Barbarossa', album: 'Caravelle', tracks: '15' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mockAlbumLookup.search).toHaveBeenCalledWith({ artist: 'Furax Barbarossa', album: 'Caravelle', tracks: '15' });

    const id = '0f6c1b7a-1d2e-4f3a-9b8c-7d6e5f4a3b2c';
    await request(app.getHttpServer())
      .get(`/library/lookup/releases/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mockAlbumLookup.details).toHaveBeenCalledWith(id);
  });

  it('requires a signed-in listener for the album lookup', async () => {
    await request(app.getHttpServer()).get('/library/lookup/releases').query({ album: 'x' }).expect(401);
    expect(mockAlbumLookup.search).not.toHaveBeenCalled();
  });
});
