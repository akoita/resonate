/**
 * Beat maker remix-beat/v1 (#1902) — Integration Test (Testcontainers)
 *
 * Against real Postgres: PATCH persists/normalizes/clears/keeps the beat and
 * rejects invalid payloads with 400 before any write — including a per-block
 * list measured against a structure sent in the same PATCH, and sources with
 * no bar grid; reads return the beat (a stale per-block list fails open);
 * renders receive the beat + its grid + timeline on every path while
 * grounding stays unchanged; published projects are locked. Renderers and
 * providers are mocked at their boundaries (the ffmpeg graph is covered by
 * remix-beat-render.spec.ts).
 *
 * Run: npm run test:integration
 */

import { BadRequestException, ConflictException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  type RemixGenerationJobData,
} from "../modules/remix/remix-project.service";
import { BEAT_NEEDS_TEMPO_ERROR } from "../modules/remix/remix-beat";
import { stubGenerationCredits } from "./e2e-helpers";

const TEST_PREFIX = `remixbeat_${Date.now()}_`;
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

const row = (...steps: number[]) =>
  Array.from({ length: 16 }, (_, step) => steps.includes(step));
const PATTERN = {
  kick: row(0, 8),
  snare: row(4, 12),
  clap: row(),
  hat: row(0, 2, 4, 6, 8, 10, 12, 14),
  openHat: row(),
};
const BEAT = {
  schemaVersion: "remix-beat/v1",
  kit: "808",
  pattern: PATTERN,
  swing: 0.2,
  gainDb: -3,
  blocks: null,
};
// The 4-section bar grid: [0,16] [16,32] [32,48] [48,64].
const REPEAT = {
  schemaVersion: "remix-structure/v1",
  blocks: [{ section: 1 }, { section: 1 }, { section: 3 }],
};

