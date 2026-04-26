import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  buildAgentRuntimeExecutionResponse,
  normalizeAgentRuntimeExecutionRequest,
} from "../modules/agents/agent_runtime.contract";
import { AgentRuntimeExecutorService } from "../modules/agents/agent_runtime.executor.service";
import { AgentRuntimeRemoteClient } from "../modules/agents/agent_runtime_remote.client";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { AgentRuntimeWorkerController } from "../modules/agents/agent_runtime_worker.controller";

const baseInput = {
  sessionId: "session-1",
  userId: "user-1",
  recentTrackIds: [],
  budgetRemainingUsd: 1,
  preferences: {},
};

describe("agent runtime worker contract", () => {
  it("accepts the envelope request shape", () => {
    const request = normalizeAgentRuntimeExecutionRequest({
      requestId: "req-1",
      input: baseInput,
    });

    expect(request.requestId).toBe("req-1");
    expect(request.input.sessionId).toBe("session-1");
  });

  it("accepts the legacy raw input shape", () => {
    const request = normalizeAgentRuntimeExecutionRequest(baseInput);

    expect(request.input.userId).toBe("user-1");
    expect(request.requestId).toBeTruthy();
  });

  it("rejects malformed runtime input", () => {
    expect(() =>
      normalizeAgentRuntimeExecutionRequest({ ...baseInput, recentTrackIds: "oops" })
    ).toThrow(BadRequestException);
  });

  it("wraps runtime results in a replayable response envelope", () => {
    const response = buildAgentRuntimeExecutionResponse(
      { requestId: "req-1", input: baseInput },
      { status: "approved", tracks: [] },
      Date.now()
    );

    expect(response).toMatchObject({
      status: "ok",
      requestId: "req-1",
      sessionId: "session-1",
      userId: "user-1",
      result: { status: "approved", tracks: [] },
    });
    expect(response.timingMs).toBeGreaterThanOrEqual(0);
  });
});

describe("AgentRuntimeService worker delegation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("uses the in-process executor when no worker URL is configured", async () => {
    delete process.env.AGENT_RUNTIME_WORKER_URL;
    const executor = { run: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }) };
    const service = new AgentRuntimeService(
      executor as unknown as AgentRuntimeExecutorService,
      new AgentRuntimeRemoteClient()
    );

    await expect(service.run(baseInput)).resolves.toMatchObject({ status: "approved" });
    expect(executor.run).toHaveBeenCalledWith(baseInput);
  });

  it("falls back to the executor when the optional worker fails", async () => {
    process.env.AGENT_RUNTIME_WORKER_URL = "http://worker.local";
    const executor = { run: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }) };
    const remote = {
      enabled: true,
      required: false,
      run: jest.fn().mockRejectedValue(new Error("offline")),
    };
    const service = new AgentRuntimeService(
      executor as unknown as AgentRuntimeExecutorService,
      remote as unknown as AgentRuntimeRemoteClient
    );

    await expect(service.run(baseInput)).resolves.toMatchObject({ status: "approved" });
    expect(remote.run).toHaveBeenCalledWith(baseInput);
    expect(executor.run).toHaveBeenCalledWith(baseInput);
  });

  it("propagates worker failures when the worker is required", async () => {
    const executor = { run: jest.fn() };
    const remote = {
      enabled: true,
      required: true,
      run: jest.fn().mockRejectedValue(new Error("offline")),
    };
    const service = new AgentRuntimeService(
      executor as unknown as AgentRuntimeExecutorService,
      remote as unknown as AgentRuntimeRemoteClient
    );

    await expect(service.run(baseInput)).rejects.toThrow("offline");
    expect(executor.run).not.toHaveBeenCalled();
  });
});

describe("AgentRuntimeWorkerController internal auth", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects mismatched internal service keys", async () => {
    process.env.INTERNAL_SERVICE_KEY = "expected";
    const controller = new AgentRuntimeWorkerController({
      run: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }),
    } as unknown as AgentRuntimeExecutorService);

    await expect(controller.execute({ input: baseInput }, "wrong")).rejects.toThrow(
      UnauthorizedException
    );
  });

  it("requires an internal service key in production", async () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    process.env.NODE_ENV = "production";
    const controller = new AgentRuntimeWorkerController({
      run: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }),
    } as unknown as AgentRuntimeExecutorService);

    await expect(controller.execute({ input: baseInput })).rejects.toThrow(
      InternalServerErrorException
    );
  });
});
