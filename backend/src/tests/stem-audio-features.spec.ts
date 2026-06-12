import {
  sanitizeStemAudioFeatures,
  STEM_AUDIO_FEATURES_SCHEMA_VERSION,
} from "../modules/ingestion/stem-audio-features";

const validFeatures = {
  schemaVersion: STEM_AUDIO_FEATURES_SCHEMA_VERSION,
  extractor: { name: "librosa", version: "0.10.2" },
  sampleRate: 22050,
  durationSeconds: 8.0,
  tempoBpm: 120.03,
  tempoConfidence: 0.62,
  beatCount: 16,
  firstBeatSec: 0.23,
  key: { tonic: "C", mode: "major", confidence: 0.81 },
  energyRms: 0.12,
  onsetDensity: 2.0,
};

describe("sanitizeStemAudioFeatures (#1184)", () => {
  it("passes a valid v1 payload through intact", () => {
    expect(sanitizeStemAudioFeatures(validFeatures)).toEqual(validFeatures);
  });

  it("rejects unknown schema versions and non-objects", () => {
    expect(
      sanitizeStemAudioFeatures({ ...validFeatures, schemaVersion: "v999" }),
    ).toBeNull();
    expect(sanitizeStemAudioFeatures(null)).toBeNull();
    expect(sanitizeStemAudioFeatures("features")).toBeNull();
    expect(sanitizeStemAudioFeatures([validFeatures])).toBeNull();
  });

  it("rejects payloads without an extractor name", () => {
    expect(
      sanitizeStemAudioFeatures({ ...validFeatures, extractor: {} }),
    ).toBeNull();
    expect(
      sanitizeStemAudioFeatures({ ...validFeatures, extractor: undefined }),
    ).toBeNull();
  });

  it("clamps out-of-range BPM to null without dropping the payload", () => {
    const tooFast = sanitizeStemAudioFeatures({
      ...validFeatures,
      tempoBpm: 2000,
    });
    expect(tooFast?.tempoBpm).toBeNull();
    expect(tooFast?.key?.tonic).toBe("C");

    const tooSlow = sanitizeStemAudioFeatures({
      ...validFeatures,
      tempoBpm: 5,
    });
    expect(tooSlow?.tempoBpm).toBeNull();
  });

  it("nulls malformed numerics instead of throwing", () => {
    const result = sanitizeStemAudioFeatures({
      ...validFeatures,
      tempoBpm: Number.NaN,
      energyRms: "loud",
      onsetDensity: -3,
      beatCount: Infinity,
      firstBeatSec: -1,
    });
    expect(result).not.toBeNull();
    expect(result?.tempoBpm).toBeNull();
    expect(result?.energyRms).toBeNull();
    expect(result?.onsetDensity).toBeNull();
    expect(result?.beatCount).toBeNull();
    expect(result?.firstBeatSec).toBeNull();
  });

  it("drops a malformed key but keeps the rest", () => {
    const badMode = sanitizeStemAudioFeatures({
      ...validFeatures,
      key: { tonic: "C", mode: "dorian", confidence: 0.5 },
    });
    expect(badMode?.key).toBeNull();
    expect(badMode?.tempoBpm).toBe(validFeatures.tempoBpm);

    const clampedConfidence = sanitizeStemAudioFeatures({
      ...validFeatures,
      key: { tonic: "A#", mode: "minor", confidence: 7 },
    });
    expect(clampedConfidence?.key).toEqual({
      tonic: "A#",
      mode: "minor",
      confidence: 1,
    });
  });

  it("floors fractional beat counts", () => {
    const result = sanitizeStemAudioFeatures({
      ...validFeatures,
      beatCount: 15.9,
    });
    expect(result?.beatCount).toBe(15);
  });
});
