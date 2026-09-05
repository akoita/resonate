import { ForbiddenException } from "@nestjs/common";
import { promises as fs } from "fs";
import { join } from "path";
import { IngestionService } from "../modules/ingestion/ingestion.service";
import { EventBus } from "../modules/shared/event_bus";

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
    const audioPath = join(tempDir, "track.upload");
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
        } as Express.Multer.File],
        metadata: {
          tracks: [{ aiDisclosure: { level: "none", facets: [] } }],
        },
      });

      expect(result.status).toBe("processing");
      expect(storageProvider.upload).toHaveBeenCalledWith(audio, expect.any(String), "audio/wav");
      expect(uploadedEvents[0].metadata.tracks[0].stems[0].data).toBeUndefined();
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalSyncProcessing === undefined) delete process.env.USE_SYNC_PROCESSING;
      else process.env.USE_SYNC_PROCESSING = originalSyncProcessing;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
