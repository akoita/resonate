import {
  evaluateHabitMixOffline,
  HabitMixCatalogRow,
  HabitMixSignalMartRow,
} from "../modules/recommendations/habit_mix_offline_eval";

const CUTOFF = new Date("2026-06-01T00:00:00.000Z");
const beforeCutoff = (days: number) => new Date(CUTOFF.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const atCutoff = CUTOFF.toISOString();

function row(input: {
  user?: string;
  track: string;
  action: string;
  at: string;
  session?: string;
  weight?: number;
  eventId?: string;
}): HabitMixSignalMartRow {
  return {
    user_id: input.user ?? "user-private-1",
    track_id: input.track,
    action: input.action,
    signal_weight: input.weight,
    occurred_at: input.at,
    session_key: input.session,
    event_id: input.eventId,
  };
}

function martRow(input: {
  user?: string;
  track: string;
  eventName: string;
  signalType: string;
  at: string;
  session?: string;
  completionRatio?: number;
  weight?: number;
  eventId?: string;
  payload?: Record<string, unknown>;
}): HabitMixSignalMartRow {
  return {
    user_id: input.user ?? "user-private-1",
    track_id: input.track,
    event_name: input.eventName,
    event_id: input.eventId,
    signal_type: input.signalType,
    signal_weight: input.weight,
    completion_ratio: input.completionRatio,
    occurred_at: input.at,
    session_id: input.session,
    payload: input.payload,
  };
}

function catalog(
  id: string,
  genre: string,
  moods: string[],
  artistId = `artist-${id}`,
  aiDisclosureLevel?: string,
): HabitMixCatalogRow {
  return { id, genre, moods, artistId, ...(aiDisclosureLevel ? { aiDisclosureLevel } : {}) };
}

function options(k = 2) {
  return { cutoff: CUTOFF, k, maxUsers: 500 };
}

describe("habit mix explicit-cutoff offline replay", () => {
  it("uses production lanes and lane quotas to improve over tied genre-only ranking", () => {
    const signals = [
      martRow({ track: "deep-train-a", eventName: "playback.completed", signalType: "strong_play", at: beforeCutoff(2), session: "session-a", completionRatio: 0.9, eventId: "evt-a", payload: { localHourBucket: "evening", weekdayKind: "weekday" } }),
      martRow({ track: "deep-train-b", eventName: "playback.completed", signalType: "strong_play", at: beforeCutoff(1), session: "session-b", completionRatio: 0.9, eventId: "evt-b", payload: { localHourBucket: "evening", weekdayKind: "weekday" } }),
      martRow({ track: "dance-train-a", eventName: "playback.completed", signalType: "strong_play", at: beforeCutoff(2), session: "session-c", completionRatio: 0.9, eventId: "evt-c", payload: { localHourBucket: "night", weekdayKind: "weekend" } }),
      martRow({ track: "dance-train-b", eventName: "playback.completed", signalType: "strong_play", at: beforeCutoff(1), session: "session-d", completionRatio: 0.9, eventId: "evt-d", payload: { localHourBucket: "night", weekdayKind: "weekend" } }),
      martRow({ track: "z-dance-target", eventName: "library.saved", signalType: "save", at: atCutoff, weight: 3, eventId: "evt-save" }),
    ];
    const tracks = [
      catalog("deep-train-a", "Deep House", ["Warm"]),
      catalog("deep-train-b", "Deep House", ["Warm"]),
      catalog("dance-train-a", "Dancehall", ["Club"]),
      catalog("dance-train-b", "Dancehall", ["Club"]),
      catalog("a-deep-candidate", "Deep House", ["Warm"]),
      catalog("b-deep-candidate", "Deep House", ["Warm"]),
      catalog("z-dance-target", "Dancehall", ["Club"]),
    ];

    const report = evaluateHabitMixOffline({ signals, catalog: tracks, options: options(2) });

    expect(report.sample.trainingSignals).toBe(4);
    expect(report.sample.targetEvents).toBe(1);
    expect(report.sample.laneUsers).toBe(1);
    expect(report.sample.noLaneUsers).toBe(0);
    expect(report.rankers.myMixLanes.recallAtK).toBe(1);
    expect(report.rankers.genreOnlyV1.recallAtK).toBe(0);
    expect(report.rankers.myMixLanes.ndcgAtK).toBeGreaterThan(report.rankers.genreOnlyV1.ndcgAtK ?? -1);
    expect(report.rankers.genreOnlyV1.ndcgAtK).toBe(0);
    expect(JSON.stringify(report)).not.toContain("user-private-1");
    expect(JSON.stringify(report)).not.toContain("session-a");
  });

  it("keeps the boundary target out of training and excludes accept and purchase targets", () => {
    const report = evaluateHabitMixOffline({
      signals: [
        martRow({ track: "prior", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.9, at: beforeCutoff(0.000001), session: "old-session" }),
        martRow({ track: "boundary-complete", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.8, at: atCutoff }),
        martRow({ track: "boundary-save", eventName: "library.saved", signalType: "save", at: atCutoff }),
        martRow({ track: "boundary-playlist-save", eventName: "playlist.track_added", signalType: "save", at: atCutoff }),
        martRow({ track: "partial-play", eventName: "playback.completed", signalType: "partial_play", completionRatio: 0.79, at: atCutoff }),
        row({ track: "boundary-accept", action: "accept", at: atCutoff }),
        row({ track: "boundary-purchase", action: "purchase", at: atCutoff }),
        row({ track: "boundary-replay", action: "replay", at: atCutoff, weight: 2 }),
      ],
      catalog: [
        catalog("prior", "Deep House", ["Warm"]),
        catalog("boundary-complete", "Deep House", ["Warm"]),
        catalog("boundary-save", "Deep House", ["Warm"]),
        catalog("boundary-playlist-save", "Deep House", ["Warm"]),
        catalog("partial-play", "Deep House", ["Warm"]),
        catalog("boundary-accept", "Deep House", ["Warm"]),
        catalog("boundary-purchase", "Deep House", ["Warm"]),
        catalog("boundary-replay", "Deep House", ["Warm"]),
      ],
      options: options(),
    });

    expect(report.sample.trainingSignals).toBe(1);
    expect(report.sample.targetEvents).toBe(3);
    expect(report.sample.targetTracks).toBe(3);
    expect(report.sample.reachableTargets).toBe(3);
    expect(report.sample.noLaneUsers).toBe(1);
  });

  it("reports unavailable and train-seen held-out positives as unreachable with an empty catalog", () => {
    const report = evaluateHabitMixOffline({
      signals: [
        martRow({ track: "only-seen", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.9, at: beforeCutoff(1), session: "prior-session" }),
        martRow({ track: "only-seen", eventName: "library.saved", signalType: "save", at: atCutoff }),
        martRow({ track: "missing-from-catalog", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.9, at: atCutoff }),
      ],
      catalog: [],
      options: options(),
    });

    expect(report.sample.targetTracks).toBe(2);
    expect(report.sample.reachableTargets).toBe(0);
    expect(report.sample.unreachableTargets).toBe(2);
    expect(report.sample.noLaneUsers).toBe(1);
    expect(report.sample.rankableUsers).toBe(0);
    expect(report.rankers.myMixLanes.recallAtK).toBeNull();
    expect(report.rankers.genreOnlyV1.ndcgAtK).toBeNull();
  });

  it("excludes fully AI targets from reachability while leaving missing disclosure eligible", () => {
    const signals = [
      martRow({ user: "ai-user", track: "ai-train-a", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.9, weight: 2, at: beforeCutoff(2), session: "ai-session-a" }),
      martRow({ user: "ai-user", track: "ai-train-b", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.9, weight: 2, at: beforeCutoff(1), session: "ai-session-b" }),
      martRow({ user: "ai-user", track: "fully-ai-target", eventName: "library.saved", signalType: "save", at: atCutoff }),
      martRow({ user: "unknown-user", track: "unknown-train-a", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.9, weight: 2, at: beforeCutoff(2), session: "unknown-session-a" }),
      martRow({ user: "unknown-user", track: "unknown-train-b", eventName: "playback.completed", signalType: "strong_play", completionRatio: 0.9, weight: 2, at: beforeCutoff(1), session: "unknown-session-b" }),
      martRow({ user: "unknown-user", track: "undisclosed-target", eventName: "library.saved", signalType: "save", at: atCutoff }),
    ];
    const tracks = [
      catalog("ai-train-a", "Deep House", ["Warm"], undefined, "PARTLY"),
      catalog("ai-train-b", "Deep House", ["Warm"], undefined, "PARTLY"),
      catalog("unknown-train-a", "Dancehall", ["Club"], undefined, "PARTLY"),
      catalog("unknown-train-b", "Dancehall", ["Club"], undefined, "PARTLY"),
      { ...catalog("fully-ai-target", "Deep House", ["Warm"]), aiDisclosureLevel: "ALL" },
      catalog("undisclosed-target", "Dancehall", ["Club"]),
    ];

    const report = evaluateHabitMixOffline({ signals, catalog: tracks, options: options(1) });

    expect(report.sample.catalogTracks).toBe(6);
    expect(report.sample.eligibleCatalogTracks).toBe(5);
    expect(report.sample.targetTracks).toBe(2);
    expect(report.sample.reachableTargets).toBe(1);
    expect(report.sample.unreachableTargets).toBe(1);
    expect(report.sample.rankableUsers).toBe(1);
    expect(report.rankers.myMixLanes.recallAtK).toBe(1);
    expect(report.note).toContain("missing disclosure remains unspecified");
  });

  it("excludes every pre-cutoff track even when its old signal falls outside the learning cap", () => {
    const oldTrain = Array.from({ length: 501 }, (_, index) => row({
      user: "capped-user",
      track: index === 0 ? "old-seen-track" : `recent-${index}`,
      action: "accept",
      at: new Date(CUTOFF.getTime() - (502 - index) * 1_000).toISOString(),
    }));
    const report = evaluateHabitMixOffline({
      signals: [
        ...oldTrain,
        martRow({ user: "capped-user", track: "old-seen-track", eventName: "library.saved", signalType: "save", at: atCutoff }),
      ],
      catalog: [catalog("old-seen-track", "Deep House", ["Warm"])],
      options: options(),
    });

    expect(report.sample.trainingSignals).toBe(500);
    expect(report.sample.targetTracks).toBe(1);
    expect(report.sample.reachableTargets).toBe(0);
    expect(report.sample.unreachableTargets).toBe(1);
  });

  it("caps users and per-user mart signals with bounded constants", () => {
    const users = Array.from({ length: 502 }, (_, index) => row({
      user: `user-${String(index).padStart(4, "0")}`,
      track: `track-${index}`,
      action: "accept",
      at: beforeCutoff(1),
    }));
    const manyForOne = Array.from({ length: 502 }, (_, index) => row({
      user: "one-user",
      track: `single-${index}`,
      action: "accept",
      at: new Date(CUTOFF.getTime() - (502 - index) * 1000).toISOString(),
    }));
    const targetsForOne = Array.from({ length: 502 }, (_, index) => martRow({
      user: "one-user",
      track: `future-${index}`,
      eventName: "library.saved",
      signalType: "save",
      at: new Date(CUTOFF.getTime() + index * 1000).toISOString(),
      eventId: `future-event-${index}`,
    }));
    const report = evaluateHabitMixOffline({
      signals: [...users, ...manyForOne, ...targetsForOne],
      catalog: [],
      options: { cutoff: CUTOFF, k: 2, maxUsers: 900 },
    });

    expect(report.sample.users).toBe(500);
    expect(report.sample.signals).toBeLessThanOrEqual(500 * 1_000);
    expect(report.sample.signals).toBe(1_499);
    expect(report.sample.trainingSignals).toBe(999);
    expect(report.sample.targetEvents).toBe(500);
  });
});
