/**
 * Section-grid arrangement (#1314) — Integration Test (Testcontainers)
 *
 * Against real Postgres: sectionGrid on project reads, PATCH mask
 * persistence/validation/reset, and the worker deriving activeIntervals from
 * persisted masks for the stem_mix render path.
 *
 * Run: npm run test:integration
 */

import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { RemixProjectService } from "../modules/remix/remix-project.service";
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";
import { REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION } from "../modules/remix/remix-arrangement";

const TEST_PREFIX = `remixarr_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCALS_STEM_ID = `${TEST_PREFIX}stem_vocals`;
const DRUMS_STEM_ID = `${TEST_PREFIX}stem_drums`;

// 120 BPM, anchor 0, 64s → 4 sections at 0/16/32/48/64.
const MEASURED_FEATURES = {
  schemaVersion: "stem-audio-features/v1",
  tempoBpm: 120,
  tempoConfidence: 0.8,
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
    jobId: "render-job",
    provider: "stem-mix-render",
    estimatedCostUsd: 0,
    outputMetadata: {
      outputUri: "local://arr-render.mp3",
      mimeType: "audio/mpeg",
      synthIdPresent: false,
      seed: null,
      sampleRate: null,
    },
  }),
};

const mask = (sections: boolean[]) => ({
  schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
  sections,
});

describe("Remix section-grid arrangement (#1314, integration)", () => {
  let projectService: RemixProjectService;
  let eventBus: EventBus;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: OWNER_ID, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: OWNER_ID,
        displayName: "Arrangement Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Arrangement Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Arrangement Track",
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
          audioFeatures: MEASURED_FEATURES,
        },
        {
          id: DRUMS_STEM_ID,
          trackId: TRACK_ID,
          type: "drums",
          uri: "local://d",
          audioFeatures: MEASURED_FEATURES,
        },
      ],
    });
  });

  afterAll(async () => {
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
    stemMixRenderer.render.mockClear();
    generationQueue.add.mockClear();
    projectService = new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      new StubRemixGenerationProvider(),
      stemMixRenderer as never,
      storageProvider as never,
      generationQueue as never,
    );
  });

  async function createProject(title: string) {
    return projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID, DRUMS_STEM_ID],
      title,
    });
  }

  it("serves the derived section grid on project reads", async () => {
    const created = await createProject("Grid read");
    const project = (await projectService.getProject(
      OWNER_ID,
      created.id,
    )) as { sectionGrid?: { kind: string; sections: unknown[]; bpm: number | null } };
    expect(project.sectionGrid).toMatchObject({ kind: "bars", bpm: 120 });
    expect(project.sectionGrid!.sections).toEqual([
      { startSec: 0, endSec: 16 },
      { startSec: 16, endSec: 32 },
      { startSec: 32, endSec: 48 },
      { startSec: 48, endSec: 64 },
    ]);
  });

  it("persists a valid mask, rejects wrong lengths, and resets on null", async () => {
    const created = await createProject("Mask CRUD");

    const updated = await projectService.updateProject(OWNER_ID, created.id, {
      stems: [
        { stemId: DRUMS_STEM_ID, arrangement: mask([false, true, true, false]) },
      ],
    });
    const drums = updated.stems.find((stem) => stem.stemId === DRUMS_STEM_ID);
    expect(drums?.arrangement).toEqual(mask([false, true, true, false]));

    // Survives a fresh read.
    const reread = await projectService.getProject(OWNER_ID, created.id);
    expect(
      reread.stems.find((stem) => stem.stemId === DRUMS_STEM_ID)?.arrangement,
    ).toEqual(mask([false, true, true, false]));

    // Wrong length for this grid → 400.
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        stems: [{ stemId: DRUMS_STEM_ID, arrangement: mask([true, false]) }],
      }),
    ).rejects.toThrow(BadRequestException);

    // Foreign shape → 400.
    await expect(
      projectService.updateProject(OWNER_ID, created.id, {
        stems: [
          { stemId: DRUMS_STEM_ID, arrangement: { bogus: true } as never },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    // null restores the always-on default.
    const cleared = await projectService.updateProject(OWNER_ID, created.id, {
      stems: [{ stemId: DRUMS_STEM_ID, arrangement: null }],
    });
    expect(
      cleared.stems.find((stem) => stem.stemId === DRUMS_STEM_ID)?.arrangement,
    ).toBeNull();
  });

  it("derives activeIntervals from persisted masks for the stem_mix render", async () => {
    const created = await createProject("Render gating");
    await projectService.updateProject(OWNER_ID, created.id, {
      stems: [
        // Drums drop out of section 2 (32–48s); adjacent on-sections merge.
        { stemId: DRUMS_STEM_ID, arrangement: mask([true, true, false, true]) },
      ],
    });

    await projectService.generateDraft(OWNER_ID, created.id);
    const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as never;
    await projectService.processGenerationJob(queuedData);

    expect(stemMixRenderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        remixProjectId: created.id,
        stems: expect.arrayContaining([
          // Fully-active stem carries no gating at all (pre-#1314 identical).
          expect.objectContaining({
            stemId: VOCALS_STEM_ID,
            muted: false,
          }),
          expect.objectContaining({
            stemId: DRUMS_STEM_ID,
            activeIntervals: [
              { startSec: 0, endSec: 32 },
              { startSec: 48, endSec: 64 },
            ],
          }),
        ]),
      }),
    );
    const call = stemMixRenderer.render.mock.calls.at(-1)?.[0] as {
      stems: Array<{ stemId: string; activeIntervals?: unknown }>;
    };
    const vocals = call.stems.find((stem) => stem.stemId === VOCALS_STEM_ID);
    expect(vocals && "activeIntervals" in vocals).toBe(false);
  });
});
