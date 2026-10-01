/**
 * Stem audio-feature backfill (#1184/#1182) — integration (Testcontainers).
 *
 * Real Postgres; the demucs worker's /analyze endpoint is mocked at the
 * fetch boundary (external service rule), and storage is a jest fake. The
 * Pub/Sub transport (#2013) uses a mocked publisher.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { StemFeatureBackfillService } from "../modules/ingestion/stem-feature-backfill.service";
import { resolveGcsStorageUri } from "../modules/storage/storage_uri_policy";

const TEST_PREFIX = `backfill_${Date.now()}_`;
const TRACK_ID = `${TEST_PREFIX}track`;

const WORKER_FEATURES = {
  schemaVersion: "stem-audio-features/v1",
  extractor: { name: "librosa", version: "0.10.2" },
  sampleRate: 22050,
  durationSeconds: 12.5,
  tempoBpm: 110.2,
  tempoConfidence: 0.7,
  beatCount: 22,
  firstBeatSec: 0.4,
  key: { tonic: "D", mode: "major", confidence: 0.66 },
  energyRms: 0.09,
  onsetDensity: 1.8,
};

describe("StemFeatureBackfillService (integration)", () => {
  const storageProvider = {
    upload: jest.fn(),
    download: jest.fn(),
    downloadRange: jest.fn(),
    delete: jest.fn(),
    // Mirrors GcsStorageProvider for the configured test bucket "b".
    resolveFetchUri: jest.fn((uri: string) => resolveGcsStorageUri(uri, "b").target),
  };
  const publisher = {
    isAvailable: jest.fn(),
    publishAnalysisJob: jest.fn(),
  };
  const envSnapshot = {
    DEMUCS_WORKER_URL: process.env.DEMUCS_WORKER_URL,
    BACKEND_URL: process.env.BACKEND_URL,
  };
  let service: StemFeatureBackfillService;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, displayName: "Backfill Artist" },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Backfill Release",
        status: "ready",
      },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: `${TEST_PREFIX}release`, title: "T", position: 1 },
    });
    await prisma.stem.createMany({
      data: [
        // Needs backfill: bytes in DB, no features.
        {
          id: `${TEST_PREFIX}stem_pending`,
          trackId: TRACK_ID,
          type: "vocals",
          uri: "db://bytes",
          data: Buffer.from("fake-audio"),
        },
        // Already has features: must not be touched.
        {
          id: `${TEST_PREFIX}stem_done`,
          trackId: TRACK_ID,
          type: "drums",
          uri: "db://bytes",
          data: Buffer.from("fake-audio"),
          audioFeatures: { schemaVersion: "stem-audio-features/v1", extractor: { name: "librosa", version: "x" } },
        },
        // Encrypted: excluded from the query entirely.
        {
          id: `${TEST_PREFIX}stem_encrypted`,
          trackId: TRACK_ID,
          type: "bass",
          uri: "db://bytes",
          data: Buffer.from("ciphertext"),
          isEncrypted: true,
        },
        // No audio anywhere: skipped with a reason.
        {
          id: `${TEST_PREFIX}stem_missing`,
          trackId: TRACK_ID,
          type: "other",
          uri: "gs://nowhere/missing.mp3",
          storageProvider: "gcs",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } });
    await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } });
  });

  beforeEach(() => {
    storageProvider.download.mockReset().mockResolvedValue(null);
    publisher.isAvailable.mockReset().mockReturnValue(false);
    publisher.publishAnalysisJob.mockReset().mockResolvedValue("msg-1");
    // HTTP transport is the default for the original tests below.
    process.env.DEMUCS_WORKER_URL = "http://worker.test:8000";
    service = new StemFeatureBackfillService(
      storageProvider as any,
      publisher as any,
    );
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", features: WORKER_FEATURES }),
    } as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("backfills missing features, skips unavailable audio, leaves done/encrypted stems alone", async () => {
    const result = await service.backfill({ limit: 50 });
    expect(result).toEqual(
      expect.objectContaining({ transport: "http", status: "ok", dispatched: 0 }),
    );

    // Only the two feature-less, unencrypted seeded stems are in scope
    // (parallel suites could add their own; filter to ours).
    const ourSkips = result.skipped.filter((s) => s.stemId.startsWith(TEST_PREFIX));
    expect(ourSkips).toEqual([
      { stemId: `${TEST_PREFIX}stem_missing`, reason: "audio_unavailable" },
    ]);

    const backfilled = await prisma.stem.findUnique({
      where: { id: `${TEST_PREFIX}stem_pending` },
      select: { audioFeatures: true },
    });
    expect(backfilled?.audioFeatures).toEqual(
      expect.objectContaining({
        schemaVersion: "stem-audio-features/v1",
        tempoBpm: 110.2,
        key: expect.objectContaining({ tonic: "D", mode: "major" }),
        camelot: "10B",
      }),
    );

    // The worker was called for our pending stem (multipart POST to /analyze).
    const analyzeCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/analyze"),
    );
    expect(analyzeCalls.length).toBeGreaterThanOrEqual(1);

    // Untouched rows stay untouched.
    const done = await prisma.stem.findUnique({
      where: { id: `${TEST_PREFIX}stem_done` },
      select: { audioFeatures: true },
    });
    expect((done?.audioFeatures as { extractor?: { version?: string } }).extractor?.version).toBe("x");
    const encrypted = await prisma.stem.findUnique({
      where: { id: `${TEST_PREFIX}stem_encrypted` },
      select: { audioFeatures: true },
    });
    expect(encrypted?.audioFeatures).toBeNull();
  });

  it("drops malformed worker responses instead of persisting them", async () => {
    // Reset the pending stem and answer with garbage.
    await prisma.stem.update({
      where: { id: `${TEST_PREFIX}stem_pending` },
      data: { audioFeatures: Prisma.DbNull },
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", features: { schemaVersion: "v999" } }),
    } as any);

    const result = await service.backfill({ limit: 50 });
    const ourSkips = result.skipped.filter((s) => s.stemId.startsWith(TEST_PREFIX));
    expect(ourSkips).toContainEqual({
      stemId: `${TEST_PREFIX}stem_pending`,
      reason: "analysis_failed",
    });
    const row = await prisma.stem.findUnique({
      where: { id: `${TEST_PREFIX}stem_pending` },
      select: { audioFeatures: true },
    });
    expect(row?.audioFeatures).toBeNull();
  });

  it("targets full mixes first with types=[original] and reports remaining per type (#1959)", async () => {
    const originalId = `${TEST_PREFIX}stem_original`;
    const separatedId = `${TEST_PREFIX}stem_guitar`;
    await prisma.stem.createMany({
      data: [
        {
          id: originalId,
          trackId: TRACK_ID,
          type: "original",
          uri: "db://bytes",
          data: Buffer.from("fake-full-mix"),
        },
        {
          id: separatedId,
          trackId: TRACK_ID,
          type: "guitar",
          uri: "db://bytes",
          data: Buffer.from("fake-audio"),
        },
      ],
    });

    const result = await service.backfill({
      limit: 100,
      // Unknown values are dropped by the allowlist.
      types: ["original", "not-a-type", 42 as unknown as string],
    });

    const original = await prisma.stem.findUnique({
      where: { id: originalId },
      select: { audioFeatures: true },
    });
    expect(original?.audioFeatures).toEqual(
      expect.objectContaining({
        schemaVersion: "stem-audio-features/v1",
        tempoBpm: 110.2,
        camelot: "10B",
      }),
    );

    // The separated stem was neither analyzed nor updated.
    const separated = await prisma.stem.findUnique({
      where: { id: separatedId },
      select: { audioFeatures: true },
    });
    expect(separated?.audioFeatures).toBeNull();
    const analyzedFiles = fetchSpy.mock.calls
      .filter(([url]) => String(url).endsWith("/analyze"))
      .map(([, init]) => ((init as RequestInit).body as FormData).get("file"))
      .map((file) => (file as File).name);
    expect(analyzedFiles).toContain(`${originalId}.audio`);
    expect(analyzedFiles).not.toContain(`${separatedId}.audio`);

    // `remaining` follows the requested filter; `remainingByType` shows every
    // type so the operator sees the whole picture.
    expect(result.remainingByType.guitar).toBeGreaterThanOrEqual(1);
    expect(result.remainingByType.vocals).toBeGreaterThanOrEqual(1);
    expect(result.remaining).toBe(result.remainingByType.original ?? 0);
  });

  describe("job-mode transport (#2013)", () => {
    const ID = (name: string) => `${TEST_PREFIX}${name}`;
    const analysisStems = [
      { id: ID("an_gcs"), uri: "https://storage.googleapis.com/b/gcs.mp3", storageProvider: "gcs", mimeType: "audio/wav" },
      { id: ID("an_local"), uri: "/catalog/stems/an_local_file/blob", storageProvider: "local", mimeType: null },
      { id: ID("an_nouri"), uri: "", storageProvider: "gcs", mimeType: null },
      // Historical bucket-relative GCS form: must not be prefixed with BACKEND_URL.
      { id: ID("an_gcsrel"), uri: "/b/originals/rel.m4a", storageProvider: "gcs", mimeType: "audio/mp4" },
      { id: ID("an_badbucket"), uri: "/other-bucket/originals/x.mp3", storageProvider: "gcs", mimeType: null },
    ];

    beforeAll(async () => {
      await prisma.stem.createMany({
        data: analysisStems.map((stem) => ({
          ...stem,
          trackId: TRACK_ID,
          type: "piano",
        })),
      });
    });

    beforeEach(() => {
      delete process.env.DEMUCS_WORKER_URL;
      process.env.BACKEND_URL = "http://backend.test:3000";
      publisher.isAvailable.mockReturnValue(true);
    });

    it("dispatches one analysis message with worker-fetchable URIs and leaves features null", async () => {
      const result = await service.backfill({ limit: 50, types: ["piano"] });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(publisher.publishAnalysisJob).toHaveBeenCalledTimes(1);
      const message = publisher.publishAnalysisJob.mock.calls[0][0];
      expect(message.kind).toBe("analyze");
      expect(message.jobId).toMatch(/^analyze_\d+_[0-9a-f]{8}$/);
      expect(message.stems).toEqual(
        expect.arrayContaining([
          { stemId: ID("an_gcs"), uri: "https://storage.googleapis.com/b/gcs.mp3", mimeType: "audio/wav" },
          { stemId: ID("an_local"), uri: "an_local_file", mimeType: "audio/mpeg" },
          {
            stemId: ID("an_gcsrel"),
            uri: "https://storage.googleapis.com/b/originals/rel.m4a",
            mimeType: "audio/mp4",
          },
        ]),
      );
      expect(message.stems.map((s: { stemId: string }) => s.stemId)).not.toContain(ID("an_badbucket"));
      expect(
        message.stems.some((s: { uri: string }) => s.uri.startsWith("http://backend.test")),
      ).toBe(false);
      expect(message.stems.map((s: { stemId: string }) => s.stemId)).not.toContain(ID("an_nouri"));

      expect(result).toEqual(
        expect.objectContaining({
          transport: "pubsub",
          status: "dispatched",
          jobId: message.jobId,
          dispatched: message.stems.length,
          updated: 0,
        }),
      );
      expect(result.scanned).toBe(message.stems.length + result.skipped.length);
      expect(result.skipped).toContainEqual({
        stemId: ID("an_nouri"),
        reason: "audio_unavailable",
      });
      expect(result.skipped).toContainEqual({
        stemId: ID("an_badbucket"),
        reason: "audio_unavailable",
      });
      // In flight stems still count as remaining.
      expect(result.remaining).toBeGreaterThanOrEqual(5);

      const rows = await prisma.stem.findMany({
        where: { id: { in: analysisStems.map((s) => s.id) } },
        select: { audioFeatures: true },
      });
      expect(rows.every((row) => row.audioFeatures === null)).toBe(true);
    });

    it("propagates a dispatch failure", async () => {
      publisher.publishAnalysisJob.mockRejectedValueOnce(new Error("run job failed"));
      await expect(service.backfill({ types: ["piano"] })).rejects.toThrow("run job failed");
    });

    it("reports worker_unavailable without touching stems or the network when no transport exists", async () => {
      publisher.isAvailable.mockReturnValue(false);

      const result = await service.backfill({ limit: 50, types: ["piano"] });

      expect(result).toEqual(
        expect.objectContaining({
          transport: "none",
          status: "worker_unavailable",
          scanned: 0,
          dispatched: 0,
          updated: 0,
          skipped: [],
        }),
      );
      expect(result.remaining).toBeGreaterThanOrEqual(5);
      expect(publisher.publishAnalysisJob).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("status() counts remaining stems without calling a worker", async () => {
      const status = await service.status({ types: "piano" as unknown });
      // A non-array `types` is ignored, so every type counts.
      expect(status.remaining).toBeGreaterThanOrEqual(3);

      const filtered = await service.status({ types: ["piano"] });
      expect(filtered.remaining).toBeGreaterThanOrEqual(3);
      expect(filtered.remaining).toBe(filtered.remainingByType.piano);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(publisher.publishAnalysisJob).not.toHaveBeenCalled();
    });

    it("applyAnalysisResults writes sanitized features, counts failures, and never overwrites", async () => {
      const gcs = ID("an_gcs");
      const local = ID("an_local");
      const nouri = ID("an_nouri");
      const outcome = await service.applyAnalysisResults({
        kind: "analysis",
        jobId: "analyze_1_deadbeef",
        status: "completed",
        results: [
          { stemId: gcs, features: WORKER_FEATURES },
          { stemId: local, features: { schemaVersion: "v999" } },
          { stemId: nouri, features: null, error: "download failed" },
          { stemId: "ignored" } as any,
          null as any,
          { features: WORKER_FEATURES } as any,
        ],
      });
      expect(outcome).toEqual({ updated: 1, failed: 2, malformed: 1 });

      const written = await prisma.stem.findUnique({ where: { id: gcs }, select: { audioFeatures: true } });
      expect(written?.audioFeatures).toEqual(
        expect.objectContaining({ tempoBpm: 110.2, camelot: "10B" }),
      );
      for (const id of [local, nouri]) {
        const row = await prisma.stem.findUnique({ where: { id }, select: { audioFeatures: true } });
        expect(row?.audioFeatures).toBeNull();
      }

      // Redelivery with different features must not overwrite measured data.
      const again = await service.applyAnalysisResults({
        kind: "analysis",
        jobId: "analyze_1_deadbeef",
        status: "completed",
        results: [{ stemId: gcs, features: { ...WORKER_FEATURES, tempoBpm: 150 } }],
      });
      expect(again.updated).toBe(0);
      const kept = await prisma.stem.findUnique({ where: { id: gcs }, select: { audioFeatures: true } });
      expect((kept?.audioFeatures as { tempoBpm?: number }).tempoBpm).toBe(110.2);

      // A whole-message failure is logged and writes nothing.
      await expect(
        service.applyAnalysisResults({
          kind: "analysis",
          jobId: "analyze_2_deadbeef",
          status: "failed",
          error: "boom",
        }),
      ).resolves.toEqual({ updated: 0, failed: 0, malformed: 0 });
    });
  });
});
