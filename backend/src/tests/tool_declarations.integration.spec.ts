/**
 * Tool Declarations — Integration Test (Testcontainers)
 *
 * Tests tool declarations and executeTool against real Postgres.
 * Seeds tracks for catalog_search. External AI services mocked.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { getToolDeclarations, executeTool } from '../modules/agents/tools/tool_declarations';
import { ToolRegistry } from '../modules/agents/tools/tool_registry';
import { EmbeddingService } from '../modules/embeddings/embedding.service';
import { EmbeddingStore } from '../modules/embeddings/embedding.store';

const TEST_PREFIX = `td_${Date.now()}_`;

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: 'gen-mock-1' }),
} as any;

describe('tool declarations (integration)', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, userId: `${TEST_PREFIX}user`, displayName: 'Tool Artist', payoutAddress: '0x' + 'A'.repeat(40) },
    });
    await prisma.release.create({
      data: { id: `${TEST_PREFIX}release`, title: 'Tool Album', artistId: `${TEST_PREFIX}artist`, status: 'published', genre: 'electronic' },
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

  it('returns function declarations for all 4 tools', () => {
    const declarations = getToolDeclarations();
    expect(declarations).toHaveLength(4);
    const names = declarations.map(d => d.name);
    expect(names).toContain('catalog_search');
    expect(names).toContain('pricing_quote');
    expect(names).toContain('analytics_signal');
    expect(names).toContain('embeddings_similarity');
  });

  it('each declaration has name, description, and parameters', () => {
    const declarations = getToolDeclarations();
    for (const decl of declarations) {
      expect(decl.name).toBeDefined();
      expect(decl.description).toBeDefined();
      expect(decl.description!.length).toBeGreaterThan(10);
      expect(decl.parameters).toBeDefined();
    }
  });

  it('executeTool dispatches catalog_search to catalog.search', async () => {
    const registry = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
    const result = await executeTool(registry, {
      name: 'catalog_search',
      args: { query: 'electronic', limit: 5 },
    });
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('executeTool dispatches pricing_quote to pricing.quote', async () => {
    const registry = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
    const result = await executeTool(registry, {
      name: 'pricing_quote',
      args: { licenseType: 'personal' },
    });
    expect(typeof result.priceUsd).toBe('number');
    expect(Number(result.priceUsd)).toBeGreaterThan(0);
  });

  it('executeTool throws on unknown tool', async () => {
    const registry = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
    await expect(
      executeTool(registry, { name: 'nonexistent_tool', args: {} }),
    ).rejects.toThrow('Tool not found');
  });
});
