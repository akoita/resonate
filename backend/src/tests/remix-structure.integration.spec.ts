/**
 * Structure blocks remix-structure/v1 (#1899) — Integration Test (Testcontainers)
 *
 * Against real Postgres: PATCH persists/normalizes/clears/keeps the structure
 * and rejects invalid payloads with 400 before any write — including stem
 * masks whose length does not match the block count after the PATCH; reads
 * return the structure plus the derived timeline; renders receive the
 * structure + timeline and block-indexed gate intervals on every path while
 * grounding stays unchanged. Renderers/providers are mocked at their
 * boundaries (the ffmpeg graph is covered by remix-structure-render.spec.ts).
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

const TEST_PREFIX = `remixstructure_${Date.now()}_`;
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

describe("Remix structure blocks (#1899, integration)", () => {
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
        displayName: "Structure Artist",
        payoutAddress: `0x${"d4".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Structure Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Structure Track",
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

  async function storedStructure(projectId: string) {
    const row = await prisma.remixProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { structure: true },
    });
    return row.structure;
  }

  async function storedMask(projectId: string, stemId: string) {
    const row = await prisma.remixProjectStem.findFirstOrThrow({
      where: { remixProjectId: projectId, stemId },
      select: { arrangement: true },
    });
    return row.arrangement;
  }

  const mask = (...sections: boolean[]) => ({
    schemaVersion: "remix-stem-arrangement/v1",
    sections,
  });

  // The 4-section bar grid: [0,16] [16,32] [32,48] [48,64].
  const REPEAT = {
    schemaVersion: "remix-structure/v1",
    blocks: [{ section: 1 }, { section: 1 }, { section: 3, fadeOut: true }],
  };

  it("PATCH persists, normalizes, returns, keeps, and clears the structure", async () => {
    const created = await createProject("Structure persist");
    expect(created.structure).toBeNull();
    // No structure: the timeline is the grid's sections in order.
    expect(created.timeline).toHaveLength(4);
    expect(created.timeline![3]).toMatchObject({
      section: 3,
      outStartSec: 48,
      outEndSec: 64,
      joinFadeIn: false,
      joinFadeOut: false,
    });

    const saved = await projectService.updateProject(OWNER_ID, created.id, {
      structure: {
        blocks: [
          { section: 1, fadeIn: false },
          { section: 1 },
          { section: 3, fadeOut: true },
        ],
      },
    });
    expect(saved.structure).toEqual(REPEAT);
    expect(await storedStructure(created.id)).toEqual(REPEAT);
    expect(saved.timeline).toEqual([
      expect.objectContaining({ index: 0, section: 1, outStartSec: 0, outEndSec: 16, srcStartSec: 16, srcEndSec: 32, joinFadeIn: true, joinFadeOut: true }),
      expect.objectContaining({ index: 1, section: 1, outStartSec: 16, outEndSec: 32, joinFadeIn: true, joinFadeOut: true }),
      expect.objectContaining({ index: 2, section: 3, outStartSec: 32, outEndSec: 48, srcStartSec: 48, srcEndSec: 64, joinFadeIn: true, joinFadeOut: false, fadeOut: true }),
    ]);

    // Reads return the stored structure and timeline.
    const reopened = await projectService.getProject(OWNER_ID, created.id);
    expect(reopened.structure).toEqual(REPEAT);
    expect(reopened.timeline).toEqual(saved.timeline);
    const listed = await projectService.listProjects(OWNER_ID);
    expect(
      listed.find((project) => project.id === created.id)?.structure,
    ).toEqual(REPEAT);

    // Absent field = unchanged; the read shape echoes back.
    const renamed = await projectService.updateProject(OWNER_ID, created.id, {
      title: "Structure persist renamed",
    });
    expect(renamed.structure).toEqual(REPEAT);
    const echoed = await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
    });
    expect(echoed.structure).toEqual(REPEAT);

    // The identity order without fades normalizes to null.
    const identity = await projectService.updateProject(OWNER_ID, created.id, {
      structure: { blocks: [0, 1, 2, 3].map((section) => ({ section })) },
    });
    expect(identity.structure).toBeNull();
    expect(await storedStructure(created.id)).toBeNull();
    expect(identity.timeline).toHaveLength(4);

    // null clears.
    await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
    });
    const cleared = await projectService.updateProject(OWNER_ID, created.id, {
      structure: null,
    });
    expect(cleared.structure).toBeNull();
    expect(await storedStructure(created.id)).toBeNull();
  });

  it("PATCH rejects invalid structures with 400 and writes nothing", async () => {
    const created = await createProject("Structure invalid");
    await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
    });

    const invalid: unknown[] = [
      "extended",
      { blocks: [] },
      { blocks: [{ section: 4 }] },
      { blocks: [{ section: 1, fadeIn: "yes" }] },
      { blocks: Array.from({ length: 97 }, () => ({ section: 0 })) },
      { schemaVersion: "remix-structure/v2", blocks: [{ section: 0 }] },
    ];
    for (const structure of invalid) {
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          title: "should not persist",
          structure,
        }),
      ).rejects.toThrow(BadRequestException);
    }
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        structure: { blocks: [{ section: 4 }] },
      }),
    ).rejects.toThrow("structure.blocks[].section must be an integer in 0..3");

    const unchanged = await projectService.getProject(OWNER_ID, created.id);
    expect(unchanged.title).toBe("Structure invalid");
    expect(unchanged.structure).toEqual(REPEAT);
  });

  it("measures stem masks against the block count after the PATCH", async () => {
    const created = await createProject("Structure masks");
    // A grid-length mask before any structure.
    await projectService.updateProject(OWNER_ID, created.id, {
      stems: [
        { stemId: VOCALS_STEM_ID, arrangement: mask(true, false, true, true) },
      ],
    });

    // Same PATCH: a new 3-block structure with a 4-entry (grid-length) mask
    // is rejected, and nothing is written.
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        structure: REPEAT,
        stems: [
          {
            stemId: DRUMS_STEM_ID,
            arrangement: mask(true, true, true, false),
          },
        ],
      }),
    ).rejects.toThrow(/exactly 3 entries/);
    expect(await storedStructure(created.id)).toBeNull();
    expect(await storedMask(created.id, DRUMS_STEM_ID)).toBeNull();

    // Same PATCH with remapped block-length masks is accepted. The vocals'
    // stored 4-entry mask is left alone (stale lengths fail open at render).
    const saved = await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
      stems: [{ stemId: DRUMS_STEM_ID, arrangement: mask(false, true, true) }],
    });
    expect(saved.structure).toEqual(REPEAT);
    expect(await storedMask(created.id, DRUMS_STEM_ID)).toEqual(
      mask(false, true, true),
    );
    expect(await storedMask(created.id, VOCALS_STEM_ID)).toEqual(
      mask(true, false, true, true),
    );

    // Later mask-only PATCHes are measured against the STORED structure.
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        stems: [
          {
            stemId: VOCALS_STEM_ID,
            arrangement: mask(true, true, true, true),
          },
        ],
      }),
    ).rejects.toThrow(/exactly 3 entries/);
    await projectService.updateProject(OWNER_ID, created.id, {
      stems: [{ stemId: VOCALS_STEM_ID, arrangement: mask(true, true, false) }],
    });

    // Clearing the structure in the same PATCH measures against the grid.
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        structure: null,
        stems: [
          { stemId: VOCALS_STEM_ID, arrangement: mask(true, true, true) },
        ],
      }),
    ).rejects.toThrow(/exactly 4 entries/);
    const reset = await projectService.updateProject(OWNER_ID, created.id, {
      structure: null,
      stems: [
        { stemId: VOCALS_STEM_ID, arrangement: mask(true, true, false, true) },
      ],
    });
    expect(reset.structure).toBeNull();
  });

  it("reads a malformed or out-of-grid stored structure as null", async () => {
    const created = await createProject("Structure malformed");
    for (const stored of [
      { schemaVersion: "remix-structure/v1", blocks: [{ section: 9 }] },
      { schemaVersion: "remix-structure/v1", blocks: "1,2" },
      { blocks: [{ section: 1 }] },
    ]) {
      await prisma.remixProject.update({
        where: { id: created.id },
        data: { structure: stored },
      });
      const read = await projectService.getProject(OWNER_ID, created.id);
      expect(read.structure).toBeNull();
      expect(read.timeline).toHaveLength(4);
    }
  });

  it("stem_mix renders receive the structure, timeline and block-indexed gates", async () => {
    const created = await createProject("Structure stem mix");
    await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
      stems: [
        // Off in the first copy of section 1 only.
        { stemId: DRUMS_STEM_ID, arrangement: mask(false, true, true) },
        // A stale grid-length mask: fails open to always-on.
        { stemId: VOCALS_STEM_ID, arrangement: null },
      ],
    });
    await prisma.remixProjectStem.updateMany({
      where: { remixProjectId: created.id, stemId: VOCALS_STEM_ID },
      data: { arrangement: mask(false, true, true, true) },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();

    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect(renderInput.structure.structure).toEqual(REPEAT);
    expect(renderInput.structure.segments).toHaveLength(3);
    expect(renderInput.structure.segments[2]).toMatchObject({
      section: 3,
      outStartSec: 32,
      outEndSec: 48,
      srcStartSec: 48,
      srcEndSec: 64,
      fadeOut: true,
    });
    expect("fx" in renderInput).toBe(false);
    const drums = renderInput.stems.find(
      (stem: { stemId: string }) => stem.stemId === DRUMS_STEM_ID,
    );
    expect(drums.activeIntervals).toEqual([{ startSec: 16, endSec: 48 }]);
    const vocals = renderInput.stems.find(
      (stem: { stemId: string }) => stem.stemId === VOCALS_STEM_ID,
    );
    expect("activeIntervals" in vocals).toBe(false);

    // Structure is editing, not AI: grounding stays stem_audio.
    const completed = await projectService.getProject(OWNER_ID, created.id);
    expect(completed.generationMetadata).toEqual(
      expect.objectContaining({ status: "completed", grounding: "stem_audio" }),
    );
  });

  it("stem_mix renders without a structure carry none, with grid masks as before", async () => {
    const created = await createProject("Structure none");
    await projectService.updateProject(OWNER_ID, created.id, {
      stems: [
        { stemId: DRUMS_STEM_ID, arrangement: mask(true, false, false, true) },
      ],
    });
    // A stored structure outside the grid fails open to the original order.
    await prisma.remixProject.update({
      where: { id: created.id },
      data: {
        structure: {
          schemaVersion: "remix-structure/v1",
          blocks: [{ section: 7 }],
        },
      },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();
    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect("structure" in renderInput).toBe(false);
    const drums = renderInput.stems.find(
      (stem: { stemId: string }) => stem.stemId === DRUMS_STEM_ID,
    );
    expect(drums.activeIntervals).toEqual([
      { startSec: 0, endSec: 16 },
      { startSec: 48, endSec: 64 },
    ]);
  });

  it("stem_plus_ai passes the structure to the provider and the layered render", async () => {
    const created = await createProject("Structure layered", "variation");
    await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
      effects: { master: { speed: 0.9 } },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();

    const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
    expect(providerInput.renderStructure.structure).toEqual(REPEAT);
    expect(providerInput.renderStructure.segments).toHaveLength(3);
    expect(providerInput.renderFx.effects.master).toEqual({ speed: 0.9 });
    const renderInput = layeredRenderer.render.mock.calls.at(-1)?.[0];
    expect(renderInput.structure).toEqual(providerInput.renderStructure);
    expect(renderInput.fx).toEqual(providerInput.renderFx);
  });

  it("audio-conditioned drafts record the conditioning structure", async () => {
    process.env.REMIX_GENERATION_PROVIDER_KIND = "audio-conditioned";
    try {
      const created = await createProject("Structure conditioned", "variation");
      await projectService.updateProject(OWNER_ID, created.id, {
        structure: REPEAT,
      });
      // Provider mocked at its boundary; it echoes the structure it
      // conditioned on, exactly like AudioConditionedRemixGenerationProvider.
      layerProvider.createRemixDraft.mockImplementationOnce(
        async (input: { renderStructure?: { structure: unknown } }) => ({
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
          ...(input.renderStructure
            ? {
                conditioningStructure: {
                  structure: input.renderStructure.structure,
                  structureVersion: "remix-structure-dsp/v1",
                },
              }
            : {}),
        }),
      );
      await projectService.generateDraft(OWNER_ID, created.id, {});
      await processQueued();

      const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
      expect(providerInput.renderStructure.structure).toEqual(REPEAT);
      expect("renderFx" in providerInput).toBe(false);
      expect(layeredRenderer.render).not.toHaveBeenCalled();

      const completed = await projectService.getProject(OWNER_ID, created.id);
      const metadata = completed.generationMetadata as Record<string, unknown>;
      expect(metadata.status).toBe("completed");
      expect(metadata.conditioningStructure).toEqual({
        structure: REPEAT,
        structureVersion: "remix-structure-dsp/v1",
      });
      expect("conditioningEffects" in metadata).toBe(false);
    } finally {
      process.env.REMIX_GENERATION_PROVIDER_KIND = "lyria";
    }
  });

  it("caps the timeline at twice the source and fails open on over-cap rows", async () => {
    const created = await createProject("Structure cap");
    // 64 s source → 128 s cap: 8 × 16 s blocks fit exactly, 9 do not.
    const blocks = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ section: index % 4 }));
    const atCap = await projectService.updateProject(OWNER_ID, created.id, {
      structure: { blocks: blocks(8) },
    });
    expect(atCap.timeline!.at(-1)!.outEndSec).toBe(128);
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        title: "should not persist",
        structure: { blocks: blocks(9) },
      }),
    ).rejects.toThrow(
      "That would make the remix more than twice as long as the original — remove a few repeats.",
    );
    const unchanged = await projectService.getProject(OWNER_ID, created.id);
    expect(unchanged.title).toBe("Structure cap");
    expect(unchanged.structure).toEqual({
      schemaVersion: "remix-structure/v1",
      blocks: blocks(8),
    });

    // A stored over-cap row (written around the PATCH) reads and renders as
    // the original order — never an oversized render.
    await prisma.remixProject.update({
      where: { id: created.id },
      data: {
        structure: { schemaVersion: "remix-structure/v1", blocks: blocks(9) },
      },
    });
    const read = await projectService.getProject(OWNER_ID, created.id);
    expect(read.structure).toBeNull();
    expect(read.timeline).toHaveLength(4);
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();
    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect("structure" in renderInput).toBe(false);
  });

  it("caps long sources at 15 minutes with its own reason", async () => {
    const created = await createProject("Structure cap long");
    // 600 s source at 120 bpm: 16 s sections, and 2 × 600 > 900 so the
    // 15-minute ceiling binds: 56 × 16 = 896 s fits, 57 × 16 = 912 s does not.
    await prisma.stem.updateMany({
      where: { trackId: TRACK_ID },
      data: { audioFeatures: { ...BAR_FEATURES, durationSeconds: 600 } },
    });
    try {
      const blocks = (count: number) =>
        Array.from({ length: count }, () => ({ section: 1 }));
      const fits = await projectService.updateProject(OWNER_ID, created.id, {
        structure: { blocks: blocks(56) },
      });
      expect(fits.timeline!.at(-1)!.outEndSec).toBe(896);
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          structure: { blocks: blocks(57) },
        }),
      ).rejects.toThrow("That would make the remix longer than 15 minutes.");
    } finally {
      await prisma.stem.updateMany({
        where: { trackId: TRACK_ID },
        data: { audioFeatures: BAR_FEATURES },
      });
    }
  });

  it("rejects a structure when the source has no section grid", async () => {
    const created = await createProject("Structure no grid");
    await prisma.stem.updateMany({
      where: { trackId: TRACK_ID },
      data: { audioFeatures: { schemaVersion: "stem-audio-features/v1" } },
    });
    try {
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          structure: { blocks: [{ section: 0 }] },
        }),
      ).rejects.toThrow(
        "This source has no section grid to arrange (no measured stem duration).",
      );
      // Clearing is still allowed; reads carry no timeline.
      const cleared = await projectService.updateProject(OWNER_ID, created.id, {
        structure: null,
      });
      expect(cleared.structure).toBeNull();
      expect(cleared.timeline).toBeNull();
    } finally {
      await prisma.stem.updateMany({
        where: { trackId: TRACK_ID },
        data: { audioFeatures: BAR_FEATURES },
      });
    }
  });
});
