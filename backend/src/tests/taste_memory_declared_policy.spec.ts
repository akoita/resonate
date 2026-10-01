/**
 * Declared taste in the policy and ranking core (#1961, ADR-TE-5) — pure unit
 * tests. `boosted` is a x1.5 weight, `hidden` beats everything, `downranked`
 * stays x0.35, and a written `note` has no ranking effect.
 */
import {
  BOOSTED_SCORE_MULTIPLIER,
  buildPolicy,
  DOWNRANKED_SCORE_MULTIPLIER,
  filterPreferencesWithPolicy,
  scoreMultiplierForSignal,
  TasteSignalControlDto,
  TasteMemorySettingsDto,
} from "../modules/recommendations/taste_memory.service";
import {
  DECLARED_PREFERENCE_WEIGHT,
  DiscoveryRankingService,
} from "../modules/recommendations/discovery-ranking.service";
import { DISCOVERY_EXPLANATION_VARIANTS } from "../modules/recommendations/discovery-explanations";

const settings: TasteMemorySettingsDto = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
  resetAt: null,
};

let nextId = 0;
function control(
  signalType: TasteSignalControlDto["signalType"],
  value: string,
  action: TasteSignalControlDto["action"],
  createdAt = "2026-09-01T00:00:00.000Z",
): TasteSignalControlDto {
  nextId += 1;
  return { id: `c${nextId}`, signalType, value, action, source: "declared_text_edit", createdAt };
}

describe("boosted taste signals", () => {
  it("weights a boosted signal above neutral and a downranked one below", () => {
    const policy = buildPolicy(settings, [
      control("genre", "Jazz", "boosted"),
      control("genre", "Drill", "downranked"),
    ]);
    expect(scoreMultiplierForSignal(policy, "genre", "jazz")).toBe(BOOSTED_SCORE_MULTIPLIER);
    expect(scoreMultiplierForSignal(policy, "genre", "JAZZ")).toBe(1.5);
    expect(scoreMultiplierForSignal(policy, "genre", "Drill")).toBe(DOWNRANKED_SCORE_MULTIPLIER);
    expect(scoreMultiplierForSignal(policy, "genre", "Soul")).toBe(1);
    expect(scoreMultiplierForSignal(undefined, "genre", "Jazz")).toBe(1);
  });

  it("lets hidden beat boosted when both somehow reach the policy", () => {
    const policy = buildPolicy(settings, [control("genre", "Jazz", "boosted")]);
    policy.hidden.set("genre", new Set(["jazz"]));
    expect(scoreMultiplierForSignal(policy, "genre", "Jazz")).toBe(0);
    const filtered = filterPreferencesWithPolicy({ genres: ["Jazz"] }, policy);
    expect(filtered.genres).toEqual([]);
  });

  it("keeps a written note out of every ranking map", () => {
    const policy = buildPolicy(settings, [control("note", "more live instruments", "declared")]);
    expect(policy.hidden.size + policy.downranked.size + policy.boosted.size).toBe(0);
    expect(scoreMultiplierForSignal(policy, "note", "more live instruments")).toBe(1);
  });

  it("does not treat an unknown action as hidden any more", () => {
    const policy = buildPolicy(settings, [control("genre", "Jazz", "declared")]);
    expect(policy.hidden.size).toBe(0);
  });
});

