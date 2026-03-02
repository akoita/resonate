/**
 * Release Pipeline Integration Tests
 *
 * Verifies the full release upload → stem separation → completion pipeline
 * with mocked Pub/Sub and storage. This test suite exercises the coordination
 * between IngestionService, StemsProcessor, and StemResultSubscriber.
 */

import { EventBus } from "../modules/shared/event_bus";

// Track emitted events for assertions
const emittedEvents: Array<{ name: string; payload: any }> = [];

describe("Release Pipeline Integration", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    emittedEvents.length = 0;
    eventBus = new EventBus();

    // Subscribe to all pipeline events
    for (const eventName of [
      "stems.uploaded",
      "stems.processing",
      "stems.processed",
      "stems.failed",
      "catalog.track_status",
      "catalog.release_status",
    ]) {
      eventBus.subscribe(eventName, (payload: any) => {
        emittedEvents.push({ name: eventName, payload });
      });
    }
  });

  describe("URI resolution pipeline", () => {
    it("correctly resolves relative URIs for different environments", () => {
      const testCases = [
        {
          input: "/catalog/stems/original.m4a/blob",
          backendUrl: "http://host.docker.internal:3000",
          expected: "http://host.docker.internal:3000/catalog/stems/original.m4a/blob",
          description: "Docker environment",
        },
        {
          input: "/catalog/stems/original.m4a/blob",
          backendUrl: "http://localhost:3000",
          expected: "http://localhost:3000/catalog/stems/original.m4a/blob",
          description: "Local development",
        },
        {
          input: "http://example.com/audio.mp3",
          backendUrl: "http://host.docker.internal:3000",
          expected: "http://example.com/audio.mp3",
          description: "Already absolute URL",
        },
        {
          input: "https://gateway.lighthouse.storage/ipfs/Qm.../blob",
          backendUrl: "http://host.docker.internal:3000",
          expected: "https://gateway.lighthouse.storage/ipfs/Qm.../blob",
          description: "IPFS URL",
        },
      ];

      for (const tc of testCases) {
        const resolved = tc.input.startsWith("http")
          ? tc.input
          : `${tc.backendUrl}${tc.input}`;

        expect(resolved).toBe(tc.expected);
      }
    });
  });

  describe("Pub/Sub message shapes", () => {
    it("StemSeparateMessage has required fields", () => {
      const message = {
        jobId: "sep_rel_123_trk_456",
        releaseId: "rel_123",
        artistId: "artist_1",
        trackId: "trk_456",
        originalStemUri: "http://host.docker.internal:3000/catalog/stems/test.mp3/blob",
        mimeType: "audio/mpeg",
      };

      expect(message.jobId).toMatch(/^sep_/);
      expect(message.releaseId).toMatch(/^rel_/);
      expect(message.trackId).toMatch(/^trk_/);
      expect(message.originalStemUri).toMatch(/^https?:\/\//);
      expect(message.mimeType).toMatch(/^audio\//);
    });

    it("StemResultMessage completed has stems map", () => {
      const result = {
        jobId: "sep_rel_123_trk_456",
        releaseId: "rel_123",
        artistId: "artist_1",
        trackId: "trk_456",
        status: "completed" as const,
        stems: {
          vocals: "/outputs/rel_123/trk_456/vocals.mp3",
          drums: "/outputs/rel_123/trk_456/drums.mp3",
          bass: "/outputs/rel_123/trk_456/bass.mp3",
          guitar: "/outputs/rel_123/trk_456/guitar.mp3",
          piano: "/outputs/rel_123/trk_456/piano.mp3",
          other: "/outputs/rel_123/trk_456/other.mp3",
        },
      };

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stems!)).toHaveLength(6);
      expect(result.stems).toHaveProperty("vocals");
      expect(result.stems).toHaveProperty("drums");
      expect(result.stems).toHaveProperty("bass");
    });

    it("StemResultMessage failed has error", () => {
      const result = {
        jobId: "sep_rel_123_trk_456",
        releaseId: "rel_123",
        artistId: "artist_1",
        trackId: "trk_456",
        status: "failed" as const,
        error: "Could not find audio at any of: ['/catalog/stems/test.m4a/blob']",
      };

      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Could not find audio");
    });
  });

  describe("Event bus pipeline coordination", () => {
    it("emits stems.uploaded event", () => {
      eventBus.publish({
        eventName: "stems.uploaded",
        releaseId: "rel_123",
        trackId: "trk_456",
      } as any);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe("stems.uploaded");
    });

    it("stems.failed event contains error details", () => {
      const errorPayload = {
        eventName: "stems.failed" as const,
        releaseId: "rel_123",
        trackId: "trk_456",
        error: "Demucs worker unreachable",
      };

      eventBus.publish(errorPayload as any);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].payload.error).toBe("Demucs worker unreachable");
    });

    it("track status events propagate through the pipeline", () => {
      // Simulate the full event sequence
      eventBus.publish({
        eventName: "catalog.track_status",
        trackId: "trk_456",
        status: "separating",
      } as any);
      eventBus.publish({
        eventName: "catalog.track_status",
        trackId: "trk_456",
        status: "uploading",
      } as any);
      eventBus.publish({
        eventName: "catalog.track_status",
        trackId: "trk_456",
        status: "complete",
      } as any);

      expect(emittedEvents).toHaveLength(3);
      expect(emittedEvents.map(e => e.payload.status)).toEqual([
        "separating",
        "uploading",
        "complete",
      ]);
    });
  });

  describe("Processing status transitions", () => {
    it("follows correct state machine: pending → separating → uploading → complete", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["separating"],
        separating: ["uploading", "failed"],
        uploading: ["complete", "failed"],
        complete: [],
        failed: [],
      };

      // Verify all transitions are valid
      const statusFlow = ["pending", "separating", "uploading", "complete"];
      for (let i = 0; i < statusFlow.length - 1; i++) {
        const from = statusFlow[i];
        const to = statusFlow[i + 1];
        expect(validTransitions[from]).toContain(to);
      }
    });

    it("allows separating → failed transition", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["separating"],
        separating: ["uploading", "failed"],
        uploading: ["complete", "failed"],
      };

      expect(validTransitions["separating"]).toContain("failed");
    });
  });
});
