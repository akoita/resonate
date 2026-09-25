/**
 * Agent tool identity — unit test
 *
 * Model function calls (Vertex runtime) are untrusted: names and args can be
 * steered by catalog content. executeTool must only dispatch declared tools and
 * must bind identity server-side; generation tools must never take the artist
 * from tool input. GenerationService is mocked as the external boundary.
 */

import { executeTool } from "../modules/agents/tools/tool_declarations";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";

describe("agent tool identity", () => {
  const originalAgentArtist = process.env.AGENT_ARTIST_ID;
  let generationService: { createGeneration: jest.Mock };
  let registry: ToolRegistry;

  beforeEach(() => {
    delete process.env.AGENT_ARTIST_ID;
    generationService = {
      createGeneration: jest.fn().mockResolvedValue({ jobId: "job-1" }),
    };
    registry = new ToolRegistry({} as any, {} as any, generationService as any);
  });

  afterAll(() => {
    if (originalAgentArtist === undefined) {
      delete process.env.AGENT_ARTIST_ID;
    } else {
      process.env.AGENT_ARTIST_ID = originalAgentArtist;
    }
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
    expect(generationService.createGeneration).not.toHaveBeenCalled();
  });

  it("refuses names that only resemble a registry name", async () => {
    for (const name of ["catalog.search", "generation_complementary", "constructor", "__proto__"]) {
      await expect(
        executeTool(registry, { name, args: {} }, { userId: "session-user" }),
      ).resolves.toEqual({ error: "unknown_tool" });
    }
    expect(generationService.createGeneration).not.toHaveBeenCalled();
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
    expect(run).toHaveBeenCalledWith({ query: "house", userId: "session-user" });
  });

  it("generation.create attributes the release to the agent artist, not tool input", async () => {
    await registry.get("generation.create").run({
      userId: "u1",
      prompt: "p",
      artistId: "victim_artist",
    });

    expect(generationService.createGeneration).toHaveBeenCalledWith(
      { prompt: "p", negativePrompt: undefined, artistId: "agent" },
      "u1",
    );
  });

  it("generation.create uses AGENT_ARTIST_ID when configured", async () => {
    process.env.AGENT_ARTIST_ID = "platform-agent-artist";

    await registry.get("generation.create").run({
      userId: "u1",
      prompt: "p",
      artistId: "victim_artist",
    });

    expect(generationService.createGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ artistId: "platform-agent-artist" }),
      "u1",
    );
  });

  it("generation.complementary ignores artistId from tool input", async () => {
    await registry.get("generation.complementary").run({
      userId: "u1",
      context: "house",
      stemType: "bass",
      existingStems: ["drums"],
      artistId: "victim_artist",
    });

    expect(generationService.createGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ artistId: "agent" }),
      "u1",
    );
  });
});
