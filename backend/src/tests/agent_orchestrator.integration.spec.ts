/**
 * Agent Orchestrator — Integration Test (Testcontainers)
 *
 * Tests AgentOrchestratorService against real Postgres.
 * Seeds User → Artist → Release → Tracks. External AI services mocked.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { AgentMixerService } from '../modules/agents/agent_mixer.service';
import { AgentNegotiatorService } from '../modules/agents/agent_negotiator.service';
import { AgentOrchestratorService } from '../modules/agents/agent_orchestrator.service';
import { AgentSelectorService } from '../modules/agents/agent_selector.service';
import { ToolRegistry } from '../modules/agents/tools/tool_registry';
import { EmbeddingService } from '../modules/embeddings/embedding.service';
import { EmbeddingStore } from '../modules/embeddings/embedding.store';

const TEST_PREFIX = `agorc_${Date.now()}_`;

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: 'gen-mock-1' }),
} as any;

describe('AgentOrchestratorService (integration)', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, userId: `${TEST_PREFIX}user`, displayName: 'Orch Artist', payoutAddress: '0x' + 'A'.repeat(40) },
    });
    await prisma.release.create({
      data: { id: `${TEST_PREFIX}release`, title: 'Orch Release', artistId: `${TEST_PREFIX}artist`, status: 'published' },
    });
    await prisma.track.createMany({
      data: [
        { id: `${TEST_PREFIX}track1`, title: 'Pulse', releaseId: `${TEST_PREFIX}release`, position: 1 },
        { id: `${TEST_PREFIX}track2`, title: 'Glow', releaseId: `${TEST_PREFIX}release`, position: 2 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it('orchestrates selection, mix, negotiation', async () => {
    const tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
    const orchestrator = new AgentOrchestratorService(
      new AgentSelectorService(tools),
      new AgentMixerService(mockGenerationService),
      new AgentNegotiatorService(tools),
      new EventBus(),
      mockGenerationService,
    );
    const result = await orchestrator.orchestrate({
      sessionId: 'session-1',
      userId: 'user-1',
      recentTrackIds: [],
      budgetRemainingUsd: 1,
      preferences: {},
    });

    expect(result.status).toBe('approved');
    expect(result.tracks.length).toBeGreaterThan(0);
    expect(result.tracks[0].mixPlan?.transition).toBeDefined();
  });
});
