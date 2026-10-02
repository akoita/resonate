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

describe("DiscoveryRankingService tempo_match signal (#2037)", () => {
  const measuredFeatures = (tempoBpm: number) =>
    features({
      source: "measured_full_mix",
      tempoBpm,
      energyBand: "medium",
      featureSources: { tempo: "measured", key: "unavailable", energy: "measured" },
    });

  async function rankTempo(
    map: Map<string, AgentAudioFeatures>,
    tempoBpm?: { min: number | null; max: number | null },
  ) {
    return new DiscoveryRankingService().rank(
      [...map.keys()].map((id) => ({ id })),
      { originalQueries: [], expandedQueries: [], audioFeaturesByTrack: map, tempoBpm },
    );
  }

  const tempoSignal = (ranked: Awaited<ReturnType<typeof rankTempo>>, id: string) =>
    ranked.find((c) => c.id === id)?.signals.find((s) => s.label === "tempo_match");

  it("boosts a measured tempo inside the requested range and explains it", async () => {
    const ranked = await rankTempo(
      new Map([["in", measuredFeatures(122)], ["out", measuredFeatures(140)]]),
      { min: 120, max: 125 },
    );
    expect(tempoSignal(ranked, "in")).toEqual({
      label: "tempo_match",
      weight: 10,
      reason: "120\u2013125 BPM match",
    });
    expect(tempoSignal(ranked, "out")).toBeUndefined();
    const inTrack = ranked.find((c) => c.id === "in")!;
    const outTrack = ranked.find((c) => c.id === "out")!;
    expect(inTrack.explanation).toContain("120\u2013125 BPM match");
    expect(inTrack.score).toBe(outTrack.score + 10);
    expect(ranked[0].id).toBe("in");
  });

  it("never matches an inferred tempo", async () => {
    const ranked = await rankTempo(new Map([["inferred", features({ tempoBpm: 122 })]]), {
      min: 120,
      max: 125,
    });
    expect(tempoSignal(ranked, "inferred")).toBeUndefined();
  });

  it("honours open-ended ranges and does nothing without a range", async () => {
    const map = new Map([["slow", measuredFeatures(100)], ["fast", measuredFeatures(130)]]);
    const under = await rankTempo(map, { min: null, max: 125 });
    expect(tempoSignal(under, "slow")?.reason).toBe("under 125 BPM match");
    expect(tempoSignal(under, "fast")).toBeUndefined();
    const over = await rankTempo(map, { min: 125, max: null });
    expect(tempoSignal(over, "fast")?.reason).toBe("over 125 BPM match");
    const none = await rankTempo(map, undefined);
    expect(tempoSignal(none, "slow")).toBeUndefined();
    expect(tempoSignal(none, "fast")).toBeUndefined();
  });

  it("does not change the primary reason code (an unmapped label is skipped)", async () => {
    const withTempo = await rankTempo(new Map([["a", measuredFeatures(122)]]), { min: 120, max: 125 });
    const without = await rankTempo(new Map([["a", measuredFeatures(122)]]));
    expect(withTempo[0].reasonCode).toBe(without[0].reasonCode);
  });
});
