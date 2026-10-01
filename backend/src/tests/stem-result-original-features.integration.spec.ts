/**
 * Full-mix audio features at ingestion (#1959) — integration (Testcontainers).
 *
 * Drives a worker result payload through the real StemResultSubscriber and
 * the real CatalogService `stems.processed` path into Postgres. Only external
 * services are faked: storage provider, encryption and the artist lookup.
 */

import { prisma } from "../db/prisma";
import { CatalogService } from "../modules/catalog/catalog.service";
import { StemResultSubscriber } from "../modules/ingestion/stem-result.subscriber";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `orig_features_${Date.now()}_`;
const userId = `${P}user`;
const artistId = `${P}artist`;

const workerFeatures = (tempoBpm: number, tonic: string, mode: string) => ({
  schemaVersion: "stem-audio-features/v1",
  extractor: { name: "librosa", version: "0.10.2" },
  sampleRate: 22050,
  durationSeconds: 30.5,
  tempoBpm,
  tempoConfidence: 0.7,
  beatCount: 60,
  firstBeatSec: 0.3,
  key: { tonic, mode, confidence: 0.55 },
  energyRms: 0.11,
  onsetDensity: 2.4,
});

describe("full-mix audio features through ingestion (integration)", () => {
  const eventBus = new EventBus();
  const storageProvider = {
    download: jest.fn(),
    upload: jest.fn(),
  };
  const encryptionService = { encrypt: jest.fn().mockResolvedValue(null) };
  const artistService = {
    findById: jest.fn().mockResolvedValue({ id: artistId, payoutAddress: null }),
  };
  let subscriber: StemResultSubscriber;
  let counter = 0;

  beforeAll(async () => {
    const catalog = new CatalogService(
      eventBus,
      encryptionService as any,
      storageProvider as any,
      new UploadRightsRoutingService(),
    );
    catalog.onModuleInit();
    subscriber = new StemResultSubscriber(
      eventBus,
      storageProvider as any,
      encryptionService as any,
      artistService as any,
      catalog,
      {} as any,
    );

    await prisma.user.create({
      data: { id: userId, email: `${P}@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: "Original Features Artist" },
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { track: { release: { artistId } } } });
    await prisma.track.deleteMany({ where: { release: { artistId } } });
    await prisma.release.deleteMany({ where: { artistId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(() => {
    storageProvider.download.mockReset().mockResolvedValue(Buffer.from("audio"));
    storageProvider.upload
      .mockReset()
      .mockImplementation(async (_data: Buffer, filename: string) => ({
        uri: `local://${filename}`,
        provider: "local",
      }));
  });

  async function seedUploadedTrack() {
    counter += 1;
    const releaseId = `${P}release_${counter}`;
    const trackId = `${P}track_${counter}`;
    const originalId = `${P}original_${counter}`;
    await prisma.release.create({
      data: { id: releaseId, artistId, title: `Release ${counter}`, status: "processing" },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: `Track ${counter}`,
        position: 1,
        processingStatus: "separating",
      },
    });
    // The upload step already stored the original row, without features.
    await prisma.stem.create({
      data: {
        id: originalId,
        trackId,
        type: "original",
        uri: `local://${originalId}.mp3`,
        storageProvider: "local",
      },
    });
    return { releaseId, trackId, originalId };
  }

  async function deliver(
    ids: { releaseId: string; trackId: string; originalId: string },
    stemFeatures: Record<string, unknown>,
  ) {
    const message = {
      data: Buffer.from(
        JSON.stringify({
          jobId: `job_${ids.trackId}`,
          releaseId: ids.releaseId,
          artistId,
          trackId: ids.trackId,
          status: "completed",
          stems: { vocals: "gs://bucket/vocals.mp3" },
          stemFeatures,
          originalStemMeta: {
            id: ids.originalId,
            uri: `local://${ids.originalId}.mp3`,
            durationSeconds: 30.5,
            mimeType: "audio/mpeg",
            storageProvider: "local",
          },
        }),
      ),
      ack: jest.fn(),
      nack: jest.fn(),
    };
    await (subscriber as any).handleMessage(message);
    return message;
  }

  async function waitForReady(releaseId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const release = await prisma.release.findUnique({
        where: { id: releaseId },
        select: { status: true },
      });
      if (release?.status === "ready") return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Release ${releaseId} never reached ready`);
  }

  it("persists tempo, key and camelot on the original stem row", async () => {
    const ids = await seedUploadedTrack();
    const message = await deliver(ids, {
      original: workerFeatures(128.4, "A", "minor"),
      vocals: workerFeatures(128.1, "C", "major"),
    });
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.nack).not.toHaveBeenCalled();
    await waitForReady(ids.releaseId);

    const original = await prisma.stem.findUniqueOrThrow({
      where: { id: ids.originalId },
    });
    expect(original.type).toBe("original");
    expect(original.audioFeatures).toEqual(
      expect.objectContaining({
        schemaVersion: "stem-audio-features/v1",
        tempoBpm: 128.4,
        key: expect.objectContaining({ tonic: "A", mode: "minor" }),
        camelot: "8A",
      }),
    );

    // Separated stems carry the Camelot code too.
    const vocals = await prisma.stem.findFirstOrThrow({
      where: { trackId: ids.trackId, type: "vocals" },
    });
    expect(vocals.audioFeatures).toEqual(
      expect.objectContaining({ tempoBpm: 128.1, camelot: "8B" }),
    );
  });

  it("drops malformed full-mix features without blocking ingestion", async () => {
    const ids = await seedUploadedTrack();
    const message = await deliver(ids, {
      original: { schemaVersion: "v999" },
      vocals: workerFeatures(90, "D", "major"),
    });
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.nack).not.toHaveBeenCalled();
    await waitForReady(ids.releaseId);

    const original = await prisma.stem.findUniqueOrThrow({
      where: { id: ids.originalId },
    });
    expect(original.audioFeatures).toBeNull();
    const vocals = await prisma.stem.findFirstOrThrow({
      where: { trackId: ids.trackId, type: "vocals" },
    });
    expect(vocals.audioFeatures).toEqual(
      expect.objectContaining({ tempoBpm: 90, camelot: "10B" }),
    );
  });

  it("ingests normally when an older worker omits the original entry", async () => {
    const ids = await seedUploadedTrack();
    const message = await deliver(ids, {
      vocals: workerFeatures(100, "E", "minor"),
    });
    expect(message.ack).toHaveBeenCalledTimes(1);
    await waitForReady(ids.releaseId);

    const original = await prisma.stem.findUniqueOrThrow({
      where: { id: ids.originalId },
    });
    expect(original.audioFeatures).toBeNull();
  });
});
