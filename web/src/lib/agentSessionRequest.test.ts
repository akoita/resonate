import { describe, expect, it } from "vitest";
import type { AgentSessionRequest } from "./api";
import {
  chipsFromRequest,
  coverageNotes,
  emptyRequest,
  hasFilters,
  ignoredKeyLabels,
  removeChip,
  requestFilterKeys,
  requestFromPreset,
  setEnergy,
  trackIdsAt,
  upcomingDjIndices,
} from "./agentSessionRequest";

const request: AgentSessionRequest = {
  genres: ["deep house", "house"],
  moods: ["warm"],
  energy: "medium",
  bpm: { min: 120, max: 125 },
};

describe("chipsFromRequest", () => {
  it("lists genre, mood, energy and tempo chips with stable keys", () => {
    expect(chipsFromRequest(request)).toEqual([
      { key: "genre:deep house", kind: "genre", label: "Deep house" },
      { key: "genre:house", kind: "genre", label: "House" },
      { key: "mood:warm", kind: "mood", label: "Warm mood" },
      { key: "energy", kind: "energy", label: "Medium energy" },
      { key: "bpm", kind: "bpm", label: "120–125 BPM" },
    ]);
  });

  it("words one-sided tempo ranges and skips an open range", () => {
    const only = (bpm: AgentSessionRequest["bpm"]) =>
      chipsFromRequest({ ...emptyRequest(), bpm }).map((chip) => chip.label);
    expect(only({ min: null, max: 125 })).toEqual(["under 125 BPM"]);
    expect(only({ min: 120, max: null })).toEqual(["over 120 BPM"]);
    expect(only({ min: null, max: null })).toEqual([]);
  });

  it("returns no chips for a missing request", () => {
    expect(chipsFromRequest(null)).toEqual([]);
    expect(chipsFromRequest(undefined)).toEqual([]);
  });
});

describe("removeChip and setEnergy", () => {
  it("removes one genre, one mood, the energy, or the tempo", () => {
    expect(removeChip(request, "genre:house").genres).toEqual(["deep house"]);
    expect(removeChip(request, "mood:warm").moods).toEqual([]);
    expect(removeChip(request, "energy").energy).toBeNull();
    expect(removeChip(request, "bpm").bpm).toBeNull();
  });

  it("leaves the request unchanged for an unknown key and never mutates", () => {
    expect(removeChip(request, "nope")).toBe(request);
    removeChip(request, "genre:house");
    expect(request.genres).toEqual(["deep house", "house"]);
  });

  it("replaces or clears the energy band", () => {
    expect(setEnergy(request, "high").energy).toBe("high");
    expect(setEnergy(request, null).energy).toBeNull();
  });
});

describe("requestFromPreset", () => {
  it("turns a preset into the filters it already stands for", () => {
    expect(
      requestFromPreset({
        searchVibes: ["Bass", "Club", "Trap"],
        preferences: { mood: "Hype", energy: "high" },
      }),
    ).toEqual({ genres: ["Bass", "Club", "Trap"], moods: ["Hype"], energy: "high", bpm: null });
  });

  it("omits a mood and energy the preset does not set", () => {
    expect(requestFromPreset({ searchVibes: ["Jazz"], preferences: {} })).toEqual({
      genres: ["Jazz"],
      moods: [],
      energy: null,
      bpm: null,
    });
  });

  it("copies the genres instead of sharing the preset's array", () => {
    const vibes = ["Jazz"];
    const result = requestFromPreset({ searchVibes: vibes, preferences: {} });
    result.genres.push("Soul");
    expect(vibes).toEqual(["Jazz"]);
  });
});

describe("hasFilters and requestFilterKeys", () => {
  it("is false for a missing or empty request", () => {
    expect(hasFilters(null)).toBe(false);
    expect(hasFilters(emptyRequest())).toBe(false);
    expect(hasFilters({ ...emptyRequest(), bpm: { min: null, max: null } })).toBe(false);
  });

  it("is true when any filter is set", () => {
    expect(hasFilters({ ...emptyRequest(), genres: ["house"] })).toBe(true);
    expect(hasFilters({ ...emptyRequest(), energy: "low" })).toBe(true);
    expect(hasFilters({ ...emptyRequest(), bpm: { min: 90, max: null } })).toBe(true);
  });

  it("lists only the kinds of filter in use, never values", () => {
    expect(requestFilterKeys(request)).toEqual(["genres", "moods", "energy", "bpm"]);
    expect(requestFilterKeys({ ...emptyRequest(), energy: "high" })).toEqual(["energy"]);
    expect(requestFilterKeys(null)).toEqual([]);
  });
});

describe("ignoredKeyLabels", () => {
  it("names the filters a listening session does not use, once each", () => {
    expect(
      ignoredKeyLabels(["keys", "requiredStems", "licenseType", "maxTotalUsd", "maxPerItemUsd", "verifiedHumanOnly"]),
    ).toEqual(["key", "stems", "license", "price", "verified human only"]);
  });
});

describe("coverageNotes", () => {
  it("explains each gap using the request's own wording", () => {
    expect(
      coverageNotes(
        {
          picks: 5,
          gaps: [
            { filter: "bpm", matched: 1 },
            { filter: "genres", matched: 0 },
          ],
        },
        request,
      ),
    ).toEqual([
      "Only 1 of 5 picks matched 120–125 BPM",
      "None of the 5 picks matched deep house, house",
    ]);
  });

  it("drops gaps for filters that were removed and handles no coverage", () => {
    expect(coverageNotes({ picks: 5, gaps: [{ filter: "bpm", matched: 2 }] }, removeChip(request, "bpm"))).toEqual([]);
    expect(coverageNotes(null, request)).toEqual([]);
    expect(coverageNotes({ picks: 0, gaps: [] }, request)).toEqual([]);
  });
});

describe("upcomingDjIndices", () => {
  const queue = [
    { id: "a" },
    { id: "local-b", catalogTrackId: "b" },
    { id: "c" },
    { id: "mine" },
    { id: "d" },
  ];

  it("returns upcoming DJ-set entries highest first, by id or catalog id", () => {
    expect(upcomingDjIndices(queue, 0, ["a", "b", "c", "d"])).toEqual([4, 2, 1]);
  });

  it("never touches the current or earlier entries or the listener's own queue", () => {
    expect(upcomingDjIndices(queue, 2, ["a", "b", "c", "d"])).toEqual([4]);
    expect(upcomingDjIndices(queue, 4, ["a", "b", "c", "d"])).toEqual([]);
  });

  it("handles an empty queue, an empty set, and no current track", () => {
    expect(upcomingDjIndices([], 0, ["a"])).toEqual([]);
    expect(upcomingDjIndices(queue, 0, [])).toEqual([]);
    expect(upcomingDjIndices(queue, -1, ["a"])).toEqual([0]);
  });

  it("collects both ids of the entries it would remove", () => {
    expect(Array.from(trackIdsAt(queue, [1, 2]))).toEqual(["local-b", "b", "c"]);
  });
});