describe("declared preferences in preference matching", () => {
  it("adds boosted genres and keeps the listener's own, without duplicates", () => {
    const policy = buildPolicy(settings, [
      control("genre", "Jazz", "boosted"),
      control("genre", "Soul", "boosted"),
    ]);
    const prefs = filterPreferencesWithPolicy({ genres: ["soul", "Rock"] }, policy);
    expect(prefs.genres).toEqual(["soul", "Rock", "Jazz"]);
  });

  it("creates the genre list from boosts when the listener had none", () => {
    const policy = buildPolicy(settings, [control("genre", "Jazz", "boosted")]);
    expect(filterPreferencesWithPolicy({}, policy).genres).toEqual(["Jazz"]);
  });

  it("leaves preferences untouched when nothing is declared", () => {
    const policy = buildPolicy(settings, []);
    expect(filterPreferencesWithPolicy({ genres: ["Rock"], mood: "Focus" }, policy)).toEqual({
      genres: ["Rock"],
      mood: "Focus",
    });
    expect(filterPreferencesWithPolicy({}, policy).genres).toBeUndefined();
  });

  it("fills a missing mood and energy, but never overrides an explicit request", () => {
    const policy = buildPolicy(settings, [
      control("mood", "Dark", "boosted"),
      control("energy", "low", "boosted"),
    ]);
    expect(filterPreferencesWithPolicy({}, policy)).toMatchObject({ mood: "Dark", energy: "low" });
    expect(filterPreferencesWithPolicy({ mood: "Focus", energy: "high" }, policy)).toMatchObject({
      mood: "Focus",
      energy: "high",
    });
  });

  it("uses the newest declared energy band", () => {
    const policy = buildPolicy(settings, [
      control("energy", "low", "boosted", "2026-09-01T00:00:00.000Z"),
      control("energy", "high", "boosted", "2026-09-02T00:00:00.000Z"),
    ]);
    expect(policy.declared?.energy).toBe("high");
  });

  it("ignores a hidden mood when filling the mood", () => {
    const policy = buildPolicy(settings, [
      control("mood", "Dark", "hidden"),
      control("mood", "Warm", "boosted"),
    ]);
    expect(filterPreferencesWithPolicy({}, policy).mood).toBe("Warm");
  });
});

describe("declared preference in the ranking core", () => {
  const ranking = new DiscoveryRankingService();
  const context = (controls: TasteSignalControlDto[]) => ({
    originalQueries: [],
    expandedQueries: [],
    tastePolicy: buildPolicy(settings, controls),
  });

  it("adds a declared-preference signal above the learned cap, with no history at all", async () => {
    const [jazz, soul] = await ranking.rank(
      [
        { id: "soul", release: { genre: "Soul" } },
        { id: "jazz", release: { genre: "Jazz" } },
      ],
      context([control("genre", "Jazz", "boosted")]),
    ).then((list) => [list.find((item) => item.id === "jazz")!, list.find((item) => item.id === "soul")!]);

    expect(jazz.signals.map((signal) => signal.label)).toContain("declared_preference");
    expect(jazz.signals.find((signal) => signal.label === "declared_preference")?.weight)
      .toBe(DECLARED_PREFERENCE_WEIGHT);
    expect(DECLARED_PREFERENCE_WEIGHT).toBeGreaterThan(18);
    expect(jazz.explanation).toContain(DISCOVERY_EXPLANATION_VARIANTS.declared_taste);
    expect(jazz.reasonCode).toBe("taste_match");
    expect(jazz.score).toBeGreaterThan(soul.score);
  });

  it("boosts on a declared mood too", async () => {
    const [item] = await ranking.rank(
      [{ id: "dark-track", release: { genre: "Techno", moods: ["Dark"] } }],
      context([control("mood", "Dark", "boosted")]),
    );
    expect(item.signals.map((signal) => signal.label)).toContain("declared_preference");
  });

  it("scales a learned preference by the boost", async () => {
    const boosted = await ranking.rank([{ id: "a", release: { genre: "Jazz" } }], {
      ...context([control("genre", "Jazz", "boosted")]),
      learnedGenreWeights: { Jazz: 4 },
    });
    const plain = await ranking.rank([{ id: "a", release: { genre: "Jazz" } }], {
      ...context([]),
      learnedGenreWeights: { Jazz: 4 },
    });
    const learned = (list: typeof boosted) =>
      list[0].signals.find((signal) => signal.label === "learned_preference")!.weight;
    expect(learned(boosted)).toBe(learned(plain) * BOOSTED_SCORE_MULTIPLIER);
  });

  it("does nothing for a downranked or note-only policy", async () => {
    const [item] = await ranking.rank(
      [{ id: "a", release: { genre: "Drill" } }],
      context([control("genre", "Drill", "downranked"), control("note", "more piano", "declared")]),
    );
    expect(item.signals.map((signal) => signal.label)).not.toContain("declared_preference");
  });
});
