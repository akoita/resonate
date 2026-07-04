const fetchIdTokenMock = jest.fn().mockResolvedValue("test-id-token");
jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getIdTokenClient: jest.fn().mockResolvedValue({
      idTokenProvider: { fetchIdToken: fetchIdTokenMock },
    }),
  })),
}));

jest.mock("undici", () => ({
  fetch: (...args: unknown[]) =>
    (global.fetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { RemixWorkerPrewarmService } from "../modules/remix/remix-worker-prewarm.service";

function fakeResponse(options: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
  } as unknown as Response;
}

async function flushPrewarm(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("RemixWorkerPrewarmService", () => {
  const originalEnabled = process.env.REMIX_GENERATION_ENABLED;
  const originalKind = process.env.REMIX_GENERATION_PROVIDER_KIND;
  const originalWorkerUrl = process.env.REMIX_AUDIO_WORKER_URL;
  const originalAudioModel = process.env.REMIX_AUDIO_MODEL;
  const originalTtl = process.env.REMIX_WORKER_PREWARM_TTL_SECONDS;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.REMIX_GENERATION_ENABLED = "true";
    process.env.REMIX_GENERATION_PROVIDER_KIND = "audio-conditioned";
    process.env.REMIX_AUDIO_WORKER_URL = "http://audio-worker:8000";
    process.env.REMIX_WORKER_PREWARM_TTL_SECONDS = "600";
    delete process.env.REMIX_AUDIO_MODEL;
    fetchIdTokenMock.mockReset().mockResolvedValue("test-id-token");
    fetchMock = jest.fn().mockResolvedValue(fakeResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    restoreEnv("REMIX_GENERATION_ENABLED", originalEnabled);
    restoreEnv("REMIX_GENERATION_PROVIDER_KIND", originalKind);
    restoreEnv("REMIX_AUDIO_WORKER_URL", originalWorkerUrl);
    restoreEnv("REMIX_AUDIO_MODEL", originalAudioModel);
    restoreEnv("REMIX_WORKER_PREWARM_TTL_SECONDS", originalTtl);
  });

  it("no-ops when the audio-conditioned provider is not active and enabled", async () => {
    process.env.REMIX_GENERATION_PROVIDER_KIND = "lyria";
    const service = new RemixWorkerPrewarmService();

    service.prewarm();
    await flushPrewarm();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchIdTokenMock).not.toHaveBeenCalled();
  });

  it("debounces attempts by TTL and allows a later attempt", async () => {
    process.env.REMIX_WORKER_PREWARM_TTL_SECONDS = "1";
    const service = new RemixWorkerPrewarmService();
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(1_000);
    service.prewarm();
    await flushPrewarm();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1_500);
    service.prewarm();
    await flushPrewarm();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(2_001);
    service.prewarm();
    await flushPrewarm();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps at most one prewarm in flight", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const service = new RemixWorkerPrewarmService();

    service.prewarm();
    service.prewarm();
    await flushPrewarm();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(fakeResponse());
    await flushPrewarm();
  });

  it("attaches an identity token when one is mintable", async () => {
    const service = new RemixWorkerPrewarmService();

    service.prewarm();
    await flushPrewarm();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://audio-worker:8000/health");
    expect(init).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer test-id-token" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("calls unauthenticated when no identity token is mintable locally", async () => {
    fetchIdTokenMock.mockRejectedValueOnce(
      new Error("Could not load the default credentials"),
    );
    const service = new RemixWorkerPrewarmService();

    service.prewarm();
    await flushPrewarm();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({});
  });

  it("swallows fetch failures", async () => {
    fetchMock.mockRejectedValue(new Error("network unavailable"));
    const service = new RemixWorkerPrewarmService();

    expect(() => service.prewarm()).not.toThrow();
    await flushPrewarm();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
