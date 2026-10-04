/**
 * Agent tool identity — unit test
 *
 * Model function calls (Vertex runtime) are untrusted: names and args can be
 * steered by catalog content. executeTool must only dispatch declared tools and
 * must bind identity server-side. Agents never generate audio (ADR-TE-4), so
 * generation tools must be unreachable by name, declared or not.
 */

import { executeTool } from "../modules/agents/tools/tool_declarations";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";

describe("agent tool identity", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry({} as any, {} as any);
  });

  it("refuses undeclared tool names such as generation_create", async () => {
    const result = await executeTool(
      registry,
      {
        name: "generation_create",
        args: { userId: "victim", artistId: "victim_artist", prompt: "p" },
      },
      { userId: "session-user" },
    );

    expect(result).toEqual({ error: "unknown_tool" });
  });

  it("refuses names that only resemble a registry name", async () => {
    for (const name of ["catalog.search", "generation_complementary", "constructor", "__proto__"]) {
      await expect(
        executeTool(registry, { name, args: {} }, { userId: "session-user" }),
      ).resolves.toEqual({ error: "unknown_tool" });
    }
  });

  it("runs declared tools with the session user, ignoring model-supplied identity", async () => {
    const run = jest.fn().mockResolvedValue({ items: [] });
    const get = jest.spyOn(registry, "get").mockReturnValue({ name: "catalog.search", run });

    await executeTool(
      registry,
      {
        name: "catalog_search",
        args: { query: "house", userId: "victim", artistId: "victim_artist" },
      },
      { userId: "session-user" },
    );

    expect(get).toHaveBeenCalledWith("catalog.search");
    expect(run).toHaveBeenCalledWith({
      query: "house",
      allowExplicit: false,
      userId: "session-user",
    });
  });

  it("forces the session's explicit choice and played tracks onto catalog tools", async () => {
    const run = jest.fn().mockResolvedValue({ items: [] });
    const get = jest.spyOn(registry, "get").mockReturnValue({ name: "x", run });

    await executeTool(
      registry,
      { name: "catalog_search", args: { query: "house", allowExplicit: true } },
      { userId: "session-user", allowExplicit: false },
    );
    expect(run).toHaveBeenLastCalledWith({
      query: "house",
      allowExplicit: false,
      userId: "session-user",
    });

    await executeTool(
      registry,
      {
        name: "semantic_search",
        args: { query: "world music", allowExplicit: true, excludeTrackIds: ["steered"] },
      },
      { userId: "session-user", allowExplicit: true, recentTrackIds: ["played-1"] },
    );
    expect(get).toHaveBeenLastCalledWith("catalog.semantic_search");
    expect(run).toHaveBeenLastCalledWith({
      query: "world music",
      allowExplicit: true,
      excludeTrackIds: ["played-1"],
      userId: "session-user",
    });
  });

  it("does not add session-owned fields to non-catalog tools", async () => {
    const run = jest.fn().mockResolvedValue({ priceUsd: 0.02 });
    jest.spyOn(registry, "get").mockReturnValue({ name: "pricing.quote", run });
    await executeTool(
      registry,
      { name: "pricing_quote", args: { licenseType: "personal" } },
      { userId: "session-user", allowExplicit: true },
    );
    expect(run).toHaveBeenCalledWith({ licenseType: "personal", userId: "session-user" });
  });

  it("exposes no generation tools in the registry", () => {
    expect(() => registry.get("generation.create")).toThrow("Tool not found");
    expect(() => registry.get("generation.complementary")).toThrow("Tool not found");
  });
});
