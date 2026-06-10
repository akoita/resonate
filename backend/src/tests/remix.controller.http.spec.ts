/**
 * RemixController — HTTP Contract Test
 *
 * Tests the HTTP contract:
 *   - Guard enforcement (401 on all remix routes)
 *   - Routing for eligibility, project CRUD, and legacy endpoints
 *   - Identity comes from the JWT, not the request body
 *   - HTTP status codes including policy/ownership errors
 */

import request from 'supertest';
import { ForbiddenException, INestApplication, NotFoundException } from '@nestjs/common';
import { RemixController } from '../modules/remix/remix.controller';
import { RemixService } from '../modules/remix/remix.service';
import { RemixEligibilityService } from '../modules/remix/remix-eligibility.service';
import { RemixProjectService } from '../modules/remix/remix-project.service';
import { RemixGenerationProviderError } from '../modules/remix/remix-generation.provider';
import { createControllerTestApp, authToken } from './e2e-helpers';

const mockRemixService = {
  createRemix: jest.fn().mockReturnValue({ remixId: 'rmx-1', status: 'submitted' }),
  getRemix: jest.fn().mockReturnValue({ remixId: 'rmx-1' }),
};

const mockEligibilityService = {
  checkEligibility: jest.fn().mockResolvedValue({
    allowed: true,
    requiredLicense: null,
    allowedActions: ['private_draft'],
    reasons: [],
    policyVersion: 'test.v1',
    source: { trackId: 'track-1', rightsRoute: 'STANDARD_ESCROW', contentStatus: 'clean' },
    stems: [],
  }),
};

const mockProjectService = {
  createProject: jest.fn().mockResolvedValue({ id: 'proj-1', status: 'draft' }),
  getProject: jest.fn().mockResolvedValue({ id: 'proj-1' }),
  listProjects: jest.fn().mockResolvedValue([]),
  updateProject: jest.fn().mockResolvedValue({ id: 'proj-1', title: 'Renamed' }),
  generateDraft: jest
    .fn()
    .mockResolvedValue({ id: 'proj-1', generationJobId: 'rmxgen_proj-1' }),
};

