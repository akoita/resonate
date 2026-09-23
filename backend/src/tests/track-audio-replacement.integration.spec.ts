import { prisma } from "../db/prisma";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogService } from "../modules/catalog/catalog.service";
import { IngestionService } from "../modules/ingestion/ingestion.service";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `track_audio_${Date.now()}_`;
const ownerId = `${P}owner`;
const outsiderId = `${P}outsider`;
const artistId = `${P}artist`;
const releaseId = `${P}release`;
const trackId = `${P}track`;
const oldStemId = `${P}old_stem`;

describe("unpublished track audio replacement", () => {
  const eventBus = new EventBus();
  const catalog = new CatalogService(eventBus as any, {} as any, {} as any, new UploadRightsRoutingService());
  const storage = {
    upload: jest.fn(async (_data: Buffer, filename: string) => ({ uri: `/replacement/${filename}`, provider: "gcs" })),
    delete: jest.fn(async () => undefined),
  };
  const queue = { add: jest.fn() };
  const service = new IngestionService(eventBus, storage as any, {} as any, {} as any, catalog, queue as any);
  const upload = {
    originalname: "replacement.wav",
    mimetype: "text/html",
    buffer: Buffer.from("replacement audio"),
  } as Express.Multer.File;

  beforeAll(async () => {
    for (const id of [ownerId, outsiderId]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.artist.create({ data: { id: artistId, userId: ownerId, displayName: "Track audio test" } });
    await prisma.release.create({ data: { id: releaseId, artistId, title: "Unpublished", status: "ready" } });
    await prisma.track.create({ data: { id: trackId, releaseId, title: "Song", position: 1, processingStatus: "complete" } });
    await prisma.stem.create({ data: { id: oldStemId, trackId, type: "original", uri: "/original/current.wav", data: Buffer.from("old audio"), isCurrent: true } });
    await prisma.audioFingerprint.create({
      data: { trackId, fingerprint: "old audio fingerprint", fingerprintHash: `${P}old_hash`, duration: 30, source: "upload" },
    });
  });

  afterAll(async () => {
    await prisma.audioFingerprint.deleteMany({ where: { trackId } });
    await prisma.stem.deleteMany({ where: { trackId } });
    await prisma.track.deleteMany({ where: { id: trackId } });
    await prisma.release.deleteMany({ where: { id: releaseId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
  });

  it("keeps the existing audio when access is denied or the release is published", async () => {
    await expect(service.replaceTrackAudio(releaseId, trackId, outsiderId, upload)).rejects.toThrow();
    expect(storage.upload).not.toHaveBeenCalled();

    await prisma.release.update({ where: { id: releaseId }, data: { status: "published" } });
    await expect(service.replaceTrackAudio(releaseId, trackId, ownerId, upload)).rejects.toThrow("only before publication");
    expect(storage.upload).not.toHaveBeenCalled();
    await prisma.release.update({ where: { id: releaseId }, data: { status: "ready" } });
    expect((await prisma.stem.findUniqueOrThrow({ where: { id: oldStemId } })).isCurrent).toBe(true);
  });

  it("rejects a forged multipart path before reading a local file", async () => {
    const forgedFile = {
      originalname: "replacement.wav",
      mimetype: "audio/wav",
      path: "/etc/passwd",
      destination: "/etc",
      filename: "passwd",
    } as Express.Multer.File;
    await expect(service.replaceTrackAudio(releaseId, trackId, ownerId, forgedFile)).rejects.toThrow(
      "Uploaded audio file has no readable content",
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects a concurrent attempt without replacing the pending revision", async () => {
    await prisma.track.update({
      where: { id: trackId },
      data: { pendingAudioRevision: "existing-attempt", audioReplacementStatus: "processing" },
    });
    await expect(service.replaceTrackAudio(releaseId, trackId, ownerId, upload)).rejects.toThrow("already processing");
    expect((await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).pendingAudioRevision).toBe("existing-attempt");
    expect(storage.delete).toHaveBeenCalledTimes(1);
    await prisma.track.update({ where: { id: trackId }, data: { pendingAudioRevision: null, audioReplacementStatus: null } });
  });

  it("activates a new revision and retains the old stem as history", async () => {
    const result = await service.replaceTrackAudio(releaseId, trackId, ownerId, upload);
    expect(result).toMatchObject({ releaseId, trackId, status: "complete" });
    expect(queue.add).not.toHaveBeenCalled();
    expect(storage.upload).toHaveBeenCalledWith(upload.buffer, expect.any(String), "audio/wav");

    const track = await prisma.track.findUniqueOrThrow({ where: { id: trackId } });
    expect(track.activeAudioRevision).toBe(result.audioRevision);
    expect(track.pendingAudioRevision).toBeNull();
    expect(track.audioReplacementStatus).toBe("complete");
    expect(await prisma.audioFingerprint.findUnique({ where: { trackId } })).toBeNull();
    const releaseDetail = await catalog.getRelease(releaseId);
    expect(releaseDetail?.tracks[0]).toMatchObject({
      id: trackId,
      activeAudioRevision: result.audioRevision,
      pendingAudioRevision: null,
      audioReplacementStatus: "complete",
    });
    const stems = await prisma.stem.findMany({ where: { trackId } });
    expect(stems.find((stem) => stem.id === oldStemId)?.isCurrent).toBe(false);
    expect(stems.filter((stem) => stem.isCurrent).map((stem) => stem.type)).toEqual(expect.arrayContaining(["original", "vocals"]));
    expect(stems.find((stem) => stem.isCurrent && stem.type === "original")?.mimeType).toBe("audio/wav");
    await expect(catalog.getStemBlob(oldStemId)).resolves.toBeNull();
    await expect(catalog.getStemBlob(oldStemId, { includeRestricted: true })).resolves.toMatchObject({ data: Buffer.from("old audio") });
  });

  it("reads a request-owned multipart file from its generated path", async () => {
    const previousRoot = process.env.INGESTION_MULTIPART_TEMP_DIR;
    const tempRoot = await mkdtemp(join(tmpdir(), "resonate-track-audio-"));
    const requestDirectory = await mkdtemp(join(tempRoot, "request-"));
    const filename = "audio-1.upload";
    const path = join(requestDirectory, filename);
    await writeFile(path, Buffer.from("disk audio"));
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    try {
      const result = await service.replaceTrackAudio(releaseId, trackId, ownerId, {
        originalname: "replacement.wav",
        mimetype: "audio/wav",
        path,
        destination: requestDirectory,
        filename,
      } as Express.Multer.File);
      expect(result.status).toBe("complete");
      expect(storage.upload).toHaveBeenCalledWith(Buffer.from("disk audio"), expect.any(String), "audio/wav");
    } finally {
      if (previousRoot === undefined) delete process.env.INGESTION_MULTIPART_TEMP_DIR;
      else process.env.INGESTION_MULTIPART_TEMP_DIR = previousRoot;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects replacement after a current stem has been minted", async () => {
    const currentStem = await prisma.stem.findFirstOrThrow({ where: { trackId, isCurrent: true } });
    const mint = await prisma.stemNftMint.create({
      data: {
        stemId: currentStem.id,
        tokenId: 1n,
        chainId: 1,
        contractAddress: `0x${"1".repeat(40)}`,
        creatorAddress: `0x${"2".repeat(40)}`,
        royaltyBps: 500,
        remixable: true,
        metadataUri: "https://example.invalid/metadata",
        transactionHash: `${P}mint_tx`,
        blockNumber: 1n,
        mintedAt: new Date(),
      },
    });
    try {
      await expect(service.replaceTrackAudio(releaseId, trackId, ownerId, upload)).rejects.toThrow(
        "Audio cannot be replaced after a stem has been minted",
      );
      expect((await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).pendingAudioRevision).toBeNull();
    } finally {
      await prisma.stemNftMint.delete({ where: { id: mint.id } });
    }
  });

  it("rolls back the pending revision if the queue cannot accept its job", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const rejectingQueue = { add: jest.fn().mockRejectedValue(new Error("Queue unavailable")) };
    const queuedService = new IngestionService(
      eventBus, storage as any, {} as any, {} as any, catalog, rejectingQueue as any,
    );
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    const priorStemCount = await prisma.stem.count({ where: { trackId } });
    await expect(queuedService.replaceTrackAudio(releaseId, trackId, ownerId, upload)).rejects.toThrow("Queue unavailable");
    expect(rejectingQueue.add).toHaveBeenCalledTimes(1);
    expect(rejectingQueue.add).toHaveBeenCalledWith(
      "process-stems",
      expect.objectContaining({ releaseId, tracks: [expect.objectContaining({ id: trackId })] }),
      expect.objectContaining({ delay: 15_000 }),
    );
    expect((await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).pendingAudioRevision).toBeNull();
    expect(await prisma.stem.count({ where: { trackId } })).toBe(priorStemCount);
    expect(storage.delete).toHaveBeenCalled();
  });
});
