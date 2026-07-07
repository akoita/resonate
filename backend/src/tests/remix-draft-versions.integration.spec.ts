/**
 * Draft versions (#1320) — Integration Test (Testcontainers)
 *
 * Against real Postgres with the stem-mix renderer mocked: regenerating
 * archives the previous completed draft (capped), archived versions stream
 * through draft-audio?jobId, unknown versions 404, and history survives a
 * failed regeneration.
 *
 * Run: npm run test:integration
 */

import { NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  REMIX_PREVIOUS_DRAFTS_MAX,
  type RemixGenerationJobData,
} from "../modules/remix/remix-project.service";
import { stubGenerationCredits } from "./e2e-helpers";
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";

const TEST_PREFIX = `remixver_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const STEM_ID = `${TEST_PREFIX}stem_vocals`;

let renderCounter = 0;
const storageProvider = {
  upload: jest.fn(),
  // Serve distinct bytes per URI so version playback is provable.
  download: jest.fn((uri: string) => Promise.resolve(Buffer.from(`audio:${uri}`))),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };
const stemMixRenderer = {
  render: jest.fn().mockImplementation(() => {
    renderCounter += 1;
    return Promise.resolve({
      jobId: `render-${renderCounter}`,
      provider: "stem-mix-render",
      estimatedCostUsd: 0,
      outputMetadata: {
        outputUri: `local://draft-${renderCounter}.mp3`,
        mimeType: "audio/mpeg",
        synthIdPresent: false,
        seed: null,
        sampleRate: null,
      },
    });
  }),
};

describe("Remix draft versions (#1320, integration)", () => {
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
        displayName: "Versions Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Versions Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Versions Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: { id: STEM_ID, trackId: TRACK_ID, type: "vocals", uri: "local://v" },
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
    projectService = new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      new StubRemixGenerationProvider(),
      stemMixRenderer as never,
      storageProvider as never,
      generationQueue as never,
      stubGenerationCredits() as never,
    );
  });

  async function renderOnce(projectId: string, retry: boolean) {
    await projectService.generateDraft(OWNER_ID, projectId, { retry });
    const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as
      RemixGenerationJobData;
    await projectService.processGenerationJob(queuedData);
    const project = await projectService.getProject(OWNER_ID, projectId);
    return project;
  }

  it("archives the previous completed draft on regeneration and streams both versions", async () => {
    const created = await projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [STEM_ID],
      title: "Versioned session",
    });

    const first = await renderOnce(created.id, false);
    const firstJobId = first.generationJobId!;
    const firstUri = (first.generationMetadata as {
      output: { outputUri: string };
    }).output.outputUri;

    const second = await renderOnce(created.id, true);
    const metadata = second.generationMetadata as {
      output: { outputUri: string };
      previousDrafts?: Array<{ jobId: string; output: { outputUri: string } }>;
    };
    expect(metadata.output.outputUri).not.toBe(firstUri);
    expect(metadata.previousDrafts).toHaveLength(1);
    expect(metadata.previousDrafts![0]).toMatchObject({
      jobId: firstJobId,
      provider: "stem-mix-render",
      grounding: "stem_audio",
      output: { outputUri: firstUri },
    });

    // Current draft streams by default; the archived version by jobId.
    const current = await projectService.getDraftAudio(OWNER_ID, created.id);
    expect(current.data.toString()).toBe(`audio:${metadata.output.outputUri}`);
    const archived = await projectService.getDraftAudio(
      OWNER_ID,
      created.id,
      firstJobId,
    );
    expect(archived.data.toString()).toBe(`audio:${firstUri}`);

    // Unknown versions 404.
    await expect(
      projectService.getDraftAudio(OWNER_ID, created.id, "rmxgen_nope"),
    ).rejects.toThrow(NotFoundException);
  });

  it("caps the history and keeps newest-first order", async () => {
    const created = await projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [STEM_ID],
      title: "Capped history",
    });

    const jobIds: string[] = [];
    let project = await renderOnce(created.id, false);
    jobIds.push(project.generationJobId!);
    for (let i = 0; i < REMIX_PREVIOUS_DRAFTS_MAX + 1; i += 1) {
      project = await renderOnce(created.id, true);
      jobIds.push(project.generationJobId!);
    }

    const metadata = project.generationMetadata as {
      previousDrafts: Array<{ jobId: string }>;
    };
    expect(metadata.previousDrafts).toHaveLength(REMIX_PREVIOUS_DRAFTS_MAX);
    // Newest archived first; the oldest generation fell off the end.
    const expected = jobIds.slice(0, -1).reverse().slice(0, REMIX_PREVIOUS_DRAFTS_MAX);
    expect(metadata.previousDrafts.map((entry) => entry.jobId)).toEqual(expected);
    expect(metadata.previousDrafts.map((e) => e.jobId)).not.toContain(jobIds[0]);
  });

  it("keeps the archive when a regeneration fails", async () => {
    const created = await projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [STEM_ID],
      title: "Failure keeps history",
    });
    const first = await renderOnce(created.id, false);
    const firstJobId = first.generationJobId!;

    stemMixRenderer.render.mockRejectedValueOnce(new Error("render exploded"));
    await projectService.generateDraft(OWNER_ID, created.id, { retry: true });
    const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as
      RemixGenerationJobData;
    await expect(
      projectService.processGenerationJob(queuedData),
    ).rejects.toThrow();

    const after = await projectService.getProject(OWNER_ID, created.id);
    const metadata = after.generationMetadata as {
      status: string;
      previousDrafts: Array<{ jobId: string }>;
    };
    expect(metadata.status).toBe("failed");
    expect(metadata.previousDrafts.map((e) => e.jobId)).toContain(firstJobId);
    // The archived first draft is still streamable after the failure.
    const archived = await projectService.getDraftAudio(
      OWNER_ID,
      created.id,
      firstJobId,
    );
    expect(archived.data.toString()).toContain("audio:local://draft-");
  });
});
