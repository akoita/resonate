/**
 * Demucs Integration Test
 *
 * This test verifies the end-to-end stem separation flow using the real Demucs worker.
 * Prerequisites:
 *   - Docker Compose running with demucs-worker service
 *   - Redis running for BullMQ
 *
 * Run with: npm test -- --testPathPattern=demucs_integration
 * Skip in CI by default (requires GPU or long CPU processing time)
 */

import { EventBus } from "../modules/shared/event_bus";
import { IngestionService } from "../modules/ingestion/ingestion.service";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import * as fs from "fs";
import * as path from "path";

// Skip if SKIP_DEMUCS_INTEGRATION is set (CI environments)
const SKIP_INTEGRATION = process.env.SKIP_DEMUCS_INTEGRATION === "true";
const DEMUCS_WORKER_URL = process.env.DEMUCS_WORKER_URL || "http://localhost:8000";

// Helper to check if Demucs worker is available
async function isDemucsWorkerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${DEMUCS_WORKER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Mock dependencies that aren't needed for this integration test
const mockEncryptionService = {
  encrypt: jest.fn().mockResolvedValue(null),
  isReady: true,
};

const mockArtistService = {
  findById: jest.fn().mockResolvedValue({
    id: "artist_test",
    payoutAddress: "0x1234567890123456789012345678901234567890",
  }),
};

const mockQueue = {
  add: jest.fn().mockImplementation(async (name, data) => {
    // Simulate immediate processing for integration test
    return { id: "job_1", data };
  }),
};

describe("Demucs Integration", () => {
  let eventBus: EventBus;
  let storageProvider: LocalStorageProvider;
  let ingestionService: IngestionService;
  let workerAvailable = false;

  beforeAll(async () => {
    workerAvailable = await isDemucsWorkerAvailable();
    if (!workerAvailable) {
      console.warn(
        "⚠️  Demucs worker not available. Start it with: docker compose up -d demucs-worker"
      );
    }
  });

  beforeEach(() => {
    eventBus = new EventBus();
    storageProvider = new LocalStorageProvider();
    const mockCatalogService = {} as any;
    ingestionService = new IngestionService(
      eventBus,
      storageProvider,
      mockEncryptionService as any,
      mockArtistService as any,
      mockCatalogService as any,
      mockQueue as any
    );
  });

  it(
    "Demucs worker health check returns ok",
    async () => {
      if (SKIP_INTEGRATION || !workerAvailable) {
        console.log("⏭️  Skipping: Demucs worker not available or SKIP_DEMUCS_INTEGRATION=true");
        return;
      }
      const response = await fetch(`${DEMUCS_WORKER_URL}/health`);
      const data = await response.json();
      expect(data.status).toBe("ok");
    },
    10000
  );

  it(
    "separates audio into stems via Demucs worker",
    async () => {
      if (SKIP_INTEGRATION || !workerAvailable) {
        console.log("⏭️  Skipping: Demucs worker not available or SKIP_DEMUCS_INTEGRATION=true");
        return;
      }

      // Use the test audio file if available
      const testAudioPath = path.join(process.cwd(), "test_audio.wav");

      if (!fs.existsSync(testAudioPath)) {
        console.warn("⚠️  test_audio.wav not found, skipping full separation test");
        return;
      }

      const audioBuffer = fs.readFileSync(testAudioPath);
      const releaseId = `rel_test_${Date.now()}`;
      const trackId = `trk_test_${Date.now()}`;

      // Call Demucs worker directly
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: "audio/wav" });
      formData.append("file", blob, "test_audio.wav");

      const response = await fetch(
        `${DEMUCS_WORKER_URL}/separate/${releaseId}/${trackId}`,
        {
          method: "POST",
          body: formData,
          // @ts-ignore - AbortSignal.timeout exists in Node 18+
          signal: AbortSignal.timeout(600000), // 10 minutes for CPU processing
        }
      );

      expect(response.ok).toBe(true);

      const result = (await response.json()) as {
        status: string;
        release_id: string;
        track_id: string;
        stems: Record<string, string>;
      };

      expect(result.status).toBe("success");
      expect(result.release_id).toBe(releaseId);
      expect(result.track_id).toBe(trackId);

      // Verify we got at least vocals, drums, bass, other
      const expectedStems = ["vocals", "drums", "bass", "other"];
      for (const stem of expectedStems) {
        expect(result.stems).toHaveProperty(stem);
        expect(result.stems[stem]).toContain(".mp3");
      }

      console.log("✅ Demucs separation successful:", Object.keys(result.stems));
    },
    660000 // 11 minute timeout for full processing
  );

  it(
    "handles invalid audio file gracefully",
    async () => {
      if (SKIP_INTEGRATION || !workerAvailable) {
        console.log("⏭️  Skipping: Demucs worker not available or SKIP_DEMUCS_INTEGRATION=true");
        return;
      }

      const invalidBuffer = Buffer.from("not audio data");
      const formData = new FormData();
      const blob = new Blob([invalidBuffer], { type: "audio/wav" });
      formData.append("file", blob, "invalid.wav");

      const response = await fetch(
        `${DEMUCS_WORKER_URL}/separate/rel_invalid/trk_invalid`,
        {
          method: "POST",
          body: formData,
          // @ts-ignore
          signal: AbortSignal.timeout(30000),
        }
      );

      // Should return error status
      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
    },
    35000
  );

  it("emits stems.uploaded event on handleFileUpload", async () => {
    const uploadedPromise = new Promise<any>((resolve) => {
      eventBus.subscribe("stems.uploaded", resolve);
    });

    // Create a mock file buffer
    const mockBuffer = Buffer.from("mock audio data");
    const mockFile: Express.Multer.File = {
      buffer: mockBuffer,
      originalname: "test.wav",
      mimetype: "audio/wav",
      fieldname: "files",
      encoding: "7bit",
      size: mockBuffer.length,
      destination: "",
      filename: "",
      path: "",
      stream: null as any,
    };

    const result = await ingestionService.handleFileUpload({
      artistId: "artist_test",
      files: [mockFile],
      metadata: {
        releaseTitle: "Integration Test Track",
        primaryArtist: "Test Artist",
      },
    });

    expect(result.releaseId).toBeDefined();
    expect(result.status).toBe("processing");

    // Verify stems.uploaded was emitted
    const uploadedEvent = await uploadedPromise;
    expect(uploadedEvent.eventName).toBe("stems.uploaded");
    expect(uploadedEvent.releaseId).toBe(result.releaseId);

    // In test mode (NODE_ENV=test), processing is synchronous and queue is not used
    // In production mode, the job would be queued via BullMQ
    if (process.env.NODE_ENV !== "test") {
      expect(mockQueue.add).toHaveBeenCalledWith(
        "process-stems",
        expect.objectContaining({
          releaseId: result.releaseId,
          artistId: "artist_test",
        })
      );
    }
  });

  it("mock processing path works in test mode", async () => {
    const processedPromise = new Promise<any>((resolve) => {
      eventBus.subscribe("stems.processed", resolve);
    });

    // enqueueUpload uses mock processing in test mode
    const result = ingestionService.enqueueUpload({
      artistId: "artist_test",
      fileUris: ["test://vocals.wav", "test://drums.wav"],
      metadata: {
        releaseTitle: "Mock Test",
        primaryArtist: "Mock Artist",
      },
    });

    expect(result.trackId).toBeDefined();

    const processedEvent = await processedPromise;
    expect(processedEvent.eventName).toBe("stems.processed");
    expect(processedEvent.modelVersion).toBe("mock-v1"); // Confirms mock path
    expect(processedEvent.tracks[0].stems.length).toBe(2);
  });
});
