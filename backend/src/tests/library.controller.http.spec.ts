import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LibraryController } from '../modules/library/library.controller';
import { LibraryService } from '../modules/library/library.service';
import { authToken, createControllerTestApp } from './e2e-helpers';

const mockLibraryService = {
  deleteTrack: jest.fn().mockResolvedValue({ id: 'track-1' }),
  deleteTracks: jest.fn().mockResolvedValue({ count: 2 }),
  clearLocalTracks: jest.fn().mockResolvedValue({ count: 1 }),
};

describe('LibraryController (HTTP)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(LibraryController, [
      { provide: LibraryService, useValue: mockLibraryService },
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
});
