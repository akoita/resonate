/**
 * The ADK runtime creates the session it runs in (#2075): Runner.runAsync
 * throws "Session not found" for a session the fresh runner has never seen.
 */
const mockGetSession = jest.fn();
const mockCreateSession = jest.fn();
const mockRunAsync = jest.fn();
let mockEvents: Array<{ final: boolean; text: string }> = [];

jest.mock("@google/genai", () => ({}));
jest.mock("@google/adk", () => ({
  InMemoryRunner: jest.fn().mockImplementation(() => ({
    sessionService: {
      getSession: mockGetSession,
      createSession: mockCreateSession,
    },
    runAsync: mockRunAsync,
  })),
  isFinalResponse: (event: { final: boolean }) => event.final,
  stringifyContent: (event: { text: string }) => event.text,
  FunctionTool: jest.fn().mockImplementation((opts: any) => opts),
  LlmAgent: jest.fn().mockImplementation((opts: any) => opts),
}));

import { AdkAdapter } from "../modules/agents/runtime/adk_adapter";
import { AgentRuntimeUnavailableError } from "../modules/agents/runtime/agent_runtime.errors";
import type { AgentRuntimeInput } from "../modules/agents/runtime/agent_runtime.adapter";

const input: AgentRuntimeInput = {
  sessionId: "session-1",
  userId: "user-1",
  recentTrackIds: [],
  budgetRemainingUsd: 10,
  preferences: { genres: ["Soul"] },
};

function finalReply(text: string) {
  mockEvents = [
    { final: false, text: "TRACK: ignored | LICENSE: personal | PRICE: $9" },
    { final: true, text },
  ];
}

describe("AdkAdapter (#2075)", () => {
  const originalEnv = { ...process.env };
  let adapter: AdkAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_AI_API_KEY = "test-key";
    process.env.AGENT_TRACK_LIMIT = "5";
    mockGetSession.mockResolvedValue(undefined);
    mockCreateSession.mockResolvedValue({});
    mockRunAsync.mockImplementation(async function* () {
      for (const event of mockEvents) yield { author: "agent", ...event };
    });
    finalReply("TRACK: t1 | LICENSE: personal | PRICE: $0\nREASONING: ok");
    adapter = new AdkAdapter({ get: () => ({ run: jest.fn() }) } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("creates the session before running the agent", async () => {
    await adapter.run(input);

    const key = { appName: "resonate", userId: "user-1", sessionId: "session-1" };
    expect(mockGetSession).toHaveBeenCalledWith(key);
    expect(mockCreateSession).toHaveBeenCalledWith(key);
    expect(mockCreateSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunAsync.mock.invocationCallOrder[0],
    );
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", sessionId: "session-1" }),
    );
  });

  it("does not recreate a session that already exists", async () => {
    mockGetSession.mockResolvedValue({ id: "session-1" });

    await adapter.run(input);

    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
  });

  it("parses the final reply into ranked picks and reasoning", async () => {
    finalReply(
      "TRACK: t1 | LICENSE: personal | PRICE: $0\n" +
        "TRACK: t2 | LICENSE: remix | PRICE: 1.5\n" +
        "REASONING: Warm soul for the evening",
    );

    const result = await adapter.run(input);

    expect(result).toMatchObject({
      status: "approved",
      reason: "adk_llm",
      trackId: "t1",
      reasoning: "Warm soul for the evening",
      picks: [
        { trackId: "t1", licenseType: "personal", priceUsd: 0 },
        { trackId: "t2", licenseType: "remix", priceUsd: 1.5 },
      ],
    });
  });

  it("rejects a reply without any TRACK line", async () => {
    finalReply("Sorry, nothing in the catalog fits.");

    const result = await adapter.run(input);

    expect(result).toMatchObject({
      status: "rejected",
      reason: "llm_no_track_selected",
    });
  });

  it("reports a missing API key as not configured", async () => {
    delete process.env.GOOGLE_AI_API_KEY;

    const error = await adapter.run(input).catch((e) => e);

    expect(error).toBeInstanceOf(AgentRuntimeUnavailableError);
    expect(error.reason).toBe("not_configured");
    expect(error.message).toBe("GOOGLE_AI_API_KEY not configured");
  });

  it("rejects without running when the session cannot be created", async () => {
    mockCreateSession.mockRejectedValue(new Error("session store down"));

    await expect(adapter.run(input)).rejects.toThrow("session store down");
    expect(mockRunAsync).not.toHaveBeenCalled();
  });
});
