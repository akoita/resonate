import {
  CAMELOT_MIN_KEY_CONFIDENCE,
  CURRENT_STEM_ANALYSIS_REVISION,
  KEY_MIN_CONFIDENCE_FROM_REVISION_3,
  keyConfidenceCutoff,
  camelotCode,
  sanitizeStemAudioFeatures,
  stemAnalysisRevision,
  withCamelot,
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

describe("analysisRevision (#2016)", () => {
  it("keeps a positive integer revision and leaves it off when absent", () => {
    expect(
      sanitizeStemAudioFeatures({ ...validFeatures, analysisRevision: 2 })
        ?.analysisRevision,
    ).toBe(2);
    const legacy = sanitizeStemAudioFeatures(validFeatures);
    expect(legacy).not.toBeNull();
    expect(legacy).not.toHaveProperty("analysisRevision");
  });

  it.each([0, -1, 1.5, "2", null, Number.NaN, 2 ** 60])(
    "omits an invalid revision (%p) without rejecting the payload",
    (analysisRevision) => {
      const result = sanitizeStemAudioFeatures({
        ...validFeatures,
        analysisRevision,
      });
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("analysisRevision");
      expect(result?.tempoBpm).toBe(validFeatures.tempoBpm);
    },
  );

  it("carries the revision through withCamelot", () => {
    const sanitized = sanitizeStemAudioFeatures({
      ...validFeatures,
      analysisRevision: 2,
    });
    expect(withCamelot(sanitized!)).toEqual(
      expect.objectContaining({ analysisRevision: 2, camelot: "8B" }),
    );
  });

  it("stemAnalysisRevision returns the stored revision or 1", () => {
    expect(CURRENT_STEM_ANALYSIS_REVISION).toBe(3);
    expect(stemAnalysisRevision({ analysisRevision: 3 })).toBe(3);
    expect(stemAnalysisRevision(validFeatures)).toBe(1);
    expect(stemAnalysisRevision(null)).toBe(1);
    expect(stemAnalysisRevision(undefined)).toBe(1);
    expect(stemAnalysisRevision([])).toBe(1);
    expect(stemAnalysisRevision("2")).toBe(1);
    for (const bad of [0, -1, 1.5, "2", null, Number.NaN]) {
      expect(stemAnalysisRevision({ analysisRevision: bad })).toBe(1);
    }
  });
});

describe("camelotCode / withCamelot (#1959)", () => {
  const majorTable: Array<[string, string]> = [
    ["C", "8B"],
    ["G", "9B"],
    ["D", "10B"],
    ["A", "11B"],
    ["E", "12B"],
    ["B", "1B"],
    ["F#", "2B"],
    ["C#", "3B"],
    ["G#", "4B"],
    ["D#", "5B"],
    ["A#", "6B"],
    ["F", "7B"],
  ];
  const minorTable: Array<[string, string]> = [
    ["A", "8A"],
    ["E", "9A"],
    ["B", "10A"],
    ["F#", "11A"],
    ["C#", "12A"],
    ["G#", "1A"],
    ["D#", "2A"],
    ["A#", "3A"],
    ["F", "4A"],
    ["C", "5A"],
    ["G", "6A"],
    ["D", "7A"],
  ];

  it.each(majorTable)("maps %s major to %s", (tonic, code) => {
    expect(camelotCode({ tonic, mode: "major", confidence: 0.8 })).toBe(code);
  });

  it.each(minorTable)("maps %s minor to %s", (tonic, code) => {
    expect(camelotCode({ tonic, mode: "minor", confidence: 0.8 })).toBe(code);
  });

  it("covers all 24 keys with distinct codes", () => {
    const codes = new Set([
      ...majorTable.map(([tonic]) =>
        camelotCode({ tonic, mode: "major", confidence: 0.5 }),
      ),
      ...minorTable.map(([tonic]) =>
        camelotCode({ tonic, mode: "minor", confidence: 0.5 }),
      ),
    ]);
    expect(codes.size).toBe(24);
    expect(codes.has(null)).toBe(false);
  });

  it("accepts flat spellings as their sharp equivalents", () => {
    const cases: Array<[string, "major" | "minor", string]> = [
      ["Db", "major", "3B"],
      ["Eb", "major", "5B"],
      ["Gb", "major", "2B"],
      ["Ab", "major", "4B"],
      ["Bb", "major", "6B"],
      ["Eb", "minor", "2A"],
      ["Bb", "minor", "3A"],
    ];
    for (const [tonic, mode, code] of cases) {
      expect(camelotCode({ tonic, mode, confidence: 0.5 })).toBe(code);
    }
  });

  it("returns null for a null key or an unknown tonic", () => {
    expect(camelotCode(null)).toBeNull();
    expect(
      camelotCode({ tonic: "H", mode: "major", confidence: 0.9 }),
    ).toBeNull();
  });

  it("returns null when key confidence is missing or below the threshold", () => {
    expect(
      camelotCode({ tonic: "C", mode: "major", confidence: null }),
    ).toBeNull();
    expect(
      camelotCode({
        tonic: "C",
        mode: "major",
        confidence: CAMELOT_MIN_KEY_CONFIDENCE - 0.01,
      }),
    ).toBeNull();
    expect(
      camelotCode({
        tonic: "C",
        mode: "major",
        confidence: CAMELOT_MIN_KEY_CONFIDENCE,
      }),
    ).toBe("8B");
  });

  it("keyConfidenceCutoff is 0.1 before revision 3 and 0.05 from it (#2018)", () => {
    expect(KEY_MIN_CONFIDENCE_FROM_REVISION_3).toBe(0.05);
    expect(keyConfidenceCutoff(1)).toBe(CAMELOT_MIN_KEY_CONFIDENCE);
    expect(keyConfidenceCutoff(2)).toBe(CAMELOT_MIN_KEY_CONFIDENCE);
    expect(keyConfidenceCutoff(3)).toBe(KEY_MIN_CONFIDENCE_FROM_REVISION_3);
    expect(keyConfidenceCutoff(4)).toBe(KEY_MIN_CONFIDENCE_FROM_REVISION_3);
  });

  it("camelotCode applies the revision-aware cutoff (#2018)", () => {
    const keyAt = (confidence: number) => ({
      tonic: "C",
      mode: "major" as const,
      confidence,
    });
    expect(camelotCode(keyAt(0.07), 3)).toBe("8B");
    expect(camelotCode(keyAt(0.07), 2)).toBeNull();
    expect(camelotCode(keyAt(0.07), 1)).toBeNull();
    expect(camelotCode(keyAt(0.07))).toBeNull();
    expect(camelotCode(keyAt(0.04), 3)).toBeNull();
    for (const revision of [1, 2, 3]) {
      expect(camelotCode(keyAt(0.12), revision)).toBe("8B");
    }
  });

  it("withCamelot uses the payload's revision for the cutoff (#2018)", () => {
    const lowMargin = { ...validFeatures, key: { tonic: "C", mode: "major", confidence: 0.07 } };
    const at = (analysisRevision?: number) =>
      withCamelot(
        sanitizeStemAudioFeatures({
          ...lowMargin,
          ...(analysisRevision === undefined ? {} : { analysisRevision }),
        })!,
      ).camelot;
    expect(at(3)).toBe("8B");
    expect(at(2)).toBeNull();
    expect(at(1)).toBeNull();
    expect(at()).toBeNull();
  });

  it("withCamelot adds the code without changing other fields", () => {
    const sanitized = sanitizeStemAudioFeatures(validFeatures)!;
    expect(withCamelot(sanitized)).toEqual({ ...sanitized, camelot: "8B" });
    expect(
      withCamelot({ ...sanitized, key: null }),
    ).toEqual({ ...sanitized, key: null, camelot: null });
  });
});
