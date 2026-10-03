import { describe, expect, it } from "vitest";
import type { AgentMixVocabulary, AgentMyMixPreferences, AgentNextPreferences, ListeningLane } from "./api";
import {
  MAX_MY_MIX_ADDITIONS,
  MAX_MY_MIX_TASTE_EDITS,
  addMyMixAddition,
  buildMyMixTasteEdits,
  createMyMixPreferences,
  getMyMixLocalContext,
  isListenerProEnabled,
  myMixAdditionOptions,
  myMixCoverageNotes,
  removeMyMixAddition,
  selectedMyMixLanes,
  setMyMixLaneBoost,
  setMyMixLaneIncluded,
  withCurrentMyMixContext,
} from "./agentMyMix";

function lane(
  id: string,
  fields: Partial<ListeningLane> = {},
): ListeningLane {
  return {
    id,
    label: id === "lane-soul" ? "Soul · Warm" : "Ambient · Zen",
    genreWeights: { Soul: 0.8, Jazz: 0.4 },
    moodWeights: { Warm: 0.7, Chill: 0.3 },
    strength: 0.9,
    contexts: { "evening:weekday": 0.8 },
    energyBand: "medium",
    hidden: false,
    ...fields,
  };
}

describe("My Mix helpers", () => {
  it("uses the local hour and weekday only to select an existing coarse context", () => {
    expect(getMyMixLocalContext(new Date(2026, 9, 3, 5, 59))).toBe("night:weekend");
    expect(getMyMixLocalContext(new Date(2026, 9, 5, 6, 0))).toBe("morning:weekday");
    expect(getMyMixLocalContext(new Date(2026, 9, 5, 11, 59))).toBe("morning:weekday");
    expect(getMyMixLocalContext(new Date(2026, 9, 5, 12, 0))).toBe("afternoon:weekday");
    expect(getMyMixLocalContext(new Date(2026, 9, 5, 17, 59))).toBe("afternoon:weekday");
    expect(getMyMixLocalContext(new Date(2026, 9, 5, 18, 0))).toBe("evening:weekday");
    expect(getMyMixLocalContext(new Date(2026, 9, 4, 23, 59))).toBe("evening:weekend");

    const context = createMyMixPreferences(new Date(2026, 9, 3, 5, 59));
    expect(context).toEqual({ context: "night:weekend" });
    expect(JSON.stringify(context)).not.toMatch(/timezone|\bUTC\b|2026|05:59/);
  });

  it("refreshes the coarse context on each next-pick request without changing other preferences", () => {
    const preferences: AgentNextPreferences = {
      source: "agent_session_prompt",
      myMix: {
        context: "evening:weekday",
        lanes: [{ id: "lane-private", boost: true }],
        additions: [{ genre: "Dancehall" }],
      },
    };
    expect(withCurrentMyMixContext(preferences, new Date(2026, 9, 4, 0, 1))).toEqual({
      source: "agent_session_prompt",
      myMix: {
        context: "night:weekend",
        lanes: [{ id: "lane-private", boost: true }],
        additions: [{ genre: "Dancehall" }],
      },
    });
    expect(withCurrentMyMixContext({ myMix: null })).toEqual({ myMix: null });
    expect(withCurrentMyMixContext({ genres: ["Soul"] })).toEqual({ genres: ["Soul"] });
  });

  it("defaults to every visible lane and makes removal explicit", () => {
    const visible = [lane("lane-soul"), lane("lane-ambient")];
    const defaults = createMyMixPreferences(new Date(2026, 9, 5, 19));
    expect(defaults).not.toHaveProperty("lanes");
    expect(selectedMyMixLanes(defaults, visible)).toEqual([
      { id: "lane-soul" },
      { id: "lane-ambient" },
    ]);

    const oneLane = setMyMixLaneIncluded(defaults, visible, "lane-ambient", false);
    expect(oneLane.lanes).toEqual([{ id: "lane-soul" }]);
    expect(setMyMixLaneIncluded({ ...defaults, lanes: [] }, visible, "lane-soul", false).lanes).toEqual([]);
  });

  it("toggles boosts only for a selected, visible lane", () => {
    const visible = [lane("lane-soul"), lane("lane-ambient")];
    const initial: AgentMyMixPreferences = { context: "evening:weekday" };
    expect(setMyMixLaneBoost(initial, visible, "lane-soul", true).lanes).toEqual([
      { id: "lane-soul", boost: true },
      { id: "lane-ambient" },
    ]);
    expect(setMyMixLaneBoost({ ...initial, lanes: [] }, visible, "lane-soul", true)).toEqual({
      ...initial,
      lanes: [],
    });
    expect(setMyMixLaneBoost(initial, [...visible, lane("lane-hidden", { hidden: true })], "lane-hidden", true))
      .toEqual(initial);
  });

  it("offers canonical catalog values and caps session additions at two", () => {
    const vocabulary: AgentMixVocabulary = {
      genres: ["Soul", "Jazz", "Dancehall", "Soul"],
      moods: ["Warm", "Chill", "Zen", "Warm"],
    };
    expect(myMixAdditionOptions(vocabulary)).toEqual({
      genres: ["Dancehall", "Jazz", "Soul"],
      moods: ["Chill", "Warm", "Zen"],
    });
    let preferences: AgentMyMixPreferences = { context: "evening:weekday" };
    preferences = addMyMixAddition(preferences, vocabulary, { genre: "soul" });
    preferences = addMyMixAddition(preferences, vocabulary, { mood: "Warm" });
    const atCapacity = addMyMixAddition(preferences, vocabulary, { genre: "Jazz" });
    expect(preferences.additions).toEqual([{ genre: "Soul" }, { mood: "Warm" }]);
    expect(atCapacity).toBe(preferences);
    expect(preferences.additions).toHaveLength(MAX_MY_MIX_ADDITIONS);
    expect(removeMyMixAddition(preferences, { genre: "SOUL" }).additions).toEqual([{ mood: "Warm" }]);
    const withAvailableSlot = removeMyMixAddition(preferences, { mood: "Warm" });
    expect(addMyMixAddition(withAvailableSlot, vocabulary, { genre: "Dancehall" }).additions).toEqual([
      { genre: "Soul" },
      { genre: "Dancehall" },
    ]);
    expect(addMyMixAddition(preferences, vocabulary, { genre: "Not in catalog" })).toBe(preferences);
  });

  it("explicitly saves additions and boosted lane catalog terms, not unchanged or removed lanes", () => {
    const visible = [lane("lane-soul"), lane("lane-ambient", {
      genreWeights: { Ambient: 0.9 },
      moodWeights: { Zen: 0.9 },
    })];
    const edits = buildMyMixTasteEdits({
      context: "evening:weekday",
      lanes: [{ id: "lane-soul", boost: true }],
      additions: [{ genre: "Soul" }, { mood: "Zen" }],
    }, visible);

    expect(edits).toEqual([
      { signalType: "genre", value: "Soul", action: "boosted" },
      { signalType: "mood", value: "Zen", action: "boosted" },
      { signalType: "genre", value: "Jazz", action: "boosted" },
      { signalType: "mood", value: "Warm", action: "boosted" },
      { signalType: "mood", value: "Chill", action: "boosted" },
    ]);
    expect(edits.some((edit) => edit.value === "Ambient")).toBe(false);
    expect(edits.every((edit) => edit.signalType !== "lane")).toBe(true);
  });

  it("bounds explicit catalog boosts to the existing API edit limit", () => {
    const genres = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Genre ${i}`, 40 - i]));
    const moods = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Mood ${i}`, 40 - i]));
    const visible = [lane("lane-soul", { genreWeights: genres, moodWeights: moods })];
    const edits = buildMyMixTasteEdits({ context: "morning:weekday", lanes: [{ id: "lane-soul", boost: true }] }, visible);
    expect(edits.length).toBeLessThanOrEqual(MAX_MY_MIX_TASTE_EDITS);
    expect(new Set(edits.map((edit) => `${edit.signalType}:${edit.value.toLowerCase()}`)).size).toBe(edits.length);
  });

  it("names lane shortfalls with catalog labels without exposing lane IDs", () => {
    expect(myMixCoverageNotes({ lanes: [
      { id: "lane-soul", label: "Soul · Warm", requested: 5, matched: 1 },
      { id: "lane-ambient", label: "Ambient · Zen", requested: 2, matched: 0 },
      { id: "lane-complete", label: "Jazz · Chill", requested: 3, matched: 4 },
      { id: "lane_0123456789abcdef0123456789abcdef", label: "lane_0123456789abcdef0123456789abcdef", requested: 1, matched: 0 },
    ] })).toEqual([
      "Only 1 of 5 picks matched Soul · Warm.",
      "Not enough new tracks for Ambient · Zen yet.",
      "Not enough new tracks for this lane yet.",
    ]);
  });

  it("keeps Listener Pro disabled behind one central seam", () => {
    expect(isListenerProEnabled()).toBe(false);
  });
});
