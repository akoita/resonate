/**
 * The LLM runtimes are told what the listener described (#2037): moods and a
 * tempo range as plain lines, and nothing at all without them.
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

import { buildUserMessage } from "../modules/agents/runtime/adk_curation_agent";
import { VertexAiAdapter } from "../modules/agents/runtime/vertex_ai_adapter";
import type { AgentRuntimeInput } from "../modules/agents/runtime/agent_runtime.adapter";

function input(preferences: AgentRuntimeInput["preferences"]): AgentRuntimeInput {
  return {
    sessionId: "s1",
    userId: "u1",
    recentTrackIds: [],
    budgetRemainingUsd: 10,
    preferences,
  };
}

function vertexMessage(value: AgentRuntimeInput) {
  const adapter = new VertexAiAdapter({} as any);
  return (adapter as any).buildUserMessage(value) as string;
}

describe.each([
  ["adk", (value: AgentRuntimeInput) => buildUserMessage(value)],
  ["vertex", vertexMessage],
])("%s user message (#2037)", (_name, build) => {
  it("adds Moods and Tempo lines when the listener described them", () => {
    const message = build(
      input({
        genres: ["Deep House"],
        mood: "Dark",
        moods: ["Dark", "Moody"],
        energy: "high",
        tempoBpm: { min: 120, max: 125 },
      }),
    );
    expect(message).toContain("Moods: Dark, Moody");
    expect(message).toContain("Tempo: 120–125 BPM");
  });

  it("words one-sided tempo ranges", () => {
    expect(build(input({ tempoBpm: { min: null, max: 125 } }))).toContain("Tempo: under 125 BPM");
    expect(build(input({ tempoBpm: { min: 120, max: null } }))).toContain("Tempo: over 120 BPM");
  });

  it("is unchanged without them", () => {
    const message = build(input({ genres: ["Soul"], mood: "Chill", energy: "low" }));
    expect(message).not.toMatch(/Moods:|Tempo:/);
    expect(message).toContain("Mood: Chill");
  });

  it("names the genres this session asked for ahead of the broader Genres (#2075)", () => {
    const message = build(
      input({ genres: ["Soul", "Jazz", "Funk"], sessionGenres: ["Soul", "Jazz"] }),
    );
    expect(message).toContain("Requested genres (this session): Soul, Jazz");
    expect(message.indexOf("Requested genres (this session):")).toBeLessThan(
      message.indexOf("Genres: Soul, Jazz, Funk"),
    );
  });

  it("has no Requested genres line without session genres", () => {
    expect(build(input({ genres: ["Soul"] }))).not.toContain("Requested genres");
    expect(build(input({ genres: ["Soul"], sessionGenres: [] }))).not.toContain(
      "Requested genres",
    );
  });
});
