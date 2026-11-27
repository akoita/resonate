import { describe, expect, it } from "vitest";
import type { LocalTrack } from "./localLibrary";
import { isCollectionActive } from "./collectionPlayback";

const track = (id: string, catalogTrackId?: string) => ({ id, catalogTrackId, title: id }) as unknown as LocalTrack;
const [a, b, c, x] = [track("a"), track("b"), track("c"), track("x")];

describe("isCollectionActive", () => {
  it("matches a playlist by the source the player recorded", () => {
    const player = { queue: [a, b, c], currentTrack: b, queueSource: { playlistId: "p1", trackIds: ["a", "b", "c"] } };
    expect(isCollectionActive(player, { trackIds: ["a", "b", "c"], playlistId: "p1" })).toBe(true);
    expect(isCollectionActive(player, { trackIds: ["a", "b", "c"], playlistId: "p2" })).toBe(true); // same tracks, exact queue
    expect(isCollectionActive(player, { trackIds: ["a", "b"], playlistId: "p2" })).toBe(false);
  });

  it("stays linked to the playlist after the queue is edited", () => {
    const player = { queue: [a, x, b], currentTrack: b, queueSource: { playlistId: "p1", trackIds: ["a", "b", "c"] } };
    expect(isCollectionActive(player, { trackIds: ["a", "b", "c"], playlistId: "p1" })).toBe(true);
  });

  it("lets go while a track from outside the playlist plays", () => {
    const player = { queue: [a, x, b], currentTrack: x, queueSource: { playlistId: "p1", trackIds: ["a", "b", "c"] } };
    expect(isCollectionActive(player, { trackIds: ["a", "b", "c"], playlistId: "p1" })).toBe(false);
  });

  it("lets go once the queue is replaced by something else", () => {
    const player = { queue: [a, b], currentTrack: a, queueSource: null };
    expect(isCollectionActive(player, { trackIds: ["a", "b", "c"], playlistId: "p1" })).toBe(false);
  });

  it("matches an album or artist when the queue holds exactly its tracks, in any order", () => {
    const shuffled = { queue: [c, a, b], currentTrack: a, queueSource: null };
    expect(isCollectionActive(shuffled, { trackIds: ["a", "b", "c"] })).toBe(true);
    const extra = { queue: [a, b, c, x], currentTrack: a, queueSource: null };
    expect(isCollectionActive(extra, { trackIds: ["a", "b", "c"] })).toBe(false);
  });

  it("matches catalog tracks by their catalog id", () => {
    const local = [track("local-1", "r1"), track("local-2", "r2")];
    const player = { queue: local, currentTrack: local[1], queueSource: null };
    expect(isCollectionActive(player, { trackIds: ["r1", "r2"] })).toBe(true);
  });

  it("is inactive with nothing playing or an empty collection", () => {
    expect(isCollectionActive({ queue: [], currentTrack: null, queueSource: null }, { trackIds: ["a"] })).toBe(false);
    expect(isCollectionActive({ queue: [a], currentTrack: a, queueSource: null }, { trackIds: [] })).toBe(false);
  });

  it("counts duplicate tracks", () => {
    const player = { queue: [a, a, b], currentTrack: a, queueSource: null };
    expect(isCollectionActive(player, { trackIds: ["a", "b", "a"] })).toBe(true);
    expect(isCollectionActive(player, { trackIds: ["a", "b", "b"] })).toBe(false);
  });
});