describe("Remix beat maker (#1902, integration)", () => {
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
        displayName: "Beat Artist",
        payoutAddress: `0x${"d5".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Beat Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Beat Track",
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

  async function storedBeat(projectId: string) {
    const project = await prisma.remixProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { beat: true },
    });
    return project.beat;
  }

  async function withFeatures<T>(features: unknown, run: () => Promise<T>) {
    await prisma.stem.updateMany({
      where: { trackId: TRACK_ID },
      data: { audioFeatures: features as object },
    });
    try {
      return await run();
    } finally {
      await prisma.stem.updateMany({
        where: { trackId: TRACK_ID },
        data: { audioFeatures: BAR_FEATURES },
      });
    }
  }

  it("PATCH persists, normalizes, returns, keeps, and clears the beat", async () => {
    const created = await createProject("Beat persist");
    expect(created.beat).toBeNull();

    // Omitted rows are silent; all-on blocks normalize to null.
    const saved = await projectService.updateProject(OWNER_ID, created.id, {
      beat: {
        kit: "808",
        pattern: { kick: PATTERN.kick, snare: PATTERN.snare, hat: PATTERN.hat },
        swing: 0.2,
        gainDb: -3,
        blocks: [true, true, true, true],
      },
    });
    expect(saved.beat).toEqual(BEAT);
    expect(await storedBeat(created.id)).toEqual(BEAT);

    const reopened = await projectService.getProject(OWNER_ID, created.id);
    expect(reopened.beat).toEqual(BEAT);
    const listed = await projectService.listProjects(OWNER_ID);
    expect(listed.find((project) => project.id === created.id)?.beat).toEqual(
      BEAT,
    );

    // Absent = unchanged; the read shape echoes back.
    const renamed = await projectService.updateProject(OWNER_ID, created.id, {
      title: "Beat persist renamed",
    });
    expect(renamed.beat).toEqual(BEAT);
    const echoed = await projectService.updateProject(OWNER_ID, created.id, {
      beat: saved.beat,
    });
    expect(echoed.beat).toEqual(BEAT);

    // An all-off pattern is kept (plays silence).
    const silent = await projectService.updateProject(OWNER_ID, created.id, {
      beat: { kit: "lofi", pattern: {} },
    });
    expect(silent.beat).toMatchObject({ kit: "lofi", pattern: { kick: row() } });

    // Per-block on/off against the grid's 4 sections.
    const blocks = await projectService.updateProject(OWNER_ID, created.id, {
      beat: { ...BEAT, blocks: [true, false, true, true] },
    });
    expect(blocks.beat).toEqual({ ...BEAT, blocks: [true, false, true, true] });

    // Muting keeps the recipe (reads return it); unmuting omits the flag.
    // Swing and level round to 2 decimals.
    const muted = await projectService.updateProject(OWNER_ID, created.id, {
      beat: { ...BEAT, swing: 0.2049, gainDb: -3.001, muted: true },
    });
    expect(muted.beat).toEqual({ ...BEAT, muted: true });
    expect(await storedBeat(created.id)).toEqual({ ...BEAT, muted: true });
    const unmuted = await projectService.updateProject(OWNER_ID, created.id, {
      beat: { ...BEAT, muted: false },
    });
    expect(unmuted.beat).toEqual(BEAT);

    const cleared = await projectService.updateProject(OWNER_ID, created.id, {
      beat: null,
    });
    expect(cleared.beat).toBeNull();
    expect(await storedBeat(created.id)).toBeNull();
  });

  it("PATCH rejects invalid beats with 400 and writes nothing", async () => {
    const created = await createProject("Beat invalid");
    await projectService.updateProject(OWNER_ID, created.id, { beat: BEAT });

    const invalid: unknown[] = [
      "boom bap",
      { kit: "909", pattern: PATTERN },
      { kit: "808" },
      { kit: "808", pattern: { ...PATTERN, cowbell: row() } },
      { kit: "808", pattern: { kick: [true, false] } },
      { kit: "808", pattern: PATTERN, swing: 0.7 },
      { kit: "808", pattern: PATTERN, gainDb: -30 },
      { kit: "808", pattern: PATTERN, blocks: [true, false] },
      { ...BEAT, schemaVersion: "remix-beat/v2" },
      { ...BEAT, tempo: 90 },
    ];
    for (const beat of invalid) {
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          title: "should not persist",
          beat,
        }),
      ).rejects.toThrow(BadRequestException);
    }
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        beat: { ...BEAT, blocks: [true, false] },
      }),
    ).rejects.toThrow("beat.blocks must have exactly 4 entries (one per block)");

    const unchanged = await projectService.getProject(OWNER_ID, created.id);
    expect(unchanged.title).toBe("Beat invalid");
    expect(unchanged.beat).toEqual(BEAT);
  });

  it("measures beat blocks against the block count after the PATCH; structure edits never rewrite them", async () => {
    const created = await createProject("Beat blocks");
    await projectService.updateProject(OWNER_ID, created.id, {
      beat: { ...BEAT, blocks: [false, true, true, true] },
    });

    // Same PATCH: a new 3-block structure with a 4-entry list is rejected,
    // and nothing is written.
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        structure: REPEAT,
        beat: { ...BEAT, blocks: [true, false, true, true] },
      }),
    ).rejects.toThrow(/exactly 3 entries/);
    expect(await storedBeat(created.id)).toMatchObject({
      blocks: [false, true, true, true],
    });
    const before = await projectService.getProject(OWNER_ID, created.id);
    expect(before.structure).toBeNull();

    // Same PATCH with a remapped 3-entry list is accepted.
    const saved = await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
      beat: { ...BEAT, blocks: [true, false, true] },
    });
    expect(saved.structure).toEqual(REPEAT);
    expect(saved.beat).toEqual({ ...BEAT, blocks: [true, false, true] });

    // Later beat-only PATCHes are measured against the STORED structure.
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        beat: { ...BEAT, blocks: [true, false, true, true] },
      }),
    ).rejects.toThrow(/exactly 3 entries/);

    // A structure-only edit leaves the stored list alone; its stale length
    // reads (and renders) as on-everywhere.
    const restructured = await projectService.updateProject(OWNER_ID, created.id, {
      structure: { blocks: [{ section: 1 }, { section: 2 }] },
    });
    expect(await storedBeat(created.id)).toMatchObject({
      blocks: [true, false, true],
    });
    expect(restructured.beat).toEqual({ ...BEAT, blocks: null });
  });

  it("rejects a beat without a bar grid (no grid, or a time grid); clearing still works", async () => {
    const created = await createProject("Beat no grid");
    await withFeatures({ schemaVersion: "stem-audio-features/v1" }, async () => {
      await expect(
        projectService.updateProject(OWNER_ID, created.id, { beat: BEAT }),
      ).rejects.toThrow(BEAT_NEEDS_TEMPO_ERROR);
      const cleared = await projectService.updateProject(OWNER_ID, created.id, {
        beat: null,
      });
      expect(cleared.beat).toBeNull();
    });
    // A measured duration without a tempo → a time grid.
    await withFeatures(
      { schemaVersion: "stem-audio-features/v1", durationSeconds: 64 },
      async () => {
        const read = await projectService.getProject(OWNER_ID, created.id);
        expect(read.sectionGrid?.kind).toBe("time");
        await expect(
          projectService.updateProject(OWNER_ID, created.id, { beat: BEAT }),
        ).rejects.toThrow(BEAT_NEEDS_TEMPO_ERROR);
      },
    );
    expect(await storedBeat(created.id)).toBeNull();
  });

  it("reads a malformed stored beat as null", async () => {
    const created = await createProject("Beat malformed");
    for (const stored of [
      { ...BEAT, kit: "tr909" },
      { ...BEAT, schemaVersion: "remix-beat/v0" },
      { kit: "808", pattern: PATTERN },
      "x---x---",
    ]) {
      await prisma.remixProject.update({
        where: { id: created.id },
        data: { beat: stored },
      });
      const read = await projectService.getProject(OWNER_ID, created.id);
      expect(read.beat).toBeNull();
    }
  });

  it("locks the beat on a published project", async () => {
    const created = await createProject("Beat published");
    await prisma.remixProject.update({
      where: { id: created.id },
      data: { status: "published" },
    });
    await expect(
      projectService.updateProject(OWNER_ID, created.id, { beat: BEAT }),
    ).rejects.toThrow(ConflictException);
    await expect(
      projectService.updateProject(OWNER_ID, created.id, { beat: null }),
    ).rejects.toThrow(ConflictException);
    expect(await storedBeat(created.id)).toBeNull();
  });

  it("stem_mix renders receive the beat over the structured timeline; grounding stays stem_audio", async () => {
    const created = await createProject("Beat stem mix");
    await projectService.updateProject(OWNER_ID, created.id, {
      structure: REPEAT,
      beat: { ...BEAT, blocks: [true, false, true] },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();

    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect(renderInput.beat.beat).toEqual({ ...BEAT, blocks: [true, false, true] });
    expect(renderInput.beat.grid).toMatchObject({ kind: "bars", bpm: 120 });
    expect(renderInput.beat.segments).toEqual(renderInput.structure.segments);
    expect(renderInput.beat.segments.map((s: { section: number }) => s.section)).toEqual([1, 1, 3]);

    const completed = await projectService.getProject(OWNER_ID, created.id);
    expect(completed.generationMetadata).toEqual(
      expect.objectContaining({ status: "completed", grounding: "stem_audio" }),
    );
  });

  it("without a structure the beat plays over the grid's sections; a stale list fails open", async () => {
    const created = await createProject("Beat no structure");
    await projectService.updateProject(OWNER_ID, created.id, { beat: BEAT });
    // A stale 3-entry list against the 4-section grid.
    await prisma.remixProject.update({
      where: { id: created.id },
      data: { beat: { ...BEAT, blocks: [true, false, true] } },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();
    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect("structure" in renderInput).toBe(false);
    expect(renderInput.beat.beat).toEqual({ ...BEAT, blocks: null });
    expect(renderInput.beat.segments).toHaveLength(4);
    expect(renderInput.beat.segments[3]).toMatchObject({
      section: 3,
      outStartSec: 48,
      outEndSec: 64,
    });
  });

  it("a muted beat is skipped entirely at render", async () => {
    const created = await createProject("Beat muted");
    await projectService.updateProject(OWNER_ID, created.id, {
      beat: { ...BEAT, muted: true },
    });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();
    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0];
    expect("beat" in renderInput).toBe(false);
  });

  it("renders carry no beat when there is none or the grid lost its tempo", async () => {
    const created = await createProject("Beat none");
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();
    expect("beat" in stemMixRenderer.render.mock.calls.at(-1)?.[0]).toBe(false);

    await prisma.remixProject.update({
      where: { id: created.id },
      data: { beat: BEAT },
    });
    await withFeatures(
      { schemaVersion: "stem-audio-features/v1", durationSeconds: 64 },
      async () => {
        await projectService.generateDraft(OWNER_ID, created.id, { retry: true });
        await processQueued();
      },
    );
    expect(stemMixRenderer.render).toHaveBeenCalledTimes(2);
    expect("beat" in stemMixRenderer.render.mock.calls.at(-1)?.[0]).toBe(false);
  });

  it("stem_plus_ai passes the beat to the provider and the layered render", async () => {
    const created = await createProject("Beat layered", "variation");
    await projectService.updateProject(OWNER_ID, created.id, { beat: BEAT });
    await projectService.generateDraft(OWNER_ID, created.id, {});
    await processQueued();

    const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
    expect(providerInput.renderBeat.beat).toEqual(BEAT);
    expect(providerInput.renderBeat.segments).toHaveLength(4);
    const renderInput = layeredRenderer.render.mock.calls.at(-1)?.[0];
    expect(renderInput.beat).toEqual(providerInput.renderBeat);
  });

  it("audio-conditioned drafts record the conditioning beat", async () => {
    process.env.REMIX_GENERATION_PROVIDER_KIND = "audio-conditioned";
    try {
      const created = await createProject("Beat conditioned", "variation");
      await projectService.updateProject(OWNER_ID, created.id, { beat: BEAT });
      // Provider mocked at its boundary; it echoes the beat it conditioned
      // on, exactly like AudioConditionedRemixGenerationProvider.
      layerProvider.createRemixDraft.mockImplementationOnce(
        async (input: { renderBeat?: { beat: unknown } }) => ({
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
          ...(input.renderBeat
            ? {
                conditioningBeat: {
                  beat: input.renderBeat.beat,
                  beatDspVersion: "remix-beat-dsp/v1",
                },
              }
            : {}),
        }),
      );
      await projectService.generateDraft(OWNER_ID, created.id, {});
      await processQueued();

      expect(layeredRenderer.render).not.toHaveBeenCalled();
      const completed = await projectService.getProject(OWNER_ID, created.id);
      const metadata = completed.generationMetadata as Record<string, unknown>;
      expect(metadata.status).toBe("completed");
      expect(metadata.conditioningBeat).toEqual({
        beat: BEAT,
        beatDspVersion: "remix-beat-dsp/v1",
      });
    } finally {
      process.env.REMIX_GENERATION_PROVIDER_KIND = "lyria";
    }
  });
});
