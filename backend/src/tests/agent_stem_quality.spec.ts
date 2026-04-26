import {
  DEFAULT_MIN_STEM_QUALITY_SCORE,
  analyzeStemQuality,
  buildStemQualityMetadataKey,
  buildStemQualityRatingPayload,
  computeCuratorReputationDelta,
  computeStemQualityTaskHash,
  rankListingsByQuality,
} from "../modules/agents/stem_quality";

function wav16Mono(samples: number[]) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  });
  return buffer;
}

describe("stem quality analysis", () => {
  it("scores an audible PCM stem above silence", () => {
    const audible = wav16Mono(Array.from({ length: 4096 }, (_, index) => Math.sin(index / 8) * 0.6));
    const silent = wav16Mono(Array.from({ length: 4096 }, () => 0));

    const audibleRating = analyzeStemQuality({
      stemId: "stem-a",
      tokenId: 10n,
      stemType: "vocals",
      audio: audible,
      analyzedAt: new Date("2026-04-26T00:00:00.000Z"),
    });
    const silentRating = analyzeStemQuality({
      stemId: "stem-b",
      tokenId: 11n,
      stemType: "other",
      audio: silent,
    });

    expect(audibleRating.analysisMethod).toBe("pcm-wav-v1");
    expect(audibleRating.score).toBeGreaterThan(silentRating.score);
    expect(audibleRating.metrics.silenceRatio).toBe(0);
    expect(silentRating.metrics.silenceRatio).toBe(1);
  });

  it("builds a stable ERC-8004 task metadata key", () => {
    const analysis = analyzeStemQuality({
      stemId: "stem-a",
      tokenId: "42",
      stemType: "drums",
      audio: wav16Mono([0.1, 0.2, -0.2, 0.1]),
      analyzedAt: new Date("2026-04-26T00:00:00.000Z"),
    });
    const payload = buildStemQualityRatingPayload({
      analysis,
      curatorUserId: "0xcurator",
      curatorAgentConfigId: "agent-1",
      curatorIdentityRegistry: "0xregistry",
      curatorIdentityTokenId: "7",
      analysisUri: "data:application/json;base64,eyJvayI6dHJ1ZX0=",
    });

    const taskHash = computeStemQualityTaskHash(payload);
    expect(taskHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(buildStemQualityMetadataKey(taskHash)).toBe(`resonate.task.stem.quality_rating.${taskHash.slice(2)}`);
  });

  it("filters low-quality listings and ranks the remaining stems by quality", () => {
    const ranked = rankListingsByQuality(
      [
        { listingId: 1n, tokenId: 1n, stemType: "other" },
        { listingId: 2n, tokenId: 2n, stemType: "vocals" },
        { listingId: 3n, tokenId: 3n, stemType: "drums" },
      ],
      [
        { id: "low", tokenId: 1n, score: DEFAULT_MIN_STEM_QUALITY_SCORE - 1, confidence: 0.8 },
        { id: "voice", tokenId: 2n, score: 86, confidence: 0.9 },
        { id: "drums", tokenId: 3n, score: 72, confidence: 0.7 },
      ],
    );

    expect(ranked.map((listing) => listing.listingId)).toEqual([2n, 3n]);
    expect(ranked[0].qualityScore).toBe(86);
    expect(ranked[0].qualityRatingId).toBe("voice");
  });

  it("updates curator reputation deltas from buyer validation signals", () => {
    expect(computeCuratorReputationDelta({ score: 85, validation: "purchase" })).toBe(2);
    expect(computeCuratorReputationDelta({ score: 10, validation: "purchase" })).toBe(-1);
    expect(computeCuratorReputationDelta({ score: 10, validation: "skip" })).toBe(1);
    expect(computeCuratorReputationDelta({ score: 80, validation: "skip" })).toBe(-1);
  });
});
