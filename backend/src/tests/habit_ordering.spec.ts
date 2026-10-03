import {
  AGENT_BEHAVIORAL_HALF_LIFE_DAYS,
} from "../config/agent_learning";
import { HABIT_ORDERING_SHORT_RUN_MAX } from "../config/habit_ordering";
import {
  deriveHabitOrderingState,
  HabitEnergyBand,
  HabitOrderTrack,
  HabitOrderingObservation,
  HabitOrderingState,
  orderHabitTracks,
} from "../modules/agents/habit_ordering";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("deriveHabitOrderingState", () => {
  it("aggregates adjacent episodes deterministically and returns no track or session identifiers", () => {
    const history = [
      ...episode("first", "lane_a", NOW, { sessionKey: "browser_session_secret" }),
      ...episode("second", "lane_b", NOW, { sessionKey: "browser_session_secret", outcome: "complete" }),
    ];

    const state = deriveHabitOrderingState(history, NOW);
    expect(state.transitions).toEqual([{ fromLaneId: "lane_a", toLaneId: "lane_b", good: 1, bad: 0, largeEnergyGood: 0 }]);
    expect(deriveHabitOrderingState([...history].reverse(), NOW)).toEqual(state);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("track_secret");
    expect(serialized).not.toContain("browser_session_secret");
  });

  it("sorts simultaneous starts by stable ID and keeps duplicate starts and outcomes to one count", () => {
    const startA = observation("a-start", "start", NOW, {
      trackId: "track_a", laneId: "lane_a", playbackInstanceId: "instance-a",
    });
    const startB = observation("b-start", "start", NOW, {
      trackId: "track_b", laneId: "lane_b", playbackInstanceId: "instance-b",
    });
    const startBDuplicate = observation("b-start-copy", "start", NOW, {
      trackId: "track_b", laneId: "lane_b", playbackInstanceId: "instance-b",
    });
    const firstOutcome = observation("b-complete", "complete", NOW, {
      trackId: "track_b", playbackInstanceId: "instance-b",
    });
    const duplicateOutcome = observation("b-replay", "replay", new Date(NOW.getTime() + 1), {
      trackId: "track_b", playbackInstanceId: "instance-b",
    });

    const state = deriveHabitOrderingState([
      startB, duplicateOutcome, startA, firstOutcome, startBDuplicate, firstOutcome,
    ], new Date(NOW.getTime() + 1));
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]).toMatchObject({ fromLaneId: "lane_a", toLaneId: "lane_b", bad: 0, largeEnergyGood: 0 });
    expect(state.transitions[0].good).toBeCloseTo(1, 8);
  });

  it("counts one transition per destination episode, gives early measured skips precedence, and ignores non-early skips", () => {
    const rows = [
      ...episode("a1", "lane_a", NOW),
      ...episode("b1", "lane_b", at(1), { outcome: "complete" }),
      ...episode("a2", "lane_a", at(2), { outcome: "complete" }),
      ...episode("b2", "lane_b", at(3), { outcome: "skip", positionMs: 25_000, durationMs: 120_000 }),
      observation("b2-complete", "complete", at(4), { trackId: "track_b2", playbackInstanceId: "instance_b2" }),
      ...episode("a3", "lane_a", at(5)),
      ...episode("b3", "lane_b", at(6), { outcome: "skip", positionMs: 30_000, durationMs: 100_000 }),
    ];

    const state = deriveHabitOrderingState(rows, at(6));
    expect(state.transitions).toHaveLength(2);
    expect(state.transitions[0]).toMatchObject({ fromLaneId: "lane_a", toLaneId: "lane_b", largeEnergyGood: 0 });
    expect(state.transitions[0].good).toBeCloseTo(1, 5);
    expect(state.transitions[0].bad).toBeCloseTo(1, 5);
    expect(state.transitions[1]).toMatchObject({ fromLaneId: "lane_b", toLaneId: "lane_a", bad: 0, largeEnergyGood: 0 });
    expect(state.transitions[1].good).toBeCloseTo(1, 5);

    const thresholdSkip = deriveHabitOrderingState([
      ...episode("a", "lane_a", NOW),
      ...episode("b", "lane_b", at(1), { outcome: "skip", positionMs: 30_000, durationMs: 120_000 }),
    ], at(1));
    expect(thresholdSkip.transitions[0]).toMatchObject({ fromLaneId: "lane_a", toLaneId: "lane_b", good: 0, largeEnergyGood: 0 });
    expect(thresholdSkip.transitions[0].bad).toBeCloseTo(1, 5);
  });

  it("attaches delayed identified outcomes, rejects late anonymous outcomes, and does not bridge unknown lanes or sessions", () => {
    const identified = [
      ...episode("id-a", "lane_a", NOW, { sessionKey: "identified" }),
      ...episode("id-b", "lane_b", at(1), { sessionKey: "identified", outcome: null }),
      ...episode("id-c", "lane_c", at(2), { sessionKey: "identified" }),
      observation("late-b-complete", "complete", at(3), {
        sessionKey: "identified", trackId: "track_id-b", playbackInstanceId: "instance_id-b",
      }),
    ];
    const anonymous = [
      ...episode("anon-a", "lane_a", NOW, { sessionKey: "anonymous", withInstance: false }),
      ...episode("anon-b", "lane_b", at(1), { sessionKey: "anonymous", outcome: null, withInstance: false }),
      ...episode("anon-c", "lane_c", at(2), { sessionKey: "anonymous", withInstance: false }),
      observation("late-anon-b-complete", "complete", at(3), {
        sessionKey: "anonymous", trackId: "track_anon-b",
      }),
    ];
    const brokenChain = [
      ...episode("broken-a", "lane_a", NOW, { sessionKey: "broken" }),
      ...episode("broken-gap", undefined, at(1), { sessionKey: "broken" }),
      ...episode("broken-b", "lane_b", at(2), { sessionKey: "broken" }),
      ...episode("other-session", "lane_c", at(3), { sessionKey: "different" }),
    ];

    const state = deriveHabitOrderingState([...identified, ...anonymous, ...brokenChain], at(3));
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]).toMatchObject({ fromLaneId: "lane_a", toLaneId: "lane_b", bad: 0, largeEnergyGood: 0 });
    expect(state.transitions[0].good).toBeCloseTo(1, 5);
  });

  it("decays transition evidence with the shared behavioral half-life and caps history to the shared limit", () => {
    const halfLife = [...episode("old-a", "lane_a", daysAgo(AGENT_BEHAVIORAL_HALF_LIFE_DAYS + 0.001)),
      ...episode("old-b", "lane_b", daysAgo(AGENT_BEHAVIORAL_HALF_LIFE_DAYS), { outcome: "complete" })];
    const recent = [
      ...episode("new-a", "lane_a", at(1)),
      ...episode("new-b", "lane_b", at(2), { outcome: "complete" }),
    ];
    const state = deriveHabitOrderingState([...halfLife, ...recent], at(2));
    expect(state.transitions[0].good).toBeCloseTo(1.5, 3);

    const many = Array.from({ length: 500 }, (_, index) => observation(
      `history-${index}`,
      "start",
      new Date(NOW.getTime() - (500 - index) * 1000),
      { trackId: `history-track-${index}`, sessionKey: `history-session-${index}`, laneId: "lane_x" },
    ));
    const capped = deriveHabitOrderingState([
      ...episode("evicted-a", "lane_a", daysAgo(1)),
      ...episode("evicted-b", "lane_b", new Date(daysAgo(1).getTime() + 1), { outcome: "complete" }),
      ...many,
    ], NOW);
    expect(capped.transitions).toEqual([]);
  });

  it("reports the latest current-agent boundary and trailing same-lane run only", () => {
    const state = deriveHabitOrderingState([
      ...episode("earlier-agent", "lane_a", at(1), { agentSessionId: "agent-old" }),
      ...episode("current-1", "lane_b", at(2), { agentSessionId: "agent-current", energyBand: "low", energySource: "measured" }),
      ...episode("current-2", "lane_b", at(3), { agentSessionId: "agent-current", energyBand: "medium", energySource: "inferred" }),
    ], at(3), "agent-current");

    expect(state.previous).toEqual({ laneId: "lane_b", runLength: 2 });
    expect(deriveHabitOrderingState([
      ...episode("lane-start", "lane_b", at(1), { agentSessionId: "agent-current" }),
      ...episode("hidden-latest", undefined, at(2), { agentSessionId: "agent-current", energyBand: "high", energySource: "measured" }),
    ], at(2), "agent-current").previous).toEqual({ energyBand: "high", runLength: 0 });
  });

  it("inherits a missing start agent tag from its matched outcome and rejects older outcomes", () => {
    const current = episode("untagged-start", "lane_b", at(2), { outcome: null });
    const taggedOutcome = observation("tagged-complete", "complete", at(3), {
      trackId: "track_untagged-start",
      playbackInstanceId: "instance_untagged-start",
      agentSessionId: "agent-current",
    });
    const tagged = deriveHabitOrderingState([...current, taggedOutcome], at(3), "agent-current");
    expect(tagged.previous).toEqual({ laneId: "lane_b", runLength: 1 });

    const beforeStart = observation("early-complete", "complete", at(1), {
      trackId: "track_untagged-start",
      playbackInstanceId: "instance_untagged-start",
      agentSessionId: "agent-current",
    });
    expect(deriveHabitOrderingState([...current, beforeStart], at(3), "agent-current").previous).toBeUndefined();
  });

  it("does not carry a DJ boundary across a later untagged browser-session start", () => {
    const state = deriveHabitOrderingState([
      ...episode("dj-start", "lane_a", at(1), { agentSessionId: "agent-current" }),
      ...episode("listener-start", "lane_b", at(2)),
    ], at(2), "agent-current");

    expect(state.previous).toBeUndefined();
  });

  it("does not attach a legacy outcome after the same track started more than once", () => {
    const sessionKey = "legacy-browser";
    const repeatedTrackId = "track_repeated";
    const rows = [
      observation("repeat-a1", "start", at(1), { sessionKey, trackId: repeatedTrackId, laneId: "lane_a" }),
      observation("repeat-b", "start", at(2), { sessionKey, trackId: "track_b", laneId: "lane_b" }),
      observation("repeat-a2", "start", at(3), { sessionKey, trackId: repeatedTrackId, laneId: "lane_a" }),
      observation("late-repeat-complete", "complete", at(4), {
        sessionKey,
        trackId: repeatedTrackId,
        agentSessionId: "agent-current",
      }),
    ];

    const state = deriveHabitOrderingState(rows, at(4), "agent-current");
    expect(state.transitions).toEqual([]);
    expect(state.previous).toBeUndefined();
  });

  it("uses only measured endpoints for large-energy evidence and requires its evidence/share thresholds", () => {
    const measured = [
      ...episode("measured-a", "lane_a", NOW, { energyBand: "low", energySource: "measured" }),
      ...episode("measured-b", "lane_b", at(1), { outcome: "complete", energyBand: "high", energySource: "measured" }),
      ...episode("inferred-a", "lane_a", at(2), { energyBand: "low", energySource: "inferred" }),
      ...episode("inferred-b", "lane_b", at(3), { outcome: "complete", energyBand: "high", energySource: "measured" }),
    ];
    const state = deriveHabitOrderingState(measured, at(3));
    expect(state.transitions[0]).toMatchObject({ fromLaneId: "lane_a", toLaneId: "lane_b", bad: 0 });
    expect(state.transitions[0].good).toBeCloseTo(2, 5);
    expect(state.transitions[0].largeEnergyGood).toBeCloseTo(1, 5);
  });
});

