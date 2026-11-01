import { describe, expect, it } from "vitest";
import type { LocalTrack } from "./localLibrary";
import {
  appendQueueTracks,
  canUndoQueueClear,
  clearQueueIndices,
  createShuffleCycleState,
  insertQueueTracksNext,
  reconcileShuffleCycle,
  removeQueueIndices,
  shuffleNext,
  shufflePrevious,
} from "./playerQueue";

function track(id: string): LocalTrack {
  return {
    id,
    title: id,
    artist: null,
    albumArtist: null,
    album: null,
    year: null,
    genre: null,
    duration: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const ids = (tracks: readonly LocalTrack[]) => tracks.map(({ id }) => id);

describe("queue batch operations", () => {
  it("appends a batch in order and reports additions", () => {
    const result = appendQueueTracks([track("a")], [track("b"), track("c")]);
    expect(ids(result.queue)).toEqual(["a", "b", "c"]);
    expect(ids(result.added)).toEqual(["b", "c"]);
    expect(result.skipped).toEqual([]);
  });

  it("deduplicates against the queue and earlier items in the incoming batch", () => {
    const duplicateB = track("b");
    const result = appendQueueTracks(
      [track("a")],
      [track("a"), duplicateB, track("b"), track("c"), track("a")],
    );
    expect(ids(result.queue)).toEqual(["a", "b", "c"]);
    expect(ids(result.added)).toEqual(["b", "c"]);
    expect(ids(result.skipped)).toEqual(["a", "b", "a"]);
    expect(result.added[0]).toBe(duplicateB);
  });

  it("inserts a unique batch directly after the current track", () => {
    const result = insertQueueTracksNext(
      [track("a"), track("b"), track("c")],
      0,
      [track("d"), track("b"), track("e")],
    );
    expect(ids(result.queue)).toEqual(["a", "d", "b", "e", "c"]);
    expect(ids(result.added)).toEqual(["d", "b", "e"]);
    expect(result.skipped).toEqual([]);
  });

  it("moves an existing track next without duplicating it", () => {
    const result = insertQueueTracksNext(
      [track("a"), track("b"), track("c")],
      0,
      [track("c")],
    );
    expect(ids(result.queue)).toEqual(["a", "c", "b"]);
    expect(ids(result.added)).toEqual(["c"]);
  });

  it("safely clamps stale insertion indexes", () => {
    expect(ids(insertQueueTracksNext([], -1, [track("a")]).queue)).toEqual(["a"]);
    expect(ids(insertQueueTracksNext([track("a")], 99, [track("b")]).queue)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("shuffle cycle navigation", () => {
  it("counts the current track as played and never immediately repeats it", () => {
    const state = createShuffleCycleState("a");
    const result = shuffleNext(state, ["a", "b", "c"], "a", { random: () => 0 });
    expect(result.trackId).toBe("b");
    expect(result.state.played).toEqual(["a", "b"]);
  });

  it("plays every unique eligible item exactly once before exhaustion", () => {
    let state = createShuffleCycleState("a");
    const first = shuffleNext(state, ["a", "b", "b", "c"], "a", { random: () => 0.99 });
    expect(first.trackId).toBe("c");
    state = first.state;
    const second = shuffleNext(state, ["a", "b", "c"], "c", { random: () => 0 });
    expect(second.trackId).toBe("b");
    const exhausted = shuffleNext(second.state, ["a", "b", "c"], "b");
    expect(exhausted.trackId).toBeNull();
    expect(exhausted.state.played).toEqual(["a", "c", "b"]);
  });

  it("makes additions eligible without resetting the active cycle", () => {
    const state = {
      history: ["a", "b"],
      position: 1,
      played: ["a", "b"],
    };
    const result = shuffleNext(state, ["a", "b", "c"], "b", { random: () => 0 });
    expect(result.trackId).toBe("c");
    expect(result.state.played).toEqual(["a", "b", "c"]);
  });

  it("filters removals from history and played state safely", () => {
    const reconciled = reconcileShuffleCycle(
      { history: ["a", "b", "c"], position: 2, played: ["a", "b", "c"] },
      ["a", "c", "d"],
      "c",
    );
    expect(reconciled).toEqual({
      history: ["a", "c"],
      position: 1,
      played: ["a", "c"],
    });
    const next = shuffleNext(reconciled, ["a", "c", "d"], "c", { random: () => 0 });
    expect(next.trackId).toBe("d");
  });

  it("moves backward and then retraces known forward history", () => {
    const state = {
      history: ["a", "c", "b"],
      position: 2,
      played: ["a", "c", "b"],
    };
    const previous = shufflePrevious(state, ["a", "b", "c"], "b");
    expect(previous.trackId).toBe("c");
    expect(previous.state.played).toEqual(state.played);
    const previousAgain = shufflePrevious(previous.state, ["a", "b", "c"], "c");
    expect(previousAgain.trackId).toBe("a");
    expect(shufflePrevious(previousAgain.state, ["a", "b", "c"], "a").trackId).toBeNull();
    const forward = shuffleNext(previousAgain.state, ["a", "b", "c"], "a");
    expect(forward.trackId).toBe("c");
    expect(shuffleNext(forward.state, ["a", "b", "c"], "c").trackId).toBe("b");
  });

  it("starts a fresh repeat-all cycle only after exhaustion", () => {
    const exhausted = {
      history: ["a", "b", "c"],
      position: 2,
      played: ["a", "b", "c"],
    };
    expect(shuffleNext(exhausted, ["a", "b", "c"], "c").trackId).toBeNull();
    const repeated = shuffleNext(exhausted, ["a", "b", "c"], "c", {
      repeatAll: true,
      random: () => 0,
    });
    expect(repeated.trackId).toBe("a");
    expect(repeated.state.played).toEqual(["a"]);
  });

  it("allows repeat-all to replay a one-item queue", () => {
    const result = shuffleNext(createShuffleCycleState("a"), ["a"], "a", {
      repeatAll: true,
    });
    expect(result.trackId).toBe("a");
    expect(result.state.history).toEqual(["a", "a"]);
  });

  it("supports deterministic random selection and guards invalid random values", () => {
    expect(
      shuffleNext(createShuffleCycleState("a"), ["a", "b", "c", "d"], "a", {
        random: () => 0.5,
      }).trackId,
    ).toBe("c");
    expect(
      shuffleNext(createShuffleCycleState("a"), ["a", "b"], "a", {
        random: () => Number.NaN,
      }).trackId,
    ).toBe("b");
  });

  it("can initialize safely before a current track exists", () => {
    const result = shuffleNext(createShuffleCycleState(), ["a", "b"], null, {
      random: () => 0,
    });
    expect(result.trackId).toBe("a");
    expect(result.state).toEqual({ history: ["a"], position: 0, played: ["a"] });
  });
});

describe("removeQueueIndices", () => {
  const queue = ["a", "b", "c", "d", "e"].map(track);
  const ids = (list: LocalTrack[]) => list.map((t) => t.id);

  it("keeps the current track playing when it survives", () => {
    const result = removeQueueIndices(queue, 3, [0, 1, 4]);
    expect(ids(result.queue)).toEqual(["c", "d"]);
    expect(result.currentIndex).toBe(1);
    expect(result.currentRemoved).toBe(false);
  });

  it("moves to the next surviving track when the current one is removed", () => {
    const result = removeQueueIndices(queue, 1, [1, 2]);
    expect(ids(result.queue)).toEqual(["a", "d", "e"]);
    expect(result.currentIndex).toBe(1);
    expect(result.currentRemoved).toBe(true);
  });

  it("falls back to the last track when everything after the current one goes", () => {
    const result = removeQueueIndices(queue, 3, [3, 4]);
    expect(ids(result.queue)).toEqual(["a", "b", "c"]);
    expect(result.currentIndex).toBe(2);
  });

  it("empties the queue and ignores out-of-range indices", () => {
    expect(removeQueueIndices(queue, 0, [0, 1, 2, 3, 4, 9])).toEqual({ queue: [], currentIndex: -1, currentRemoved: true });
    expect(ids(removeQueueIndices(queue, 0, [-1, 7]).queue)).toEqual(ids(queue));
  });

  it("keeps no current track when nothing was playing", () => {
    expect(removeQueueIndices(queue, -1, [0]).currentIndex).toBe(-1);
  });
});

describe("Clear queue", () => {
  const queue = [track("a"), track("b"), track("c"), track("d")];

  it("removes every position except the playing track", () => {
    const indices = clearQueueIndices(queue.length, 2);
    expect(indices).toEqual([0, 1, 3]);
    const result = removeQueueIndices(queue, 2, indices);
    expect(ids(result.queue)).toEqual(["c"]);
    expect(result.currentIndex).toBe(0);
    expect(result.currentRemoved).toBe(false);
  });

  it("empties the queue when nothing is playing", () => {
    expect(clearQueueIndices(queue.length, -1)).toEqual([0, 1, 2, 3]);
    expect(removeQueueIndices(queue, -1, clearQueueIndices(queue.length, -1)).queue).toEqual([]);
  });

  it("offers Undo only while the queue is still what the clear left", () => {
    expect(canUndoQueueClear("c", [track("c")])).toBe(true);
    expect(canUndoQueueClear("c", [track("c"), track("e")])).toBe(false);
    expect(canUndoQueueClear("c", [track("e")])).toBe(false);
    expect(canUndoQueueClear(null, [])).toBe(true);
    expect(canUndoQueueClear(null, [track("e")])).toBe(false);
  });
});
