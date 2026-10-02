import {
  hasMeasuredTrackFeatures,
  MEASURED_TEMPO_MIN_CONFIDENCE,
  measuredTrackFeatures,
} from "../modules/agents/measured_track_features";
import { publicTrackAudioFeatures } from "../modules/catalog/track-audio-features";

function stored(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "stem-audio-features/v1",
    extractor: { name: "librosa", version: "0.10" },
    sampleRate: 22050,
    durationSeconds: 200,
    tempoBpm: 124,
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

describe("measuredTrackFeatures", () => {
  it("returns measured tempo, key, camelot and energy for a confident row", () => {
    expect(measuredTrackFeatures(stored())).toEqual({
      tempoBpm: 124,
      tempoConfidence: 0.8,
      key: { tonic: "A", mode: "minor", confidence: 0.4 },
      camelot: "8A",
      energy: 0.5,
    });
  });

  it("applies the tempo confidence boundary inclusively at 0.5", () => {
    expect(MEASURED_TEMPO_MIN_CONFIDENCE).toBe(0.5);
    expect(measuredTrackFeatures(stored({ tempoConfidence: 0.5 })).tempoBpm).toBe(124);
    const below = measuredTrackFeatures(stored({ tempoConfidence: 0.4999 }));
    expect(below.tempoBpm).toBeNull();
    expect(below.tempoConfidence).toBeNull();
  });

  it("treats a missing tempo or tempo confidence as unmeasured", () => {
    expect(measuredTrackFeatures(stored({ tempoBpm: null })).tempoBpm).toBeNull();
    expect(measuredTrackFeatures(stored({ tempoBpm: 500 })).tempoBpm).toBeNull();
    expect(measuredTrackFeatures(stored({ tempoConfidence: null })).tempoBpm).toBeNull();
  });

  it("drops the key and camelot below the key confidence threshold", () => {
    const low = measuredTrackFeatures(
      stored({ key: { tonic: "A", mode: "minor", confidence: 0.09 }, camelot: null }),
    );
    expect(low.key).toBeNull();
    expect(low.camelot).toBeNull();
    const edge = measuredTrackFeatures(
      stored({ key: { tonic: "A", mode: "minor", confidence: 0.1 }, camelot: null }),
    );
    expect(edge.key).toEqual({ tonic: "A", mode: "minor", confidence: 0.1 });
    expect(edge.camelot).toBe("8A");
    expect(
      measuredTrackFeatures(stored({ key: { tonic: "A", mode: "minor", confidence: null } })).key,
    ).toBeNull();
  });

  it("applies the revision-aware key cutoff (#2018)", () => {
    const at = (confidence: number, analysisRevision?: number) =>
      measuredTrackFeatures(
        stored({
          key: { tonic: "A", mode: "minor", confidence },
          camelot: null,
          ...(analysisRevision === undefined ? {} : { analysisRevision }),
        }),
      );
    const usable = at(0.07, 3);
    expect(usable.key).toEqual({ tonic: "A", mode: "minor", confidence: 0.07 });
    expect(usable.camelot).toBe("8A");
    for (const revision of [1, 2, undefined]) {
      const dropped = at(0.07, revision);
      expect(dropped.key).toBeNull();
      expect(dropped.camelot).toBeNull();
    }
    expect(at(0.04, 3).key).toBeNull();
    expect(at(0.04, 3).camelot).toBeNull();
    for (const revision of [1, 2, 3, undefined]) {
      expect(at(0.12, revision).key).not.toBeNull();
      expect(at(0.12, revision).camelot).toBe("8A");
    }
  });

  it("derives camelot for legacy rows stored without it", () => {
    const { camelot: _omit, ...legacy } = stored({
      key: { tonic: "C", mode: "major", confidence: 0.3 },
    });
    expect(measuredTrackFeatures(legacy).camelot).toBe("8B");
  });

  it("computes the energy composite from RMS and onset density", () => {
    // 0.65 * (0.3 / 0.3) + 0.35 * (8 / 8)
    expect(measuredTrackFeatures(stored({ energyRms: 0.3, onsetDensity: 8 })).energy).toBe(1);
    // clamped above full scale
    expect(measuredTrackFeatures(stored({ energyRms: 0.9, onsetDensity: 40 })).energy).toBe(1);
    // RMS only when onset density is absent
    expect(measuredTrackFeatures(stored({ energyRms: 0.15, onsetDensity: null })).energy).toBe(0.325);
    // rounded to 4 decimals: 0.65 * (0.1 / 0.3) + 0.35 * (3 / 8) = 0.34791666...
    expect(measuredTrackFeatures(stored({ energyRms: 0.1, onsetDensity: 3 })).energy).toBe(0.3479);
    expect(measuredTrackFeatures(stored({ energyRms: 0, onsetDensity: 0 })).energy).toBe(0);
    expect(measuredTrackFeatures(stored({ energyRms: null })).energy).toBeNull();
  });

  it("returns all nulls for malformed or unrecognized JSON", () => {
    const empty = {
      tempoBpm: null,
      tempoConfidence: null,
      key: null,
      camelot: null,
      energy: null,
    };
    for (const raw of [
      null,
      undefined,
      "nope",
      42,
      [],
      {},
      { schemaVersion: "stem-audio-features/v0", extractor: { name: "x" } },
      { schemaVersion: "stem-audio-features/v1" },
    ]) {
      const result = measuredTrackFeatures(raw);
      expect(result).toEqual(empty);
      expect(hasMeasuredTrackFeatures(result)).toBe(false);
    }
  });
});

describe("publicTrackAudioFeatures", () => {
  it("is null without an original stem or without measurements", () => {
    expect(publicTrackAudioFeatures(undefined)).toBeNull();
    expect(publicTrackAudioFeatures([{ type: "drums", audioFeatures: stored() }])).toBeNull();
    expect(publicTrackAudioFeatures([{ type: "original", audioFeatures: null }])).toBeNull();
  });

  it("reports measured values from the original stem only", () => {
    expect(
      publicTrackAudioFeatures([
        { type: "drums", audioFeatures: stored({ tempoBpm: 60 }) },
        { type: "original", audioFeatures: stored() },
      ]),
    ).toEqual({
      tempoBpm: 124,
      tempoConfidence: 0.8,
      key: { tonic: "A", mode: "minor", confidence: 0.4 },
      camelot: "8A",
      energy: 0.5,
      source: "measured_full_mix",
    });
  });
});
