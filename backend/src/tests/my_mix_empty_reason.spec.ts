/**
 * #2270: a listener with no listening lanes gets a reason code naming the rule
 * that left them without, and boosting a family-keyed lane raises the family's
 * tracks in the declared-boost ranking.
 */
import {
  AGENT_LISTENING_LANE_MIN_SESSIONS,
  AGENT_TASTE_HISTORY_WINDOW_DAYS,
} from "../config/agent_learning";
import type { AgentTasteSignalInput } from "../modules/agents/agent_learning.service";
import {
  analyzeListeningLanes,
  computeListeningLanes,
  LISTENING_LANES_EMPTY_REASONS,
} from "../modules/agents/listening_lanes";
import { matchingMyMixLaneIds, resolveMyMixPlan } from "../modules/agents/agent_my_mix";
import {
  declaredGenreMatchesRelease,
  genreFamilyNamed,
} from "../modules/recommendations/genre_families";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import {
  buildPolicy,
  TasteMemorySettingsDto,
  TasteSignalControlDto,
} from "../modules/recommendations/taste_memory.service";

const NOW = new Date("2026-07-01T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
let counter = 0;

function signal(overrides: Partial<AgentTasteSignalInput> = {}): AgentTasteSignalInput {
  counter += 1;
  return {
    action: "complete",
    trackId: `track_${counter}`,
    sessionKey: `session_${counter}`,
    createdAt: NOW,
    genre: "Soul",
    moods: ["Warm"],
    localHourBucket: "evening",
    weekdayKind: "weekday",
    ...overrides,
  };
}

function sessions(count: number, overrides: Partial<AgentTasteSignalInput> = {}) {
  return Array.from({ length: count }, () => signal(overrides));
}

describe("listening lanes empty reason (#2270)", () => {
  it("names exactly the four documented codes", () => {
    expect([...LISTENING_LANES_EMPTY_REASONS]).toEqual([
      "no_signals",
      "unknown_genres",
      "too_few_sessions",
      "evidence_decayed",
    ]);
  });

  it("has no reason when lanes exist", () => {
    const result = analyzeListeningLanes(sessions(2), NOW);
    expect(result.lanes).toHaveLength(1);
    expect(result.emptyReason).toBeNull();
    expect(computeListeningLanes(sessions(2), NOW)).toEqual(result.lanes);
  });

  describe("no_signals", () => {
    it("an empty history", () => {
      expect(analyzeListeningLanes([], NOW)).toEqual({ lanes: [], emptyReason: "no_signals" });
    });

    it("signals without a session key", () => {
      expect(analyzeListeningLanes(sessions(3, { sessionKey: undefined }), NOW).emptyReason).toBe("no_signals");
      expect(analyzeListeningLanes(sessions(3, { sessionKey: "  " }), NOW).emptyReason).toBe("no_signals");
    });

    it("signals outside the history window", () => {
      const tooOld = new Date(NOW.getTime() - (AGENT_TASTE_HISTORY_WINDOW_DAYS + 1) * DAY_MS);
      expect(analyzeListeningLanes(sessions(3, { createdAt: tooOld }), NOW).emptyReason).toBe("no_signals");
    });

    it("signals at or before a taste reset", () => {
      const policy = buildPolicy(
        { ...SETTINGS, resetAt: NOW.toISOString() },
        [],
      );
      expect(analyzeListeningLanes(sessions(3), NOW, policy).emptyReason).toBe("no_signals");
    });
  });

  describe("unknown_genres", () => {
    it("signals whose genre no vocabulary or family names", () => {
      expect(analyzeListeningLanes(sessions(4, { genre: "Senegal" }), NOW)).toEqual({
        lanes: [],
        emptyReason: "unknown_genres",
      });
      expect(analyzeListeningLanes(sessions(4, { genre: undefined }), NOW).emptyReason).toBe("unknown_genres");
    });

    it("is not reported when only some signals have an unknown genre", () => {
      const result = analyzeListeningLanes([...sessions(2), ...sessions(2, { genre: "Senegal" })], NOW);
      expect(result.emptyReason).toBeNull();
      expect(result.lanes).toHaveLength(1);
    });
  });

  describe("too_few_sessions", () => {
    it("a single positive session", () => {
      expect(AGENT_LISTENING_LANE_MIN_SESSIONS).toBe(2);
      expect(analyzeListeningLanes([signal({ action: "purchase" })], NOW)).toEqual({
        lanes: [],
        emptyReason: "too_few_sessions",
      });
    });

    it("many signals from one session", () => {
      const result = analyzeListeningLanes(sessions(5, { sessionKey: "the-only-session" }), NOW);
      expect(result.emptyReason).toBe("too_few_sessions");
    });

    it("two sessions of disjoint habits, one each", () => {
      const result = analyzeListeningLanes([signal({ genre: "Soul" }), signal({ genre: "Jazz" })], NOW);
      expect(result.emptyReason).toBe("too_few_sessions");
    });

    it("only skips, which never form a habit", () => {
      const result = analyzeListeningLanes(sessions(4, { action: "skip" }), NOW);
      expect(result.emptyReason).toBe("too_few_sessions");
    });
  });

  describe("evidence_decayed", () => {
    it("enough sessions whose evidence has decayed below the floor", () => {
      const old = new Date(NOW.getTime() - 500 * DAY_MS);
      const result = analyzeListeningLanes(sessions(3, { action: "save", createdAt: old }), NOW);
      expect(result).toEqual({ lanes: [], emptyReason: "evidence_decayed" });
    });

    it("the same sessions, played recently, do form a lane", () => {
      expect(analyzeListeningLanes(sessions(3, { action: "save" }), NOW).emptyReason).toBeNull();
    });

    it("two sessions whose half-decayed evidence never reaches the floor", () => {
      const older = new Date(NOW.getTime() - 100 * DAY_MS);
      const result = analyzeListeningLanes(sessions(2, { createdAt: older }), NOW);
      expect(result.emptyReason).toBe("evidence_decayed");
    });
  });
});

describe("boosting a family-keyed lane (#2270)", () => {
  const ranking = new DiscoveryRankingService();
  const control = (value: string): TasteSignalControlDto => ({
    id: `c_${value}`,
    signalType: "genre",
    value,
    action: "boosted",
    source: "declared_text_edit",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  const context = (values: string[]) => ({
    originalQueries: [],
    expandedQueries: [],
    tastePolicy: buildPolicy(SETTINGS, values.map(control)),
  });

  // A lane keyed by a family id: free-text "Mandingue" files under "african".
  const familyLane = computeListeningLanes(sessions(3, { genre: "Mandingue", moods: [] }), NOW)[0];

  it("fixture: the lane is keyed by a genre family id", () => {
    expect(Object.keys(familyLane.genreWeights)).toEqual(["african"]);
  });

  it("raises a family member above an unrelated track, via the lane's boosted edit", async () => {
    const [laneKey] = Object.keys(familyLane.genreWeights);
    const ranked = await ranking.rank(
      [
        { id: "other", release: { genre: "Techno" } },
        { id: "member", release: { genre: "Mandingue" } },
        { id: "family-label", release: { genre: "African" } },
      ],
      context([laneKey]),
    );
    const byId = Object.fromEntries(ranked.map((item) => [item.id, item]));
    for (const id of ["member", "family-label"]) {
      const labels = byId[id].signals.map((entry) => entry.label);
      expect(labels).toContain("declared_preference");
      expect(byId[id].score).toBeGreaterThan(byId.other.score);
    }
    expect(byId.other.signals.map((entry) => entry.label)).not.toContain("declared_preference");
    expect(byId.member.signals.find((entry) => entry.label === "declared_preference")?.reason)
      .toBe("you asked for more African");
  });

  it("matches the same tracks the lane claims in a mix", () => {
    const plan = resolveMyMixPlan({}, [familyLane], 5)!;
    for (const genre of ["Mandingue", "African", "Afrobeats", "West Africa"]) {
      expect(matchingMyMixLaneIds(plan.lanes, { genre })).toEqual([familyLane.id]);
      expect(declaredGenreMatchesRelease("african", genre)).toBe(true);
    }
    expect(declaredGenreMatchesRelease("african", "Techno")).toBe(false);
  });

  it("boosts through a family label too, e.g. an edit stored as the label", async () => {
    const [item] = await ranking.rank(
      [{ id: "lofi", release: { genre: "Chillhop" } }],
      context(["Ambient / Lo-fi"]),
    );
    expect(item.signals.map((entry) => entry.label)).toContain("declared_preference");
  });

  it("keeps ordinary declared boosts exact: only a named family widens", async () => {
    // "French Rap" holds a narrow family phrase but does not NAME a family.
    expect(genreFamilyNamed("French Rap")).toBeUndefined();
    expect(declaredGenreMatchesRelease("French Rap", "Trap")).toBe(false);
    expect(declaredGenreMatchesRelease("Jazz", "jazz")).toBe(true);
    const [item] = await ranking.rank(
      [{ id: "trap", release: { genre: "Trap" } }],
      context(["French Rap"]),
    );
    expect(item.signals.map((entry) => entry.label)).not.toContain("declared_preference");
  });
});

const SETTINGS: TasteMemorySettingsDto = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
  resetAt: null,
};
