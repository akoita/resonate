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
    // (The seeded vocals stem is held back after the previous test's failed
    // analysis, #2012, so the unfiltered type checked here is guitar.)
    expect(result.remainingByType.guitar).toBeGreaterThanOrEqual(1);
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
      const dispatchedHosts = message.stems
        .filter((s: { uri: string }) => /^https?:\/\//.test(s.uri))
        .map((s: { uri: string }) => new URL(s.uri).hostname);
      expect(dispatchedHosts).not.toContain("backend.test");
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
      // In flight stems still count as remaining; the two unavailable ones
      // are recorded as failed and held back (#2012).
      expect(result.remaining).toBeGreaterThanOrEqual(3);
      expect(result.failed).toBeGreaterThanOrEqual(2);
      const held = await prisma.stem.findMany({
        where: { id: { in: [ID("an_nouri"), ID("an_badbucket"), ID("an_gcs")] } },
        select: { id: true, audioFeaturesFailureCount: true, audioFeaturesFailedAt: true },
        orderBy: { id: "asc" },
      });
      expect(
        Object.fromEntries(held.map((row) => [row.id, row.audioFeaturesFailureCount])),
      ).toEqual({ [ID("an_nouri")]: 1, [ID("an_badbucket")]: 1, [ID("an_gcs")]: 0 });

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
      expect(result.remaining + result.failed).toBeGreaterThanOrEqual(5);
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
      // Missing and malformed results count as failed analyses (#2012); nouri
      // already failed once at dispatch.
      const failures = await prisma.stem.findMany({
        where: { id: { in: [gcs, local, nouri] } },
        select: { id: true, audioFeaturesFailureCount: true },
      });
      expect(
        Object.fromEntries(failures.map((row) => [row.id, row.audioFeaturesFailureCount])),
      ).toEqual({ [gcs]: 0, [local]: 1, [nouri]: 2 });

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

  describe("refresh of older analysis revisions (#2016)", () => {
    const ID = (name: string) => `${TEST_PREFIX}${name}`;
    const nullId = ID("rf_null");
    const rev1Id = ID("rf_rev1");
    const rev2Id = ID("rf_rev2");
    const badRevId = ID("rf_badrev");
    const currentId = ID("rf_current");
    const ourIds = [nullId, rev1Id, rev2Id, badRevId, currentId];
    const features = (tempoBpm: number, extra: Record<string, unknown> = {}) => ({
      ...WORKER_FEATURES,
      tempoBpm,
      camelot: "10B",
      ...extra,
    });
    const featuresOf = async (id: string) =>
      (
        await prisma.stem.findUnique({
          where: { id },
          select: { audioFeatures: true },
        })
      )?.audioFeatures as { tempoBpm?: number; analysisRevision?: number } | null;

    beforeAll(async () => {
      // "bass" is used by no other test here (the seeded bass stem is encrypted).
      await prisma.stem.createMany({
        data: ourIds.map((id) => ({
          id,
          trackId: TRACK_ID,
          type: "bass",
          uri: "db://bytes",
          data: Buffer.from("fake-audio"),
        })),
      });
    });

    beforeEach(async () => {
      await prisma.stem.updateMany({
        where: { id: { in: ourIds } },
        data: { audioFeaturesFailedAt: null, audioFeaturesFailureCount: 0 },
      });
      await prisma.stem.update({
        where: { id: nullId },
        data: { audioFeatures: Prisma.DbNull },
      });
      await prisma.stem.update({
        where: { id: rev1Id },
        data: { audioFeatures: features(90) },
      });
      await prisma.stem.update({
        where: { id: rev2Id },
        data: { audioFeatures: features(95, { analysisRevision: 2 }) },
      });
      // Revision 2 is outdated since #2018; revision 3 is the current one.
      await prisma.stem.update({
        where: { id: currentId },
        data: { audioFeatures: features(98, { analysisRevision: 3 }) },
      });
      // A non-numeric revision counts as revision 1.
      await prisma.stem.update({
        where: { id: badRevId },
        data: { audioFeatures: features(100, { analysisRevision: "2" }) },
      });
    });

    const dispatchedIds = () =>
      (
        publisher.publishAnalysisJob.mock.calls[0]?.[0]?.stems ?? []
      ).map((s: { stemId: string }) => s.stemId);

    it("without refresh only stems lacking features are targeted", async () => {
      delete process.env.DEMUCS_WORKER_URL;
      publisher.isAvailable.mockReturnValue(true);

      const result = await service.backfill({ limit: 50, types: ["bass"] });

      expect(dispatchedIds()).toEqual([nullId]);
      expect(result.remaining).toBe(1);
      expect(result.remainingByType.bass).toBe(1);
    });

    it("pubsub refresh targets missing and older revisions (including 2) but not the current one", async () => {
      delete process.env.DEMUCS_WORKER_URL;
      publisher.isAvailable.mockReturnValue(true);

      const result = await service.backfill({
        limit: 50,
        types: ["bass"],
        refresh: true,
      });

      expect(dispatchedIds().sort()).toEqual(
        [nullId, rev1Id, rev2Id, badRevId].sort(),
      );
      expect(result).toEqual(
        expect.objectContaining({ transport: "pubsub", status: "dispatched" }),
      );
      expect(result.remaining).toBe(4);
      expect(result.remainingByType.bass).toBe(4);
      // The type filter applies to the selection: refresh with another type
      // does not dispatch bass stems.
      publisher.publishAnalysisJob.mockClear();
      await service.backfill({ limit: 50, types: ["original"], refresh: true });
      expect(dispatchedIds()).not.toEqual(expect.arrayContaining([rev1Id]));
    });

    it("pubsub refresh honours the limit in id order", async () => {
      delete process.env.DEMUCS_WORKER_URL;
      publisher.isAvailable.mockReturnValue(true);

      const result = await service.backfill({
        limit: 2,
        types: ["bass"],
        refresh: true,
      });

      expect(dispatchedIds()).toEqual([badRevId, nullId].sort());
      expect(result.scanned).toBe(2);
      expect(result.remaining).toBe(4);
    });

    it("status counts the refresh set separately from the default set", async () => {
      const plain = await service.status({ types: ["bass"] });
      expect(plain.remaining).toBe(1);

      const refresh = await service.status({ types: ["bass"], refresh: true });
      expect(refresh.remaining).toBe(4);
      expect(refresh.remainingByType.bass).toBe(4);
      // Encrypted stems never count.
      const encrypted = await prisma.stem.count({
        where: { type: "bass", isEncrypted: true, trackId: TRACK_ID },
      });
      expect(encrypted).toBe(1);
    });

    it("refresh holds back recently failed stems unless retryFailed (#2012)", async () => {
      delete process.env.DEMUCS_WORKER_URL;
      publisher.isAvailable.mockReturnValue(true);
      await prisma.stem.update({
        where: { id: rev1Id },
        data: { audioFeaturesFailedAt: new Date(), audioFeaturesFailureCount: 1 },
      });

      const status = await service.status({ types: ["bass"], refresh: true });
      expect(status).toEqual(
        expect.objectContaining({ remaining: 3, failed: 1 }),
      );
      expect(status.remainingByType.bass).toBe(3);

      const result = await service.backfill({ limit: 50, types: ["bass"], refresh: true });
      expect(dispatchedIds().sort()).toEqual([nullId, rev2Id, badRevId].sort());
      expect(result).toEqual(expect.objectContaining({ remaining: 3, failed: 1 }));

      publisher.publishAnalysisJob.mockClear();
      await service.backfill({ limit: 50, types: ["bass"], refresh: true, retryFailed: true });
      // Fewest failures first: the failed stem comes last.
      expect(dispatchedIds()).toEqual([...[nullId, rev2Id, badRevId].sort(), rev1Id]);
    });

    it("http refresh overwrites older revisions and leaves the current one", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          features: { ...WORKER_FEATURES, analysisRevision: 3 },
        }),
      } as any);

      const result = await service.backfill({
        limit: 50,
        types: ["bass"],
        refresh: true,
      });

      expect(result.updated).toBe(4);
      expect(result.remaining).toBe(0);
      for (const id of [nullId, rev1Id, rev2Id, badRevId]) {
        expect(await featuresOf(id)).toEqual(
          expect.objectContaining({ tempoBpm: 110.2, analysisRevision: 3 }),
        );
      }
      expect((await featuresOf(currentId))?.tempoBpm).toBe(98);
      const analyzed = fetchSpy.mock.calls
        .filter(([url]) => String(url).endsWith("/analyze"))
        .map(([, init]) => (((init as RequestInit).body as FormData).get("file") as File).name);
      expect(analyzed.sort()).toEqual(
        [nullId, rev1Id, rev2Id, badRevId].map((id) => `${id}.audio`).sort(),
      );
    });

    it("http without refresh leaves older revisions alone", async () => {
      await service.backfill({ limit: 50, types: ["bass"] });
      expect((await featuresOf(rev1Id))?.tempoBpm).toBe(90);
      expect((await featuresOf(nullId))?.tempoBpm).toBe(110.2);
    });

    it("applyAnalysisResults upgrades older revisions but never rewrites the current one", async () => {
      const revision3 = (tempoBpm: number) => ({
        ...WORKER_FEATURES,
        tempoBpm,
        analysisRevision: 3,
      });
      const outcome = await service.applyAnalysisResults({
        kind: "analysis",
        jobId: "analyze_rf_1",
        status: "completed",
        results: [
          { stemId: nullId, features: revision3(120) },
          { stemId: rev1Id, features: revision3(121) },
          { stemId: badRevId, features: revision3(122) },
          { stemId: rev2Id, features: revision3(123) },
          { stemId: currentId, features: revision3(124) },
        ],
      });
      // The stored revision-3 row is not rewritten by another revision-3 result.
      expect(outcome).toEqual({ updated: 4, failed: 0, malformed: 0 });
      expect(await featuresOf(nullId)).toEqual(
        expect.objectContaining({ tempoBpm: 120, analysisRevision: 3 }),
      );
      expect((await featuresOf(rev1Id))?.tempoBpm).toBe(121);
      expect((await featuresOf(badRevId))?.tempoBpm).toBe(122);
      expect(await featuresOf(rev2Id)).toEqual(
        expect.objectContaining({ tempoBpm: 123, analysisRevision: 3 }),
      );
      expect((await featuresOf(currentId))?.tempoBpm).toBe(98);

      // Redelivery of the same message is a no-op.
      const again = await service.applyAnalysisResults({
        kind: "analysis",
        jobId: "analyze_rf_1",
        status: "completed",
        results: [
          { stemId: nullId, features: revision3(130) },
          { stemId: rev1Id, features: revision3(131) },
        ],
      });
      expect(again.updated).toBe(0);
      expect((await featuresOf(nullId))?.tempoBpm).toBe(120);
      expect((await featuresOf(rev1Id))?.tempoBpm).toBe(121);
    });

    it("applyAnalysisResults never downgrades to a revision-1 result", async () => {
      const outcome = await service.applyAnalysisResults({
        kind: "analysis",
        jobId: "analyze_rf_2",
        status: "completed",
        results: [
          { stemId: rev2Id, features: { ...WORKER_FEATURES, tempoBpm: 140 } },
          // Equal revision (1 vs 1): not an upgrade, stays untouched.
          { stemId: rev1Id, features: { ...WORKER_FEATURES, tempoBpm: 141 } },
          // A revision-1 result still fills a missing row.
          { stemId: nullId, features: { ...WORKER_FEATURES, tempoBpm: 142 } },
        ],
      });
      expect(outcome.updated).toBe(1);
      expect(await featuresOf(rev2Id)).toEqual(
        expect.objectContaining({ tempoBpm: 95, analysisRevision: 2 }),
      );
      expect((await featuresOf(rev1Id))?.tempoBpm).toBe(90);
      const filled = await featuresOf(nullId);
      expect(filled?.tempoBpm).toBe(142);
      expect(filled).not.toHaveProperty("analysisRevision");
    });
  });

  describe("failed analyses are held back (#2012)", () => {
    const ID = (name: string) => `${TEST_PREFIX}${name}`;
    // Ids sort as listed: the failing stem would come first by id.
    const failId = ID("ms_a_fail");
    const okB = ID("ms_b_ok");
    const okC = ID("ms_c_ok");
    const ourIds = [failId, okB, okC];
    const DAY_AND_AN_HOUR_MS = 25 * 60 * 60 * 1000;

    const analyzedNames = () =>
      fetchSpy.mock.calls
        .filter(([url]) => String(url).endsWith("/analyze"))
        .map(([, init]) => (((init as RequestInit).body as FormData).get("file") as File).name);
    const failureOf = async (id: string) =>
      prisma.stem.findUnique({
        where: { id },
        select: { audioFeatures: true, audioFeaturesFailedAt: true, audioFeaturesFailureCount: true },
      });
    const ageLastFailure = (id: string) =>
      prisma.stem.update({
        where: { id },
        data: { audioFeaturesFailedAt: new Date(Date.now() - DAY_AND_AN_HOUR_MS) },
      });

    beforeAll(async () => {
      // "master" is used by no other test here.
      await prisma.stem.createMany({
        data: ourIds.map((id) => ({
          id,
          trackId: TRACK_ID,
          type: "master",
          uri: "db://bytes",
          data: Buffer.from("fake-audio"),
        })),
      });
    });

    beforeEach(() => {
      // The worker always fails to analyze the failing stem (HTTP 500).
      fetchSpy.mockImplementation(async (_url: unknown, init?: RequestInit) => {
        const file = (init?.body as FormData).get("file") as File;
        if (file.name === `${failId}.audio`) {
          return { ok: false, status: 500, json: async () => ({}) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "success", features: WORKER_FEATURES }),
        } as any;
      });
    });

    it("does not re-pick a failing stem within the window and counts it in failed, not remaining", async () => {
      const first = await service.backfill({ limit: 1, types: ["master"] });
      expect(first.skipped).toEqual([{ stemId: failId, reason: "analysis_failed" }]);
      expect(first).toEqual(
        expect.objectContaining({ updated: 0, remaining: 2, failed: 1 }),
      );
      const failedRow = await failureOf(failId);
      expect(failedRow?.audioFeaturesFailureCount).toBe(1);
      expect(failedRow?.audioFeaturesFailedAt).toBeInstanceOf(Date);
      expect(failedRow?.audioFeatures).toBeNull();

      // Each later batch moves on to an untried stem.
      const second = await service.backfill({ limit: 1, types: ["master"] });
      expect(second).toEqual(
        expect.objectContaining({ scanned: 1, updated: 1, remaining: 1, failed: 1 }),
      );
      const third = await service.backfill({ limit: 1, types: ["master"] });
      expect(third).toEqual(
        expect.objectContaining({ scanned: 1, updated: 1, remaining: 0, failed: 1 }),
      );
      const fourth = await service.backfill({ limit: 1, types: ["master"] });
      expect(fourth).toEqual(
        expect.objectContaining({ scanned: 0, updated: 0, remaining: 0, failed: 1 }),
      );

      expect(analyzedNames()).toEqual([`${failId}.audio`, `${okB}.audio`, `${okC}.audio`]);
      expect(await service.status({ types: ["master"] })).toEqual(
        expect.objectContaining({ remaining: 0, failed: 1 }),
      );
      for (const id of [okB, okC]) {
        expect((await failureOf(id))?.audioFeaturesFailureCount).toBe(0);
      }
    });

    it("retries after the window with untried stems first, then holds the stem at the failure cap", async () => {
      // An untried stem sorts after the failing one by id but is picked first.
      await prisma.stem.update({ where: { id: okC }, data: { audioFeatures: Prisma.DbNull } });
      await ageLastFailure(failId);

      const untried = await service.backfill({ limit: 1, types: ["master"] });
      expect(untried).toEqual(expect.objectContaining({ updated: 1, remaining: 1, failed: 0 }));
      expect(analyzedNames()).toEqual([`${okC}.audio`]);

      // Failure 2, then (after the window again) failure 3.
      await service.backfill({ limit: 1, types: ["master"] });
      expect((await failureOf(failId))?.audioFeaturesFailureCount).toBe(2);
      await ageLastFailure(failId);
      await service.backfill({ limit: 1, types: ["master"] });
      expect((await failureOf(failId))?.audioFeaturesFailureCount).toBe(3);

      // At the cap the window no longer releases it.
      await ageLastFailure(failId);
      fetchSpy.mockClear();
      const capped = await service.backfill({ limit: 1, types: ["master"] });
      expect(capped).toEqual(
        expect.objectContaining({ scanned: 0, remaining: 0, failed: 1 }),
      );
      expect(analyzedNames()).toEqual([]);
    });

    it("retryFailed re-attempts held-back stems and a success resets the failure fields", async () => {
      // The worker can now analyze it.
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", features: WORKER_FEATURES }),
      } as any);

      const result = await service.backfill({ types: ["master"], retryFailed: true });

      expect(analyzedNames()).toEqual([`${failId}.audio`]);
      expect(result).toEqual(
        expect.objectContaining({ updated: 1, remaining: 0, failed: 0 }),
      );
      const row = await failureOf(failId);
      expect(row?.audioFeatures).toEqual(expect.objectContaining({ tempoBpm: 110.2 }));
      expect(row?.audioFeaturesFailureCount).toBe(0);
      expect(row?.audioFeaturesFailedAt).toBeNull();
    });
  });
});
