import { LyriaRemixGenerationProvider, buildLyriaRemixPrompt, normalizeLyriaError } from "../modules/remix/lyria-remix-generation.provider";
import {
  buildRemixGenerationInput,
  RemixGenerationProviderError,
  validateRemixGenerationConstraints,
  type RemixGenerationInput,
} from "../modules/remix/remix-generation.provider";
import type { LyriaClient } from "../modules/generation/lyria.client";
import type { StorageProvider } from "../modules/storage/storage_provider";

function generationInput(
  overrides: Partial<RemixGenerationInput> = {},
): RemixGenerationInput {
  return {
    sourceTrackId: "track-1",
    stemIds: ["stem-1"],
    mode: "variation",
    prompt: "darker, halftime",
    constraints: {},
    provenance: {
      remixProjectId: "project-1",
      creatorUserId: "user-1",
      licenseType: "remix",
      licenseId: "purchase-1",
      sourceRightsRoute: "STANDARD_ESCROW",
      sourceContentStatus: "clean",
      sourcePolicyVersion: "2026-06-10.v2",
      voiceLikenessAllowed: false,
    },
    ...overrides,
  };
}

function buildProvider(options: {
  generate?: jest.Mock;
  upload?: jest.Mock;
} = {}) {
  const generate =
    options.generate ??
    jest.fn().mockResolvedValue({
      audioBytes: Buffer.from("audio"),
      mimeType: "audio/wav",
      synthIdPresent: true,
      seed: 42,
      durationSeconds: 30,
      sampleRate: 48000,
      provider: "lyria-002",
      lyrics: [],
    });
  const upload =
    options.upload ??
    jest.fn().mockResolvedValue({ uri: "gs://stems/remix-drafts/project-1/x.wav", provider: "gcs" });
  const provider = new LyriaRemixGenerationProvider(
    { generate } as unknown as LyriaClient,
    { upload } as unknown as StorageProvider,
  );
  return { provider, generate, upload };
}

describe("LyriaRemixGenerationProvider", () => {
  const originalEnabled = process.env.REMIX_GENERATION_ENABLED;

  beforeEach(() => {
    process.env.REMIX_GENERATION_ENABLED = "true";
  });

  afterAll(() => {
    if (originalEnabled === undefined) delete process.env.REMIX_GENERATION_ENABLED;
    else process.env.REMIX_GENERATION_ENABLED = originalEnabled;
  });

  it("stays behind the master gate regardless of provider kind", async () => {
    process.env.REMIX_GENERATION_ENABLED = "false";
    const { provider, generate } = buildProvider();
    await expect(provider.createRemixDraft(generationInput())).rejects.toMatchObject({
      code: "provider_disabled",
      retryable: false,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects stem_mix mode without calling the vendor", async () => {
    const { provider, generate } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput({ mode: "stem_mix", prompt: undefined })),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects prompted modes without a prompt", async () => {
    const { provider } = buildProvider();
    await expect(
      provider.createRemixDraft(generationInput({ prompt: "   " })),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("generates, stores, and returns provenance-complete job metadata", async () => {
    const { provider, generate, upload } = buildProvider();
    const job = await provider.createRemixDraft(
      generationInput({ constraints: { durationSeconds: 60, bpm: 120, key: "Fm" } }),
    );

    expect(generate).toHaveBeenCalledWith({
      prompt: expect.stringContaining("darker, halftime"),
      durationSeconds: 60,
    });
    expect(generate.mock.calls[0][0].prompt).toContain("120 BPM");
    expect(generate.mock.calls[0][0].prompt).toContain("key of Fm");

    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^remix-draft-project-1-.+\.wav$/),
      "audio/wav",
    );

    expect(job.provider).toBe("lyria-002");
    expect(job.jobId).toBeTruthy();
    // 60 seconds = two 30-second cost units.
    expect(job.estimatedCostUsd).toBeCloseTo(0.12);
    expect(job.outputMetadata).toEqual({
      outputUri: "gs://stems/remix-drafts/project-1/x.wav",
      mimeType: "audio/wav",
      synthIdPresent: true,
      seed: 42,
      sampleRate: 48000,
    });
  });

  it("normalizes vendor failures and storage failures", async () => {
    const safety = buildProvider({
      generate: jest.fn().mockRejectedValue(new Error("Blocked by safety filters")),
    });
    await expect(safety.provider.createRemixDraft(generationInput())).rejects.toMatchObject({
      code: "provider_rejected",
      retryable: false,
    });

    const quota = buildProvider({
      generate: jest.fn().mockRejectedValue(new Error("RESOURCE_EXHAUSTED: quota")),
    });
    await expect(quota.provider.createRemixDraft(generationInput())).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });

    const storage = buildProvider({
      upload: jest.fn().mockRejectedValue(new Error("bucket unavailable")),
    });
    await expect(storage.provider.createRemixDraft(generationInput())).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });
});

describe("buildLyriaRemixPrompt", () => {
  it("phrases variation and extension differently and appends constraint hints", () => {
    const variation = buildLyriaRemixPrompt({
      mode: "variation",
      userPrompt: "lofi haze",
      bpm: 80,
    });
    expect(variation).toContain("variation");
    expect(variation).toContain("lofi haze");
    expect(variation).toContain("80 BPM");
    expect(variation).not.toContain("key of");

    const extension = buildLyriaRemixPrompt({
      mode: "extension",
      userPrompt: "build a second drop",
      key: "Am",
    });
    expect(extension).toContain("continuation");
    expect(extension).toContain("key of Am");
  });
});

describe("normalizeLyriaError", () => {
  it("passes through already-normalized errors", () => {
    const original = new RemixGenerationProviderError("invalid_input", "x", false);
    expect(normalizeLyriaError(original)).toBe(original);
  });
});

describe("validateRemixGenerationConstraints (#1162 review prereq)", () => {
  it("accepts empty and in-bounds constraints", () => {
    expect(validateRemixGenerationConstraints(undefined)).toEqual([]);
    expect(
      validateRemixGenerationConstraints({
        durationSeconds: 120,
        bpm: 174,
        key: "F#m",
        explicitAllowed: false,
      }),
    ).toEqual([]);
  });

  it("reports each out-of-bounds field", () => {
    const problems = validateRemixGenerationConstraints({
      durationSeconds: 45,
      bpm: 600,
      key: "H@",
    });
    expect(problems).toHaveLength(3);
    expect(problems.join(" ")).toContain("durationSeconds");
    expect(problems.join(" ")).toContain("bpm");
    expect(problems.join(" ")).toContain("key");
  });
});

describe("buildRemixGenerationInput mode guard (#1162 review prereq)", () => {
  it("throws invalid_input for unknown stored modes", () => {
    expect(() =>
      buildRemixGenerationInput({
        id: "project-1",
        creatorUserId: "user-1",
        sourceTrackId: "track-1",
        mode: "freeform_jam",
        prompt: "p",
        licenseType: "remix",
        licenseId: null,
        policyVersion: "v",
        source: { rightsRoute: null, contentStatus: "clean" },
        stems: [{ stemId: "stem-1" }],
      }),
    ).toThrow(RemixGenerationProviderError);
  });
});
