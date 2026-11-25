/**
 * Streaming renditions (#2661) — Testcontainers Integration Test
 *
 * - the public blob path never returns the bytes of a cloud-stored original;
 * - the track stream resolves the same stem as before, with its rendition;
 * - the sweep creates renditions, records them, counts `remaining` down to 0,
 *   skips official stems and parks repeated failures.
 *
 * Run: npm run test:integration -- stream_rendition
 */
import { prisma } from "../db/prisma";
import { CatalogService } from "../modules/catalog/catalog.service";
import { EventBus } from "../modules/shared/event_bus";
import { StorageProvider, type StorageResult } from "../modules/storage/storage_provider";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import {
  STREAM_RENDITION_MAX_FAILURES,
  StreamRenditionService,
} from "../modules/catalog/stream_rendition.service";

const TEST_PREFIX = `rend_${Date.now()}_`;
const userId = `${TEST_PREFIX}user`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const originalId = `${TEST_PREFIX}original`;
const vocalsId = `${TEST_PREFIX}vocals`;
const officialId = `${TEST_PREFIX}official`;
const ORIGINAL_BYTES = Buffer.from("lossless-master-bytes");

class RecordingStorage extends StorageProvider {
  readonly uploads: Array<{ filename: string; prefix?: string; size: number }> = [];
  async upload(data: Buffer, filename: string, _mimeType: string, options?: { prefix?: string }): Promise<StorageResult> {
    this.uploads.push({ filename, prefix: options?.prefix, size: data.length });
    return { uri: `https://storage.googleapis.com/bucket/${options?.prefix ?? "originals"}/${filename}`, provider: "gcs" };
  }
  async download(): Promise<Buffer | null> {
    return ORIGINAL_BYTES;
  }
  async delete(): Promise<void> {}
}

/** Transcoding is ffmpeg's job; here it only has to differ from the input. */
class TestRenditionService extends StreamRenditionService {
  failFor = new Set<string>();
  protected async transcode(data: Buffer): Promise<Buffer> {
    if (this.failFor.size > 0) throw new Error("transcode failed");
    return Buffer.concat([Buffer.from("MP3:"), data.subarray(0, 4)]);
  }
}

const encryption = { loadSourceBuffer: jest.fn(async () => ORIGINAL_BYTES), decrypt: jest.fn() };

let catalog: CatalogService;
let storage: RecordingStorage;
let renditions: TestRenditionService;

function ourStems() {
  return { id: { startsWith: TEST_PREFIX } };
}

describe("Streaming renditions (integration)", () => {
  beforeAll(async () => {
    storage = new RecordingStorage();
    catalog = new CatalogService(new EventBus(), encryption as any, storage, new UploadRightsRoutingService());
    renditions = new TestRenditionService(catalog, storage);

    await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    await prisma.artist.create({ data: { id: artistId, userId, displayName: "Rendition Artist" } });
    await prisma.release.create({ data: { id: releaseId, artistId, title: "Rendition Album", status: "published" } });
    await prisma.track.create({ data: { id: trackId, releaseId, title: "Rendition Track", artist: "Rendition Artist" } });
    await prisma.stem.createMany({
      data: [
        {
          id: originalId,
          trackId,
          type: "original",
          uri: `https://storage.googleapis.com/bucket/originals/${originalId}.wav`,
          storageProvider: "gcs",
          mimeType: "audio/wav",
        },
        {
          id: vocalsId,
          trackId,
          type: "vocals",
          source: "separated",
          uri: `https://storage.googleapis.com/bucket/originals/${vocalsId}.mp3`,
          storageProvider: "gcs",
          mimeType: "audio/mpeg",
        },
        {
          id: officialId,
          trackId,
          type: "drums",
          source: "official",
          uri: `https://storage.googleapis.com/bucket/originals/${officialId}.wav`,
          storageProvider: "gcs",
          mimeType: "audio/wav",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: ourStems() });
    await prisma.track.deleteMany({ where: { id: trackId } });
    await prisma.release.deleteMany({ where: { id: releaseId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("never returns a cloud original through the public blob path", async () => {
    await expect(catalog.getStemBlob(originalId)).resolves.toBeNull();
    await expect(catalog.getStemBlob(vocalsId)).resolves.toBeNull();
    // A filename lookup can no longer reach a cloud object either.
    await expect(catalog.getStemBlob(`originals/${originalId}`)).resolves.toBeNull();
    // Internal callers still read the archive.
    const internal = await catalog.getStemBlob(originalId, { includeRestricted: true });
    expect(internal?.data.equals(ORIGINAL_BYTES)).toBe(true);
  });

  it("resolves the track's full mix, without a rendition yet", async () => {
    const stem = await catalog.resolveTrackStreamStem(trackId);
    expect(stem).toMatchObject({ id: originalId, streamUri: null });
  });

  it("parks a stem after repeated failures and keeps it out of remaining", async () => {
    renditions.failFor.add("all");
    for (let attempt = 0; attempt < STREAM_RENDITION_MAX_FAILURES; attempt += 1) {
      await renditions.createRendition(vocalsId);
    }
    renditions.failFor.clear();
    const parked = await prisma.stem.findUniqueOrThrow({ where: { id: vocalsId } });
    expect(parked.streamFailureCount).toBe(STREAM_RENDITION_MAX_FAILURES);
    expect(parked.streamUri).toBeNull();
    await prisma.stem.update({ where: { id: vocalsId }, data: { streamFailureCount: 0, streamFailedAt: null } });
  });

  it("backfills our stems to remaining 0, full mix first, skipping official stems", async () => {
    let guard = 0;
    while (
      (await prisma.stem.count({ where: { ...ourStems(), source: { not: "official" }, streamUri: null } })) > 0 &&
      guard < 50
    ) {
      await renditions.runSweep(50);
      guard += 1;
    }
    const rows = await prisma.stem.findMany({ where: ourStems(), orderBy: { id: "asc" } });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[originalId].streamUri).toContain(`/renditions/rendition-${originalId}.mp3`);
    expect(byId[originalId].streamMimeType).toBe("audio/mpeg");
    expect(byId[vocalsId].streamUri).toContain(`/renditions/rendition-${vocalsId}.mp3`);
    expect(byId[officialId].streamUri).toBeNull();

    const ours = storage.uploads.filter((upload) => upload.filename.includes(TEST_PREFIX));
    expect(ours.every((upload) => upload.prefix === "renditions")).toBe(true);

    const stem = await catalog.resolveTrackStreamStem(trackId);
    expect(stem?.streamUri).toContain("/renditions/");
    const publicStem = await catalog.resolvePublicStreamStem(vocalsId);
    expect(publicStem?.streamUri).toContain("/renditions/");
  });

  it("stops resolving a withdrawn release for listeners", async () => {
    await prisma.release.update({ where: { id: releaseId }, data: { status: "withdrawn" } });
    await expect(catalog.resolveTrackStreamStem(trackId)).resolves.toBeNull();
    await expect(catalog.resolvePublicStreamStem(originalId)).resolves.toBeNull();
    await expect(catalog.resolveTrackStreamStem(trackId, { includeRestricted: true })).resolves.not.toBeNull();
    await prisma.release.update({ where: { id: releaseId }, data: { status: "published" } });
  });
});
