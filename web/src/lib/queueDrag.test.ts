import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalTrack } from "./localLibrary";
import {
  QUEUE_DRAG_TYPE,
  QUEUE_ROW_DRAG_TYPE,
  canQueueDrag,
  markQueueDragStartedForTests,
  queueRowDragPayload,
  resetQueueDragForTests,
  resolveDroppedTracks,
} from "./queueDrag";

function track(id: string, extra: Partial<LocalTrack> = {}): LocalTrack {
  return {
    id,
    title: `Track ${id}`,
    artist: "Artist",
    albumArtist: null,
    album: "Album",
    year: null,
    genre: null,
    duration: 120,
    createdAt: "",
    ...extra,
  };
}

const library: Record<string, LocalTrack> = {
  a: track("a", { album: "Night", artist: "Amara" }),
  b: track("b", { album: "Night", artist: "Amara" }),
  c: track("c", { album: "Day", artist: "Okomfo" }),
};
const lookup = vi.fn(async (id: string) => library[id] ?? null);
const listLibrary = vi.fn(async () => Object.values(library));

afterEach(() => {
  resetQueueDragForTests();
  vi.clearAllMocks();
});

describe("canQueueDrag", () => {
  it("refuses drags that did not start in this document", () => {
    expect(canQueueDrag(["application/json"])).toBe(false);
  });

  it("takes app payloads and offers that started here", () => {
    markQueueDragStartedForTests();
    expect(canQueueDrag(["application/json", "text/plain"])).toBe(true);
    expect(canQueueDrag([QUEUE_DRAG_TYPE])).toBe(true);
  });

  it("ignores files, plain links and queue rows dragged back onto the queue", () => {
    markQueueDragStartedForTests();
    expect(canQueueDrag(["Files"])).toBe(false);
    expect(canQueueDrag(["text/uri-list", "text/plain"])).toBe(false);
    expect(canQueueDrag(["application/json", QUEUE_ROW_DRAG_TYPE])).toBe(false);
  });
});

describe("resolveDroppedTracks", () => {
  it("looks a library track up by id", async () => {
    const tracks = await resolveDroppedTracks(JSON.stringify({ type: "track", id: "a" }), lookup, listLibrary);
    expect(tracks.map((t) => t.id)).toEqual(["a"]);
  });

  it("uses a release track as dragged when the lookup finds nothing", async () => {
    const dragged = track("rel-1", { remoteUrl: "https://example.test/rel-1" });
    const tracks = await resolveDroppedTracks(
      JSON.stringify({ type: "release-track", track: dragged }),
      lookup,
      listLibrary,
    );
    expect(tracks).toEqual([dragged]);
  });

  it("keeps the order of a selection and drops what cannot be found", async () => {
    const tracks = await resolveDroppedTracks(
      JSON.stringify({ type: "album", tracks: [{ id: "c" }, { id: "missing" }, { id: "a" }] }),
      lookup,
      listLibrary,
    );
    expect(tracks.map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("resolves a playlist row being reordered", async () => {
    const tracks = await resolveDroppedTracks(
      JSON.stringify({ type: "reorder-track", playlistId: "p", trackId: "b", index: 0 }),
      lookup,
      listLibrary,
    );
    expect(tracks.map((t) => t.id)).toEqual(["b"]);
  });

  it("resolves album and artist cards from the library", async () => {
    const album = await resolveDroppedTracks(JSON.stringify({ type: "album", name: "Night", artist: "Amara" }), lookup, listLibrary);
    expect(album.map((t) => t.id)).toEqual(["a", "b"]);
    const artist = await resolveDroppedTracks(JSON.stringify({ type: "artist", name: "Okomfo" }), lookup, listLibrary);
    expect(artist.map((t) => t.id)).toEqual(["c"]);
  });

  it("returns nothing for malformed or unknown payloads", async () => {
    expect(await resolveDroppedTracks("not json", lookup, listLibrary)).toEqual([]);
    expect(await resolveDroppedTracks(JSON.stringify({ type: "stem-pack" }), lookup, listLibrary)).toEqual([]);
    expect(await resolveDroppedTracks(JSON.stringify({ type: "release-track", track: { id: 3 } }), lookup, listLibrary)).toEqual([]);
  });
});

describe("queueRowDragPayload", () => {
  it("is a track payload the playlists panel understands", () => {
    const payload = JSON.parse(queueRowDragPayload(track("q1", { catalogTrackId: "cat-1" })));
    expect(payload).toEqual({ type: "track", id: "q1", catalogTrackId: "cat-1", title: "Track q1", artist: "Artist" });
  });
});
