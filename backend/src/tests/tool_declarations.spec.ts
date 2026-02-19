import { getToolDeclarations, executeTool } from "../modules/agents/tools/tool_declarations";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

jest.mock("../db/prisma", () => ({
  prisma: {
    track: {
      findMany: async () => [
        { id: "track-1", title: "Pulse", explicit: false, release: { title: "Album", genre: "electronic", artworkUrl: null } },
        { id: "track-2", title: "Glow", explicit: false, release: { title: "Album", genre: "lo-fi", artworkUrl: null } },
      ],
      findUnique: async () => null,
    },
  },
}));

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: "gen-mock-1" }),
} as any;

describe("tool declarations", () => {
  it("returns function declarations for all 4 tools", () => {
    const declarations = getToolDeclarations();
    expect(declarations).toHaveLength(4);
    const names = declarations.map((d) => d.name);
    expect(names).toContain("catalog_search");
    expect(names).toContain("pricing_quote");
    expect(names).toContain("analytics_signal");
    expect(names).toContain("embeddings_similarity");
  });

  it("each declaration has name, description, and parameters", () => {
    const declarations = getToolDeclarations();
    for (const decl of declarations) {
      expect(decl.name).toBeDefined();
      expect(decl.description).toBeDefined();
      expect(decl.description!.length).toBeGreaterThan(10);
      expect(decl.parameters).toBeDefined();
    }
  });

  it("executeTool dispatches catalog_search to catalog.search", async () => {
    const registry = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
    const result = await executeTool(registry, {
      name: "catalog_search",
      args: { query: "electronic", limit: 5 },
    });
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("executeTool dispatches pricing_quote to pricing.quote", async () => {
    const registry = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
    const result = await executeTool(registry, {
      name: "pricing_quote",
      args: { licenseType: "personal" },
    });
    expect(typeof result.priceUsd).toBe("number");
    expect(Number(result.priceUsd)).toBeGreaterThan(0);
  });

  it("executeTool throws on unknown tool", async () => {
    const registry = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
    await expect(
      executeTool(registry, { name: "nonexistent_tool", args: {} })
    ).rejects.toThrow("Tool not found");
  });
});
