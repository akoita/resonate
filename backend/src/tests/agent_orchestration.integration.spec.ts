/**
 * Agent Orchestration — Integration Test (Testcontainers)
 *
 * Tests AgentOrchestrationService.selectNextTrack against real Postgres.
 * Seeds real User → Artist → Release → Track.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { AgentOrchestrationService } from '../modules/sessions/agent_orchestration.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `agor_${Date.now()}_`;

describe('AgentOrchestrationService (integration)', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'Agent Test Artist',
        payoutAddress: '0x' + 'A'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        title: 'Agent Test Release',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        title: 'Nebula Loop',
        releaseId: `${TEST_PREFIX}release`,
        position: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it('selects a track and returns price decision', async () => {
    const eventBus = new EventBus();
    const service = new AgentOrchestrationService(eventBus);
    const result = await service.selectNextTrack({
      sessionId: 'session-1',
      preferences: { licenseType: 'personal' },
    });

    expect(result.status).toBe('ok');
    expect(result.track?.id).toBe(`${TEST_PREFIX}track`);
    expect(result.priceUsd).toBeGreaterThan(0);
  });

  it('returns no_tracks when DB is filtered to zero results', async () => {
    const eventBus = new EventBus();
    const service = new AgentOrchestrationService(eventBus);
    const result = await service.selectNextTrack({
      sessionId: 'session-2',
      preferences: { genres: ['nonexistent_genre_xyz'] },
    });

    expect(result.status).toBe('no_tracks');
  });
});
