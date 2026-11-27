import {
  aggregateListeningStats,
  COUNTED_PLAY_MS,
  listenedMsOf,
  type PlaySignalRow,
  type StatsTrackInfo,
} from "../modules/listening_stats/listening_stats.aggregate";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function track(id: string, artist: string, extra: Partial<StatsTrackInfo> = {}): StatsTrackInfo {
  return {
    trackId: id,
    title: `Track ${id}`,
    artistKey: `id:${artist}`,
    artistId: artist,
    artistName: `Artist ${artist}`,
    releaseId: `release-${id}`,
    releaseTitle: `Release ${id}`,
    artworkUrl: null,
    hasUploadedArtwork: false,
    artworkRevision: 1,
    genre: "House",
    moods: ["Warm"],
    available: true,
    ...extra,
  };
}

function play(trackId: string, at: Date, outcome: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): PlaySignalRow {
  return {
    trackId,
    action: "complete",
    createdAt: at,
    metadata: {
      localHourBucket: "evening",
      weekdayKind: "weekday",
      outcome: { durationMs: 200_000, completionRatio: 0.5, ...outcome },
      ...extra,
    },
  };
}

const base = {
  windowDays: 7 as const,
  now: NOW,
  recording: true,
  truncated: false,
  saves: 0,
  artistKeysBefore: new Set<string>(),
};

describe("listening stats aggregation", () => {
  it("estimates listened time from the recorded ratio, never below a counted play", () => {
    expect(listenedMsOf({ outcome: { durationMs: 200_000, completionRatio: 0.5 } })).toBe(100_000);
    expect(listenedMsOf({ outcome: { durationMs: 200_000, completionRatio: 0.05 } })).toBe(COUNTED_PLAY_MS);
    expect(listenedMsOf({ outcome: { durationMs: 20_000, completionRatio: 0.2 } })).toBe(20_000);
    expect(listenedMsOf({})).toBe(COUNTED_PLAY_MS);
  });

  it("ranks tracks, artists and tags, and compares with the previous window", () => {
    const tracks = new Map([
      ["a", track("a", "one")],
      ["b", track("b", "one", { genre: "Jazz", moods: ["Calm", "warm"] })],
      ["c", track("c", "two", { genre: null, moods: [] })],
    ]);
    const plays = [
      play("a", ago(HOUR)),
      play("a", ago(2 * HOUR), { completionRatio: 1, playedThrough: true }),
      { ...play("a", ago(3 * HOUR)), action: "replay" },
      play("b", ago(DAY), {}, { localHourBucket: "morning", weekdayKind: "weekend" }),
      play("c", ago(2 * DAY)),
      play("a", ago(8 * DAY)), // previous window
      { ...play("a", ago(HOUR)), action: "skip" }, // not a play
      play("gone", ago(HOUR)), // not in the catalog any more
    ];
    const stats = aggregateListeningStats({ ...base, plays, tracks, saves: 2, artistKeysBefore: new Set(["id:one"]) });

    expect(stats.summary.plays).toBe(6);
    expect(stats.summary.tracks).toBe(4);
    expect(stats.summary.artists).toBe(2);
    expect(stats.summary.newArtists).toBe(1);
    expect(stats.summary.saves).toBe(2);
    expect(stats.summary.previous.plays).toBe(1);
    expect(stats.summary.playedThroughRate).toBeCloseTo(1 / 6, 3);
    expect(stats.topTracks.map((t) => [t.trackId, t.plays])).toEqual([["a", 3], ["b", 1], ["c", 1]]);
    expect(stats.topArtists.map((a) => [a.name, a.plays, a.tracks])).toEqual([["Artist one", 4], ["Artist two", 1]].map(([n, p]) => [n, p, n === "Artist one" ? 2 : 1]));
    expect(stats.genres[0]).toEqual({ name: "House", plays: 3, share: 0.75 });
    expect(stats.moods.map((m) => m.name)).toEqual(["Warm", "Calm"]);
    expect(stats.moods[0].plays).toBe(4);
    expect(stats.moments).toEqual({ morning: 1, afternoon: 0, evening: 5, night: 0 });
    expect(stats.weekendPlays).toBe(1);
    expect(stats.weekdayPlays).toBe(5);
  });

  it("returns plays in sparse 15-minute UTC slots across both windows, oldest first", () => {
    const tracks = new Map([["a", track("a", "one")]]);
    const plays = [
      play("a", ago(HOUR)),
      play("a", ago(HOUR - 60_000)), // same slot
      play("a", ago(9 * DAY)), // previous window, kept for streaks
    ];
    const stats = aggregateListeningStats({ ...base, plays, tracks });
    const slot = (at: Date) => Math.floor(at.getTime() / (15 * 60_000));
    expect(stats.activity).toEqual([
      [slot(ago(9 * DAY)), 1, 100],
      [slot(ago(HOUR)), 2, 200],
    ]);
  });

  it("is empty and honest with no plays", () => {
    const stats = aggregateListeningStats({ ...base, plays: [], tracks: new Map(), recording: false });
    expect(stats.summary.plays).toBe(0);
    expect(stats.summary.playedThroughRate).toBeNull();
    expect(stats.activity).toEqual([]);
    expect(stats.topArtists).toEqual([]);
    expect(stats.recording).toBe(false);
  });
});
