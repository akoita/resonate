import { AgentAudioFeatures } from "../modules/agents/agent_audio_feature.service";
import {
  audioFeatureReason,
  DiscoveryRankingService,
} from "../modules/recommendations/discovery-ranking.service";

function features(overrides: Partial<AgentAudioFeatures> = {}): AgentAudioFeatures {
  return {
    schemaVersion: "agent-audio-features/v2",
    source: "metadata_inferred",
    extractor: { name: "metadata_feature_seed", version: "2026-05-15" },
    confidence: 0.6,
    derivedAt: "2026-01-01T00:00:00.000Z",
    durationBucket: "standard",
    tempoBpm: 101,
    tempoBand: "mid",
    key: null,
    camelot: null,
    featureSources: { tempo: "inferred", key: "unavailable", energy: "inferred" },
    energy: 0.8,
    energyBand: "high",
    descriptors: { genres: [], moods: [], instrumentation: [], texture: [] },
    featureVector: {
      dimensions: [
        "energy",
        "tempo",
        "duration",
        "stem_density",
        "vocal_presence",
        "beat_presence",
        "generated_likelihood",
      ],
      values: [0, 0, 0, 0, 0, 0, 0],
    },
    tags: [],
    warnings: [],
    ...overrides,
  };
}

describe("audioFeatureReason", () => {
  it("prints a rounded BPM only when the tempo was measured", () => {
    expect(
      audioFeatureReason(
        features({
          source: "measured_full_mix",
          tempoBpm: 123.6,
          featureSources: { tempo: "measured", key: "unavailable", energy: "measured" },
        }),
      ),
    ).toBe("124 BPM, high energy");
  });

  it("never prints the fabricated inferred tempo", () => {
    const reason = audioFeatureReason(features());
    expect(reason).toBe("high energy");
    expect(reason).not.toMatch(/BPM|101/);
  });

  it("omits BPM for measured energy with an inferred tempo", () => {
    expect(
      audioFeatureReason(
        features({
          source: "measured_full_mix",
          featureSources: { tempo: "inferred", key: "unavailable", energy: "measured" },
        }),
      ),
    ).toBe("high energy");
  });

  it("omits BPM for entries cached without featureSources", () => {
    const legacy = features();
    delete (legacy as Partial<AgentAudioFeatures>).featureSources;
    expect(audioFeatureReason(legacy)).toBe("high energy");
  });
});

describe("DiscoveryRankingService audio-feature signal", () => {
  it("uses the measured/inferred reason in the ranked signal", async () => {
    const service = new DiscoveryRankingService();
    const ranked = await service.rank(
      [{ id: "measured" }, { id: "inferred" }],
      {
        originalQueries: [],
        expandedQueries: [],
        audioFeaturesByTrack: new Map([
          [
            "measured",
            features({
              tempoBpm: 128,
              featureSources: { tempo: "measured", key: "unavailable", energy: "measured" },
            }),
          ],
          ["inferred", features()],
        ]),
      },
    );
    const reasonFor = (id: string) =>
      ranked.find((c) => c.id === id)?.signals.find((s) => s.label === "audio_features")?.reason;
    expect(reasonFor("measured")).toBe("128 BPM, high energy");
    expect(reasonFor("inferred")).toBe("high energy");
  });
});
