/**
 * AI parts in the render (#1901 S4 PR 2) — Integration Test (Testcontainers).
 *
 * A stem_mix draft whose project has AI parts, rendered end to end with the
 * REAL stem-mix renderer and ffmpeg mixer (storage mocked in memory at its
 * boundary): audible parts are fetched from storage, laid out and mixed;
 * missing / not-ready / foreign takes are skipped with a reason; muted parts
 * are left out; the draft becomes AI-assisted (stem_plus_ai, aiGenerated)
 * with the parts lineage; and rendering is FREE — the real credit ledger
 * records nothing for the draft job. Gated on ffmpeg.
 *
 * Run: npm run test:integration
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  type RemixGenerationJobData,
} from "../modules/remix/remix-project.service";
import { FfmpegStemAudioMixer } from "../modules/remix/stem-audio-mixer";
import { FfmpegStemMixRenderer } from "../modules/remix/remix-stem-mix.renderer";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { REMIX_PARTS_SCHEMA_VERSION } from "../modules/remix/remix-parts";

jest.setTimeout(240_000);

const TEST_PREFIX = `remixpartsrender_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const STEM_ID = `${TEST_PREFIX}stem_keys`;

// 120 bpm, 32 s → two 8-bar (16 s) sections, no pickup.
const BAR_FEATURES = {
  schemaVersion: "stem-audio-features/v1",
  tempoBpm: 120,
  tempoConfidence: 0.9,
  firstBeatSec: 0,
  durationSeconds: 32,
  key: { tonic: "A", mode: "minor", confidence: 0.3 },
};

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const describeWithFfmpeg = ffmpegAvailable ? describe : describe.skip;

/** ffmpeg-synthesized audio bytes (sine), written through a temp file. */
function synth(seconds: number, hz: number, format: "wav" | "flac"): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "remix-parts-int-"));
  try {
    const out = join(dir, `audio.${format}`);
    execFileSync(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=48000:duration=${seconds}`,
        "-ac", "2", "-sample_fmt", "s16",
        ...(format === "flac" ? ["-c:a", "flac"] : ["-c:a", "pcm_s16le"]),
        out,
      ],
      { stdio: "ignore", timeout: 60_000 },
    );
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function renderSeconds(buffer: Buffer): number {
  const dir = mkdtempSync(join(tmpdir(), "remix-parts-int-out-"));
  try {
    const out = join(dir, "mix.mp3");
    writeFileSync(out, buffer);
    const raw = execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", out, "-ac", "1", "-f", "f32le", "-c:a", "pcm_f32le", "-"],
      { timeout: 60_000, maxBuffer: 256 * 1024 * 1024 },
    );
    return raw.length / 4 / 48_000;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const objects = new Map<string, Buffer>();
const storageProvider = {
  upload: jest.fn(async (data: Buffer, filename: string) => {
    const uri = `mem://${filename}`;
    objects.set(uri, Buffer.from(data));
    return { uri, provider: "local" as const };
  }),
  download: jest.fn(async (uri: string) => objects.get(uri) ?? null),
  downloadRange: jest.fn(),
  delete: jest.fn(async (uri: string) => {
    objects.delete(uri);
  }),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };

