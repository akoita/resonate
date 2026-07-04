// The deployed worker is IAM-protected Cloud Run: the provider mints an
// identity token per call. Mocked per the testing standards (google-auth
// is an allowed mock); fetchIdTokenMock is switchable per test.
const fetchIdTokenMock = jest.fn().mockResolvedValue("test-id-token");
jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getIdTokenClient: jest.fn().mockResolvedValue({
      idTokenProvider: { fetchIdToken: fetchIdTokenMock },
    }),
  })),
}));

// The provider calls the worker through undici (its dedicated dispatcher
// disables the 300s default headers timeout that killed cold starts).
// Route it to the test's global fetch mock.
jest.mock("undici", () => ({
  Agent: jest.fn().mockImplementation(() => ({})),
  FormData: global.FormData,
  fetch: (...args: unknown[]) =>
    (global.fetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { AudioConditionedRemixGenerationProvider } from "../modules/remix/audio-conditioned-remix-generation.provider";
import {
  RemixGenerationProviderError,
  type RemixGenerationInput,
} from "../modules/remix/remix-generation.provider";
import type { StemAudioMixer } from "../modules/remix/stem-audio-mixer";
import { REMIX_POLICY_VERSION } from "../modules/remix/remix-eligibility.policy";
import type { StorageProvider } from "../modules/storage/storage_provider";

function generationInput(
  overrides: Partial<RemixGenerationInput> = {},
): RemixGenerationInput {
  return {
    sourceTrackId: "track-1",
    stemIds: ["stem-1"],
    mode: "variation",
    prompt: "add a heavy four-on-the-floor techno kick",
    constraints: {},
    stemArrangement: [{ stemId: "stem-1", gainDb: 0, muted: false }],
    provenance: {
      remixProjectId: "project-1",
      creatorUserId: "user-1",
      licenseType: "remix",
      licenseId: "purchase-1",
      sourceRightsRoute: "STANDARD_ESCROW",
      sourceContentStatus: "clean",
      sourcePolicyVersion: REMIX_POLICY_VERSION,
      voiceLikenessAllowed: false,
    },
    ...overrides,
  };
}

function fakeResponse(options: {
  ok?: boolean;
  status?: number;
  body?: Buffer;
  headers?: Record<string, string>;
}): Response {
  const { ok = true, status = 200, body = Buffer.from("wav-bytes") } = options;
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok,
    status,
    headers: { get: (key: string) => headers.get(key.toLowerCase()) ?? null },
    arrayBuffer: async () => {
      const view = new Uint8Array(body);
      return view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength,
      );
    },
    text: async () => body.toString(),
  } as unknown as Response;
}

function buildProvider(options: {
  mix?: jest.Mock;
  upload?: jest.Mock;
} = {}) {
  const mix =
    options.mix ??
    jest.fn().mockResolvedValue({
      buffer: Buffer.from("mixed-stems"),
      mimeType: "audio/mpeg",
      stemCount: 2,
    });
  const upload =
    options.upload ??
    jest
      .fn()
      .mockResolvedValue({ uri: "gs://stems/remix-drafts/x.wav", provider: "gcs" });
  const provider = new AudioConditionedRemixGenerationProvider(
    { mixUnmutedStems: mix } as unknown as StemAudioMixer,
    { upload } as unknown as StorageProvider,
  );
  return { provider, mix, upload };
}

describe("AudioConditionedRemixGenerationProvider (#1182 slice 4)", () => {
  const originalEnabled = process.env.REMIX_GENERATION_ENABLED;
  const originalWorkerUrl = process.env.REMIX_AUDIO_WORKER_URL;
  // Worker-time render grant (#1214): the provider forwards it to the mixer.
  const AUTH = {
    userId: "user-1",
    remixProjectId: "project-1",
    authorizedStemIds: new Set(["stem-1"]),
  };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.REMIX_GENERATION_ENABLED = "true";
    process.env.REMIX_AUDIO_WORKER_URL = "http://audio-worker:8000";
    fetchMock = jest.fn().mockResolvedValue(
      fakeResponse({
        body: Buffer.from("generated-wav"),
        headers: {
          "content-type": "audio/wav",
          "x-seed": "1189",
          "x-sample-rate": "44100",
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalEnabled === undefined)
      delete process.env.REMIX_GENERATION_ENABLED;
    else process.env.REMIX_GENERATION_ENABLED = originalEnabled;
    if (originalWorkerUrl === undefined)
      delete process.env.REMIX_AUDIO_WORKER_URL;
    else process.env.REMIX_AUDIO_WORKER_URL = originalWorkerUrl;
  });

  it("stays behind the master gate", async () => {
    process.env.REMIX_GENERATION_ENABLED = "false";
    const { provider, mix } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput(), AUTH),
    ).rejects.toMatchObject({ code: "provider_disabled", retryable: false });
    expect(mix).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects stem_mix mode before any work", async () => {
    const { provider, mix } = buildProvider();
    await expect(
      provider.createRemixDraft(
        generationInput({ mode: "stem_mix", prompt: undefined }),
        AUTH,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mix).not.toHaveBeenCalled();
  });

  it("rejects a missing prompt", async () => {
    const { provider } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput({ prompt: "   " }), AUTH),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects when no stem arrangement is provided to condition on", async () => {
    const { provider, mix } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput({ stemArrangement: [] }), AUTH),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mix).not.toHaveBeenCalled();
  });

  it("mixes the arrangement, calls the worker, stores, and returns job metadata", async () => {
    const { provider, mix, upload } = buildProvider();
    const job = await provider.createRemixDraft(
      generationInput({ constraints: { durationSeconds: 60 } }),
      AUTH,
    );

    // Conditions on the project's arrangement, forwarding the render grant.
    expect(mix).toHaveBeenCalledWith(
      [{ stemId: "stem-1", gainDb: 0, muted: false }],
      AUTH,
    );

    // Calls the worker's /generate with the spike defaults + the prompt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://audio-worker:8000/generate");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("prompt")).toContain("techno kick");
    expect(form.get("cfg_scale")).toBe("7");
    expect(form.get("init_noise_level")).toBe("0.2");
    expect(form.get("steps")).toBe("25");
    expect(form.get("duration")).toBe("60");
    expect(form.get("model")).toBe("medium");

    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^remix-draft-project-1-.+\.wav$/),
      "audio/wav",
    );

    expect(job.provider).toBe("stable-audio-3-medium");
    expect(job.estimatedCostUsd).toBeCloseTo(0.12); // 60s = two 30s units
    expect(job.outputMetadata).toEqual({
      outputUri: "gs://stems/remix-drafts/x.wav",
      mimeType: "audio/wav",
      synthIdPresent: false,
      seed: 1189,
      sampleRate: 44100,
    });
  });

  it("propagates the mixer's encrypted-stem deferral", async () => {
    const mix = jest
      .fn()
      .mockRejectedValue(
        new RemixGenerationProviderError(
          "invalid_input",
          "Encrypted stems cannot be rendered yet.",
          false,
        ),
      );
    const { provider } = buildProvider({ mix });
    await expect(
      provider.createRemixDraft(generationInput(), AUTH),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a worker 4xx to a non-retryable provider_rejected", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 422, body: Buffer.from("bad prompt") }),
    );
    const { provider, upload } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput(), AUTH),
    ).rejects.toMatchObject({ code: "provider_rejected", retryable: false });
    expect(upload).not.toHaveBeenCalled();
  });

  it("maps a worker 5xx to a retryable provider_unavailable", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 503, body: Buffer.from("overloaded") }),
    );
    const { provider } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput(), AUTH),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("attaches an identity token for the IAM-protected worker", async () => {
    const { provider } = buildProvider();
    await provider.createRemixDraft(generationInput(), AUTH);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-id-token",
    });
  });

  it("calls unauthenticated when no identity token is mintable (local dev)", async () => {
    fetchIdTokenMock.mockRejectedValueOnce(
      new Error("Could not load the default credentials"),
    );
    const { provider } = buildProvider();
    await provider.createRemixDraft(generationInput(), AUTH);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({});
  });

  it("maps a worker 403 (auth/config fault) to provider_unavailable, not a prompt rejection", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 403,
        body: Buffer.from("The request was not authenticated."),
      }),
    );
    const { provider } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput(), AUTH),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("maps a network/timeout failure to a retryable provider_unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("The operation was aborted"));
    const { provider } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput(), AUTH),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("maps a storage write failure to a retryable provider_unavailable", async () => {
    const upload = jest.fn().mockRejectedValue(new Error("bucket unavailable"));
    const { provider } = buildProvider({ upload });
    await expect(
      provider.createRemixDraft(generationInput(), AUTH),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("honors env overrides for the worker knobs", async () => {
    process.env.REMIX_AUDIO_CFG_SCALE = "5";
    process.env.REMIX_AUDIO_STEPS = "40";
    process.env.REMIX_AUDIO_MODEL = "small-music";
    try {
      const { provider } = buildProvider();
      const job = await provider.createRemixDraft(generationInput(), AUTH);
      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get("cfg_scale")).toBe("5");
      expect(form.get("steps")).toBe("40");
      expect(form.get("model")).toBe("small-music");
      expect(job.provider).toBe("stable-audio-3-small-music");
    } finally {
      delete process.env.REMIX_AUDIO_CFG_SCALE;
      delete process.env.REMIX_AUDIO_STEPS;
      delete process.env.REMIX_AUDIO_MODEL;
    }
  });

  it("rejects unsupported self-hosted worker models before calling the worker", async () => {
    process.env.REMIX_AUDIO_MODEL = "large";
    try {
      const { provider, mix } = buildProvider();
      await expect(
        provider.createRemixDraft(generationInput(), AUTH),
      ).rejects.toMatchObject({
        code: "provider_unavailable",
        retryable: false,
      });
      expect(mix).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.REMIX_AUDIO_MODEL;
    }
  });
});
