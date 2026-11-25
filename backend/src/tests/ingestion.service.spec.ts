import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { promises as fs } from "fs";
import { join } from "path";
import { IngestionService } from "../modules/ingestion/ingestion.service";
import { EventBus } from "../modules/shared/event_bus";

// Upload limits read the database (#2659); these unit specs cover the upload
// flow itself, and the limits have their own integration spec.
// #2666: the participation gate reads the database; these tests cover storage.
jest.mock("../modules/participation/participation.service", () => ({
  assertParticipationAccepted: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../modules/trust/upload_limits", () => ({
  assertWithinUploadLimits: jest.fn().mockResolvedValue(undefined),
}));

function makeService(artistProfile: { id: string } | null) {
  return new IngestionService(
    { publish: jest.fn(), subscribe: jest.fn() } as any,
    {} as any,
    {} as any,
    { getProfile: jest.fn().mockResolvedValue(artistProfile) } as any,
    {} as any,
    { add: jest.fn() } as any,
  );
}

describe("IngestionService upload ownership", () => {
  it("refuses invalid composition details before storing any audio (#2669)", async () => {
    const storageProvider = { upload: jest.fn() };
    const service = new IngestionService(
      { publish: jest.fn(), subscribe: jest.fn() } as any,
      storageProvider as any,
      {} as any,
      { getProfile: jest.fn() } as any,
      {} as any,
      { add: jest.fn() } as any,
    );
    await expect(
      service.handleFileUpload({
        artistId: "artist-1",
        files: [{ originalname: "a.wav", mimetype: "audio/wav", buffer: Buffer.from("x"), size: 1 } as Express.Multer.File],
        metadata: { tracks: [{ composition: { iswc: "T-034.524.680-9" } }] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageProvider.upload).not.toHaveBeenCalled();
  });

  it("rejects uploads that target another artist profile", async () => {
    const service = makeService({ id: "artist-owned-by-user" });

    await expect(
      service.handleFileUpload({
        artistId: "artist-owned-by-someone-else",
        userId: "user-1",
        files: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("reads path-backed audio sequentially without retaining production buffers", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSyncProcessing = process.env.USE_SYNC_PROCESSING;
    const originalTempRoot = process.env.INGESTION_MULTIPART_TEMP_DIR;
    process.env.NODE_ENV = "production";
    process.env.USE_SYNC_PROCESSING = "true";
    const eventBus = new EventBus();
    const uploadedEvents: any[] = [];
    eventBus.subscribe("stems.uploaded", (event: any) => uploadedEvents.push(event));
    const storageProvider = {
      upload: jest.fn().mockResolvedValue({ uri: "local://original", provider: "local" }),
    };
    const service = new IngestionService(
      eventBus,
      storageProvider as any,
      {} as any,
      { getProfile: jest.fn() } as any,
      {} as any,
      { add: jest.fn() } as any,
    );
    const tempDir = await fs.mkdtemp("/tmp/resonate-ingestion-service-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempDir;
    const requestDirectory = await fs.mkdtemp(join(tempDir, "request-"));
    const filename = "audio-1.upload";
    const audioPath = join(requestDirectory, filename);
    const audio = Buffer.from("path-backed audio");
    await fs.writeFile(audioPath, audio);

    try {
      const result = await service.handleFileUpload({
        artistId: "artist-1",
        files: [{
          fieldname: "files",
          originalname: "track.wav",
          encoding: "7bit",
          mimetype: "audio/wav",
          size: audio.length,
          path: audioPath,
          destination: requestDirectory,
          filename,
        } as Express.Multer.File],
        metadata: {
          tracks: [{
            aiDisclosure: { level: "none", facets: [] },
            // #2669: composition details travel with the track, normalized.
            composition: { writers: [{ name: " Ada ", role: "composer" }], iswc: "T-034.524.680-1" },
          }],
        },
      });

      expect(result.status).toBe("processing");
      expect(uploadedEvents[0].metadata.tracks[0].composition).toEqual(
        expect.objectContaining({ writers: [{ name: "Ada", role: "composer" }], iswc: "T0345246801" }),
      );
      expect(storageProvider.upload).toHaveBeenCalledWith(audio, expect.any(String), "audio/wav");
      expect(uploadedEvents[0].metadata.tracks[0].stems[0].data).toBeUndefined();
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalSyncProcessing === undefined) delete process.env.USE_SYNC_PROCESSING;
      else process.env.USE_SYNC_PROCESSING = originalSyncProcessing;
      if (originalTempRoot === undefined) delete process.env.INGESTION_MULTIPART_TEMP_DIR;
      else process.env.INGESTION_MULTIPART_TEMP_DIR = originalTempRoot;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
