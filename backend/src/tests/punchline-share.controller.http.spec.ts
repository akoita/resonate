/**
 * PunchlineController — HTTP contract for the public share routes (#1477).
 *
 * Routing + the public (no-auth) contract of the moment/collectible share
 * endpoints, and that they do not shadow the sibling collect routes.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PunchlineController } from '../modules/punchline/punchline.controller';
import { PunchlineCollectService } from '../modules/punchline/punchline-collect.service';
import { PunchlineDropService } from '../modules/punchline/punchline-drop.service';
import { PunchlineX402Service } from '../modules/punchline/punchline-x402.service';
import { PunchlineEligibilityService } from '../modules/punchline/punchline-eligibility.service';
import { PunchlineMetricsService } from '../modules/punchline/punchline-metrics.service';
import { PunchlineUnlockService } from '../modules/punchline/punchline-unlock.service';
import { createControllerTestApp } from './e2e-helpers';

const mockDropService = {
  getPublicMomentShare: jest.fn().mockResolvedValue({
    moment: { id: 'm1', title: 'Hook' },
    drop: { id: 'd1', title: 'Drop' },
    track: { id: 't1', title: 'Track' },
    release: { id: 'r1', title: 'Rel', artworkMimeType: null },
    artistName: 'Artist',
  }),
  getPublicCollectibleShare: jest.fn().mockResolvedValue({
    moment: { id: 'm1', title: 'Hook' },
    drop: { id: 'd1', title: 'Drop' },
    track: { id: 't1', title: 'Track' },
    release: { id: 'r1', title: 'Rel', artworkMimeType: null },
    artistName: 'Artist',
    edition: { editionNumber: 3, collectorDisplayName: 'Fan', acquiredAt: null },
  }),
};

const mockQuote = { buildMomentQuote: jest.fn().mockResolvedValue({ ok: true }) };

describe('PunchlineController public share routes (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(PunchlineController, [
      { provide: PunchlineDropService, useValue: mockDropService },
      { provide: PunchlineCollectService, useValue: {} },
      { provide: PunchlineX402Service, useValue: mockQuote },
      { provide: PunchlineEligibilityService, useValue: {} },
      { provide: PunchlineMetricsService, useValue: {} },
      { provide: PunchlineUnlockService, useValue: {} },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('GET /punchline/moments/:id/public → 200 without auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/punchline/moments/m1/public')
      .expect(200);
    expect(mockDropService.getPublicMomentShare).toHaveBeenCalledWith('m1');
    expect(res.body.moment.id).toBe('m1');
    expect(res.body.artistName).toBe('Artist');
  });

  it('GET /punchline/collectibles/:id/public → 200 with edition block', async () => {
    const res = await request(app.getHttpServer())
      .get('/punchline/collectibles/col1/public')
      .expect(200);
    expect(mockDropService.getPublicCollectibleShare).toHaveBeenCalledWith('col1');
    expect(res.body.edition.editionNumber).toBe(3);
  });

  it('does not shadow GET /punchline/moments/:id/collect/quote', async () => {
    await request(app.getHttpServer())
      .get('/punchline/moments/m1/collect/quote')
      .expect(200);
    expect(mockQuote.buildMomentQuote).toHaveBeenCalledWith('m1');
    expect(mockDropService.getPublicMomentShare).not.toHaveBeenCalled();
  });
});
