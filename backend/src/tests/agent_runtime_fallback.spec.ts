/**
 * The LLM runtime -> deterministic fallback is observable (#2075): the executor
 * tells the orchestrator which runtime failed and why, as a category only.
 */
jest.mock("@google/genai", () => ({}));
jest.mock("@google/adk", () => ({
  InMemoryRunner: jest.fn(),
  isFinalResponse: jest.fn(),
  stringifyContent: jest.fn(),
  FunctionTool: jest.fn(),
  LlmAgent: jest.fn(),
}));

import { AgentRuntimeExecutorService } from "../modules/agents/agent_runtime.executor.service";
import { AgentRuntimeUnavailableError } from "../modules/agents/runtime/agent_runtime.errors";
import type { AgentRuntimeInput } from "../modules/agents/runtime/agent_runtime.adapter";

const input: AgentRuntimeInput = {
  sessionId: "session-1",
  userId: "user-1",
  recentTrackIds: [],
  budgetRemainingUsd: 0,
  preferences: { genres: ["soul"] },
};

describe("AgentRuntimeExecutorService fallback (#2075)", () => {
  const originalRuntime = process.env.AGENT_RUNTIME;
  const orchestrated = { status: "approved", tracks: [], shortfall: 0 };

  function build(adapterRun: jest.Mock) {
    const orchestrator = { orchestrate: jest.fn().mockResolvedValue(orchestrated) };
    const adapter = (name: string) => ({ name, run: adapterRun });
    const executor = new AgentRuntimeExecutorService(
      orchestrator as any,
      adapter("vertex") as any,
      adapter("langgraph") as any,
      adapter("adk") as any,
    );
    return { executor, orchestrator };
  }

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.AGENT_RUNTIME;
    else process.env.AGENT_RUNTIME = originalRuntime;
  });

  it("passes the categorical reason of an unavailable runtime", async () => {
    process.env.AGENT_RUNTIME = "adk";
    const { executor, orchestrator } = build(
      jest.fn().mockRejectedValue(new AgentRuntimeUnavailableError("not_configured", "no key")),
    );

    const result = await executor.run(input);

    expect(result).toBe(orchestrated);
    expect(orchestrator.orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1" }),
      { runtimeFallback: { from: "adk", reason: "not_configured" } },
    );
  });

  it("emits a categorical degraded.fallback event (#2076)", async () => {
    process.env.AGENT_RUNTIME = "adk";
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { executor } = build(
        jest.fn().mockRejectedValue(new AgentRuntimeUnavailableError("not_configured", "secret key detail")),
      );

      await executor.run(input);

      const events = info.mock.calls
        .map(([line]) => JSON.parse(String(line)))
        .filter((payload) => payload.event === "degraded.fallback");
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          severity: "WARNING",
          component: "agent_runtime.adk",
          reason: "not_configured",
          errorClass: "AgentRuntimeUnavailableError",
        }),
      );
      expect(JSON.stringify(events[0])).not.toContain("secret");
    } finally {
      info.mockRestore();
    }
  });

  it("records a timeout against the vertex runtime", async () => {
    process.env.AGENT_RUNTIME = "vertex";
    const { executor, orchestrator } = build(
      jest.fn().mockRejectedValue(new AgentRuntimeUnavailableError("timeout", "slow")),
    );

    await executor.run(input);

    expect(orchestrator.orchestrate).toHaveBeenCalledWith(expect.anything(), {
      runtimeFallback: { from: "vertex", reason: "timeout" },
    });
  });

  it("reports any other failure as error without leaking its text", async () => {
    process.env.AGENT_RUNTIME = "adk";
    const { executor, orchestrator } = build(
      jest.fn().mockRejectedValue(new Error("secret upstream detail")),
    );

    await executor.run(input);

    const options = orchestrator.orchestrate.mock.calls[0][1];
    expect(options).toEqual({ runtimeFallback: { from: "adk", reason: "error" } });
    expect(JSON.stringify(options)).not.toContain("secret");
  });

  it("is not a fallback when the runtime is configured as rules (local)", async () => {
    process.env.AGENT_RUNTIME = "local";
    const adapterRun = jest.fn();
    const { executor, orchestrator } = build(adapterRun);

    await executor.run(input);

    expect(adapterRun).not.toHaveBeenCalled();
    expect(orchestrator.orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrator.orchestrate.mock.calls[0]).toHaveLength(1);
  });

  it("passes nothing for the single-profile control", async () => {
    const { executor, orchestrator } = build(jest.fn());

    await executor.runWithSingleProfile(input);

    expect(orchestrator.orchestrate.mock.calls[0]).toHaveLength(1);
  });
});
