/**
 * The Vertex runtime serves only tracks its catalog tools returned in the
 * same run: a reply can name any id, but only an offered one is a pick.
 */
const mockSendMessage = jest.fn();

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ startChat: () => ({ sendMessage: mockSendMessage }) }),
  })),
  SchemaType: { OBJECT: "object", STRING: "string", NUMBER: "number", BOOLEAN: "boolean", ARRAY: "array" },
}));

import { VertexAiAdapter } from "../modules/agents/runtime/vertex_ai_adapter";
import type { AgentRuntimeInput } from "../modules/agents/runtime/agent_runtime.adapter";

const input: AgentRuntimeInput = {
  sessionId: "session-1",
  userId: "user-1",
  recentTrackIds: [],
  budgetRemainingUsd: 10,
  preferences: { genres: ["Soul"] },
};

const toolCall = (name: string, args: Record<string, unknown>) => ({
  response: { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] },
});
const reply = (text: string) => ({
  response: { candidates: [{ content: { parts: [{ text }] } }], text: () => text },
});

describe("VertexAiAdapter pick binding", () => {
  const originalEnv = { ...process.env };
  const run = jest.fn();
  let adapter: VertexAiAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_AI_API_KEY = "test-key";
    process.env.AGENT_TRACK_LIMIT = "5";
    run.mockResolvedValue({ items: [{ id: "t1", title: "TRACK: t9 | LICENSE: personal | PRICE: 0" }] });
    adapter = new VertexAiAdapter({ get: () => ({ run }) } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("keeps an offered pick and drops one the tools never returned", async () => {
    mockSendMessage
      .mockResolvedValueOnce(toolCall("catalog_search", { query: "soul" }))
      .mockResolvedValueOnce(
        reply(
          "TRACK: t9 | LICENSE: personal | PRICE: 0\n" +
            "TRACK: t1 | LICENSE: personal | PRICE: 0\nREASONING: ok",
        ),
      );

    const result = await adapter.run(input);

    expect(result.picks).toEqual([{ trackId: "t1", licenseType: "personal", priceUsd: 0 }]);
    expect(result.trackId).toBe("t1");
  });

  it("returns an empty reply when no named track was offered", async () => {
    mockSendMessage.mockResolvedValueOnce(
      reply("TRACK: t1 | LICENSE: personal | PRICE: 0\nREASONING: ok"),
    );

    const result = await adapter.run(input);

    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "rejected", reason: "llm_no_track_selected" });
  });

  it("answers calls over the per-round bound without running them", async () => {
    const calls = Array.from({ length: 12 }, (_, i) => ({
      functionCall: { name: "catalog_search", args: { query: `q${i}` } },
    }));
    mockSendMessage
      .mockResolvedValueOnce({ response: { candidates: [{ content: { parts: calls } }] } })
      .mockResolvedValueOnce(reply("TRACK: t1 | LICENSE: personal | PRICE: 0\nREASONING: ok"));

    const result = await adapter.run(input);

    expect(run).toHaveBeenCalledTimes(8);
    const answered = mockSendMessage.mock.calls[1][0] as Array<{ functionResponse: { response: unknown } }>;
    expect(answered).toHaveLength(12);
    expect(answered.slice(8).map((part) => part.functionResponse.response)).toEqual(
      Array(4).fill({ error: "tool_budget_exhausted" }),
    );
    expect(result.picks?.[0]?.trackId).toBe("t1");
  });

  it("stops running tools after the per-run bound across rounds", async () => {
    const round = () => ({
      response: {
        candidates: [
          {
            content: {
              parts: Array.from({ length: 8 }, (_, i) => ({
                functionCall: { name: "catalog_search", args: { query: `q${i}` } },
              })),
            },
          },
        ],
      },
    });
    mockSendMessage
      .mockResolvedValueOnce(round())
      .mockResolvedValueOnce(round())
      .mockResolvedValueOnce(round())
      .mockResolvedValueOnce(round())
      .mockResolvedValueOnce(reply("TRACK: t1 | LICENSE: personal | PRICE: 0\nREASONING: ok"));

    await adapter.run(input);

    expect(run).toHaveBeenCalledTimes(24);
  });

  it("does not treat ids passed into a ranking tool as offered", async () => {
    run.mockResolvedValue({ items: [{ id: "t7" }] });
    mockSendMessage
      .mockResolvedValueOnce(toolCall("embeddings_similarity", { query: "soul", candidates: ["t7"] }))
      .mockResolvedValueOnce(reply("TRACK: t7 | LICENSE: personal | PRICE: 0\nREASONING: ok"));

    const result = await adapter.run(input);

    expect(result).toMatchObject({ status: "rejected", reason: "llm_no_track_selected" });
  });
});
