/**
 * Stem export (#2550, S6f-1 of #1903) — Integration Test (Testcontainers)
 *
 * Against real Postgres: "Also render stems" is a Pro tool for Mix stems
 * drafts only; the worker passes it to the renderer with the stems' labels
 * and stores the rendered stems with the draft; the project says whether
 * stems can be exported; the stems export streams a zip (manifest first,
 * then one file at a time); a deleted draft version takes its stems along.
 * The renderer is mocked at its boundary (the graph and a real ffmpeg render
 * are covered by remix-stems.spec.ts).
 *
 * Run: npm run test:integration
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  type RemixGenerationJobData,
  type RemixStreamedExport,
} from "../modules/remix/remix-project.service";
import {
  RemixEntitlementsService,
  type RemixEntitlementDecision,
} from "../modules/remix/remix-entitlements";
import { renderedStemsRecord } from "../modules/remix/remix-stems";
import { stubGenerationCredits } from "./e2e-helpers";

class DenyingEntitlements extends RemixEntitlementsService {
  async pro(): Promise<RemixEntitlementDecision> {
    return {
      allowed: false,
      reason: "not_subscribed",
      policyVersion: "remix-pro-policy/test-deny",
    };
  }
}

const TEST_PREFIX = `remixstems_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCALS_STEM_ID = `${TEST_PREFIX}stem_a_vocals`;
const DRUMS_STEM_ID = `${TEST_PREFIX}stem_b_drums`;

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
  delete: jest.fn().mockResolvedValue(undefined),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };

let renderCount = 0;
const stemMixRenderer = {
  render: jest.fn(async (input: { renderStems?: unknown }) => {
    renderCount += 1;
    const n = renderCount;
    return {
      provider: "stem-mix-render",
      jobId: `stem-mix-job-${n}`,
      estimatedCostUsd: 0,
      ...(input.renderStems
        ? {
            renderedStems: renderedStemsRecord([
              { name: "01-vocals.flac", kind: "stem", label: "Vocals", stemId: VOCALS_STEM_ID, uri: `local://stem-v-${n}.flac`, bytes: 4 },
              { name: "02-drums.flac", kind: "stem", label: "Drums", stemId: DRUMS_STEM_ID, uri: `local://stem-d-${n}.flac`, bytes: 4 },
            ]),
          }
        : {}),
      outputMetadata: {
        outputUri: `local://stem-mix-${n}.mp3`,
        mimeType: "audio/mpeg",
        synthIdPresent: false,
        seed: null,
        sampleRate: 48000,
      },
    };
  }),
};

/** Names of the entries in a stored ZIP, from its central directory. */
function zipEntryNames(zip: Buffer): string[] {
  const end = zip.length - 22;
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const nameLength = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength;
  }
  return names;
}

