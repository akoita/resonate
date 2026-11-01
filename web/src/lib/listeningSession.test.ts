import { describe, expect, it } from "vitest";
import { consumeRepeat, createFiniteRepeat, queueSnapshot, queueSourceKind, scheduleTrackRepeat, scheduledRepeatFor, takeScheduledRepeat, validateSegment } from "./listeningSession";
import { createShuffleCycleState, shuffleNext } from "./playerQueue";
import type { LocalTrack } from "./localLibrary";
const track = (id: string, extra = {}): LocalTrack => ({ id, title: id, artist: null, album: null, albumArtist: null, year: null, genre: null, duration: 100, createdAt: "", catalogTrackId: id, ...extra });

describe("listening sessions", () => {
  it("requires explicit source identity and detects ordered divergence", () => {
    const q = [track("a"), track("b")];
    expect(queueSourceKind(q, null)).toBe("ad_hoc");
    const source = { playlistId: "p", trackIds: ["a", "b"] };
    expect(queueSourceKind(q, source)).toBe("unchanged_playlist");
    expect(queueSourceKind([...q].reverse(), source)).toBe("modified_playlist");
    expect(queueSourceKind(q.slice(1), source)).toBe("modified_playlist");
    expect(queueSourceKind([...q, track("c")], source)).toBe("modified_playlist");
    expect(queueSourceKind(q, JSON.parse(JSON.stringify(source)))).toBe("unchanged_playlist");
  });
  it("snapshots the full manifest and reports unsupported local entries without mutating it", () => {
    const q = [track("past"), track("now"), track("local", { catalogTrackId: null, source: "local" }), track("future"), track("now")];
    expect(queueSnapshot(q)).toEqual({ trackIds: ["past", "now", "future"], invalid: [q[2]] });
    expect(q).toHaveLength(5);
  });
  it.each([[0, 0, 100], [8, 4, 100], [0, 10, NaN], [0, Infinity, 100], [0, 1, 0]])("rejects invalid or unknown ranges %s %s %s", (a,b,d) => {
    expect(validateSegment(a,b,d)).toBeNull();
  });
  it("clamps valid boundaries to duration", () => expect(validateSegment(-2, 120, 100)).toEqual({ start: 0, end: 100 }));
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects repeat count %s", count => expect(createFiniteRepeat("track", count)).toBeNull());
  it.each(["track", "queue"] as const)("performs exactly three additional %s repeats, then completes", target => {
    let plan = createFiniteRepeat(target, 3)!;
    for (const remaining of [2, 1, 0]) {
      const result = consumeRepeat(plan);
      expect(result.replay).toBe(true); expect(result.plan?.remaining).toBe(remaining); plan = result.plan!;
    }
    expect(consumeRepeat(plan)).toEqual({ replay: false, plan: null });
  });
  it("schedules repeats for a track that is not playing, and cancels with 0", () => {
    const set = scheduleTrackRepeat({}, "b", 3)!;
    expect(set).toEqual({ b: 3 });
    expect(scheduledRepeatFor(set, track("b"))).toBe(3);
    expect(scheduledRepeatFor(set, track("x", { catalogTrackId: "b" }))).toBe(3);
    expect(scheduledRepeatFor(set, track("a"))).toBe(0);
    expect(scheduleTrackRepeat(set, "b", 0)).toEqual({});
    for (const bad of [-1, 1.5, NaN]) expect(scheduleTrackRepeat(set, "b", bad)).toBeNull();
    expect(set).toEqual({ b: 3 });
  });
  it("hands a scheduled count to the player once, as a track repeat", () => {
    const taken = takeScheduledRepeat({ b: 2, c: 1 }, track("b"));
    expect(taken.plan).toEqual({ target: "track", configured: 2, remaining: 2 });
    expect(taken.schedule).toEqual({ c: 1 });
    expect(takeScheduledRepeat(taken.schedule, track("b"))).toEqual({ plan: null, schedule: { c: 1 } });
  });
  it("each repeated shuffle cycle includes every track, without an immediate boundary repeat", () => {
    const ids = ["a", "b", "c"];
    let current = "a";
    let state = createShuffleCycleState(current);
    for (let cycle = 0; cycle < 4; cycle++) {
      const heard = cycle === 0 ? [current] : [];
      while (heard.length < 3) {
        const result = shuffleNext(state, ids, current, { repeatAll: true, random: () => 0 });
        expect(result.trackId).not.toBe(current);
        current = result.trackId!; state = result.state; heard.push(current);
      }
      expect(new Set(heard).size).toBe(3);
    }
  });
});
