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
import { resolveListeningLanes } from "../modules/agents/listening_lanes.service";

jest.mock("../modules/agents/listening_lanes.service", () => ({
  resolveListeningLanes: jest.fn(),
}));

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

  it("strips a caller-supplied internal plan when My Mix is absent", async () => {
    delete process.env.AGENT_RUNTIME_WORKER_URL;
    const executor = { run: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }) };
    const service = new AgentRuntimeService(
      executor as unknown as AgentRuntimeExecutorService,
      new AgentRuntimeRemoteClient(),
    );
    const forged = { ...baseInput, myMixPlan: { lanes: [{ id: "attacker", label: "Private" }] } } as any;

    await service.run(forged);

    expect(executor.run).toHaveBeenCalledWith(baseInput);
  });

  it("resolves My Mix again and bypasses a configured remote worker", async () => {
    const lane = {
      id: "lane_soul",
      label: "Soul · Warm",
      genreWeights: { Soul: 2 },
      moodWeights: { Warm: 1 },
      strength: 2,
      contexts: {},
      energyBand: null,
    };
    (resolveListeningLanes as jest.Mock).mockResolvedValue([lane]);
    const executor = {
      run: jest.fn(),
      runWithMyMix: jest.fn().mockResolvedValue({
        status: "approved",
        tracks: [],
        mixCoverage: { lanes: [{ id: "lane_soul", label: "Soul · Warm", requested: 5, matched: 0 }] },
      }),
    };
    const remote = {
      enabled: true,
      required: true,
      run: jest.fn(),
    };
    const service = new AgentRuntimeService(
      executor as unknown as AgentRuntimeExecutorService,
      remote as unknown as AgentRuntimeRemoteClient,
    );
    const input = {
      ...baseInput,
      preferences: { myMix: { lanes: [{ id: "lane_soul" }] } },
      myMixPlan: { lanes: [{ id: "attacker", label: "Forged" }] },
    } as any;

    await expect(service.run(input)).resolves.toMatchObject({ status: "approved" });

    expect(remote.run).not.toHaveBeenCalled();
    expect(executor.run).not.toHaveBeenCalled();
    expect(executor.runWithMyMix).toHaveBeenCalledWith(
      baseInput,
      expect.objectContaining({ lanes: [expect.objectContaining({ id: "lane_soul", requested: 5 })] }),
    );
    expect(service.takeMyMixDemandObservations("user-1", "session-1")).toEqual([
      expect.objectContaining({ laneId: "lane_soul", genres: ["Soul"], moods: [], requested: 5 }),
    ]);
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

describe("AgentRuntimeExecutorService My Mix boundary", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it("drops forged top-level plans when the wire preferences omit My Mix", async () => {
    process.env.AGENT_RUNTIME = "adk";
    const orchestrator = { orchestrate: jest.fn() };
    const adk = { name: "adk", run: jest.fn().mockResolvedValue({ status: "approved" }) };
    const executor = new AgentRuntimeExecutorService(
      orchestrator as any,
      {} as any,
      {} as any,
      adk as any,
    );
    const forged = { ...baseInput, myMixPlan: { lanes: [{ id: "attacker" }] } } as any;

    await executor.run(forged);

    expect(adk.run).toHaveBeenCalledWith(baseInput);
  });

  it("uses a fresh server-resolved plan on the direct worker executor path", async () => {
    process.env.AGENT_RUNTIME = "adk";
    (resolveListeningLanes as jest.Mock).mockResolvedValue([{
      id: "lane_soul",
      label: "Soul · Warm",
      genreWeights: { Soul: 2 },
      moodWeights: { Warm: 1 },
      strength: 2,
      contexts: {},
      energyBand: null,
    }]);
    const orchestrator = { orchestrate: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }) };
    const adk = { name: "adk", run: jest.fn() };
    const executor = new AgentRuntimeExecutorService(
      orchestrator as any,
      {} as any,
      {} as any,
      adk as any,
    );

    await executor.run({
      ...baseInput,
      preferences: { myMix: { lanes: [{ id: "lane_soul" }] } },
      myMixPlan: { lanes: [{ id: "attacker" }] },
    } as any);

    expect(adk.run).not.toHaveBeenCalled();
    expect(orchestrator.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      ...baseInput,
      myMixPlan: expect.objectContaining({ lanes: [expect.objectContaining({ id: "lane_soul" })] }),
    }));
    expect(orchestrator.orchestrate.mock.calls[0][0]).not.toHaveProperty("myMixPlan.lanes[0].id", "attacker");
  });
});
