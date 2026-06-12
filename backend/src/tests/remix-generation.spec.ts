import {
  deriveSourceFeatureHints,
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

  it("includes source feature hints for prompted modes only (#1182 slice 3)", () => {
    const stems = [
      {
        stemId: "stem-1",
        audioFeatures: {
          schemaVersion: "stem-audio-features/v1",
          tempoBpm: 92.5,
          tempoConfidence: 0.6,
          key: { tonic: "G", mode: "minor", confidence: 0.7 },
        },
      },
    ];
    const prompted = buildRemixGenerationInput(
      projectFixture({ mode: "variation", stems }),
    );
    expect(prompted.sourceFeatureHints).toEqual({ bpm: 93, key: "G minor" });

    const mix = buildRemixGenerationInput(
      projectFixture({ mode: "stem_mix", stems }),
    );
    expect(mix.sourceFeatureHints).toBeUndefined();

    const noFeatures = buildRemixGenerationInput(
      projectFixture({ mode: "variation" }),
    );
    expect(noFeatures.sourceFeatureHints).toBeUndefined();
  });

  it("always disables voice/likeness in the MVP policy context", () => {
    const input = buildRemixGenerationInput(projectFixture());
    expect(input.provenance.voiceLikenessAllowed).toBe(false);
  });
});

describe("deriveSourceFeatureHints (#1182 slice 3)", () => {
  const features = (over: Record<string, unknown> = {}) => ({
    schemaVersion: "stem-audio-features/v1",
    tempoBpm: 120.4,
    tempoConfidence: 0.8,
    key: { tonic: "G", mode: "minor", confidence: 0.7 },
    ...over,
  });

  it("derives rounded tempo and a key string from stem features", () => {
    expect(
      deriveSourceFeatureHints([{ audioFeatures: features() }]),
    ).toEqual({ bpm: 120, key: "G minor" });
  });

  it("prefers the highest-confidence measurements across stems", () => {
    const hints = deriveSourceFeatureHints([
      { audioFeatures: features({ tempoBpm: 90, tempoConfidence: 0.4 }) },
      {
        audioFeatures: features({
          tempoBpm: 121,
          tempoConfidence: 0.9,
          key: { tonic: "A", mode: "major", confidence: 0.95 },
        }),
      },
    ]);
    expect(hints).toEqual({ bpm: 121, key: "A major" });
  });

  it("ignores muted stems, missing features, and unknown schemas", () => {
    expect(
      deriveSourceFeatureHints([
        { muted: true, audioFeatures: features() },
        { audioFeatures: null },
        { audioFeatures: { schemaVersion: "v999", tempoBpm: 200 } },
      ]),
    ).toEqual({});
  });

  it("keeps partial hints when only one measurement exists", () => {
    expect(
      deriveSourceFeatureHints([
        { audioFeatures: features({ key: null }) },
      ]),
    ).toEqual({ bpm: 120 });
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
        mimeType: null,
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
