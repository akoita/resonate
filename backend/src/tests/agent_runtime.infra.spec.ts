/**
 * Agent Runtime — Integration Test (Testcontainers)
 *
 * Tests AgentRuntimeService against real Postgres.
 * Seeds tracks for selection. Google AI SDK mocks stay (external ESM packages).
 *
 * Run: npm run test:integration
 */

// ESM mocks must stay — external Google AI SDK packages
jest.mock('@google/genai', () => ({}));
jest.mock('@google/adk', () => ({
  InMemoryRunner: jest.fn().mockImplementation(() => ({
    runAsync: jest.fn().mockReturnValue((async function* () {})()),
  })),
  isFinalResponse: jest.fn().mockReturnValue(false),
  stringifyContent: jest.fn().mockReturnValue(''),
  FunctionTool: jest.fn().mockImplementation((opts: any) => opts),
  LlmAgent: jest.fn().mockImplementation((opts: any) => opts),
}));

import { prisma } from '../db/prisma';
import { AgentRuntimeService } from '../modules/agents/agent_runtime.service';
import { AdkAdapter } from '../modules/agents/runtime/adk_adapter';
import { LangGraphAdapter } from '../modules/agents/runtime/langgraph_adapter';
import { VertexAiAdapter } from '../modules/agents/runtime/vertex_ai_adapter';
import { ToolRegistry } from '../modules/agents/tools/tool_registry';
import { EmbeddingService } from '../modules/embeddings/embedding.service';
import { EmbeddingStore } from '../modules/embeddings/embedding.store';

const TEST_PREFIX = `agrt_${Date.now()}_`;

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: 'gen-mock-1' }),
} as any;

function makeInput(overrides: Record<string, any> = {}) {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    recentTrackIds: [],
    budgetRemainingUsd: 1,
    preferences: {},
    ...overrides,
  };
}

describe('AgentRuntimeService (integration)', () => {
  let tools: ToolRegistry;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, userId: `${TEST_PREFIX}user`, displayName: 'Runtime Artist', payoutAddress: '0x' + 'R'.repeat(40) },
    });
    await prisma.release.create({
      data: { id: `${TEST_PREFIX}release`, title: 'Runtime Release', artistId: `${TEST_PREFIX}artist`, status: 'published' },
    });
    await prisma.track.create({
      data: { id: `${TEST_PREFIX}track`, title: 'Pulse', releaseId: `${TEST_PREFIX}release`, position: 1 },
    });
  });

  afterAll(async () => {
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  beforeEach(() => {
    tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
  });

  it('falls back to orchestrator when mode is local', async () => {
    const orchestrator = {
      orchestrate: async () => ({ status: 'approved', tracks: [] }),
    } as any;
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(tools),
      new LangGraphAdapter(),
      new AdkAdapter(tools),
    );
    process.env.AGENT_RUNTIME = 'local';
    const result = await runtime.run(makeInput());
    expect(result.status).toBe('approved');
  });

  it('falls back to orchestrator when GOOGLE_AI_API_KEY is not set', async () => {
    const orchestrator = {
      orchestrate: async () => ({
        status: 'approved',
        tracks: [{ trackId: 't-orch', mixPlan: {}, negotiation: { priceUsd: 0.05, licenseType: 'personal' } }],
      }),
    } as any;
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(tools),
      new LangGraphAdapter(),
      new AdkAdapter(tools),
    );
    delete process.env.GOOGLE_AI_API_KEY;
    process.env.AGENT_RUNTIME = 'vertex';
    const result = await runtime.run(makeInput());
    expect(result.status).toBe('approved');
    expect('tracks' in result).toBe(true);
  });

  it('falls back to orchestrator when vertex adapter throws', async () => {
    const orchestrator = {
      orchestrate: async () => ({
        status: 'approved',
        tracks: [{ trackId: 't-1', mixPlan: {}, negotiation: {} }],
      }),
    } as any;
    const badAdapter = {
      name: 'vertex' as const,
      run: async () => { throw new Error('Network down'); },
    };
    const runtime = new AgentRuntimeService(
      orchestrator,
      badAdapter as any,
      new LangGraphAdapter(),
      new AdkAdapter(tools),
    );
    process.env.AGENT_RUNTIME = 'vertex';
    const result = await runtime.run(makeInput());
    expect(result.status).toBe('approved');
  });

  it('falls back to orchestrator when ADK adapter throws', async () => {
    const orchestrator = {
      orchestrate: async () => ({
        status: 'approved',
        tracks: [{ trackId: 't-1', mixPlan: {}, negotiation: {} }],
      }),
    } as any;
    const badAdkAdapter = {
      name: 'adk' as const,
      run: async () => { throw new Error('ADK error'); },
    };
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(tools),
      new LangGraphAdapter(),
      badAdkAdapter as any,
    );
    process.env.AGENT_RUNTIME = 'adk';
    const result = await runtime.run(makeInput());
    expect(result.status).toBe('approved');
  });
});

describe('VertexAiAdapter (integration)', () => {
  let tools: ToolRegistry;

  beforeEach(() => {
    tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
  });

  it('throws when GOOGLE_AI_API_KEY is not set', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const adapter = new VertexAiAdapter(tools);
    await expect(adapter.run(makeInput())).rejects.toThrow('GOOGLE_AI_API_KEY not configured');
  });
});

describe('AdkAdapter (integration)', () => {
  let tools: ToolRegistry;

  beforeEach(() => {
    tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
  });

  it('throws when GOOGLE_AI_API_KEY is not set', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const adapter = new AdkAdapter(tools);
    await expect(adapter.run(makeInput())).rejects.toThrow('GOOGLE_AI_API_KEY not configured');
  });
});
