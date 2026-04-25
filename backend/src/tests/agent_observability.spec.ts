import { AgentObservabilityService } from "../modules/agents/agent_observability.service";

describe("agent observability", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.LANGFUSE_ENABLED;
    delete process.env.LANGFUSE_HOST;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_ENVIRONMENT;
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("stays disabled unless Langfuse env is complete", async () => {
    process.env.LANGFUSE_ENABLED = "true";
    const service = new AgentObservabilityService();

    await service.traceToolCall({
      toolName: "catalog.search",
      input: { query: "house" },
      output: { items: [] },
      startedAt: new Date("2026-04-25T00:00:00.000Z"),
      endedAt: new Date("2026-04-25T00:00:00.005Z"),
    });

    expect(service.isEnabled()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends redacted Langfuse ingestion events when configured", async () => {
    process.env.LANGFUSE_ENABLED = "true";
    process.env.LANGFUSE_HOST = "https://langfuse.test/";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_ENVIRONMENT = "Staging";
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 201 });
    const service = new AgentObservabilityService();

    await service.traceToolCall({
      toolName: "stem.download",
      input: { stemId: "stem-1", authorization: "Bearer secret" },
      output: { ok: true, token: "sensitive" },
      startedAt: new Date("2026-04-25T00:00:00.000Z"),
      endedAt: new Date("2026-04-25T00:00:00.010Z"),
    });

    expect(service.isEnabled()).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://langfuse.test/api/public/ingestion",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("pk-test:sk-test").toString("base64")}`,
        }),
      })
    );
    const [, request] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0].type).toBe("trace-create");
    expect(body.batch[1].type).toBe("span-create");
    expect(body.batch[1].body.input.authorization).toBe("[redacted]");
    expect(body.batch[1].body.output.token).toBe("[redacted]");
    expect(body.batch[1].body.environment).toBe("staging");
  });
});
