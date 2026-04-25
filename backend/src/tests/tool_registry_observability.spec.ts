import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";

describe("tool registry observability", () => {
  const generationService = { createGeneration: jest.fn() } as any;

  it("traces successful tool calls", async () => {
    const observability = { traceToolCall: jest.fn() };
    const registry = new ToolRegistry(
      new EmbeddingService(),
      new EmbeddingStore(),
      generationService,
      observability as any
    );

    const result = await registry.get("pricing.quote").run({ licenseType: "remix" });

    expect(result).toEqual({ priceUsd: 0.06 });
    expect(observability.traceToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "pricing.quote",
        input: { licenseType: "remix" },
        output: { priceUsd: 0.06 },
        startedAt: expect.any(Date),
        endedAt: expect.any(Date),
      })
    );
  });

  it("traces failed custom tool calls before rethrowing", async () => {
    const observability = { traceToolCall: jest.fn() };
    const registry = new ToolRegistry(
      new EmbeddingService(),
      new EmbeddingStore(),
      generationService,
      observability as any
    );
    registry.register({
      name: "test.fail",
      run: async () => {
        throw new Error("boom");
      },
    });

    await expect(registry.get("test.fail").run({ ok: false })).rejects.toThrow("boom");
    expect(observability.traceToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "test.fail",
        input: { ok: false },
        error: expect.any(Error),
      })
    );
  });
});
