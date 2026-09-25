/**
 * Per-stem AI transforms (#1316) — Integration Test (Testcontainers)
 *
 * Against real Postgres with the lyria layered path mocked at the provider
 * boundary: replace_stem conditions and renders on the bed (target excluded),
 * add_layer keeps the full bed, metadata records the transform, and invalid
 * transforms fail before any provider work.
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

const TEST_PREFIX = `remixtr_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCALS_STEM_ID = `${TEST_PREFIX}stem_a_vocals`;
const DRUMS_STEM_ID = `${TEST_PREFIX}stem_b_drums`;

const storageProvider = {
  upload: jest.fn(),
  download: jest.fn(),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };
const stemMixRenderer = { render: jest.fn() };
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

describe("Remix per-stem transforms (#1316, integration)", () => {
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
        displayName: "Transform Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Transform Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Transform Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.createMany({
      data: [
        { id: VOCALS_STEM_ID, trackId: TRACK_ID, type: "vocals", uri: "local://v" },
        { id: DRUMS_STEM_ID, trackId: TRACK_ID, type: "drums", uri: "local://d" },
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

  async function createVariationProject(title: string, prompt: string) {
    return projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID, DRUMS_STEM_ID],
      title,
      mode: "variation",
      prompt,
    });
  }

  async function processQueued() {
    const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as
      RemixGenerationJobData;
    return projectService.processGenerationJob(queuedData);
  }

  it("replace_stem conditions and renders on the bed, excluding the target", async () => {
    const created = await createVariationProject("Replace drums", "darker, halftime");
    const pending = await projectService.generateDraft(OWNER_ID, created.id, {
      stemTransform: { kind: "replace_stem", stemId: DRUMS_STEM_ID },
    });

    // Enqueue metadata records the labelled transform.
    expect(pending.generationMetadata).toEqual(
      expect.objectContaining({
        status: "pending",
        grounding: "stem_plus_ai",
        stemTransform: {
          kind: "replace_stem",
          stemId: DRUMS_STEM_ID,
          stemLabel: "drums",
        },
      }),
    );

    await processQueued();

    // Provider conditioning bed excludes the replaced stem.
    const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
    expect(providerInput.stemTransform).toEqual({
      kind: "replace_stem",
      stemId: DRUMS_STEM_ID,
      stemLabel: "drums",
    });
    expect(
      providerInput.stemArrangement.map((stem: { stemId: string }) => stem.stemId),
    ).toEqual([VOCALS_STEM_ID]);

    // The layered render mixes the layer over the same bed.
    const renderInput = layeredRenderer.render.mock.calls.at(-1)?.[0];
    expect(
      renderInput.stems.map((stem: { stemId: string }) => stem.stemId),
    ).toEqual([VOCALS_STEM_ID]);

    // Completed metadata keeps the transform for the studio + publish lineage.
    const completed = await projectService.getProject(OWNER_ID, created.id);
    expect(completed.generationMetadata).toEqual(
      expect.objectContaining({
        status: "completed",
        stemTransform: expect.objectContaining({ kind: "replace_stem" }),
      }),
    );
  });

  it("add_layer keeps the full arrangement as the bed", async () => {
    const created = await createVariationProject("Add pad", "warm synth pad");
    await projectService.generateDraft(OWNER_ID, created.id, {
      stemTransform: { kind: "add_layer" },
    });
    await processQueued();

    const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
    expect(
      providerInput.stemArrangement
        .map((stem: { stemId: string }) => stem.stemId)
        .sort(),
    ).toEqual([VOCALS_STEM_ID, DRUMS_STEM_ID].sort());
    expect(providerInput.stemTransform).toEqual({ kind: "add_layer" });
  });

  it("whole-track generation is unchanged when no transform is sent", async () => {
    const created = await createVariationProject("Whole track", "lo-fi flip");
    const pending = await projectService.generateDraft(OWNER_ID, created.id, {});
    expect(
      (pending.generationMetadata as Record<string, unknown>).stemTransform,
    ).toBeUndefined();
    await processQueued();
    const providerInput = layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
    expect(providerInput.stemArrangement).toHaveLength(2);
    expect("stemTransform" in providerInput).toBe(false);
  });

  it("rejects invalid transforms before any provider work", async () => {
    // stem_mix mode: transforms do not apply.
    const stemMix = await projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID],
      title: "Stem mix",
    });
    await expect(
      projectService.generateDraft(OWNER_ID, stemMix.id, {
        stemTransform: { kind: "add_layer" },
      }),
    ).rejects.toThrow(BadRequestException);

    // Unknown target stem.
    const variation = await createVariationProject("Bad target", "prompt");
    await expect(
      projectService.generateDraft(OWNER_ID, variation.id, {
        stemTransform: { kind: "replace_stem", stemId: "nope" },
      }),
    ).rejects.toThrow(BadRequestException);

    // Replacing the only unmuted stem leaves an empty bed.
    await projectService.updateProject(OWNER_ID, variation.id, {
      stems: [{ stemId: VOCALS_STEM_ID, muted: true }],
    });
    await expect(
      projectService.generateDraft(OWNER_ID, variation.id, {
        stemTransform: { kind: "replace_stem", stemId: DRUMS_STEM_ID },
      }),
    ).rejects.toThrow(/no unmuted stems/);

    expect(layerProvider.createRemixDraft).not.toHaveBeenCalled();
  });

  describe("persisted AI target (#1882)", () => {
    it("PATCH persists, returns, normalizes, and clears aiTarget", async () => {
      const created = await createVariationProject("Target persist", "prompt");
      expect(created.aiTarget).toBeNull();

      const saved = await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "replace_stem", stemId: DRUMS_STEM_ID },
      });
      expect(saved.aiTarget).toEqual({
        kind: "replace_stem",
        stemId: DRUMS_STEM_ID,
      });

      // Reads (get + list) carry the saved target.
      const reopened = await projectService.getProject(OWNER_ID, created.id);
      expect(reopened.aiTarget).toEqual({
        kind: "replace_stem",
        stemId: DRUMS_STEM_ID,
      });
      const listed = await projectService.listProjects(OWNER_ID);
      expect(listed.find((p) => p.id === created.id)?.aiTarget).toEqual({
        kind: "replace_stem",
        stemId: DRUMS_STEM_ID,
      });

      // Undefined leaves it unchanged.
      const renamed = await projectService.updateProject(OWNER_ID, created.id, {
        title: "Target persist renamed",
      });
      expect(renamed.aiTarget).toEqual({
        kind: "replace_stem",
        stemId: DRUMS_STEM_ID,
      });

      // replace_stem without a stem yet is allowed.
      const noStem = await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "replace_stem" },
      });
      expect(noStem.aiTarget).toEqual({ kind: "replace_stem", stemId: null });

      const layer = await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "add_layer", stemId: null },
      });
      expect(layer.aiTarget).toEqual({ kind: "add_layer", stemId: null });

      // whole normalizes to null (stored as SQL NULL).
      const whole = await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "whole" },
      });
      expect(whole.aiTarget).toBeNull();
      const wholeRow = await prisma.remixProject.findUnique({
        where: { id: created.id },
        select: { aiTarget: true },
      });
      expect(wholeRow?.aiTarget).toBeNull();

      // null clears it.
      await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "add_layer" },
      });
      const cleared = await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: null,
      });
      expect(cleared.aiTarget).toBeNull();
      const clearedRow = await prisma.remixProject.findUnique({
        where: { id: created.id },
        select: { aiTarget: true },
      });
      expect(clearedRow?.aiTarget).toBeNull();
    });

    it("PATCH rejects invalid targets with 400", async () => {
      const created = await createVariationProject("Target invalid", "prompt");
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          aiTarget: { kind: "replace_stem", stemId: "not-a-project-stem" },
        }),
      ).rejects.toThrow(/not part of this project/);
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          aiTarget: { kind: "add_layer", stemId: DRUMS_STEM_ID },
        }),
      ).rejects.toThrow(/only applies to replace_stem/);
      await expect(
        projectService.updateProject(OWNER_ID, created.id, {
          aiTarget: { kind: "remix_all" },
        }),
      ).rejects.toThrow(BadRequestException);

      const unchanged = await projectService.getProject(OWNER_ID, created.id);
      expect(unchanged.aiTarget).toBeNull();
    });

    it("generate falls back to the saved replace_stem target", async () => {
      const created = await createVariationProject("Saved replace", "halftime");
      await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "replace_stem", stemId: DRUMS_STEM_ID },
      });

      const pending = await projectService.generateDraft(OWNER_ID, created.id, {});
      expect(pending.generationMetadata).toEqual(
        expect.objectContaining({
          stemTransform: {
            kind: "replace_stem",
            stemId: DRUMS_STEM_ID,
            stemLabel: "drums",
          },
        }),
      );
      expect(pending.aiTarget).toEqual({
        kind: "replace_stem",
        stemId: DRUMS_STEM_ID,
      });

      await processQueued();
      const providerInput =
        layerProvider.createRemixDraft.mock.calls.at(-1)?.[0];
      expect(
        providerInput.stemArrangement.map(
          (stem: { stemId: string }) => stem.stemId,
        ),
      ).toEqual([VOCALS_STEM_ID]);
    });

    it("an explicit request transform wins over the saved target", async () => {
      const created = await createVariationProject("Explicit wins", "pad");
      await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "replace_stem", stemId: DRUMS_STEM_ID },
      });

      const pending = await projectService.generateDraft(OWNER_ID, created.id, {
        stemTransform: { kind: "add_layer" },
      });
      expect(
        (pending.generationMetadata as Record<string, unknown>).stemTransform,
      ).toEqual({ kind: "add_layer" });
    });

    it("a saved replace_stem without a stem makes generate 400", async () => {
      const created = await createVariationProject("No stem yet", "prompt");
      await projectService.updateProject(OWNER_ID, created.id, {
        aiTarget: { kind: "replace_stem" },
      });
      await expect(
        projectService.generateDraft(OWNER_ID, created.id, {}),
      ).rejects.toThrow("Pick the stem to replace first");
      expect(generationQueue.add).not.toHaveBeenCalled();
    });

    it("a saved replace_stem over a muted bed still fails honestly", async () => {
      const created = await createVariationProject("Muted bed", "prompt");
      await projectService.updateProject(OWNER_ID, created.id, {
        stems: [{ stemId: VOCALS_STEM_ID, muted: true }],
        aiTarget: { kind: "replace_stem", stemId: DRUMS_STEM_ID },
      });
      await expect(
        projectService.generateDraft(OWNER_ID, created.id, {}),
      ).rejects.toThrow(/no unmuted stems/);
      expect(generationQueue.add).not.toHaveBeenCalled();
    });
  });
});
