/**
 * Draft versions (#1320) — Integration Test (Testcontainers)
 *
 * Against real Postgres with the stem-mix renderer mocked: regenerating
 * archives the previous completed draft (capped), archived versions stream
 * through draft-audio?jobId, unknown versions 404, and history survives a
 * failed regeneration. Deleting an archived version (#1910) removes the
 * entry under a row lock and deletes its audio only when nothing else
 * references the object.
 *
 * Run: npm run test:integration
 */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
const STRANGER_ID = `${TEST_PREFIX}stranger`;
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
    await prisma.user.create({
      data: { id: STRANGER_ID, email: `${TEST_PREFIX}stranger@test.resonate` },
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
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, STRANGER_ID] } } });
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

  describe("deleting a previous draft version (#1910)", () => {
    type Metadata = {
      output: { outputUri: string };
      previousDrafts?: Array<{ jobId: string; output: { outputUri: string } }>;
    };

    /** A project with a current draft and two archived versions. */
    async function projectWithHistory(title: string) {
      const created = await projectService.createProject({
        userId: OWNER_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [STEM_ID],
        title,
      });
      await renderOnce(created.id, false);
      await renderOnce(created.id, true);
      const project = await renderOnce(created.id, true);
      const metadata = project.generationMetadata as Metadata;
      expect(metadata.previousDrafts).toHaveLength(2);
      return { project, metadata };
    }

    beforeEach(() => {
      storageProvider.delete.mockReset();
      storageProvider.delete.mockResolvedValue(undefined);
    });

    it("removes the archived entry, deletes its audio, and returns the read shape", async () => {
      const { project, metadata } = await projectWithHistory("Delete one");
      const [newest, older] = metadata.previousDrafts!;
      const events: unknown[] = [];
      const subscription = eventBus.subscribe(
        "remix.draft_version_deleted",
        (event) => {
          events.push(event);
        },
      );

      const result = await projectService.deleteDraftVersion(
        OWNER_ID,
        project.id,
        older.jobId,
      );
      subscription.unsubscribe();

      const after = result.generationMetadata as Metadata;
      expect(after.previousDrafts!.map((e) => e.jobId)).toEqual([newest.jobId]);
      // The current draft is untouched.
      expect(result.generationJobId).toBe(project.generationJobId);
      expect(after.output.outputUri).toBe(metadata.output.outputUri);
      // Same shape as GET for a draft project.
      expect(result).toHaveProperty("availableStems");
      expect(result).toHaveProperty("commerce");

      expect(storageProvider.delete).toHaveBeenCalledTimes(1);
      expect(storageProvider.delete).toHaveBeenCalledWith(older.output.outputUri);

      const stored = await prisma.remixProject.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(
        (stored.generationMetadata as Metadata).previousDrafts!.map((e) => e.jobId),
      ).toEqual([newest.jobId]);
      // The deleted version no longer streams.
      await expect(
        projectService.getDraftAudio(OWNER_ID, project.id, older.jobId),
      ).rejects.toThrow(NotFoundException);
      expect(events).toEqual([
        expect.objectContaining({
          eventName: "remix.draft_version_deleted",
          remixProjectId: project.id,
          creatorId: OWNER_ID,
          generationJobId: older.jobId,
        }),
      ]);
    });

    it("drops the previousDrafts key when the last archived version is deleted", async () => {
      const created = await projectService.createProject({
        userId: OWNER_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [STEM_ID],
        title: "Delete last",
      });
      await renderOnce(created.id, false);
      const project = await renderOnce(created.id, true);
      const [only] = (project.generationMetadata as Metadata).previousDrafts!;

      const result = await projectService.deleteDraftVersion(
        OWNER_ID,
        project.id,
        only.jobId,
      );
      expect(result.generationMetadata).not.toHaveProperty("previousDrafts");
      expect(storageProvider.delete).toHaveBeenCalledWith(only.output.outputUri);
    });

    it("forbids a non-owner and changes nothing", async () => {
      const { project, metadata } = await projectWithHistory("Stranger");
      await expect(
        projectService.deleteDraftVersion(
          STRANGER_ID,
          project.id,
          metadata.previousDrafts![0].jobId,
        ),
      ).rejects.toThrow(ForbiddenException);
      const stored = await prisma.remixProject.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect((stored.generationMetadata as Metadata).previousDrafts).toHaveLength(2);
      expect(storageProvider.delete).not.toHaveBeenCalled();
    });

    it("404s a missing project", async () => {
      await expect(
        projectService.deleteDraftVersion(OWNER_ID, `${TEST_PREFIX}missing`, "x"),
      ).rejects.toThrow(NotFoundException);
    });

    it("404s an unknown version and the current draft", async () => {
      const { project } = await projectWithHistory("Not found");
      await expect(
        projectService.deleteDraftVersion(OWNER_ID, project.id, "rmxgen_nope"),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "draft_version_not_found" }),
      });
      const current = projectService.deleteDraftVersion(
        OWNER_ID,
        project.id,
        project.generationJobId!,
      );
      await expect(current).rejects.toThrow(NotFoundException);
      await expect(current).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "draft_version_not_found",
          message: expect.stringContaining("regenerate"),
        }),
      });
      expect(storageProvider.delete).not.toHaveBeenCalled();
    });

    it("409s a published project", async () => {
      const { project, metadata } = await projectWithHistory("Published lock");
      await prisma.remixProject.update({
        where: { id: project.id },
        data: { status: "published" },
      });
      await expect(
        projectService.deleteDraftVersion(
          OWNER_ID,
          project.id,
          metadata.previousDrafts![0].jobId,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: "project_published" }),
      });
      expect(storageProvider.delete).not.toHaveBeenCalled();
    });

    it("allows deleting on an archived (private, unpublished) project", async () => {
      const { project, metadata } = await projectWithHistory("Archived project");
      await prisma.remixProject.update({
        where: { id: project.id },
        data: { status: "archived" },
      });
      const target = metadata.previousDrafts![0];
      const result = await projectService.deleteDraftVersion(
        OWNER_ID,
        project.id,
        target.jobId,
      );
      expect(
        (result.generationMetadata as Metadata).previousDrafts!.map((e) => e.jobId),
      ).not.toContain(target.jobId);
      expect(storageProvider.delete).toHaveBeenCalledWith(target.output.outputUri);
    });

    it("409s while a generation is in flight", async () => {
      const { project, metadata } = await projectWithHistory("In flight");
      await prisma.remixProject.update({
        where: { id: project.id },
        data: {
          generationMetadata: {
            ...(project.generationMetadata as object),
            status: "processing",
          } as Prisma.JsonObject,
        },
      });
      await expect(
        projectService.deleteDraftVersion(
          OWNER_ID,
          project.id,
          metadata.previousDrafts![0].jobId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(storageProvider.delete).not.toHaveBeenCalled();
    });

    it("keeps the stored object when another reference shares its URI", async () => {
      const { project, metadata } = await projectWithHistory("Shared URI");
      const [newest, older] = metadata.previousDrafts!;
      // Both archived entries point at the same object.
      await prisma.remixProject.update({
        where: { id: project.id },
        data: {
          generationMetadata: {
            ...(project.generationMetadata as object),
            previousDrafts: [
              newest,
              { ...older, output: { ...older.output, outputUri: newest.output.outputUri } },
            ],
          } as unknown as Prisma.JsonObject,
        },
      });
      const result = await projectService.deleteDraftVersion(
        OWNER_ID,
        project.id,
        older.jobId,
      );
      expect(
        (result.generationMetadata as Metadata).previousDrafts!.map((e) => e.jobId),
      ).toEqual([newest.jobId]);
      expect(storageProvider.delete).not.toHaveBeenCalled();
    });

    it("keeps the stored object when it is the current draft output", async () => {
      const { project, metadata } = await projectWithHistory("Current URI");
      const [newest, older] = metadata.previousDrafts!;
      await prisma.remixProject.update({
        where: { id: project.id },
        data: {
          generationMetadata: {
            ...(project.generationMetadata as object),
            previousDrafts: [
              newest,
              { ...older, output: { ...older.output, outputUri: metadata.output.outputUri } },
            ],
          } as unknown as Prisma.JsonObject,
        },
      });
      await projectService.deleteDraftVersion(OWNER_ID, project.id, older.jobId);
      expect(storageProvider.delete).not.toHaveBeenCalled();
    });

    it("keeps the version removed when the storage delete fails", async () => {
      const { project, metadata } = await projectWithHistory("Storage fails");
      const target = metadata.previousDrafts![1];
      storageProvider.delete.mockRejectedValueOnce(new Error("gcs down"));
      const result = await projectService.deleteDraftVersion(
        OWNER_ID,
        project.id,
        target.jobId,
      );
      expect(
        (result.generationMetadata as Metadata).previousDrafts!.map((e) => e.jobId),
      ).not.toContain(target.jobId);
      expect(storageProvider.delete).toHaveBeenCalledTimes(1);
    });

    it("keeps a version deleted mid-regeneration deleted (delete commits between generateDraft's read and its claim)", async () => {
      const { project, metadata } = await projectWithHistory("Regenerate race");
      const [newest, older] = metadata.previousDrafts!;
      const currentJobId = project.generationJobId!;

      // A service whose eligibility check (awaited after generateDraft's
      // early project read, before the claim) lets a delete commit first.
      const eligibility = new RemixEligibilityService();
      const realCheck = eligibility.checkEligibility.bind(eligibility);
      let deleted = false;
      jest
        .spyOn(eligibility, "checkEligibility")
        .mockImplementation(async (...args) => {
          if (!deleted) {
            deleted = true;
            await projectService.deleteDraftVersion(
              OWNER_ID,
              project.id,
              older.jobId,
            );
          }
          return realCheck(...args);
        });
      const racingService = new RemixProjectService(
        eventBus,
        eligibility,
        new StubRemixGenerationProvider(),
        stemMixRenderer as never,
        storageProvider as never,
        generationQueue as never,
        stubGenerationCredits() as never,
      );

      await racingService.generateDraft(OWNER_ID, project.id, { retry: true });
      expect(deleted).toBe(true);
      expect(storageProvider.delete).toHaveBeenCalledWith(older.output.outputUri);

      const pending = await prisma.remixProject.findUniqueOrThrow({
        where: { id: project.id },
      });
      const pendingMeta = pending.generationMetadata as Metadata & {
        status: string;
        retryOfJobId: string;
      };
      expect(pendingMeta.status).toBe("pending");
      expect(pendingMeta.retryOfJobId).toBe(currentJobId);
      // The just-replaced draft is archived newest-first; the deleted
      // version is not resurrected from generateDraft's early read.
      expect(pendingMeta.previousDrafts!.map((e) => e.jobId)).toEqual([
        currentJobId,
        newest.jobId,
      ]);

      // …and stays gone once the job completes.
      const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as
        RemixGenerationJobData;
      await racingService.processGenerationJob(queuedData);
      const done = await projectService.getProject(OWNER_ID, project.id);
      expect(
        (done.generationMetadata as Metadata).previousDrafts!.map((e) => e.jobId),
      ).toEqual([currentJobId, newest.jobId]);
      await expect(
        projectService.getDraftAudio(OWNER_ID, project.id, older.jobId),
      ).rejects.toThrow(NotFoundException);
    });

    it("lets exactly one of two concurrent deletes remove the entry and its audio", async () => {
      const { project, metadata } = await projectWithHistory("Concurrent");
      const target = metadata.previousDrafts![1];
      // Hold the project row while both deletes start, so both have loaded
      // the same pre-delete state before either can write — a real race.
      let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "RemixProject" WHERE "id" = ${project.id} FOR UPDATE`;
        pending = Promise.allSettled([
          projectService.deleteDraftVersion(OWNER_ID, project.id, target.jobId),
          projectService.deleteDraftVersion(OWNER_ID, project.id, target.jobId),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const results = await pending!;
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(NotFoundException);
      expect(storageProvider.delete).toHaveBeenCalledTimes(1);
      expect(storageProvider.delete).toHaveBeenCalledWith(target.output.outputUri);

      const stored = await prisma.remixProject.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(
        (stored.generationMetadata as Metadata).previousDrafts!.map((e) => e.jobId),
      ).toEqual([metadata.previousDrafts![0].jobId]);
    });
  });
});
