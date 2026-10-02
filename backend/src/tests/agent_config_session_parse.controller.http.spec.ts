/**
 * AgentConfigController POST /agents/config/session/parse (#2037) — HTTP contract:
 *   - Guard enforcement (401 without a JWT)
 *   - DTO validation (400 for a missing, oversize or whitespace-only text)
 *   - The parsed listening filters on 200
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AgentConfigController } from '../modules/agents/agent_config.controller';
import { AgentOrchestratorService } from '../modules/agents/agent_orchestrator.service';
import { AgentRuntimeService } from '../modules/agents/agent_runtime.service';
import { AgentIdentityService } from '../modules/agents/agent_identity.service';
import { AgentLearningService } from '../modules/agents/agent_learning.service';
import { AGENT_SESSION_REQUEST_PARSER } from '../modules/agents/agent_session_request';
import { EventBus } from '../modules/shared/event_bus';
import { defaultCrateFilters } from '../modules/crates/crate_filters';
import { createControllerTestApp, authToken } from './e2e-helpers';

const parser = {
  parse: jest.fn(),
};
const eventBus = { publish: jest.fn() };

describe('AgentConfigController session parse (e2e)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(AgentConfigController, [
      { provide: AgentOrchestratorService, useValue: {} },
      { provide: AgentRuntimeService, useValue: {} },
      { provide: AgentIdentityService, useValue: {} },
      { provide: AgentLearningService, useValue: {} },
      { provide: EventBus, useValue: eventBus },
      { provide: AGENT_SESSION_REQUEST_PARSER, useValue: parser },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    parser.parse.mockResolvedValue({
      filters: { ...defaultCrateFilters(), genres: ['Deep House'], bpm: { min: 120, max: 125 } },
      unparsed: [],
      strategy: 'deterministic',
    });
  });

  it('POST /agents/config/session/parse → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/agents/config/session/parse')
      .send({ text: 'deep house' })
      .expect(401);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('→ 200 with the listening filters', async () => {
    const res = await request(app.getHttpServer())
      .post('/agents/config/session/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'deep house, 120-125 bpm' })
      .expect(200);
    expect(res.body).toEqual({
      request: { genres: ['Deep House'], moods: [], energy: null, bpm: { min: 120, max: 125 } },
      unparsed: [],
      ignored: [],
      strategy: 'deterministic',
    });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('→ 400 when text is missing', async () => {
    await request(app.getHttpServer())
      .post('/agents/config/session/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('→ 400 when text is not a string', async () => {
    await request(app.getHttpServer())
      .post('/agents/config/session/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 42 })
      .expect(400);
  });

  it('→ 400 when text is longer than 500 characters', async () => {
    await request(app.getHttpServer())
      .post('/agents/config/session/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'a'.repeat(501) })
      .expect(400);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('→ 200 for text of exactly 500 characters', async () => {
    await request(app.getHttpServer())
      .post('/agents/config/session/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'a'.repeat(500) })
      .expect(200);
  });

  it('→ 400 when text is only whitespace', async () => {
    await request(app.getHttpServer())
      .post('/agents/config/session/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: '   \n\t ' })
      .expect(400);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('does not collide with the other session routes', async () => {
    await request(app.getHttpServer()).post('/agents/config/session/stop').expect(401);
    await request(app.getHttpServer()).post('/agents/config/session').expect(401);
  });
});
