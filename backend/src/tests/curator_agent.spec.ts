import { CuratorAgentService, StemAudioMetrics } from "../modules/agents/curator_agent.service";

// ─── Mock prisma ──────────────────────────────────────────────
jest.mock("../db/prisma", () => ({
  prisma: {
    stem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    stemQualityRating: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "../db/prisma";
const mockPrisma = prisma as any;

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Generate a synthetic 16-bit mono WAV buffer containing a sine wave.
 * @param freq  Frequency in Hz
 * @param durationMs  Duration in milliseconds
 * @param sampleRate  Sample rate (default 44100)
 * @param amplitude  Amplitude 0-1 (default 0.5)
 */
function generateSineWav(
  freq: number,
  durationMs: number,
  sampleRate = 44100,
  amplitude = 0.5,
): Buffer {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);       // chunk size
  buffer.writeUInt16LE(1, 20);        // PCM format
  buffer.writeUInt16LE(1, 22);        // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34);       // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * amplitude;
    const int16 = Math.round(sample * 32767);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, int16)), headerSize + i * 2);
  }

  return buffer;
}

/** Generate a silent WAV buffer */
function generateSilentWav(durationMs: number, sampleRate = 44100): Buffer {
  return generateSineWav(440, durationMs, sampleRate, 0);
}

// ─── Tests ──────────────────────────────────────────────────

