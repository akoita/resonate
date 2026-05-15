import { prisma } from "../db/prisma";
import { AgentAudioFeatureService } from "../modules/agents/agent_audio_feature.service";

const TEST_PREFIX = `agaf_${Date.now()}_`;

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
    await prisma.stem.deleteMany({ where: { trackId: { in: [`${TEST_PREFIX}track`, `${TEST_PREFIX}legacy`] } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { in: [`${TEST_PREFIX}track`, `${TEST_PREFIX}legacy`] } } }).catch(() => {});
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
});
