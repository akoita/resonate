/**
 * Upload ownership against real Postgres: an upload may reuse catalog audio
 * only from the caller's own tracks, and the deprecated enqueue route binds the
 * upload to the caller's artist profile, as the multipart upload route does.
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { IngestionService } from "../modules/ingestion/ingestion.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `ingestion_owner_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const OTHER_ID = `${TEST_PREFIX}other`;
const NO_PROFILE_ID = `${TEST_PREFIX}no_profile`;
const OWNER_ARTIST = `${TEST_PREFIX}owner_artist`;
const OTHER_ARTIST = `${TEST_PREFIX}other_artist`;
const OWN_TRACK = `${TEST_PREFIX}own_track`;
const FOREIGN_TRACK = `${TEST_PREFIX}foreign_track`;

describe("ingestion upload ownership", () => {
  const eventBus = new EventBus();
  const artistService = {
    getProfile: jest.fn(async (userId: string) =>
      prisma.artist.findFirst({ where: { userId }, select: { id: true, displayName: true } }),
    ),
  };
  const catalogService = { getTrackStream: jest.fn().mockResolvedValue(null) };
  const service = new IngestionService(
    eventBus,
    {} as any,
    {} as any,
    artistService as any,
    catalogService as any,
    { add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) } as any,
  );

  beforeAll(async () => {
    for (const id of [OWNER_ID, OTHER_ID, NO_PROFILE_ID]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    for (const [artistId, userId, track] of [
      [OWNER_ARTIST, OWNER_ID, OWN_TRACK],
      [OTHER_ARTIST, OTHER_ID, FOREIGN_TRACK],
    ]) {
      await prisma.artist.create({ data: { id: artistId, userId, displayName: `Artist ${artistId}` } });
      await prisma.release.create({
        data: { id: `${track}_release`, artistId, title: "Catalog release", status: "published" },
      });
      await prisma.track.create({ data: { id: track, releaseId: `${track}_release`, title: "Catalog track", position: 1 } });
    }
  });

  afterAll(async () => {
    await prisma.track.deleteMany({ where: { id: { in: [OWN_TRACK, FOREIGN_TRACK] } } });
    await prisma.release.deleteMany({ where: { id: { in: [`${OWN_TRACK}_release`, `${FOREIGN_TRACK}_release`] } } });
    await prisma.artist.deleteMany({ where: { id: { in: [OWNER_ARTIST, OTHER_ARTIST] } } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, OTHER_ID, NO_PROFILE_ID] } } });
    eventBus.destroy();
  });

  beforeEach(() => catalogService.getTrackStream.mockClear());

  it("refuses to reuse another artist's catalog audio, before reading it", async () => {
    await expect(
      service.handleFileUpload({ userId: OWNER_ID, files: [], metadata: {}, catalogTrackId: FOREIGN_TRACK }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.handleFileUpload({ userId: OWNER_ID, files: [], metadata: {}, catalogTrackId: `${TEST_PREFIX}missing` }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(catalogService.getTrackStream).not.toHaveBeenCalled();
  });

  it("lets the owner reuse their own catalog audio", async () => {
    // The stub has no audio, so the upload stops right after the ownership check.
    await expect(
      service.handleFileUpload({ userId: OWNER_ID, files: [], metadata: {}, catalogTrackId: OWN_TRACK }),
    ).rejects.toThrow("audio not found in catalog");
    expect(catalogService.getTrackStream).toHaveBeenCalledWith(OWN_TRACK, { includeRestricted: true });
  });

  it("binds a deprecated enqueue to the caller's artist profile", async () => {
    const publish = jest.spyOn(eventBus, "publish");
    await expect(
      service.enqueueUpload({ userId: OWNER_ID, artistId: OTHER_ARTIST, fileUris: ["test://a.wav"] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.enqueueUpload({ userId: NO_PROFILE_ID, artistId: OTHER_ARTIST, fileUris: ["test://a.wav"] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.enqueueUpload({ userId: OWNER_ID, artistId: OWNER_ARTIST, fileUris: [42 as unknown as string] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(publish).not.toHaveBeenCalled();

    const queued = await service.enqueueUpload({ userId: OWNER_ID, artistId: "", fileUris: ["test://a.wav"] });
    expect(queued.trackId).toBeDefined();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventName: "stems.uploaded", artistId: OWNER_ARTIST }));
    publish.mockRestore();
  });
});
