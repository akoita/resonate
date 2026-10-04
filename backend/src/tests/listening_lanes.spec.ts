import {
  AGENT_TASTE_HISTORY_LIMIT,
} from "../config/agent_learning";
import { AgentTasteSignalInput } from "../modules/agents/agent_learning.service";
import { computeListeningLanes } from "../modules/agents/listening_lanes";
import { TasteMemoryPolicy, TasteSignalType } from "../modules/recommendations/taste_memory.service";
import { TASTE_EDIT_GENRES } from "../modules/recommendations/taste_edit_vocabulary";

const NOW = new Date("2026-07-01T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
let trackNumber = 0;
let sessionPairNumber = 0;

describe("computeListeningLanes", () => {
  it("produces two deterministic catalog lanes from repeated session habits without exposing identifiers", () => {
    const history = [
      ...twoSessions("Soul", "Warm", {
        localHourBucket: "evening",
        weekdayKind: "weekday",
        audioFeatures: { energy: 0.5, energySource: "measured" },
      }),
      ...twoSessions("Dancehall", "Club", {
        localHourBucket: "night",
        weekdayKind: "weekend",
        audioFeatures: { energy: 0.8, energySource: "measured" },
      }),
    ];

    const lanes = computeListeningLanes(history, NOW);

    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.label).sort()).toEqual(["Dancehall · Club", "Soul · Warm"]);
    expect(lanes.map((lane) => lane.energyBand).sort()).toEqual(["high", "medium"]);
    expect(lanes.every((lane) => /^lane_[a-f0-9]{32}$/.test(lane.id))).toBe(true);
    expect(lanes).toEqual(computeListeningLanes([...history].reverse(), NOW));
    const serialized = JSON.stringify(lanes);
    expect(serialized).not.toContain("track_secret");
    expect(serialized).not.toContain("browser_session_secret");
    expect(serialized).not.toContain("Harbor Lights");
  });

  it("keeps different genres apart even when their coarse contexts match", () => {
    const sharedContext = { localHourBucket: "evening", weekdayKind: "weekday" };
    const lanes = computeListeningLanes([
      ...twoSessions("Soul", "Warm", sharedContext),
      ...twoSessions("Dancehall", "Club", sharedContext),
    ], NOW);

    expect(lanes).toHaveLength(2);
    expect(lanes.every((lane) => Object.keys(lane.contexts).includes("evening:weekday"))).toBe(true);
  });

  it("requires two distinct sessions and at least the configured decayed evidence", () => {
    expect(computeListeningLanes([signal()], NOW)).toEqual([]);
    expect(computeListeningLanes([
      signal({ sessionKey: "one-browser-session" }),
      signal({ sessionKey: "one-browser-session" }),
    ], NOW)).toEqual([]);
    expect(computeListeningLanes([
      signal({ sessionKey: undefined }),
      signal({ sessionKey: undefined }),
    ], NOW)).toEqual([]);
  });

  it("matches the same catalog habit across different action weights and ages", () => {
    const lanes = computeListeningLanes([
      signal({ action: "complete", sessionKey: "completion-session", createdAt: NOW }),
      signal({ action: "purchase", sessionKey: "purchase-session", createdAt: new Date(NOW.getTime() - 180 * DAY_MS) }),
    ], NOW);

    expect(lanes).toHaveLength(1);
    expect(lanes[0].label).toBe("Soul · Warm");
    expect(lanes[0].genreWeights.Soul).toBeGreaterThan(2);
  });

  it("excludes history outside the 730-day window and at or before the reset marker", () => {
    const tooOld = new Date(NOW.getTime() - 731 * DAY_MS);
    expect(computeListeningLanes([
      ...twoSessions("Soul", "Warm", { createdAt: tooOld }),
    ], NOW)).toEqual([]);

    const resetAt = new Date(NOW.getTime() - DAY_MS);
    const resetPolicy = policy({ resetAt });
    expect(computeListeningLanes([
      signal({ sessionKey: "before-reset", createdAt: new Date(resetAt.getTime() - 1) }),
      signal({ sessionKey: "at-reset", createdAt: resetAt }),
    ], NOW, resetPolicy)).toEqual([]);

    const postReset = computeListeningLanes([
      signal({ sessionKey: "after-reset-a", createdAt: new Date(resetAt.getTime() + 1) }),
      signal({ sessionKey: "after-reset-b", createdAt: new Date(resetAt.getTime() + 1) }),
    ], NOW, resetPolicy);
    expect(postReset).toHaveLength(1);
    expect(postReset[0].genreWeights.Soul).toBeGreaterThan(2);
  });

  it("uses only the newest 500 signals within the history window", () => {
    const recentSignals = Array.from({ length: AGENT_TASTE_HISTORY_LIMIT }, (_, index) => signal({
      sessionKey: `recent-session-${index}`,
      genre: "Dancehall",
      moods: ["Club"],
      createdAt: new Date(NOW.getTime() - index * DAY_MS),
    }));
    const olderSignals = [
      signal({ sessionKey: "old-soul-a", genre: "Soul", createdAt: new Date(NOW.getTime() - 501 * DAY_MS) }),
      signal({ sessionKey: "old-soul-b", genre: "Soul", createdAt: new Date(NOW.getTime() - 502 * DAY_MS) }),
    ];

    const lanes = computeListeningLanes([...olderSignals, ...recentSignals], NOW);

    expect(lanes).toHaveLength(1);
    expect(Object.keys(lanes[0].genreWeights)).toEqual(["Dancehall"]);
  });

  it("canonicalizes catalog aliases and lets a hidden alias win over a canonical boost", () => {
    const lanes = computeListeningLanes([
      ...twoSessions("Hip Hop", "Warm"),
    ], NOW, policy({
      hidden: { genre: ["hip hop"] },
      boosted: { genre: ["Hip-Hop"] },
    }));

    expect(lanes).toEqual([]);
  });

  it("uses one downrank multiplier when an original alias is downranked and its canonical label is boosted", () => {
    const lanes = computeListeningLanes([
      ...twoSessions("Hip Hop", "Late-night", { action: "save" }),
    ], NOW, policy({
      downranked: { genre: ["Hip Hop"] },
      boosted: { genre: ["Hip-Hop"] },
    }));

    expect(lanes).toHaveLength(1);
    expect(lanes[0].genreWeights["Hip-Hop"]).toBeCloseTo(1.05 * 2, 8);
    expect(lanes[0].moodWeights["Late Night"]).toBe(6);
  });

  it("removes a hidden mood from all of its aliases without removing genre evidence", () => {
    const lanes = computeListeningLanes([
      signal({ sessionKey: "mood-a", moods: ["Warm", "Warmer"] }),
      signal({ sessionKey: "mood-b", moods: ["Warm"] }),
    ], NOW, policy({ hidden: { mood: ["warmer"] } }));

    expect(lanes).toHaveLength(1);
    expect(lanes[0].label).toBe("Soul");
    expect(lanes[0].genreWeights.Soul).toBe(3);
    expect(lanes[0].moodWeights).toEqual({});
  });

  it("excludes an entire signal when an artist alias is hidden", () => {
    const lanes = computeListeningLanes([
      ...twoSessions("Soul", "Warm", {
        artists: ["Harbor Lights Live"],
        artistAliases: { "Harbor Lights Live": ["Harbor Lights"] },
      }),
    ], NOW, policy({ hidden: { artist: ["Harbor Lights"] } }));

    expect(lanes).toEqual([]);
  });

  it("lets negative evidence reduce a matching lane without creating a lane of its own", () => {
    const survivingLane = computeListeningLanes([
      signal({ action: "save", sessionKey: "positive-a" }),
      signal({ action: "save", sessionKey: "positive-b" }),
      signal({ action: "unsave", sessionKey: "negative-c" }),
    ], NOW);

    expect(survivingLane).toHaveLength(1);
    expect(survivingLane[0].genreWeights.Soul).toBe(4);
    expect(survivingLane[0].moodWeights.Warm).toBe(4);

    const cancelledLane = computeListeningLanes([
      signal({ action: "complete", sessionKey: "positive-a" }),
      signal({ action: "complete", sessionKey: "positive-b" }),
      signal({ action: "unsave", weight: -5, sessionKey: "negative-c" }),
    ], NOW);
    expect(cancelledLane).toEqual([]);

    expect(computeListeningLanes([
      signal({ action: "unsave", sessionKey: "negative-a" }),
      signal({ action: "unsave", sessionKey: "negative-b" }),
    ], NOW)).toEqual([]);
  });

  it("uses measured energy only and caps results at six catalog lanes", () => {
    const measured = [
      signal({ sessionKey: "energy-a", audioFeatures: { energy: 0.82, energySource: "measured" } }),
      signal({ sessionKey: "energy-b", audioFeatures: { energy: 0.2, energySource: "inferred" } }),
    ];
    const measuredLane = computeListeningLanes(measured, NOW);
    expect(measuredLane[0].energyBand).toBe("high");

    const genres = ["Acid House", "Acid Jazz", "Acoustic", "Afro-Pop", "Afrobeat", "Amapiano", "Alternative", "Ambient"];
    const manyLanes = computeListeningLanes(genres.flatMap((genre) => twoSessions(genre, undefined)), NOW);
    expect(manyLanes).toHaveLength(6);
    expect(manyLanes.every((lane) => Object.keys(lane.genreWeights).every((value) => TASTE_EDIT_GENRES.includes(value)))).toBe(true);
    expect(manyLanes.every((lane) => lane.strength >= 0 && lane.strength <= 1)).toBe(true);
    expect(manyLanes.reduce((sum, lane) => sum + lane.strength, 0)).toBeLessThanOrEqual(1);
    expect(manyLanes.every((lane) => !lane.label.includes("browser") && !lane.label.includes("track_secret"))).toBe(true);
  });
});

