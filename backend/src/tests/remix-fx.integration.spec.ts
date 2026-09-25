/**
 * Shared effects recipe remix-fx/v1 (#1897) — Integration Test (Testcontainers)
 *
 * Against real Postgres: PATCH persists/normalizes/clears/keeps the recipe and
 * rejects invalid payloads with 400 before any write; reads return it; renders
 * receive it (with the bar-grid tempo) on the stem_mix and stem_plus_ai paths
 * while grounding stays unchanged. Renderers/providers are mocked at their
 * boundaries (the ffmpeg graph itself is covered by remix-fx-render.spec.ts).
 *
 * Run: npm run test:integration
 */

import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  type RemixGenerationJobData,
} from "../modules/remix/remix-project.service";
import { stubGenerationCredits } from "./e2e-helpers";

const TEST_PREFIX = `remixfx_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCALS_STEM_ID = `${TEST_PREFIX}stem_a_vocals`;
const DRUMS_STEM_ID = `${TEST_PREFIX}stem_b_drums`;

// 120 bpm, 64 s → a 4-section bar grid (8 bars = 16 s per section).
const BAR_FEATURES = {
  schemaVersion: "stem-audio-features/v1",
  tempoBpm: 120,
  tempoConfidence: 0.9,
  firstBeatSec: 0,
  durationSeconds: 64,
};

const storageProvider = {
  upload: jest.fn(),
  download: jest.fn(),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };
const stemMixRenderer = {
  render: jest.fn().mockResolvedValue({
    provider: "stem-mix-render",
    jobId: "stem-mix-job",
    estimatedCostUsd: 0,
    outputMetadata: {
      outputUri: "local://stem-mix.mp3",
      mimeType: "audio/mpeg",
      synthIdPresent: false,
      seed: null,
      sampleRate: 48000,
    },
  }),
};
const layerProvider = {
  createRemixDraft: jest.fn().mockResolvedValue({
    provider: "lyria-3-pro-preview",
    jobId: "layer-job",
    estimatedCostUsd: 0.12,
    outputMetadata: {
      outputUri: "local://generated-layer.wav",
      mimeType: "audio/wav",
      synthIdPresent: true,
      seed: 909,
      sampleRate: 48000,
    },
  }),
};
const layeredRenderer = {
  render: jest.fn().mockResolvedValue({
    provider: "stem-plus-ai-layered-render",
    jobId: "layered-job",
    estimatedCostUsd: 0.12,
    outputMetadata: {
      outputUri: "local://stem-plus-ai.mp3",
      mimeType: "audio/mpeg",
      synthIdPresent: true,
      seed: 909,
      sampleRate: 48000,
    },
  }),
};

describe("Remix shared effects recipe (#1897, integration)", () => {
  let projectService: RemixProjectService;
  let eventBus: EventBus;
  let originalEnabled: string | undefined;
  let originalKind: string | undefined;

  beforeAll(async () => {
    originalEnabled = process.env.REMIX_GENERATION_ENABLED;
    originalKind = process.env.REMIX_GENERATION_PROVIDER_KIND;
    process.env.REMIX_GENERATION_ENABLED = "true";
    process.env.REMIX_GENERATION_PROVIDER_KIND = "lyria";

    await prisma.user.create({
      data: { id: OWNER_ID, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: OWNER_ID,
        displayName: "FX Artist",
        payoutAddress: `0x${"c3".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "FX Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "FX Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.createMany({
      data: [
        {
          id: VOCALS_STEM_ID,
          trackId: TRACK_ID,
          type: "vocals",
          uri: "local://v",
          audioFeatures: BAR_FEATURES,
        },
        {
          id: DRUMS_STEM_ID,
          trackId: TRACK_ID,
          type: "drums",
          uri: "local://d",
          audioFeatures: BAR_FEATURES,
        },
      ],
    });
  });

  afterAll(async () => {
    if (originalEnabled === undefined) delete process.env.REMIX_GENERATION_ENABLED;
    else process.env.REMIX_GENERATION_ENABLED = originalEnabled;
    if (originalKind === undefined) delete process.env.REMIX_GENERATION_PROVIDER_KIND;
    else process.env.REMIX_GENERATION_PROVIDER_KIND = originalKind;

    await prisma.remixProjectStem.deleteMany({
      where: { project: { sourceTrackId: TRACK_ID } },
    });
    await prisma.remixProject.deleteMany({ where: { sourceTrackId: TRACK_ID } });
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: OWNER_ID } });
    eventBus.destroy();
  });

  beforeEach(() => {
    if (!eventBus) eventBus = new EventBus();
    generationQueue.add.mockClear();
    stemMixRenderer.render.mockClear();
    layerProvider.createRemixDraft.mockClear();
    layeredRenderer.render.mockClear();
    projectService = new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      layerProvider as never,
      stemMixRenderer as never,
      storageProvider as never,
      generationQueue as never,
      stubGenerationCredits() as never,
      layeredRenderer as never,
    );
  });

  async function createProject(
    title: string,
    mode: "stem_mix" | "variation" = "stem_mix",
  ) {
    return projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID, DRUMS_STEM_ID],
      title,
      mode,
      ...(mode === "variation" ? { prompt: "add a warm pad" } : {}),
    });
  }

  async function processQueued() {
    const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as
      RemixGenerationJobData;
    return projectService.processGenerationJob(queuedData);
  }

  async function storedEffects(projectId: string) {
    const row = await prisma.remixProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { effects: true },
    });
    return row.effects;
  }

  it("PATCH persists, normalizes, returns, keeps, and clears effects", async () => {
    const created = await createProject("FX persist");
    expect(created.effects).toBeNull();

    const saved = await projectService.updateProject(OWNER_ID, created.id, {
      effects: {
        master: { speed: 0.854, space: 0.4549, tone: 0 },
        stems: {
          [VOCALS_STEM_ID]: { echo: 0.333 },
          [DRUMS_STEM_ID]: { space: 0 },
        },
      },
    });
    const normalized = {
      schemaVersion: "remix-fx/v1",
      master: { speed: 0.85, space: 0.45 },
      stems: { [VOCALS_STEM_ID]: { echo: 0.33 } },
    };
    expect(saved.effects).toEqual(normalized);
    expect(await storedEffects(created.id)).toEqual(normalized);

    // Reads return the stored recipe.
    const reopened = await projectService.getProject(OWNER_ID, created.id);
    expect(reopened.effects).toEqual(normalized);
    const listed = await projectService.listProjects(OWNER_ID);
    expect(listed.find((project) => project.id === created.id)?.effects).toEqual(
      normalized,
    );

    // Absent field = unchanged.
    const renamed = await projectService.updateProject(OWNER_ID, created.id, {
      title: "FX persist renamed",
    });
    expect(renamed.effects).toEqual(normalized);

    // Echoing the read shape back (with schemaVersion) is accepted.
    const echoed = await projectService.updateProject(OWNER_ID, created.id, {
      effects: normalized,
    });
    expect(echoed.effects).toEqual(normalized);

    // All-default recipe normalizes to null (untouched).
    const reset = await projectService.updateProject(OWNER_ID, created.id, {
      effects: { master: { speed: 1, space: 0 } },
    });
    expect(reset.effects).toBeNull();
    expect(await storedEffects(created.id)).toBeNull();

    // null clears.
    await projectService.updateProject(OWNER_ID, created.id, {
      effects: { master: { warmth: 0.5 } },
    });
    const cleared = await projectService.updateProject(OWNER_ID, created.id, {
      effects: null,
    });
    expect(cleared.effects).toBeNull();
    expect(await storedEffects(created.id)).toBeNull();
  });

  it("PATCH rejects invalid effects with 400 and writes nothing", async () => {
    const created = await createProject("FX invalid");
    await projectService.updateProject(OWNER_ID, created.id, {
      effects: { master: { space: 0.2 } },
    });

    const invalid: unknown[] = [
      "slowed",
      { master: { speed: 2 } },
      { master: { space: "0.5" } },
      { master: { pitch: 1 } },
      { stems: { "not-a-project-stem": { echo: 0.5 } } },
      { stems: { [VOCALS_STEM_ID]: { echo: -0.1 } } },
      { schemaVersion: "remix-fx/v2" },
    ];
    for (const effects of invalid) {
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          title: "should not persist",
          effects,
        }),
      ).rejects.toThrow(BadRequestException);
    }

    const unchanged = await projectService.getProject(OWNER_ID, created.id);
    expect(unchanged.title).toBe("FX invalid");
    expect(unchanged.effects).toEqual({
      schemaVersion: "remix-fx/v1",
      master: { space: 0.2 },
    });
  });

  it("reads a malformed stored recipe as null", async () => {
    const created = await createProject("FX malformed");
    await prisma.remixProject.update({
      where: { id: created.id },
      data: { effects: { schemaVersion: "remix-fx/v1", master: { speed: 7 } } },
    });
    const read = await projectService.getProject(OWNER_ID, created.id);
    expect(read.effects).toBeNull();
  });

  it("stem_mix renders receive the recipe and the bar-grid tempo", async () => {
    const created = await createProject("FX stem mix");
    await projectService.updateProject(OWNER_ID, created.id, {
      effects: {
        master: { speed: 0.85, space: 0.3 },
        stems: { [DRUMS_STEM_ID]: { echo: 0.5 } },
      },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();

    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect(renderInput.fx).toEqual({
      effects: {
        schemaVersion: "remix-fx/v1",
        master: { speed: 0.85, space: 0.3 },
        stems: { [DRUMS_STEM_ID]: { echo: 0.5 } },
      },
      bpm: 120,
    });

    // Effects are DSP, not AI: grounding stays stem_audio.
    const completed = await projectService.getProject(OWNER_ID, created.id);
    expect(completed.generationMetadata).toEqual(
      expect.objectContaining({
        status: "completed",
        grounding: "stem_audio",
      }),
    );
  });

  it("stem_mix renders without effects carry no fx at all", async () => {
    const created = await createProject("FX none");
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();
    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect("fx" in renderInput).toBe(false);
  });

  it("time-grid projects render effects without a bpm", async () => {
    const created = await createProject("FX time grid");
    await prisma.stem.updateMany({
      where: { trackId: TRACK_ID },
      data: {
        audioFeatures: {
          schemaVersion: "stem-audio-features/v1",
          durationSeconds: 64,
        },
      },
    });
    try {
      await projectService.updateProject(OWNER_ID, created.id, {
        effects: { stems: { [VOCALS_STEM_ID]: { echo: 0.4 } } },
      });
      await projectService.generateDraft(OWNER_ID, created.id, {});
      await processQueued();
      const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
      expect(renderInput.fx).toEqual({
        effects: {
          schemaVersion: "remix-fx/v1",
          stems: { [VOCALS_STEM_ID]: { echo: 0.4 } },
        },
        bpm: null,
      });
    } finally {
      await prisma.stem.updateMany({
        where: { trackId: TRACK_ID },
        data: { audioFeatures: BAR_FEATURES },
      });
    }
  });

  it("audio-conditioned drafts record the conditioning effects (#1897)", async () => {
    process.env.REMIX_GENERATION_PROVIDER_KIND = "audio-conditioned";
    try {
      const created = await createProject("FX conditioned", "variation");
      await projectService.updateProject(OWNER_ID, created.id, {
        effects: { master: { speed: 0.9, space: 0.2 } },
      });
      // Provider mocked at its boundary; it echoes the recipe it conditioned
      // on, exactly like AudioConditionedRemixGenerationProvider does.
      layerProvider.createRemixDraft.mockImplementationOnce(
        async (input: { renderFx?: { effects: unknown } }) => ({
          provider: "stable-audio-3-medium",
          jobId: "conditioned-job",
          estimatedCostUsd: 0.05,
          outputMetadata: {
            outputUri: "local://conditioned.wav",
            mimeType: "audio/wav",
            synthIdPresent: false,
            seed: 1,
            sampleRate: 44100,
          },
          ...(input.renderFx
            ? {
                conditioningEffects: {
                  effects: input.renderFx.effects,
                  effectsDspVersion: "remix-fx-dsp/v1",
                },
              }
            : {}),
        }),
      );
      await projectService.generateDraft(OWNER_ID, created.id, {});
      await processQueued();

      const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
      expect(providerInput.renderFx).toEqual({
        effects: { schemaVersion: "remix-fx/v1", master: { speed: 0.9, space: 0.2 } },
        bpm: 120,
      });
      // Not lyria: no layered render, the provider audio is the draft.
      expect(layeredRenderer.render).not.toHaveBeenCalled();

      const completed = await projectService.getProject(OWNER_ID, created.id);
      const metadata = completed.generationMetadata as Record<string, unknown>;
      expect(metadata.status).toBe("completed");
      expect(metadata.conditioningEffects).toEqual({
        effects: { schemaVersion: "remix-fx/v1", master: { speed: 0.9, space: 0.2 } },
        effectsDspVersion: "remix-fx-dsp/v1",
      });
      expect("renderMetadata" in metadata).toBe(false);
    } finally {
      process.env.REMIX_GENERATION_PROVIDER_KIND = "lyria";
    }
  });

  it("stem_plus_ai passes the recipe to the provider and the layered render", async () => {
    const created = await createProject("FX layered", "variation");
    await projectService.updateProject(OWNER_ID, created.id, {
      effects: { master: { speed: 1.1, warmth: 0.25 } },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();

    const expectedFx = {
      effects: {
        schemaVersion: "remix-fx/v1",
        master: { speed: 1.1, warmth: 0.25 },
      },
      bpm: 120,
    };
    const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
    expect(providerInput.renderFx).toEqual(expectedFx);
    const renderInput = layeredRenderer.render.mock.calls.at(-1)?.[0];
    expect(renderInput.fx).toEqual(expectedFx);
  });
});