describe('RemixController (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(RemixController, [
      { provide: RemixService, useValue: mockRemixService },
      { provide: RemixEligibilityService, useValue: mockEligibilityService },
      { provide: RemixProjectService, useValue: mockProjectService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ----- Guard enforcement -----

  it('GET /remix/eligibility → 401 without JWT', async () => {
    await request(app.getHttpServer()).get('/remix/eligibility?trackId=t1').expect(401);
  });

  it('POST /remix/projects → 401 without JWT', async () => {
    await request(app.getHttpServer()).post('/remix/projects').send({}).expect(401);
  });

  it('GET /remix/projects/:id → 401 without JWT', async () => {
    await request(app.getHttpServer()).get('/remix/projects/proj-1').expect(401);
  });

  it('PATCH /remix/projects/:id → 401 without JWT', async () => {
    await request(app.getHttpServer()).patch('/remix/projects/proj-1').send({}).expect(401);
  });

  it('POST /remix/create → 401 without JWT', async () => {
    await request(app.getHttpServer()).post('/remix/create').send({}).expect(401);
  });

  // ----- Eligibility -----

  it('GET /remix/eligibility → 200 and passes JWT user + parsed stem ids', async () => {
    const res = await request(app.getHttpServer())
      .get('/remix/eligibility?trackId=track-1&stemIds=s1,%20s2,')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.allowed).toBe(true);
    expect(mockEligibilityService.checkEligibility).toHaveBeenCalledWith({
      userId: 'user-1',
      trackId: 'track-1',
      stemIds: ['s1', 's2'],
    });
  });

  it('GET /remix/eligibility → 400 without trackId', async () => {
    await request(app.getHttpServer())
      .get('/remix/eligibility')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(mockEligibilityService.checkEligibility).not.toHaveBeenCalled();
  });

  // ----- Projects -----

  it('POST /remix/projects → 201 and takes creator from JWT, not body', async () => {
    await request(app.getHttpServer())
      .post('/remix/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        userId: 'attacker',
        sourceTrackId: 'track-1',
        stemIds: ['s1'],
        title: 'Draft',
      })
      .expect(201);

    expect(mockProjectService.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', sourceTrackId: 'track-1' }),
    );
  });

  it('POST /remix/projects → 403 when policy denies', async () => {
    mockProjectService.createProject.mockRejectedValueOnce(
      new ForbiddenException({ message: 'denied', eligibility: { allowed: false } }),
    );
    const res = await request(app.getHttpServer())
      .post('/remix/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceTrackId: 'track-1', stemIds: ['s1'], title: 'Draft' })
      .expect(403);
    expect(res.body.eligibility).toEqual({ allowed: false });
  });

  it('GET /remix/projects → 200 owner-scoped list', async () => {
    await request(app.getHttpServer())
      .get('/remix/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mockProjectService.listProjects).toHaveBeenCalledWith('user-1');
  });

  it('GET /remix/projects/:id → 200 with JWT', async () => {
    await request(app.getHttpServer())
      .get('/remix/projects/proj-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mockProjectService.getProject).toHaveBeenCalledWith('user-1', 'proj-1');
  });

  it('GET /remix/projects/:id → 404 for missing projects', async () => {
    mockProjectService.getProject.mockRejectedValueOnce(new NotFoundException());
    await request(app.getHttpServer())
      .get('/remix/projects/missing')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /remix/projects/:id → 403 for non-owners', async () => {
    mockProjectService.getProject.mockRejectedValueOnce(new ForbiddenException());
    await request(app.getHttpServer())
      .get('/remix/projects/proj-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('PATCH /remix/projects/:id → 200 and routes patch to the service', async () => {
    await request(app.getHttpServer())
      .patch('/remix/projects/proj-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Renamed' })
      .expect(200);
    expect(mockProjectService.updateProject).toHaveBeenCalledWith('user-1', 'proj-1', {
      title: 'Renamed',
    });
  });

  // ----- Generation -----

  it('POST /remix/projects/:id/generate → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/remix/projects/proj-1/generate')
      .send({})
      .expect(401);
  });

  it('POST /remix/projects/:id/generate → 201 and routes options to the service', async () => {
    await request(app.getHttpServer())
      .post('/remix/projects/proj-1/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ constraints: { durationSeconds: 60 }, force: true })
      .expect(201);
    expect(mockProjectService.generateDraft).toHaveBeenCalledWith('user-1', 'proj-1', {
      constraints: { durationSeconds: 60 },
      force: true,
    });
  });

  it('POST /remix/projects/:id/generate → 503 with the normalized error contract when disabled', async () => {
    mockProjectService.generateDraft.mockRejectedValueOnce(
      new RemixGenerationProviderError(
        'provider_disabled',
        'AI remix generation is not enabled on this environment yet.',
        false,
      ),
    );
    const res = await request(app.getHttpServer())
      .post('/remix/projects/proj-1/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(503);
    expect(res.body).toEqual({
      code: 'provider_disabled',
      message: 'AI remix generation is not enabled on this environment yet.',
      retryable: false,
    });
  });

  it('POST /remix/projects/:id/generate → 422 for provider rejections', async () => {
    mockProjectService.generateDraft.mockRejectedValueOnce(
      new RemixGenerationProviderError('provider_rejected', 'Prompt rejected.', false),
    );
    await request(app.getHttpServer())
      .post('/remix/projects/proj-1/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(422);
  });

  // ----- Legacy compatibility -----

  it('POST /remix/create → 201 and ignores body creatorId in favor of JWT', async () => {
    await request(app.getHttpServer())
      .post('/remix/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        creatorId: 'attacker',
        sourceTrackId: 'track-1',
        stemIds: ['s1'],
        title: 'Legacy',
      })
      .expect(201);

    expect(mockRemixService.createRemix).toHaveBeenCalledWith(
      expect.objectContaining({ creatorId: 'user-1' }),
    );
  });

  it('GET /remix/:remixId → 200 with JWT (legacy read)', async () => {
    await request(app.getHttpServer())
      .get('/remix/rmx-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mockRemixService.getRemix).toHaveBeenCalledWith('rmx-1');
  });
});
