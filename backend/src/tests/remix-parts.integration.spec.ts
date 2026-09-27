/**
 * AI parts (#1901) — Integration Test (Testcontainers Postgres).
 *
 * Money paths against the REAL GenerationCreditsService and ledger (ADR-BM-6
 * line 2: each take is one 30 s generation at the canonical per-30 s price):
 * a happy batch debits exactly once per take; 402 happens before any take
 * exists; every failure after the debit (provider, conform, storage, stale
 * claim) refunds; a worker-time shortfall charges nothing. Also: capability /
 * tempo-grid refusals, the rate limit counting takes, PATCH `parts`
 * validation, DELETE 409s, the 24-take cap with eviction, and owner-only
 * access on every route. The queue and storage are mocked at their
 * boundaries; the stub provider synthesizes real audio and the conform runs
 * for real (ffmpeg + the stretch engine).
 *
 * Run: npm run test:integration
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { execFileSync } from "child_process";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  type RemixPartTakeJobData,
} from "../modules/remix/remix-project.service";
import {
  RemixGenerationProviderError,
  StubRemixGenerationProvider,
  type RemixGenerationProvider,
} from "../modules/remix/remix-generation.provider";
import {
  GenerationCreditsService,
  InsufficientCreditsException,
} from "../modules/credits/generation-credits.service";
import {
  REMIX_PART_TAKE_JOB,
  REMIX_PARTS_SCHEMA_VERSION,
} from "../modules/remix/remix-parts";

jest.setTimeout(240_000);

const TEST_PREFIX = `remixparts_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const OTHER_ID = `${TEST_PREFIX}other`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const FLAT_TRACK_ID = `${TEST_PREFIX}flat_track`;
const STEM_ID = `${TEST_PREFIX}stem_keys`;
const FLAT_STEM_ID = `${TEST_PREFIX}stem_flat`;

// 120 bpm, 64 s → a 4-section bar grid; A minor with a usable confidence.
const BAR_FEATURES = {
  schemaVersion: "stem-audio-features/v1",
  tempoBpm: 120,
  tempoConfidence: 0.9,
  firstBeatSec: 0,
  durationSeconds: 64,
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
const itWithFfmpeg = ffmpegAvailable ? it : it.skip;

// In-memory storage at the provider boundary.
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
const stemMixRenderer = { render: jest.fn() };

describe("Remix AI parts (#1901, integration)", () => {
  const credits = new GenerationCreditsService(
    { get: (_key: string, fallback?: unknown) => fallback } as never,
  );
  let eventBus: EventBus;
  const prevEnabled = process.env.REMIX_GENERATION_ENABLED;

  function makeService(
    provider: RemixGenerationProvider = new StubRemixGenerationProvider(),
  ) {
    return new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      provider,
      stemMixRenderer as never,
      storageProvider as never,
      generationQueue as never,
      credits as never,
    );
  }

  async function createProject(
    service: RemixProjectService,
    trackId = TRACK_ID,
    stemId = STEM_ID,
  ) {
    return service.createProject({
      userId: OWNER_ID,
      sourceTrackId: trackId,
      stemIds: [stemId],
      title: `Parts ${Date.now()}`,
      mode: "stem_mix",
    });
  }

  function queuedJobs(): RemixPartTakeJobData[] {
    return generationQueue.add.mock.calls
      .filter((call) => call[0] === REMIX_PART_TAKE_JOB)
      .map((call) => call[1] as RemixPartTakeJobData);
  }

  async function ledger(takeIds: string[]) {
    return prisma.generationCreditTransaction.findMany({
      where: { userId: OWNER_ID, jobId: { in: takeIds } },
      orderBy: { createdAt: "asc" },
    });
  }

  async function balance(): Promise<number> {
    return (await credits.getBalance(OWNER_ID)).balanceCents;
  }

  /** Set the owner's balance exactly (via the real grant/debit paths). */
  async function setBalance(cents: number) {
    const current = await balance();
    if (current < cents) await credits.grant(OWNER_ID, cents - current, "test_grant");
    if (current > cents) await credits.debit(OWNER_ID, current - cents, "test_drain");
  }

  async function seedTake(
    projectId: string,
    overrides: Partial<{
      role: string;
      status: string;
      createdAt: Date;
      storageUri: string | null;
      userId: string;
    }> = {},
  ) {
    const storageUri =
      overrides.storageUri === undefined
        ? `mem://seed-${projectId}-${Math.random()}`
        : overrides.storageUri;
    if (storageUri) objects.set(storageUri, Buffer.from("fLaCseed"));
    return prisma.remixPartTake.create({
      data: {
        projectId,
        userId: overrides.userId ?? OWNER_ID,
        batchId: "seed",
        role: overrides.role ?? "keys",
        bars: 4,
        seed: 1,
        status: overrides.status ?? "completed",
        promptVersion: "remix-part-prompt/v1",
        grounding: "feature_conditioned",
        costCents: 10,
        storageUri,
        mimeType: "audio/flac",
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
  }

  beforeAll(async () => {
    process.env.REMIX_GENERATION_ENABLED = "true";
    eventBus = new EventBus();
    await prisma.user.create({
      data: { id: OWNER_ID, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    await prisma.user.create({
      data: { id: OTHER_ID, email: `${TEST_PREFIX}other@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: OWNER_ID,
        displayName: "Parts Artist",
        payoutAddress: `0x${"d4".repeat(20)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Parts Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    for (const [trackId, stemId, features] of [
      [TRACK_ID, STEM_ID, BAR_FEATURES],
      [FLAT_TRACK_ID, FLAT_STEM_ID, null],
    ] as const) {
      await prisma.track.create({
        data: {
          id: trackId,
          releaseId: `${TEST_PREFIX}release`,
          title: "Parts Track",
          position: 1,
          contentStatus: "clean",
          rightsRoute: "STANDARD_ESCROW",
        },
      });
      await prisma.stem.create({
        data: {
          id: stemId,
          trackId,
          type: "keys",
          uri: "local://keys",
          ...(features ? { audioFeatures: features } : {}),
        },
      });
    }
  });

  afterAll(async () => {
    if (prevEnabled === undefined) delete process.env.REMIX_GENERATION_ENABLED;
    else process.env.REMIX_GENERATION_ENABLED = prevEnabled;
    await prisma.generationCostRecord.deleteMany({
      where: { userId: { in: [OWNER_ID, OTHER_ID] } },
    });
    await prisma.generationCreditTransaction.deleteMany({
      where: { userId: { in: [OWNER_ID, OTHER_ID] } },
    });
    await prisma.generationCreditAccount.deleteMany({
      where: { userId: { in: [OWNER_ID, OTHER_ID] } },
    });
    await prisma.remixPartTake.deleteMany({
      where: { userId: { in: [OWNER_ID, OTHER_ID] } },
    });
    await prisma.remixProjectStem.deleteMany({
      where: { project: { sourceTrackId: { in: [TRACK_ID, FLAT_TRACK_ID] } } },
    });
    await prisma.remixProject.deleteMany({
      where: { sourceTrackId: { in: [TRACK_ID, FLAT_TRACK_ID] } },
    });
    await prisma.stem.deleteMany({
      where: { trackId: { in: [TRACK_ID, FLAT_TRACK_ID] } },
    });
    await prisma.track.deleteMany({
      where: { id: { in: [TRACK_ID, FLAT_TRACK_ID] } },
    });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, OTHER_ID] } } });
    eventBus.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    generationQueue.add.mockResolvedValue({ id: "queued" });
  });

  // --- Money -------------------------------------------------------------------

  itWithFfmpeg(
    "happy path: 3 takes complete, audio streams, the ledger debits exactly once per take",
    async () => {
      const service = makeService();
      const project = await createProject(service);
      await setBalance(100);

      const batch = await service.generatePartTakes(OWNER_ID, project.id, {
        role: "keys",
        bars: 4,
        style: "  bright \u0007 house  ",
      });
      expect(batch.quoteCents).toBe(30);
      expect(batch.perTakeCents).toBe(10);
      expect(batch.takes).toHaveLength(3);
      expect(batch.takes.every((take) => take.status === "pending")).toBe(true);
      expect(batch.takes[0]).toMatchObject({
        role: "keys",
        bars: 4,
        style: "bright house",
        grounding: "feature_conditioned",
        aiGenerated: true,
        costCents: 10,
      });
      expect(batch.takes[0]).not.toHaveProperty("storageUri");
      // Queued, not charged yet.
      const jobs = queuedJobs();
      expect(jobs).toHaveLength(3);
      expect(generationQueue.add).toHaveBeenCalledWith(
        REMIX_PART_TAKE_JOB,
        expect.objectContaining({ kind: "part_take", userId: OWNER_ID }),
        expect.objectContaining({ attempts: 1, jobId: `rmxpart_${jobs[0].takeId}` }),
      );
      expect(await balance()).toBe(100);

      for (const job of jobs) {
        await expect(service.processPartTakeJob(job)).resolves.toMatchObject({
          status: "completed",
        });
      }
      // A redelivered job is not claimable: no second debit.
      await expect(service.processPartTakeJob(jobs[0])).resolves.toMatchObject({
        skipped: true,
      });

      const takeIds = jobs.map((job) => job.takeId);
      const rows = await ledger(takeIds);
      expect(rows.filter((row) => row.type === "debit")).toHaveLength(3);
      expect(rows.filter((row) => row.type === "refund")).toHaveLength(0);
      for (const takeId of takeIds) {
        const debits = rows.filter((row) => row.jobId === takeId && row.type === "debit");
        expect(debits).toHaveLength(1);
        expect(debits[0]).toMatchObject({ amountCents: 10, reason: "remix_part" });
      }
      expect(await balance()).toBe(70);
      expect(
        await prisma.generationCostRecord.count({ where: { jobId: { in: takeIds } } }),
      ).toBe(3);

      const read = await service.getProject(OWNER_ID, project.id);
      expect(read.partTakes).toHaveLength(3);
      for (const take of read.partTakes) {
        expect(take.status).toBe("completed");
        expect(take.mimeType).toBe("audio/flac");
        expect(take.provider).toBe("remix-stub");
        expect(take.model).toBe("remix-stub-part/v1");
        expect(take).not.toHaveProperty("storageUri");
        const conform = take.conform as Record<string, number | string>;
        expect(conform.conformVersion).toBe("remix-part-conform/v1");
        expect(conform.targetBpm).toBe(120);
        expect(conform.lengthFrames).toBe(384000); // 4 bars at 120 BPM, 48 kHz
        expect(take.durationSec).toBeCloseTo(8, 6);
        // The stub's seeded ±3 % drift is measured and removed.
        expect(Math.abs((conform.estimatedRatio as number) - 1)).toBeLessThanOrEqual(0.031);
        expect(conform.estimatedRatio).not.toBe(1);
      }
      expect(JSON.stringify(read)).not.toContain("mem://");

      const audio = await service.getPartTakeAudio(OWNER_ID, project.id, takeIds[0]);
      expect(audio.mimeType).toBe("audio/flac");
      expect(audio.data.subarray(0, 4).toString("ascii")).toBe("fLaC");
      await expect(
        service.getPartTakeAudio(OTHER_ID, project.id, takeIds[0]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it("402 before any work: no take is created, nothing is queued or charged", async () => {
    const service = makeService();
    const project = await createProject(service);
    await setBalance(25);

    await expect(
      service.generatePartTakes(OWNER_ID, project.id, { role: "bass", bars: 4 }),
    ).rejects.toMatchObject({
      constructor: InsufficientCreditsException,
      requiredCents: 30,
      balanceCents: 25,
    });
    expect(await prisma.remixPartTake.count({ where: { projectId: project.id } })).toBe(0);
    expect(generationQueue.add).not.toHaveBeenCalled();
    expect(await balance()).toBe(25);
    // Two takes fit.
    await expect(
      service.generatePartTakes(OWNER_ID, project.id, { role: "bass", bars: 4, takes: 2 }),
    ).resolves.toMatchObject({ quoteCents: 20 });
  });

  it("a worker-time shortfall fails the take without charging it", async () => {
    const service = makeService();
    const project = await createProject(service);
    await setBalance(10);
    await service.generatePartTakes(OWNER_ID, project.id, { role: "pad", bars: 4, takes: 1 });
    const [job] = queuedJobs();
    await setBalance(5); // spent elsewhere meanwhile

    await expect(service.processPartTakeJob(job)).resolves.toMatchObject({
      failed: true,
      errorCode: "insufficient_credits",
    });
    expect(await ledger([job.takeId])).toHaveLength(0);
    expect(await balance()).toBe(5);
    const take = await prisma.remixPartTake.findUniqueOrThrow({ where: { id: job.takeId } });
    expect(take).toMatchObject({ status: "failed", errorCode: "insufficient_credits" });
  });

  it.each([
    [
      "a provider failure",
      {
        createRemixDraft: jest.fn(),
        createPartClip: jest.fn(async () => {
          throw new RemixGenerationProviderError(
            "provider_unavailable",
            "vendor said 500 with internal detail",
            true,
          );
        }),
      },
      "provider_unavailable",
    ],
    [
      "a conform failure (undecodable clip)",
      {
        createRemixDraft: jest.fn(),
        createPartClip: jest.fn(async () => ({
          audio: Buffer.from("not audio at all"),
          mimeType: "audio/wav",
          provider: "remix-stub",
          model: "broken",
          estimatedCostUsd: 0.06,
        })),
      },
      "conform_failed",
    ],
    [
      "an unexpected provider crash",
      {
        createRemixDraft: jest.fn(),
        createPartClip: jest.fn(async () => {
          throw new TypeError("secret stack detail");
        }),
      },
      "internal_error",
    ],
  ])("%s after the debit is refunded, with a safe error code", async (_label, provider, code) => {
    const service = makeService(provider as never);
    const project = await createProject(service);
    await setBalance(50);
    await service.generatePartTakes(OWNER_ID, project.id, { role: "guitar", bars: 4, takes: 1 });
    const [job] = queuedJobs();

    await expect(service.processPartTakeJob(job)).resolves.toMatchObject({
      failed: true,
      errorCode: code,
    });
    const rows = await ledger([job.takeId]);
    expect(rows.map((row) => [row.type, row.amountCents])).toEqual([
      ["debit", 10],
      ["refund", 10],
    ]);
    expect(rows[1].reason).toBe("remix_part_failed_refund");
    expect(await balance()).toBe(50);
    const take = await prisma.remixPartTake.findUniqueOrThrow({ where: { id: job.takeId } });
    expect(take).toMatchObject({ status: "failed", errorCode: code, storageUri: null });
    expect(JSON.stringify(take)).not.toContain("detail");
  });

  itWithFfmpeg("a storage failure after the conform is refunded", async () => {
    const service = makeService();
    const project = await createProject(service);
    await setBalance(30);
    await service.generatePartTakes(OWNER_ID, project.id, { role: "drums", bars: 4, takes: 1 });
    const [job] = queuedJobs();
    storageProvider.upload.mockRejectedValueOnce(new Error("bucket gone"));

    await expect(service.processPartTakeJob(job)).resolves.toMatchObject({
      failed: true,
      errorCode: "storage_failed",
    });
    expect((await ledger([job.takeId])).map((row) => row.type)).toEqual(["debit", "refund"]);
    expect(await balance()).toBe(30);
  });

  it("a stale charged claim is swept, refunded once, and never charged again", async () => {
    const service = makeService();
    const project = await createProject(service);
    await setBalance(40);
    const take = await seedTake(project.id, { status: "processing", storageUri: null });
    await prisma.remixPartTake.update({
      where: { id: take.id },
      data: { startedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    // Its dead worker had charged it.
    await credits.debit(OWNER_ID, 10, "remix_part", take.id, "remix_draft");
    expect(await balance()).toBe(30);

    const read = await service.getProject(OWNER_ID, project.id);
    expect(read.partTakes.find((t) => t.id === take.id)).toMatchObject({
      status: "failed",
      errorCode: "stale",
    });
    expect(await balance()).toBe(40);
    // A second sweep (or a late redelivery) never refunds or charges twice.
    await service.getProject(OWNER_ID, project.id);
    await expect(
      service.processPartTakeJob({
        kind: "part_take",
        takeId: take.id,
        userId: OWNER_ID,
        projectId: project.id,
      }),
    ).resolves.toMatchObject({ skipped: true });
    expect((await ledger([take.id])).map((row) => row.type)).toEqual(["debit", "refund"]);
    expect(await balance()).toBe(40);
  });

  it("a queue failure fails the takes uncharged and answers 503-class", async () => {
    const service = makeService();
    const project = await createProject(service);
    await setBalance(30);
    generationQueue.add.mockRejectedValue(new Error("redis down"));

    await expect(
      service.generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4, takes: 2 }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    const takes = await prisma.remixPartTake.findMany({ where: { projectId: project.id } });
    expect(takes).toHaveLength(2);
    expect(takes.every((take) => take.status === "failed" && take.errorCode === "queue_unavailable")).toBe(true);
    expect(await ledger(takes.map((take) => take.id))).toHaveLength(0);
    expect(await balance()).toBe(30);
  });

  // --- Refusals before any work --------------------------------------------------

  it("parts_unsupported for a provider without the clip capability", async () => {
    const service = makeService({ createRemixDraft: jest.fn() } as never);
    const project = await createProject(service);
    await setBalance(100);
    const error = await service
      .generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ code: "parts_unsupported" });
    expect(await prisma.remixPartTake.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("no_tempo_grid for a source without a measured tempo", async () => {
    const service = makeService();
    const project = await createProject(service, FLAT_TRACK_ID, FLAT_STEM_ID);
    await setBalance(100);
    const error = await service
      .generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: "no_tempo_grid" });
    expect(await prisma.remixPartTake.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("provider_disabled when generation is off", async () => {
    const service = makeService();
    const project = await createProject(service);
    process.env.REMIX_GENERATION_ENABLED = "false";
    try {
      await expect(
        service.generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4 }),
      ).rejects.toMatchObject({ code: "provider_disabled" });
    } finally {
      process.env.REMIX_GENERATION_ENABLED = "true";
    }
  });

  it("the rate limit counts every take of a batch", async () => {
    const previous = process.env.REMIX_GENERATION_RATE_LIMIT;
    process.env.REMIX_GENERATION_RATE_LIMIT = "4";
    let service: RemixProjectService;
    try {
      service = makeService();
    } finally {
      if (previous === undefined) delete process.env.REMIX_GENERATION_RATE_LIMIT;
      else process.env.REMIX_GENERATION_RATE_LIMIT = previous;
    }
    const project = await createProject(service);
    await setBalance(100);
    await service.generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4, takes: 3 });
    const error = await service
      .generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4, takes: 2 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(await prisma.remixPartTake.count({ where: { projectId: project.id } })).toBe(3);
  });

  it("rejects invalid requests with 400 before any work", async () => {
    const service = makeService();
    const project = await createProject(service);
    for (const body of [
      { role: "vocals", bars: 4 },
      { role: "keys", bars: 3 },
      { role: "keys", bars: 4, takes: 9 },
    ]) {
      await expect(service.generatePartTakes(OWNER_ID, project.id, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(await prisma.remixPartTake.count({ where: { projectId: project.id } })).toBe(0);
  });

  // --- PATCH parts ------------------------------------------------------------------

  it("PATCH parts: validates takes under the lock, persists, reads back, clears", async () => {
    const service = makeService();
    const project = await createProject(service);
    const other = await createProject(service);
    const bass = await seedTake(project.id, { role: "bass" });
    const keys = await seedTake(project.id, { role: "keys" });
    const pending = await seedTake(project.id, { role: "keys", status: "pending", storageUri: null });
    const failed = await seedTake(project.id, { role: "keys", status: "failed", storageUri: null });
    const foreign = await seedTake(other.id, { role: "keys" });
    const blockCount = project.timeline!.length;

    const patch = (parts: unknown) => service.updateProject(OWNER_ID, project.id, { parts });
    const recipe = (...parts: Array<Record<string, unknown>>) => ({
      schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
      parts,
    });

    for (const [label, parts, message] of [
      ["another role", recipe({ id: "a", role: "keys", takeId: bass.id }), "is a bass take, not keys"],
      ["another project", recipe({ id: "a", role: "keys", takeId: foreign.id }), "not a take of this project"],
      ["unknown take", recipe({ id: "a", role: "keys", takeId: "nope" }), "not a take of this project"],
      ["pending take", recipe({ id: "a", role: "keys", takeId: pending.id }), "not a completed take"],
      ["failed take", recipe({ id: "a", role: "keys", takeId: failed.id }), "not a completed take"],
      [
        "more than 4 parts",
        recipe(...["a", "b", "c", "d", "e"].map((id) => ({ id, role: "keys", takeId: keys.id }))),
        "At most 4",
      ],
      [
        "blocks of the wrong length",
        recipe({ id: "a", role: "keys", takeId: keys.id, blocks: [true] }),
        `exactly ${blockCount} entries`,
      ],
    ] as const) {
      const error = await patch(parts).catch((e) => e);
      expect([label, error]).toEqual([label, expect.any(BadRequestException)]);
      expect(String(error.message)).toContain(message);
    }
    expect(
      (await prisma.remixProject.findUniqueOrThrow({ where: { id: project.id } })).parts,
    ).toBeNull();

    const blocks = Array.from({ length: blockCount }, (_, i) => i % 2 === 0);
    const updated = await patch(
      recipe(
        { id: "bass-lane", role: "bass", takeId: bass.id, gainDb: -4, blocks },
        { id: "keys-lane", role: "keys", takeId: keys.id, muted: true },
      ),
    );
    expect(updated.parts).toEqual({
      schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
      parts: [
        { id: "bass-lane", role: "bass", takeId: bass.id, gainDb: -4, blocks },
        { id: "keys-lane", role: "keys", takeId: keys.id, muted: true },
      ],
    });
    const read = await service.getProject(OWNER_ID, project.id);
    expect(read.parts).toEqual(updated.parts);

    // A non-owner cannot PATCH.
    await expect(
      service.updateProject(OTHER_ID, project.id, { parts: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const cleared = await patch(null);
    expect(cleared.parts).toBeNull();
  });

  // --- DELETE --------------------------------------------------------------------------

  it("DELETE: 409 in use / processing, 404 unknown, 403 non-owner, otherwise removes row and audio", async () => {
    const service = makeService();
    const project = await createProject(service);
    const used = await seedTake(project.id, { role: "keys" });
    const running = await seedTake(project.id, { role: "keys", status: "processing", storageUri: null });
    await prisma.remixPartTake.update({ where: { id: running.id }, data: { startedAt: new Date() } });
    const unused = await seedTake(project.id, { role: "keys" });
    await service.updateProject(OWNER_ID, project.id, {
      parts: {
        schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
        parts: [{ id: "lane", role: "keys", takeId: used.id }],
      },
    });

    const inUse = await service.deletePartTake(OWNER_ID, project.id, used.id).catch((e) => e);
    expect(inUse).toBeInstanceOf(ConflictException);
    expect(inUse.getResponse()).toMatchObject({ code: "take_in_use" });
    const processing = await service.deletePartTake(OWNER_ID, project.id, running.id).catch((e) => e);
    expect(processing.getResponse()).toMatchObject({ code: "take_processing" });
    await expect(service.deletePartTake(OWNER_ID, project.id, "nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.deletePartTake(OTHER_ID, project.id, unused.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const after = await service.deletePartTake(OWNER_ID, project.id, unused.id);
    expect(after.partTakes.map((take) => take.id)).not.toContain(unused.id);
    expect(storageProvider.delete).toHaveBeenCalledWith(unused.storageUri);
    expect(objects.has(unused.storageUri!)).toBe(false);
    expect(await prisma.remixPartTake.findUnique({ where: { id: used.id } })).not.toBeNull();
  });

  // --- The 24-take cap -------------------------------------------------------------------

  it("evicts the oldest unreferenced settled takes (and their audio) to stay at 24", async () => {
    const service = makeService();
    const project = await createProject(service);
    await setBalance(100);
    const base = Date.now() - 24 * 60 * 60 * 1000;
    const seeded = [];
    for (let i = 0; i < 23; i += 1) {
      seeded.push(
        await seedTake(project.id, {
          role: "keys",
          status: i === 1 ? "failed" : "completed",
          storageUri: i === 1 ? null : undefined,
          createdAt: new Date(base + i * 1000),
        }),
      );
    }
    // The oldest is referenced by a part: it must survive.
    await service.updateProject(OWNER_ID, project.id, {
      parts: {
        schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
        parts: [{ id: "lane", role: "keys", takeId: seeded[0].id }],
      },
    });

    await service.generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4, takes: 3 });

    const remaining = await prisma.remixPartTake.findMany({ where: { projectId: project.id } });
    expect(remaining).toHaveLength(24);
    const ids = new Set(remaining.map((take) => take.id));
    expect(ids.has(seeded[0].id)).toBe(true); // referenced
    expect(ids.has(seeded[1].id)).toBe(false); // oldest unreferenced (failed)
    expect(ids.has(seeded[2].id)).toBe(false); // next oldest (completed)
    expect(ids.has(seeded[3].id)).toBe(true);
    expect(storageProvider.delete).toHaveBeenCalledWith(seeded[2].storageUri);
    expect(objects.has(seeded[2].storageUri!)).toBe(false);
    const read = await service.getProject(OWNER_ID, project.id);
    expect(read.partTakes).toHaveLength(24);
    expect(read.partTakes[0].status).toBe("pending"); // newest first
  });

  it("refuses a batch it cannot make room for (409 take_limit_reached), uncharged", async () => {
    const service = makeService();
    const project = await createProject(service);
    await setBalance(100);
    for (let i = 0; i < 23; i += 1) {
      await seedTake(project.id, { role: "keys", status: "pending", storageUri: null });
    }
    const error = await service
      .generatePartTakes(OWNER_ID, project.id, { role: "keys", bars: 4, takes: 2 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: "take_limit_reached" });
    expect(await prisma.remixPartTake.count({ where: { projectId: project.id } })).toBe(23);
    expect(generationQueue.add).not.toHaveBeenCalled();
    expect(await balance()).toBe(100);
  });

  // --- Owner-only ----------------------------------------------------------------------------

  it("every route is owner-only, and a job for another user's take is not claimable", async () => {
    const service = makeService();
    const project = await createProject(service);
    const take = await seedTake(project.id);
    await prisma.generationCreditAccount.upsert({
      where: { userId: OTHER_ID },
      create: { userId: OTHER_ID, balanceCents: 1000 },
      update: { balanceCents: 1000 },
    });

    await expect(
      service.generatePartTakes(OTHER_ID, project.id, { role: "keys", bars: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getPartTakeAudio(OTHER_ID, project.id, take.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.deletePartTake(OTHER_ID, project.id, take.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getProject(OTHER_ID, project.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Takes are scoped to their project: another project id never resolves it.
    const mine = await createProject(service);
    await expect(service.getPartTakeAudio(OWNER_ID, mine.id, take.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const pending = await seedTake(project.id, { status: "pending", storageUri: null });
    await expect(
      service.processPartTakeJob({
        kind: "part_take",
        takeId: pending.id,
        userId: OTHER_ID,
        projectId: project.id,
      }),
    ).resolves.toMatchObject({ skipped: true });
    expect(
      await prisma.generationCreditTransaction.count({ where: { jobId: pending.id } }),
    ).toBe(0);
    expect(
      (await prisma.remixPartTake.findUniqueOrThrow({ where: { id: pending.id } })).status,
    ).toBe("pending");
  });
});