describe("CuratorAgentService", () => {
  let service: CuratorAgentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CuratorAgentService();
  });

  // ─── WAV Decoding ───────────────────────────────────────

  describe("decodeWav", () => {
    it("should decode a valid 16-bit WAV into Float32 samples", () => {
      const wav = generateSineWav(440, 100); // 100ms sine wave
      const samples = service.decodeWav(wav);

      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBeGreaterThan(0);
      // Samples should be in [-1, 1] range
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(-1);
        expect(s).toBeLessThanOrEqual(1);
      }
    });

    it("should return empty array for buffer < 44 bytes", () => {
      const tiny = Buffer.alloc(10);
      expect(service.decodeWav(tiny).length).toBe(0);
    });

    it("should handle non-WAV data as raw PCM", () => {
      const raw = Buffer.alloc(200);
      for (let i = 0; i < 100; i++) {
        raw.writeInt16LE(Math.round(Math.sin(i * 0.1) * 16000), i * 2);
      }
      const samples = service.decodeWav(raw);
      expect(samples.length).toBe(100);
    });
  });

  // ─── Score Computation ──────────────────────────────────

  describe("computeScore", () => {
    it("should return 0 for fully silent/empty metrics", () => {
      const metrics: StemAudioMetrics = {
        rmsEnergy: 0,
        spectralDensity: 0,
        silenceRatio: 1,
        musicalSalience: 0,
      };
      expect(service.computeScore(metrics)).toBe(0);
    });

    it("should return 100 for perfect metrics", () => {
      const metrics: StemAudioMetrics = {
        rmsEnergy: 1,
        spectralDensity: 1,
        silenceRatio: 0,
        musicalSalience: 1,
      };
      expect(service.computeScore(metrics)).toBe(100);
    });

    it("should always return value in [0, 100]", () => {
      // Test with extreme values
      const overMax: StemAudioMetrics = {
        rmsEnergy: 2,
        spectralDensity: 2,
        silenceRatio: -1,
        musicalSalience: 2,
      };
      expect(service.computeScore(overMax)).toBeLessThanOrEqual(100);
      expect(service.computeScore(overMax)).toBeGreaterThanOrEqual(0);
    });

    it("should produce mid-range score for moderate metrics", () => {
      const moderate: StemAudioMetrics = {
        rmsEnergy: 0.5,
        spectralDensity: 0.5,
        silenceRatio: 0.5,
        musicalSalience: 0.5,
      };
      const score = service.computeScore(moderate);
      expect(score).toBeGreaterThanOrEqual(25);
      expect(score).toBeLessThanOrEqual(75);
    });
  });

  // ─── Audio Metrics (pure-JS fallback) ───────────────────

  describe("computeMetrics (pure-JS fallback)", () => {
    it("should return high values for a loud sine wave", async () => {
      const wav = generateSineWav(440, 500, 44100, 0.7); // 500ms at 0.7 amplitude
      const metrics = await service.computeMetrics(wav);

      expect(metrics.rmsEnergy).toBeGreaterThan(0.3);
      expect(metrics.silenceRatio).toBeLessThan(0.1);
      expect(metrics.musicalSalience).toBeGreaterThan(0.3);
    });

    it("should return near-zero values for silence", async () => {
      const wav = generateSilentWav(500);
      const metrics = await service.computeMetrics(wav);

      expect(metrics.rmsEnergy).toBeLessThan(0.01);
      expect(metrics.silenceRatio).toBeGreaterThan(0.9);
      expect(metrics.musicalSalience).toBeLessThan(0.15);
    });

    it("should return zero metrics for empty buffer", async () => {
      const empty = Buffer.alloc(0);
      const metrics = await service.computeMetrics(empty);

      expect(metrics.rmsEnergy).toBe(0);
      expect(metrics.spectralDensity).toBe(0);
      expect(metrics.silenceRatio).toBe(1);
      expect(metrics.musicalSalience).toBe(0);
    });
  });

  // ─── analyzeStem ────────────────────────────────────────

  describe("analyzeStem", () => {
    it("should persist rating to DB via upsert", async () => {
      const wav = generateSineWav(440, 200, 44100, 0.5);
      mockPrisma.stem.findUnique.mockResolvedValue({
        id: "stem-1",
        data: wav,
        uri: "/tmp/test.wav",
        storageProvider: "local",
      });
      mockPrisma.stemQualityRating.upsert.mockResolvedValue({
        id: "rating-1",
        stemId: "stem-1",
        curatorId: "system",
        score: 50,
      });

      const result = await service.analyzeStem("stem-1");

      expect(result.stemId).toBe("stem-1");
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.metrics.rmsEnergy).toBeGreaterThan(0);
      expect(mockPrisma.stemQualityRating.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stemId_curatorId: { stemId: "stem-1", curatorId: "system" } },
          create: expect.objectContaining({ stemId: "stem-1", curatorId: "system" }),
          update: expect.objectContaining({ rmsEnergy: expect.any(Number) }),
        }),
      );
    });

    it("should throw for missing stem", async () => {
      mockPrisma.stem.findUnique.mockResolvedValue(null);

      await expect(service.analyzeStem("nonexistent")).rejects.toThrow(
        "Stem not found: nonexistent",
      );
    });

    it("should throw for stem with no audio data", async () => {
      mockPrisma.stem.findUnique.mockResolvedValue({
        id: "stem-empty",
        data: null,
        uri: "/nonexistent/path",
        storageProvider: "local",
      });

      await expect(service.analyzeStem("stem-empty")).rejects.toThrow(
        /Cannot read stem audio/,
      );
    });

    it("should use custom curatorId", async () => {
      const wav = generateSineWav(440, 100);
      mockPrisma.stem.findUnique.mockResolvedValue({
        id: "stem-2",
        data: wav,
        uri: "",
        storageProvider: "local",
      });
      mockPrisma.stemQualityRating.upsert.mockResolvedValue({});

      await service.analyzeStem("stem-2", "curator-agent-1");

      expect(mockPrisma.stemQualityRating.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stemId_curatorId: { stemId: "stem-2", curatorId: "curator-agent-1" } },
        }),
      );
    });
  });

  // ─── analyzeTrackStems ──────────────────────────────────

  describe("analyzeTrackStems", () => {
    it("should analyse all stems in a track", async () => {
      const wav = generateSineWav(440, 100);
      mockPrisma.stem.findMany.mockResolvedValue([
        { id: "s1", type: "vocals", trackId: "t1" },
        { id: "s2", type: "drums", trackId: "t1" },
      ]);
      mockPrisma.stem.findUnique
        .mockResolvedValueOnce({ id: "s1", data: wav, uri: "", storageProvider: "local" })
        .mockResolvedValueOnce({ id: "s2", data: wav, uri: "", storageProvider: "local" });
      mockPrisma.stemQualityRating.upsert.mockResolvedValue({});

      const results = await service.analyzeTrackStems("t1");

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe("vocals");
      expect(results[1].type).toBe("drums");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("should return score 0 for failed stems", async () => {
      mockPrisma.stem.findMany.mockResolvedValue([
        { id: "s-fail", type: "other", trackId: "t2" },
      ]);
      mockPrisma.stem.findUnique.mockResolvedValue(null);

      const results = await service.analyzeTrackStems("t2");

      expect(results[0].score).toBe(0);
    });
  });

  // ─── lookupQuality ─────────────────────────────────────

  describe("lookupQuality", () => {
    it("should return best score per stem", async () => {
      mockPrisma.stemQualityRating.findMany.mockResolvedValue([
        { stemId: "s1", score: 85, curatorId: "curator-a" },
        { stemId: "s1", score: 70, curatorId: "curator-b" },
        { stemId: "s2", score: 40, curatorId: "curator-a" },
      ]);

      const result = await service.lookupQuality(["s1", "s2"]);

      expect(result.get("s1")).toEqual({ score: 85, curatorId: "curator-a" });
      expect(result.get("s2")).toEqual({ score: 40, curatorId: "curator-a" });
    });

    it("should return empty map for empty input", async () => {
      const result = await service.lookupQuality([]);
      expect(result.size).toBe(0);
    });
  });

  // ─── lookupTrackQuality ─────────────────────────────────

  describe("lookupTrackQuality", () => {
    it("should return average quality per track", async () => {
      mockPrisma.stem.findMany.mockResolvedValue([
        { id: "s1", trackId: "t1", qualityRatings: [{ score: 80 }] },
        { id: "s2", trackId: "t1", qualityRatings: [{ score: 60 }] },
        { id: "s3", trackId: "t2", qualityRatings: [{ score: 90 }] },
        { id: "s4", trackId: "t3", qualityRatings: [] }, // no ratings
      ]);

      const result = await service.lookupTrackQuality(["t1", "t2", "t3"]);

      expect(result.get("t1")).toBe(70); // avg(80, 60)
      expect(result.get("t2")).toBe(90);
      expect(result.has("t3")).toBe(false); // no rated stems
    });

    it("should return empty map for empty input", async () => {
      const result = await service.lookupTrackQuality([]);
      expect(result.size).toBe(0);
    });
  });
});
