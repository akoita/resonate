/**
 * #2088: the LLM curator cannot change the session's explicit-content choice,
 * is told that catalog genres are free text, and has a semantic search tool.
 */
jest.mock("@google/adk", () => ({
  FunctionTool: class {
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options);
    }
  },
  LlmAgent: class {
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options);
    }
  },
}));

import { createCurationAgent, buildUserMessage } from "../modules/agents/runtime/adk_curation_agent";
import { VertexAiAdapter } from "../modules/agents/runtime/vertex_ai_adapter";
import { getToolDeclarations } from "../modules/agents/tools/tool_declarations";

const toolByName = (agent: any, name: string) => agent.tools.find((tool: any) => tool.name === name);

describe("AI DJ curator session controls (#2088)", () => {
  const registryWith = (run: jest.Mock) => ({ get: jest.fn().mockReturnValue({ run }) }) as any;

  it("keeps allowExplicit out of every model-visible tool schema", () => {
    const agent: any = createCurationAgent(registryWith(jest.fn()), { allowExplicit: false });
    for (const tool of agent.tools) {
      expect(Object.keys(tool.parameters.shape)).not.toContain("allowExplicit");
    }
    for (const declaration of getToolDeclarations()) {
      expect(Object.keys((declaration.parameters as any)?.properties ?? {})).not.toContain(
        "allowExplicit",
      );
    }
  });

  it("declares semantic_search on both runtimes", () => {
    const agent: any = createCurationAgent(registryWith(jest.fn()));
    expect(toolByName(agent, "semantic_search")).toBeDefined();
    expect(getToolDeclarations().map((d) => d.name)).toContain("semantic_search");
  });

  it.each([true, false])("forces allowExplicit=%s onto ADK catalog calls", async (allowExplicit) => {
    const run = jest.fn().mockResolvedValue({ items: [] });
    const registry = registryWith(run);
    const agent: any = createCurationAgent(registry, { allowExplicit, recentTrackIds: ["played-1"] });

    // Whatever the model passes, the session's choice wins.
    await toolByName(agent, "catalog_search").execute({ query: "house", allowExplicit: !allowExplicit });
    expect(registry.get).toHaveBeenLastCalledWith("catalog.search");
    expect(run).toHaveBeenLastCalledWith({ query: "house", allowExplicit });

    await toolByName(agent, "semantic_search").execute({ query: "world music", allowExplicit: !allowExplicit });
    expect(registry.get).toHaveBeenLastCalledWith("catalog.semantic_search");
    expect(run).toHaveBeenLastCalledWith({
      query: "world music",
      allowExplicit,
      excludeTrackIds: ["played-1"],
    });
  });

  it("defaults to no explicit tracks when no choice is supplied", async () => {
    const run = jest.fn().mockResolvedValue({ items: [] });
    const agent: any = createCurationAgent(registryWith(run));
    await toolByName(agent, "catalog_search").execute({ query: "house" });
    expect(run).toHaveBeenCalledWith({ query: "house", allowExplicit: false });
  });

  it("tells both prompts that genres are free text and to fill the selection target", () => {
    const adkPrompt: string = (createCurationAgent(registryWith(jest.fn())) as any).instruction;
    const vertexPrompt: string = (new VertexAiAdapter({} as any) as any).buildSystemPrompt({});
    for (const prompt of [adkPrompt, vertexPrompt]) {
      expect(prompt).toContain("free-text labels");
      expect(prompt).toContain("semantic_search");
      expect(prompt).toContain("full selection target");
      expect(prompt).not.toContain("Recommend only the strongest matching tracks");
    }
    expect(adkPrompt).toContain("Never generate audio");
  });

  it("no longer asks for fewer tracks just because the catalog looks sparse", () => {
    const message = buildUserMessage({
      sessionId: "s1",
      userId: "u1",
      recentTrackIds: [],
      budgetRemainingUsd: 0,
      preferences: {},
    });
    expect(message).not.toContain("If the catalog is sparse");
    expect(message).toContain("Fill the selection target");
  });
});