describe("Remix stem export (#2550, integration)", () => {
  let eventBus: EventBus;

  function service(entitlements?: RemixEntitlementsService) {
    return new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      {} as never,
      stemMixRenderer as never,
      storageProvider as never,
      generationQueue as never,
      stubGenerationCredits() as never,
      undefined,
      undefined,
      entitlements,
    );
  }

  beforeAll(async () => {
    eventBus = new EventBus();
    await prisma.user.create({
      data: { id: OWNER_ID, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    // The owner owns the source artist: export is allowed on their own work.
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: OWNER_ID,
        displayName: "Stems Artist",
        payoutAddress: `0x${"c4".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Stems Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Stems Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.createMany({
      data: [
        { id: VOCALS_STEM_ID, trackId: TRACK_ID, type: "vocals", title: "Vocals", uri: "local://v", audioFeatures: BAR_FEATURES },
        { id: DRUMS_STEM_ID, trackId: TRACK_ID, type: "drums", uri: "local://d", audioFeatures: BAR_FEATURES },
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
    generationQueue.add.mockClear();
    stemMixRenderer.render.mockClear();
    storageProvider.download.mockReset();
    storageProvider.delete.mockClear();
  });

  async function createProject(
    projectService: RemixProjectService,
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

  async function processQueued(projectService: RemixProjectService) {
    const queued = generationQueue.add.mock.calls.at(-1)?.[1] as RemixGenerationJobData;
    return { queued, result: await projectService.processGenerationJob(queued) };
  }

  it("refuses stems for an AI draft and without Pro, before queueing", async () => {
    const projectService = service();
    const variation = await createProject(projectService, "Stems variation", "variation");
    await expect(
      projectService.generateDraft(OWNER_ID, variation.id, { renderStems: true }),
    ).rejects.toThrow(BadRequestException);

    const mix = await createProject(projectService, "Stems no pro");
    const denied = service(new DenyingEntitlements());
    const attempt = denied.generateDraft(OWNER_ID, mix.id, { renderStems: true });
    await expect(attempt).rejects.toThrow(ForbiddenException);
    await attempt.catch((error: ForbiddenException) => {
      expect(error.getResponse()).toMatchObject({
        code: "pro_required",
        fields: ["renderStems"],
      });
    });
    expect(generationQueue.add).not.toHaveBeenCalled();
  });

  it("renders, stores and streams the stems; a deleted version takes them along", async () => {
    const projectService = service();
    const project = await createProject(projectService, "Night Drive / Stems");

    await projectService.generateDraft(OWNER_ID, project.id, { renderStems: true });
    const { queued } = await processQueued(projectService);
    expect(queued.renderStems).toBe(true);
    const renderInput = stemMixRenderer.render.mock.calls.at(-1)?.[0] as {
      renderStems?: { stemLabels: Record<string, string> };
    };
    // Catalog title first, the stem type otherwise.
    expect(renderInput.renderStems).toEqual({
      stemLabels: { [VOCALS_STEM_ID]: "Vocals", [DRUMS_STEM_ID]: "drums" },
    });

    const view = await projectService.getProject(OWNER_ID, project.id);
    expect(view.stemsExport).toEqual({ available: true, reason: null });
    const row = await prisma.remixProject.findUniqueOrThrow({
      where: { id: project.id },
    });
    const firstStems = (row.generationMetadata as { stems: { files: Array<{ uri: string }> } }).stems;
    expect(firstStems.files.map((file) => file.uri)).toHaveLength(2);

    storageProvider.download.mockImplementation(async (uri: string) =>
      Buffer.from(uri.includes("stem-v") ? "VVVV" : "DDDD"),
    );
    const download = (await projectService.exportDraft(
      OWNER_ID,
      project.id,
      "stems",
    )) as RemixStreamedExport;
    expect(download.streamed).toBe(true);
    expect(download.filename).toBe("Night-Drive-Stems-Stems.zip");
    const chunks: Buffer[] = [];
    await download.writeTo(async (chunk) => {
      chunks.push(chunk);
    });
    const zip = Buffer.concat(chunks);
    expect(zipEntryNames(zip)).toEqual(["stems.json", "01-vocals.flac", "02-drums.flac"]);
    // The first local entry is the manifest: header, name, then its bytes.
    const manifestSize = zip.readUInt32LE(18);
    const manifestStart = 30 + zip.readUInt16LE(26);
    const manifest = JSON.parse(
      zip.subarray(manifestStart, manifestStart + manifestSize).toString(),
    );
    expect(manifest).toMatchObject({
      schemaVersion: "resonate-stems/v1",
      lineage: { remixProjectId: project.id, sourceTrackId: TRACK_ID },
    });
    expect(JSON.stringify(manifest)).not.toContain("local://");

    // A render without stems replaces the current draft: the old version
    // keeps its stems until it is deleted.
    await projectService.generateDraft(OWNER_ID, project.id, { retry: true });
    await processQueued(projectService);
    const after = await projectService.getProject(OWNER_ID, project.id);
    expect(after.stemsExport).toEqual({ available: false, reason: "no_stems" });
    await expect(
      projectService.exportDraft(OWNER_ID, project.id, "stems"),
    ).rejects.toThrow(ConflictException);

    const archived = (
      (await prisma.remixProject.findUniqueOrThrow({ where: { id: project.id } }))
        .generationMetadata as { previousDrafts: Array<{ jobId: string; stemUris?: string[] }> }
    ).previousDrafts;
    expect(archived[0].stemUris).toEqual(firstStems.files.map((file) => file.uri));
    await projectService.deleteDraftVersion(OWNER_ID, project.id, archived[0].jobId);
    const deleted = storageProvider.delete.mock.calls.map(([uri]) => uri);
    expect(deleted).toEqual(expect.arrayContaining(firstStems.files.map((file) => file.uri)));
  });

  it("needs Pro to export stems", async () => {
    const projectService = service();
    const project = await createProject(projectService, "Stems export pro");
    await projectService.generateDraft(OWNER_ID, project.id, { renderStems: true });
    await processQueued(projectService);
    await expect(
      service(new DenyingEntitlements()).exportDraft(OWNER_ID, project.id, "stems"),
    ).rejects.toThrow(ForbiddenException);
    expect(storageProvider.download).not.toHaveBeenCalled();
  });
});
