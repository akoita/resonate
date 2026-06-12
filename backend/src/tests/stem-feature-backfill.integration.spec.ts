/**
 * Stem audio-feature backfill (#1184/#1182) — integration (Testcontainers).
 *
 * Real Postgres; the demucs worker's /analyze endpoint is mocked at the
 * fetch boundary (external service rule), and storage is a jest fake.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { StemFeatureBackfillService } from "../modules/ingestion/stem-feature-backfill.service";

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
    service = new StemFeatureBackfillService(storageProvider as any);
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", features: WORKER_FEATURES }),
    } as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("backfills missing features, skips unavailable audio, leaves done/encrypted stems alone", async () => {
    const result = await service.backfill({ limit: 50 });

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
});