describeWithFfmpeg("AI parts in the stem_mix render (#1901, integration)", () => {
  const credits = new GenerationCreditsService(
    { get: (_key: string, fallback?: unknown) => fallback } as never,
  );
  let eventBus: EventBus;
  let service: RemixProjectService;
  let takeAudio: Buffer;

  beforeAll(async () => {
    eventBus = new EventBus();
    takeAudio = synth(8, 330, "flac"); // 4 bars at 120 bpm
    await prisma.user.create({
      data: { id: OWNER_ID, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: OWNER_ID,
        displayName: "Parts Render Artist",
        payoutAddress: `0x${"d5".repeat(20)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Parts Render Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: `${TEST_PREFIX}release`,
        title: "Parts Render Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: {
        id: STEM_ID,
        trackId: TRACK_ID,
        type: "keys",
        uri: "db://bytes",
        data: synth(32, 220, "wav"),
        audioFeatures: BAR_FEATURES,
      },
    });
    const mixer = new FfmpegStemAudioMixer(
      storageProvider as never,
      { decryptForRender: jest.fn() } as never,
    );
    service = new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      { createRemixDraft: jest.fn() } as never,
      new FfmpegStemMixRenderer(mixer, storageProvider as never),
      storageProvider as never,
      generationQueue as never,
      credits as never,
    );
  });

  afterAll(async () => {
    await prisma.generationCostRecord.deleteMany({ where: { userId: OWNER_ID } });
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: OWNER_ID } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: OWNER_ID } });
    await prisma.remixPartTake.deleteMany({ where: { userId: OWNER_ID } });
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
    jest.clearAllMocks();
    generationQueue.add.mockResolvedValue({ id: "queued" });
  });

  async function createProject(title: string) {
    return service.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [STEM_ID],
      title,
      mode: "stem_mix",
    });
  }

  async function seedTake(
    projectId: string,
    role: string,
    status = "completed",
    withAudio = true,
  ) {
    const storageUri = withAudio ? `mem://take-${projectId}-${role}-${Math.random()}` : null;
    if (storageUri) objects.set(storageUri, takeAudio);
    return prisma.remixPartTake.create({
      data: {
        projectId,
        userId: OWNER_ID,
        batchId: "seed",
        role,
        bars: 4,
        seed: 7,
        status,
        promptVersion: "remix-part-prompt/v1",
        provider: "stub",
        model: "stub-clip",
        grounding: "feature_conditioned",
        costCents: 10,
        storageUri,
        mimeType: "audio/flac",
        conform: { conformVersion: "remix-part-conform/v1" },
      },
    });
  }

  async function renderDraft(projectId: string) {
    await service.generateDraft(OWNER_ID, projectId, {});
    const queued = generationQueue.add.mock.calls.at(-1)?.[1] as RemixGenerationJobData;
    await service.processGenerationJob(queued);
    const row = await prisma.remixProject.findUniqueOrThrow({ where: { id: projectId } });
    return { jobId: queued.jobId, metadata: row.generationMetadata as Record<string, any> };
  }

  it("mixes audible parts, skips the rest with a reason, marks the draft AI-assisted, and charges nothing", async () => {
    const project = await createProject("Parts render");
    const keys = await seedTake(project.id, "keys");
    const drums = await seedTake(project.id, "drums");
    const pending = await seedTake(project.id, "bass", "processing");
    await prisma.remixProject.update({
      where: { id: project.id },
      data: {
        parts: {
          schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
          parts: [
            { id: "keys-1", role: "keys", takeId: keys.id, gainDb: -3, blocks: [false, true] },
            { id: "drums-1", role: "drums", takeId: drums.id },
            { id: "bass-1", role: "bass", takeId: pending.id },
            { id: "ghost", role: "pad", takeId: "no-such-take" },
          ],
        },
      },
    });
    const balanceBefore = (await credits.getBalance(OWNER_ID)).balanceCents;
    const completed: unknown[] = [];
    const subscription = eventBus.subscribe("remix.generation_completed", (event) => {
      completed.push(event);
    });

    const { jobId, metadata } = await renderDraft(project.id);
    subscription.unsubscribe();

    expect(metadata.status).toBe("completed");
    expect(metadata).toMatchObject({ grounding: "stem_plus_ai", aiGenerated: true });
    expect(metadata.renderMetadata).toMatchObject({
      inputCount: 3,
      activeStemCount: 1,
      partsDspVersion: "remix-parts-dsp/v1",
      addedParts: ["ai_part"],
      parts: [
        {
          partId: "keys-1",
          role: "keys",
          takeId: keys.id,
          provider: "stub",
          model: "stub-clip",
          promptVersion: "remix-part-prompt/v1",
          conformVersion: "remix-part-conform/v1",
          bars: 4,
          gainDb: -3,
        },
        { partId: "drums-1", role: "drums", takeId: drums.id, gainDb: 0 },
      ],
    });
    expect(metadata.renderMetadata.partsSkipped).toEqual([
      { partId: "bass-1", takeId: pending.id, reason: "take_not_ready" },
      { partId: "ghost", takeId: "no-such-take", reason: "take_missing" },
    ]);
    // No storage URI leaks into the recorded lineage.
    expect(JSON.stringify(metadata.renderMetadata)).not.toContain("mem://");
    expect(completed).toEqual([
      expect.objectContaining({ grounding: "stem_plus_ai", aiGenerated: true }),
    ]);

    // Rendering with parts is free: nothing on the ledger for this draft.
    const ledger = await prisma.generationCreditTransaction.findMany({
      where: { userId: OWNER_ID, jobId },
    });
    expect(ledger).toEqual([]);
    expect((await credits.getBalance(OWNER_ID)).balanceCents).toBe(balanceBefore);

    const output = objects.get(metadata.output.outputUri)!;
    expect(Math.abs(renderSeconds(output) - 32)).toBeLessThan(0.2);
  });

  it("parts take the keep-pitch tempo stretch like stems", async () => {
    const project = await createProject("Parts stretch");
    const drums = await seedTake(project.id, "drums");
    const keys = await seedTake(project.id, "keys");
    await prisma.remixProject.update({
      where: { id: project.id },
      data: {
        effects: {
          schemaVersion: "remix-fx/v2",
          master: { speed: 0.8, keepPitch: true, semitones: 2 },
        },
        parts: {
          schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
          parts: [
            { id: "d", role: "drums", takeId: drums.id },
            { id: "k", role: "keys", takeId: keys.id },
          ],
        },
      },
    });
    const { metadata } = await renderDraft(project.id);
    expect(metadata.status).toBe("completed");
    expect(metadata.renderMetadata.parts).toHaveLength(2);
    expect(metadata.renderMetadata.stretch).toMatchObject({ tempo: 0.8, semitones: 2 });
    const output = objects.get(metadata.output.outputUri)!;
    expect(Math.abs(renderSeconds(output) - 32 / 0.8)).toBeLessThan(0.3);
  });

  it("muted parts only: the render is untouched and stays stem_audio", async () => {
    const project = await createProject("Muted parts");
    const keys = await seedTake(project.id, "keys");
    await prisma.remixProject.update({
      where: { id: project.id },
      data: {
        parts: {
          schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
          parts: [{ id: "k", role: "keys", takeId: keys.id, muted: true }],
        },
      },
    });
    const { metadata } = await renderDraft(project.id);
    expect(metadata).toMatchObject({ grounding: "stem_audio", aiGenerated: false });
    expect(metadata.renderMetadata.inputCount).toBe(1);
    expect("parts" in metadata.renderMetadata).toBe(false);
    expect("addedParts" in metadata.renderMetadata).toBe(false);
  });

  it("only skipped parts (incl. another project's take): recorded, the draft stays stem_audio", async () => {
    const project = await createProject("Skipped parts");
    const other = await createProject("Other project");
    const foreign = await seedTake(other.id, "keys");
    const keys = await seedTake(project.id, "keys");
    await prisma.remixProject.update({
      where: { id: project.id },
      data: {
        parts: {
          schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
          parts: [
            { id: "ghost", role: "keys", takeId: "missing-take" },
            // Another project's take is never readable here (owner-only).
            { id: "foreign", role: "keys", takeId: foreign.id },
            // A take of another role is not this part's take.
            { id: "wrong-role", role: "pad", takeId: keys.id },
          ],
        },
      },
    });
    const { metadata } = await renderDraft(project.id);
    expect(metadata).toMatchObject({ grounding: "stem_audio", aiGenerated: false });
    expect(metadata.renderMetadata).toMatchObject({
      inputCount: 1,
      parts: [],
      partsSkipped: [
        { partId: "ghost", takeId: "missing-take", reason: "take_missing" },
        { partId: "foreign", takeId: foreign.id, reason: "take_missing" },
        { partId: "wrong-role", takeId: keys.id, reason: "take_missing" },
      ],
    });
    expect("addedParts" in metadata.renderMetadata).toBe(false);
  });
});
