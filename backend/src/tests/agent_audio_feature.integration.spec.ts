import { prisma } from "../db/prisma";
import { AgentAudioFeatureService } from "../modules/agents/agent_audio_feature.service";

const TEST_PREFIX = `agaf_${Date.now()}_`;

function measuredStemFeatures(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "stem-audio-features/v1",
    extractor: { name: "librosa", version: "0.10" },
    sampleRate: 22050,
    durationSeconds: 200,
    tempoBpm: 128,
    tempoConfidence: 0.8,
    beatCount: 400,
    firstBeatSec: 0.4,
    key: { tonic: "A", mode: "minor", confidence: 0.4 },
    energyRms: 0.15,
    onsetDensity: 4,
    camelot: "8A",
    ...overrides,
  };
}

async function seedOriginalTrack(suffix: string, position: number, audioFeatures?: object) {
  const trackId = `${TEST_PREFIX}m_${suffix}`;
  await prisma.track.create({
    data: {
      id: trackId,
      title: "Measured Drift",
      releaseId: `${TEST_PREFIX}release`,
      position,
    },
  });
  await prisma.stem.create({
    data: {
      id: `${TEST_PREFIX}m_${suffix}_original`,
      trackId,
      type: "original",
      uri: `local://original-${suffix}.mp3`,
      durationSeconds: 200,
      ...(audioFeatures ? { audioFeatures } : {}),
    },
  });
  return trackId;
}

function withoutDerivedAt<T extends { derivedAt: string }>(features: T) {
  const { derivedAt: _derivedAt, ...rest } = features;
  return rest;
}

