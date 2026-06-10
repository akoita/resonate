import {
  buildRemixGenerationInput,
  estimateRemixGenerationCostUsd,
  RemixGenerationProviderError,
  StubRemixGenerationProvider,
} from "../modules/remix/remix-generation.provider";

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    creatorUserId: "user-1",
    sourceTrackId: "track-1",
    mode: "variation",
    prompt: "darker, halftime",
    licenseType: "remix",
    licenseId: null,
    policyVersion: "2026-06-09.v1",
    source: { rightsRoute: "STANDARD_ESCROW", contentStatus: "clean" },
    stems: [{ stemId: "stem-1" }, { stemId: "stem-2" }],
    ...overrides,
  } as Parameters<typeof buildRemixGenerationInput>[0];
}

describe("buildRemixGenerationInput", () => {
  it("maps project fields and rights/policy provenance", () => {
    const input = buildRemixGenerationInput(projectFixture(), {
      durationSeconds: 60,
      bpm: 120,
    });
    expect(input).toEqual({
      sourceTrackId: "track-1",
      stemIds: ["stem-1", "stem-2"],
      mode: "variation",
      prompt: "darker, halftime",
      constraints: { durationSeconds: 60, bpm: 120 },
      provenance: {
        remixProjectId: "proj-1",
        creatorUserId: "user-1",
        licenseType: "remix",
        licenseId: null,
        sourceRightsRoute: "STANDARD_ESCROW",
        sourceContentStatus: "clean",
        sourcePolicyVersion: "2026-06-09.v1",
        voiceLikenessAllowed: false,
      },
    });
  });

  it("strips prompts for stem_mix mode", () => {
    const input = buildRemixGenerationInput(
      projectFixture({ mode: "stem_mix", prompt: "should be ignored" }),
    );
    expect(input.mode).toBe("stem_mix");
    expect(input.prompt).toBeUndefined();
  });

  it("omits blank prompts for prompted modes", () => {
    const input = buildRemixGenerationInput(
      projectFixture({ mode: "extension", prompt: "   " }),
    );
    expect(input.prompt).toBeUndefined();
  });

  it("always disables voice/likeness in the MVP policy context", () => {
    const input = buildRemixGenerationInput(projectFixture());
    expect(input.provenance.voiceLikenessAllowed).toBe(false);
  });
});

describe("estimateRemixGenerationCostUsd", () => {
  it("matches the catalog cost model of $0.06 per 30 seconds", () => {
    expect(estimateRemixGenerationCostUsd()).toBe(0.06);
    expect(estimateRemixGenerationCostUsd(60)).toBe(0.12);
    expect(estimateRemixGenerationCostUsd(15)).toBe(0.03);
  });
});

describe("StubRemixGenerationProvider", () => {
  const originalEnv = process.env.REMIX_GENERATION_ENABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REMIX_GENERATION_ENABLED;
    } else {
      process.env.REMIX_GENERATION_ENABLED = originalEnv;
    }
  });

  it("fails with a normalized provider_disabled error by default", async () => {
    delete process.env.REMIX_GENERATION_ENABLED;
    const provider = new StubRemixGenerationProvider();
    const attempt = provider.createRemixDraft(
      buildRemixGenerationInput(projectFixture()),
    );
    await expect(attempt).rejects.toBeInstanceOf(RemixGenerationProviderError);
    await expect(attempt).rejects.toMatchObject({
      code: "provider_disabled",
      retryable: false,
    });
  });

  it("returns a deterministic job with cost estimate when enabled", async () => {
    process.env.REMIX_GENERATION_ENABLED = "true";
    const provider = new StubRemixGenerationProvider();
    const job = await provider.createRemixDraft(
      buildRemixGenerationInput(projectFixture(), { durationSeconds: 60 }),
    );
    expect(job).toEqual({
      provider: "remix-stub",
      jobId: "rmxgen_proj-1",
      estimatedCostUsd: 0.12,
      outputMetadata: {
        outputUri: null,
        synthIdPresent: null,
        seed: null,
        sampleRate: null,
      },
    });
  });

  it("rejects inputs without stems as invalid_input", async () => {
    process.env.REMIX_GENERATION_ENABLED = "true";
    const provider = new StubRemixGenerationProvider();
    const input = buildRemixGenerationInput(projectFixture({ stems: [] }));
    await expect(provider.createRemixDraft(input)).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