function twoSessions(
  genre: string,
  mood?: string,
  extras: Partial<AgentTasteSignalInput> = {},
) {
  sessionPairNumber += 1;
  return [`browser_session_secret_${sessionPairNumber}_a`, `browser_session_secret_${sessionPairNumber}_b`].map((sessionKey) => signal({
    sessionKey,
    genre,
    moods: mood ? [mood] : [],
    ...extras,
  }));
}

function signal(overrides: Partial<AgentTasteSignalInput> = {}): AgentTasteSignalInput {
  trackNumber += 1;
  return {
    action: "complete",
    trackId: `track_secret_${trackNumber}`,
    sessionKey: `browser_session_secret_${trackNumber}`,
    createdAt: NOW,
    genre: "Soul",
    moods: ["Warm"],
    localHourBucket: "evening",
    weekdayKind: "weekday",
    ...overrides,
  };
}

function policy(options: {
  resetAt?: Date;
  hidden?: Partial<Record<TasteSignalType, string[]>>;
  downranked?: Partial<Record<TasteSignalType, string[]>>;
  boosted?: Partial<Record<TasteSignalType, string[]>>;
} = {}): TasteMemoryPolicy {
  const toMap = (controls: Partial<Record<TasteSignalType, string[]>>) => {
    const result = new Map<TasteSignalType, Set<string>>();
    for (const [type, values] of Object.entries(controls)) {
      if (values) result.set(type as TasteSignalType, new Set(values.map((value) => value.trim().toLowerCase())));
    }
    return result;
  };
  return {
    settings: {
      socialMatchingEnabled: false,
      citySceneDiscoveryEnabled: false,
      agentPlaybackTrainingEnabled: true,
      recommendationExplanationPreference: "balanced",
      resetAt: options.resetAt?.toISOString() ?? null,
    },
    ...(options.resetAt ? { resetAt: options.resetAt } : {}),
    hidden: toMap(options.hidden ?? {}),
    downranked: toMap(options.downranked ?? {}),
    boosted: toMap(options.boosted ?? {}),
  };
}