describe("AgentAudioFeatureService (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Feature Artist",
        payoutAddress: `0x${"A".repeat(40)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        title: "Feature Release",
        artistId: `${TEST_PREFIX}artist`,
        status: "published",
        genre: "Techno",
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        title: "Heavy Club Kicks",
        releaseId: `${TEST_PREFIX}release`,
        position: 1,
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}legacy`,
        title: "Soft Focus Drift",
        releaseId: `${TEST_PREFIX}release`,
        position: 2,
        generationMetadata: {
          agentAudioFeatures: {
            schemaVersion: "agent-audio-features/v1",
            source: "metadata_inferred",
            confidence: 0.5,
            derivedAt: "2026-01-01T00:00:00.000Z",
            tempoBpm: 90,
            energy: 0.3,
            energyBand: "low",
            tags: ["legacy"],
            warnings: [],
          },
        },
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}stem`,
        trackId: `${TEST_PREFIX}track`,
        type: "drums",
        uri: "local://drums.mp3",
        durationSeconds: 123,
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}legacy_stem`,
        trackId: `${TEST_PREFIX}legacy`,
        type: "vocals",
        uri: "local://vocals.mp3",
        durationSeconds: 88,
      },
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it("derives and persists metadata-backed audio features", async () => {
    const service = new AgentAudioFeatureService();

    const result = await service.getOrCreate(`${TEST_PREFIX}track`);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.features.schemaVersion).toBe("agent-audio-features/v2");
      expect(result.features.energyBand).toBe("high");
      expect(result.features.durationSeconds).toBe(123);
      expect(result.features.durationBucket).toBe("standard");
      expect(result.features.tempoBand).toMatch(/slow|mid|fast/);
      expect(result.features.source).toBe("metadata_inferred");
      expect(result.features.extractor).toEqual({
        name: "metadata_feature_seed",
        version: "2026-05-15",
      });
      expect(result.features.normalizedGenre).toBe("techno");
      expect(result.features.descriptors.instrumentation).toContain("drums");
      expect(result.features.descriptors.texture).toContain("percussive");
      expect(result.features.featureVector.dimensions).toEqual([
        "energy",
        "tempo",
        "duration",
        "stem_density",
        "vocal_presence",
        "beat_presence",
        "generated_likelihood",
      ]);
      expect(result.features.featureVector.values).toHaveLength(7);
      expect(result.features.warnings).toContain("fingerprint_unavailable");
    }

    const track = await prisma.track.findUnique({
      where: { id: `${TEST_PREFIX}track` },
      select: { generationMetadata: true },
    });
    expect(track?.generationMetadata).toEqual(expect.objectContaining({
      agentAudioFeatures: expect.objectContaining({
        schemaVersion: "agent-audio-features/v2",
      }),
    }));
  });

  it("reuses current-schema features without recomputing derivedAt", async () => {
    const service = new AgentAudioFeatureService();

    const first = await service.getOrCreate(`${TEST_PREFIX}track`);
    const second = await service.getOrCreate(`${TEST_PREFIX}track`);

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status === "ok" && second.status === "ok") {
      expect(second.features.derivedAt).toBe(first.features.derivedAt);
    }
  });

  it("recomputes cached features after an audio revision becomes active", async () => {
    const service = new AgentAudioFeatureService();
    await service.getOrCreate(`${TEST_PREFIX}track`);
    await prisma.stem.update({ where: { id: `${TEST_PREFIX}stem` }, data: { isCurrent: false } });
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}replacement_stem`,
        trackId: `${TEST_PREFIX}track`,
        type: "vocals",
        uri: "local://new-vocals.mp3",
        durationSeconds: 45,
        audioRevision: "replacement-revision",
      },
    });
    await prisma.track.update({
      where: { id: `${TEST_PREFIX}track` },
      data: { activeAudioRevision: "replacement-revision" },
    });

    const result = await service.getOrCreate(`${TEST_PREFIX}track`);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.features.durationSeconds).toBe(45);
      expect(result.features.descriptors.instrumentation).toContain("vocals");
      expect(result.features.descriptors.instrumentation).not.toContain("drums");
    }
    const track = await prisma.track.findUniqueOrThrow({ where: { id: `${TEST_PREFIX}track` } });
    expect(track.generationMetadata).toEqual(expect.objectContaining({ agentAudioRevision: "replacement-revision" }));
  });

  it("backfills legacy feature schemas to the current version", async () => {
    const service = new AgentAudioFeatureService();

    const result = await service.getOrCreate(`${TEST_PREFIX}legacy`);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.features.schemaVersion).toBe("agent-audio-features/v2");
      expect(result.features.durationBucket).toBe("short");
      expect(result.features.descriptors.instrumentation).toContain("vocals");
      expect(result.features.featureVector.values).toHaveLength(7);
      expect(result.features.derivedAt).not.toBe("2026-01-01T00:00:00.000Z");
    }

    const track = await prisma.track.findUnique({
      where: { id: `${TEST_PREFIX}legacy` },
      select: { generationMetadata: true },
    });
    expect(track?.generationMetadata).toEqual(expect.objectContaining({
      agentAudioFeatures: expect.objectContaining({
        schemaVersion: "agent-audio-features/v2",
      }),
    }));
  });

  it("fails gracefully when the track is missing", async () => {
    const service = new AgentAudioFeatureService();

    await expect(service.getOrCreate(`${TEST_PREFIX}missing`)).resolves.toEqual({
      status: "failed",
      trackId: `${TEST_PREFIX}missing`,
      reason: "track_not_found",
    });
  });
  describe("measured full-mix features (#1960)", () => {
    it("overlays measured tempo, key, camelot and energy on the inferred features", async () => {
      const trackId = await seedOriginalTrack("measured", 10, measuredStemFeatures());
      const result = await new AgentAudioFeatureService().getOrCreate(trackId);

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      const f = result.features;
      expect(f.schemaVersion).toBe("agent-audio-features/v2");
      expect(f.source).toBe("measured_full_mix");
      expect(f.tempoBpm).toBe(128);
      expect(f.tempoConfidence).toBe(0.8);
      expect(f.tempoBand).toBe("fast");
      expect(f.key).toEqual({ tonic: "A", mode: "minor", confidence: 0.4 });
      expect(f.camelot).toBe("8A");
      // 0.65 * (0.15 / 0.3) + 0.35 * (4 / 8)
      expect(f.energy).toBe(0.5);
      expect(f.energyBand).toBe("medium");
      expect(f.featureSources).toEqual({ tempo: "measured", key: "measured", energy: "measured" });
      expect(f.confidence).toBeGreaterThanOrEqual(0.8);
      expect(f.featureVector.values[0]).toBe(0.5);
      expect(f.featureVector.values[1]).toBeCloseTo((128 - 60) / 120, 4);
      expect(f.descriptors.moods).toEqual(expect.arrayContaining(["medium", "fast"]));
      expect(f.tags).toEqual(expect.arrayContaining(["medium", "fast"]));

      const track = await prisma.track.findUniqueOrThrow({ where: { id: trackId } });
      expect(track.generationMetadata).toEqual(
        expect.objectContaining({ agentAudioMeasuredKey: expect.stringMatching(/^[0-9a-f]{16}$/) }),
      );
    });

    it("keeps the inferred output when features are absent or below thresholds", async () => {
      const service = new AgentAudioFeatureService();
      const absentId = await seedOriginalTrack("absent", 11);
      const lowId = await seedOriginalTrack(
        "low",
        12,
        measuredStemFeatures({
          tempoConfidence: 0.4,
          key: { tonic: "A", mode: "minor", confidence: 0.05 },
          camelot: null,
          energyRms: null,
          onsetDensity: null,
        }),
      );

      const absent = await service.getOrCreate(absentId);
      const low = await service.getOrCreate(lowId);
      expect(absent.status).toBe("ok");
      expect(low.status).toBe("ok");
      if (absent.status !== "ok" || low.status !== "ok") return;

      expect(absent.features.source).toBe("metadata_inferred");
      expect(absent.features.featureSources).toEqual({
        tempo: "inferred",
        key: "unavailable",
        energy: "inferred",
      });
      expect(absent.features.key).toBeNull();
      expect(absent.features.camelot).toBeNull();
      expect(absent.features).not.toHaveProperty("tempoConfidence");
      // Same title, genre and stems => identical to the inferred output.
      expect(withoutDerivedAt(low.features)).toEqual(withoutDerivedAt(absent.features));
      // Inferred energy/tempo for "Measured Drift" + Techno (not the measured 0.5 / 128).
      expect(absent.features.energyBand).toBe("high");
    });

    it("re-derives when the original stem's features change", async () => {
      const service = new AgentAudioFeatureService();
      const trackId = await seedOriginalTrack("invalidate", 13, measuredStemFeatures());

      const first = await service.getOrCreate(trackId);
      expect(first.status).toBe("ok");
      if (first.status !== "ok") return;
      expect(first.features.tempoBpm).toBe(128);
      const firstKey = (
        await prisma.track.findUniqueOrThrow({ where: { id: trackId } })
      ).generationMetadata as Record<string, unknown>;

      await prisma.stem.update({
        where: { id: `${TEST_PREFIX}m_invalidate_original` },
        data: {
          audioFeatures: measuredStemFeatures({
            tempoBpm: 90,
            tempoConfidence: 0.9,
            key: { tonic: "C", mode: "major", confidence: 0.5 },
            camelot: "8B",
            energyRms: 0.3,
            onsetDensity: 8,
          }),
        },
      });

      const second = await service.getOrCreate(trackId);
      expect(second.status).toBe("ok");
      if (second.status !== "ok") return;
      expect(second.features.tempoBpm).toBe(90);
      expect(second.features.tempoBand).toBe("slow");
      expect(second.features.camelot).toBe("8B");
      expect(second.features.energy).toBe(1);
      expect(second.features.energyBand).toBe("high");
      const secondKey = (
        await prisma.track.findUniqueOrThrow({ where: { id: trackId } })
      ).generationMetadata as Record<string, unknown>;
      expect(secondKey.agentAudioMeasuredKey).not.toBe(firstKey.agentAudioMeasuredKey);

      // Unchanged measured fields reuse the cache (same derivedAt).
      const third = await service.getOrCreate(trackId);
      expect(third.status === "ok" && third.features.derivedAt).toBe(second.features.derivedAt);
    });

    it("treats cached entries without featureSources as stale", async () => {
      const trackId = await seedOriginalTrack("stalecache", 14, measuredStemFeatures());
      await prisma.track.update({
        where: { id: trackId },
        data: {
          generationMetadata: {
            agentAudioFeatures: {
              schemaVersion: "agent-audio-features/v2",
              source: "metadata_inferred",
              confidence: 0.5,
              derivedAt: "2026-01-01T00:00:00.000Z",
              tempoBpm: 100,
              energy: 0.3,
              energyBand: "low",
              tags: [],
              warnings: [],
            },
            agentAudioRevision: null,
          },
        },
      });

      const result = await new AgentAudioFeatureService().getOrCreate(trackId);
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.features.derivedAt).not.toBe("2026-01-01T00:00:00.000Z");
        expect(result.features.featureSources.tempo).toBe("measured");
      }
    });
  });
});