describe("orderHabitTracks", () => {
  it("returns the same descriptor objects as a stable permutation, retaining duplicate IDs", () => {
    const lowerRank: HabitOrderTrack = { id: "same-id", rank: 1, laneId: "lane_a" };
    const higherRank: HabitOrderTrack = { id: "same-id", rank: 2, laneId: "lane_b" };
    const result = orderHabitTracks([higherRank, lowerRank], emptyState(), { lane_a: 1, lane_b: 1 });

    expect(orderHabitTracks([], emptyState(), {})).toEqual([]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(lowerRank);
    expect(result[1]).toBe(higherRank);
    expect(new Set(result).size).toBe(2);
  });

  it("prefers lane strength below the global learning threshold, with measured continuity and rank as ties", () => {
    const tracks: HabitOrderTrack[] = [
      { id: "b-first", rank: 0, laneId: "lane_b" },
      { id: "a-second", rank: 1, laneId: "lane_a" },
    ];
    const belowThreshold = stateWith([{ fromLaneId: "lane_prev", toLaneId: "lane_b", good: 2, bad: 0, largeEnergyGood: 0 }]);
    expect(orderHabitTracks(tracks, belowThreshold, { lane_a: 0.9, lane_b: 0.2 })).toEqual([tracks[1], tracks[0]]);
    const energyCandidates: HabitOrderTrack[] = [
      { id: "inferred", rank: 0, laneId: "lane_equal", energyBand: "high", energySource: "inferred" },
      { id: "measured", rank: 1, laneId: "lane_equal", energyBand: "low", energySource: "measured" },
    ];
    const boundary = { transitions: [], previous: { laneId: "lane_equal", energyBand: "medium" as const, runLength: 0 } };
    expect(orderHabitTracks(energyCandidates, boundary, { lane_equal: 0.5 })[0]).toBe(energyCandidates[1]);
  });

  it("treats a sub-threshold pair as neutral even when other pairs unlock learned ordering", () => {
    const tracks: HabitOrderTrack[] = [
      { id: "weak-pair", rank: 0, laneId: "lane_b" },
      { id: "strong-unknown", rank: 1, laneId: "lane_c" },
    ];
    const state = stateWith([
      { fromLaneId: "lane_a", toLaneId: "lane_b", good: 0.5, bad: 0, largeEnergyGood: 0 },
      { fromLaneId: "other-a", toLaneId: "other-b", good: 3, bad: 0, largeEnergyGood: 0 },
    ], { laneId: "lane_a", runLength: 3 });

    expect(orderHabitTracks(tracks, state, { lane_b: 0.2, lane_c: 0.9 })).toEqual([tracks[1], tracks[0]]);
  });

  it("continues short lane runs, switches after the target, and extends only to the configured maximum without an alternative", () => {
    const sameLane: HabitOrderTrack[] = [
      { id: "a-1", rank: 0, laneId: "lane_a" },
      { id: "a-2", rank: 1, laneId: "lane_a" },
      { id: "b-1", rank: 2, laneId: "lane_b" },
    ];
    const shortBoundary = stateWith([], { laneId: "lane_a", runLength: 2 });
    expect(orderHabitTracks(sameLane, shortBoundary, { lane_a: 0.2, lane_b: 1 }).map((track) => track.id))
      .toEqual(["a-1", "a-2", "b-1"]);

    const maxBoundary = stateWith([], { laneId: "lane_a", runLength: HABIT_ORDERING_SHORT_RUN_MAX });
    const oneLane = sameLane.slice(0, 2);
    expect(orderHabitTracks(oneLane, maxBoundary, { lane_a: 1 }).map((track) => track.id))
      .toEqual(["a-1", "a-2"]);
  });

  it("filters measured abrupt jumps before strength and rank when a compatible alternative exists", () => {
    const tracks: HabitOrderTrack[] = [
      { id: "strong-abrupt", rank: 0, laneId: "lane_strong", energyBand: "high", energySource: "measured" },
      { id: "weaker-compatible", rank: 1, laneId: "lane_compatible", energyBand: "medium", energySource: "measured" },
    ];
    const state = stateWith([], { laneId: "lane_previous", energyBand: "low", runLength: HABIT_ORDERING_SHORT_RUN_MAX });

    expect(orderHabitTracks(tracks, state, { lane_strong: 1, lane_compatible: 0.1 })[0]).toBe(tracks[1]);
  });

  it("keeps an energy-safe negative transition rather than selecting an unproven abrupt jump", () => {
    const tracks: HabitOrderTrack[] = [
      { id: "negative-compatible", rank: 1, laneId: "lane_safe", energyBand: "medium", energySource: "measured" },
      { id: "unknown-abrupt", rank: 0, laneId: "lane_abrupt", energyBand: "high", energySource: "measured" },
    ];
    const state = stateWith([
      { fromLaneId: "lane_previous", toLaneId: "lane_safe", good: 0, bad: 3, largeEnergyGood: 0 },
      { fromLaneId: "elsewhere", toLaneId: "other", good: 1, bad: 0, largeEnergyGood: 0 },
    ], { laneId: "lane_previous", energyBand: "low", runLength: HABIT_ORDERING_SHORT_RUN_MAX });

    expect(orderHabitTracks(tracks, state, { lane_safe: 0.1, lane_abrupt: 1 })[0]).toBe(tracks[0]);
  });

  it("avoids a repeatedly early-skipped lane when a nonnegative alternative exists", () => {
    const skippedPair = { fromLaneId: "lane_a", toLaneId: "lane_b", good: 0, bad: 3, largeEnergyGood: 0 };
    const state = stateWith([
      skippedPair,
      { fromLaneId: "other_a", toLaneId: "other_b", good: 1, bad: 0, largeEnergyGood: 0 },
    ], { laneId: "lane_a", runLength: 3 });
    const tracks: HabitOrderTrack[] = [
      { id: "habitually-skipped", rank: 0, laneId: "lane_b" },
      { id: "neutral", rank: 1, laneId: "lane_c" },
    ];

    expect(orderHabitTracks(tracks, state, { lane_b: 1, lane_c: 0.1 })[0]).toBe(tracks[1]);
  });

  it("lets sufficiently proven measured large jumps pass energy continuity while unmeasured jumps stay neutral", () => {
    const tracks: HabitOrderTrack[] = [
      { id: "measured-jump", rank: 0, laneId: "lane_b", energyBand: "high", energySource: "measured" },
      { id: "unmeasured", rank: 1, laneId: "lane_c", energyBand: "high", energySource: "inferred" },
    ];
    const state = stateWith([
      { fromLaneId: "lane_a", toLaneId: "lane_b", good: 3, bad: 1, largeEnergyGood: 3 },
      { fromLaneId: "lane_a", toLaneId: "lane_c", good: 3, bad: 1, largeEnergyGood: 0 },
    ], { laneId: "lane_a", energyBand: "low", runLength: 3 });

    expect(orderHabitTracks(tracks, state, { lane_b: 0.5, lane_c: 0.5 })[0]).toBe(tracks[0]);
  });
});

function emptyState(): HabitOrderingState {
  return { transitions: [] };
}

function stateWith(
  transitions: HabitOrderingState["transitions"],
  previous?: HabitOrderingState["previous"],
): HabitOrderingState {
  return { transitions, ...(previous ? { previous } : {}) };
}

function episode(
  name: string,
  laneId: string | undefined,
  createdAt: Date,
  options: {
    sessionKey?: string;
    outcome?: "complete" | "replay" | "save" | "skip" | null;
    positionMs?: number;
    durationMs?: number;
    playbackInstanceId?: string;
    withInstance?: boolean;
    agentSessionId?: string;
    energyBand?: HabitEnergyBand;
    energySource?: string;
  } = {},
): HabitOrderingObservation[] {
  const sessionKey = options.sessionKey ?? "browser_session";
  const trackId = `track_${name}`;
  const instanceId = options.playbackInstanceId ?? `instance_${name}`;
  const identity = options.withInstance === false ? {} : { playbackInstanceId: instanceId };
  const shared = {
    sessionKey,
    trackId,
    ...(laneId ? { laneId } : {}),
    ...(options.agentSessionId ? { agentSessionId: options.agentSessionId } : {}),
    ...(options.energyBand ? { energyBand: options.energyBand } : {}),
    ...(options.energySource ? { energySource: options.energySource } : {}),
    ...identity,
  };
  const start = observation(`${name}-start`, "start", createdAt, shared);
  if (!options.outcome) return [start];
  const outcome = observation(`${name}-${options.outcome}`, options.outcome, createdAt, {
    sessionKey,
    trackId,
    ...(options.agentSessionId ? { agentSessionId: options.agentSessionId } : {}),
    ...(options.withInstance === false ? {} : { playbackInstanceId: instanceId }),
    ...(options.positionMs !== undefined ? { positionMs: options.positionMs } : {}),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
  });
  return [start, outcome];
}

function observation(
  id: string,
  action: string,
  createdAt: Date,
  extras: Partial<HabitOrderingObservation> = {},
): HabitOrderingObservation {
  return {
    id,
    sessionKey: extras.sessionKey ?? "browser_session",
    trackId: extras.trackId ?? `track_secret_${id}`,
    createdAt,
    action,
    ...extras,
  };
}

function at(seconds: number): Date {
  return new Date(NOW.getTime() + seconds * 1000);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}
