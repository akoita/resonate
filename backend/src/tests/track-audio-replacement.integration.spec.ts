import { prisma } from "../db/prisma";
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
  });

  afterAll(async () => {
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
});
