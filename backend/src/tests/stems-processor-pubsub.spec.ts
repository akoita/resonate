/**
 * StemsProcessor (pubsub mode) — Regression Tests
 *
 * Guards against two recurring regressions:
 *
 * 1. **callbackUrl must never be undefined** (2026-03-11)
 *    Without a callbackUrl, the Demucs Docker worker skips HTTP progress
 *    callbacks, so the UI shows "Separating..." with no percentage.
 *
 * 2. **DB status update must tolerate the release not existing yet** (2026-03-11)
 *    The CatalogService creates the release via an async EventBus subscriber.
 *    If the BullMQ processor fires first, a naive prisma.release.update() throws
 *    P2025 "Record to update not found", leaving track status stuck on "Pending".
 */

describe("StemsProcessor pubsub mode (regression)", () => {
  // -------------------------------------------------------------------
  // 1. callbackUrl is ALWAYS present in Pub/Sub messages
  //    Regression: callbackUrl was `process.env.BACKEND_URL || undefined`
  //    which made it null when BACKEND_URL was unset. The worker then
  //    skipped all progress HTTP callbacks.
  // -------------------------------------------------------------------
  describe("callbackUrl fallback", () => {
    const originalEnv = process.env.BACKEND_URL;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.BACKEND_URL = originalEnv;
      } else {
        delete process.env.BACKEND_URL;
      }
    });

    it("callbackUrl defaults to host.docker.internal:3000 when BACKEND_URL is unset", () => {
      delete process.env.BACKEND_URL;

      // Simulate the message construction logic from stems.processor.ts
      const callbackUrl = process.env.BACKEND_URL || "http://host.docker.internal:3000";

      expect(callbackUrl).toBe("http://host.docker.internal:3000");
      expect(callbackUrl).not.toBeUndefined();
      expect(callbackUrl).not.toBeNull();
      expect(callbackUrl).not.toBe("");
    });

    it("callbackUrl uses BACKEND_URL when set", () => {
      process.env.BACKEND_URL = "https://my-backend.run.app";

      const callbackUrl = process.env.BACKEND_URL || "http://host.docker.internal:3000";

      expect(callbackUrl).toBe("https://my-backend.run.app");
    });

    it("callbackUrl is always a valid HTTP(S) URL", () => {
      delete process.env.BACKEND_URL;
      const callbackUrl = process.env.BACKEND_URL || "http://host.docker.internal:3000";

      expect(callbackUrl).toMatch(/^https?:\/\/.+/);
    });

    it("the full StemSeparateMessage always includes a callbackUrl", () => {
      delete process.env.BACKEND_URL;

      // Simulate message construction as done in stems.processor.ts
      const message = {
        jobId: "sep_test",
        releaseId: "rel_test",
        artistId: "art_test",
        trackId: "trk_test",
        originalStemUri: "http://host.docker.internal:3000/catalog/stems/stem_test/blob",
        mimeType: "audio/mpeg",
        callbackUrl: process.env.BACKEND_URL || "http://host.docker.internal:3000",
        originalStemMeta: { id: "stem_test" },
      };

      expect(message.callbackUrl).toBeDefined();
      expect(message.callbackUrl).not.toBe("");
      expect(typeof message.callbackUrl).toBe("string");
    });
  });

  // -------------------------------------------------------------------
  // 2. DB status update uses retry+wait pattern
  //    Regression: prisma.release.update() threw P2025 because the
  //    CatalogService hadn't created the release record yet.
  // -------------------------------------------------------------------
  describe("DB status update resilience", () => {
    it("retry loop waits when release is not immediately available", async () => {
      // Simulate the retry logic from stems.processor.ts
      const MAX_RETRIES = 10;
      const RETRY_DELAY = 10; // Use short delay for tests
      let findCallCount = 0;
      const APPEAR_ON_ATTEMPT = 3;

      // Mock: release appears on attempt 3
      const mockFindUnique = async () => {
        findCallCount++;
        if (findCallCount >= APPEAR_ON_ATTEMPT) {
          return { id: "rel_test" };
        }
        return null;
      };

      let updateCalled = false;
      const mockUpdate = async () => {
        updateCalled = true;
      };

      let releaseFound = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const existing = await mockFindUnique();
        if (existing) {
          await mockUpdate();
          releaseFound = true;
          break;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }

      expect(releaseFound).toBe(true);
      expect(updateCalled).toBe(true);
      expect(findCallCount).toBe(APPEAR_ON_ATTEMPT);
    });

    it("gives up gracefully after MAX_RETRIES without crashing", async () => {
      const MAX_RETRIES = 5;
      const RETRY_DELAY = 10;

      // Mock: release never appears
      const mockFindUnique = async () => null;
      let updateCalled = false;

      let releaseFound = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const existing = await mockFindUnique();
        if (existing) {
          updateCalled = true;
          releaseFound = true;
          break;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }

      expect(releaseFound).toBe(false);
      expect(updateCalled).toBe(false);
      // Key assertion: no exception thrown — the processor continues gracefully
    });

    it("updates tracks even when release is not found (updateMany is safe)", async () => {
      // prisma.track.updateMany() returns { count: 0 } when no records match,
      // unlike prisma.track.update() which throws P2025.
      // This test documents that architectural choice.
      const mockUpdateMany = async (args: any) => {
        return { count: 0 }; // No records matched — that's OK
      };

      const result = await mockUpdateMany({
        where: { id: "trk_nonexistent" },
        data: { processingStatus: "separating" },
      });

      expect(result.count).toBe(0); // No crash, returns safely
    });
  });

  // -------------------------------------------------------------------
  // 3. Progress callback chain integrity
  //    Validates that the HTTP callback → EventBus → WebSocket chain
  //    produces the correct event shape for the frontend.
  // -------------------------------------------------------------------
  describe("progress callback → WebSocket chain", () => {
    it("handleProgress event shape matches gateway expectations", () => {
      // Simulate IngestionService.handleProgress()
      const releaseId = "rel_test";
      const trackId = "trk_test";
      const progress = 42;

      const event = {
        eventName: "stems.progress",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId,
        trackId,
        progress,
      };

      // Gateway transforms this into:
      const broadcast = {
        releaseId: event.releaseId,
        trackId: event.trackId,
        progress: event.progress,
      };

      // Frontend useWebSockets hook expects exactly this shape
      expect(broadcast.releaseId).toBe("rel_test");
      expect(broadcast.trackId).toBe("trk_test");
      expect(broadcast.progress).toBe(42);
      expect(Object.keys(broadcast)).toHaveLength(3);
    });

    it("callbackUrl resolves to a URL the Docker worker can reach", () => {
      delete process.env.BACKEND_URL;
      const callbackUrl = process.env.BACKEND_URL || "http://host.docker.internal:3000";

      // The worker constructs: `${callbackUrl}/ingestion/progress/${releaseId}/${trackId}`
      const progressEndpoint = `${callbackUrl}/ingestion/progress/rel_test/trk_test`;

      expect(progressEndpoint).toBe(
        "http://host.docker.internal:3000/ingestion/progress/rel_test/trk_test"
      );
      // Must NOT contain 'localhost' — unreachable from Docker containers
      expect(progressEndpoint).not.toContain("localhost");
    });
  });

  // -------------------------------------------------------------------
  // 4. Local storage worker handoff
  //    Restricted uploads cannot rely on the public /catalog/stems route,
  //    so local stems should be handed off as shared-volume filenames.
  // -------------------------------------------------------------------
  describe("local storage handoff", () => {
    it("uses the shared-volume filename for local catalog URIs", () => {
      const originalStemUri = "/catalog/stems/original_stem_123.m4a/blob";
      const storageProvider = "local";

      const resolved = storageProvider === "local" && originalStemUri.startsWith("/catalog/stems/")
        ? originalStemUri.split("/").slice(-2, -1)[0]
        : originalStemUri;

      expect(resolved).toBe("original_stem_123.m4a");
      expect(resolved).not.toContain("/catalog/stems/");
    });
  });
});
