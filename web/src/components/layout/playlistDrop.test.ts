import { describe, expect, it } from "vitest";
import {
  parsePlaylistDropPayload,
  playlistDropEffect,
  playlistDropForTarget,
  playlistDropToast,
  playlistSourceType,
} from "./playlistDrop";

describe("playlistDropEffect", () => {
  it("advertises copy for library/catalog drags so the browser accepts them", () => {
    expect(playlistDropEffect("copy")).toBe("copy");
    expect(playlistDropEffect("copyMove")).toBe("copy");
    expect(playlistDropEffect("all")).toBe("copy");
    expect(playlistDropEffect("uninitialized")).toBe("copy");
    expect(playlistDropEffect(undefined)).toBe("copy");
  });

  it("advertises move only for a move-only (internal reorder) drag", () => {
    expect(playlistDropEffect("move")).toBe("move");
    expect(playlistDropEffect("linkMove")).toBe("move");
  });
});

describe("parsePlaylistDropPayload", () => {
  const json = (value: unknown) => JSON.stringify(value);

  it("reads a single library track", () => {
    expect(parsePlaylistDropPayload(json({ type: "track", id: "t1", title: "Song", artist: "A" }))).toEqual({
      kind: "tracks",
      trackIds: ["t1"],
      title: "Song",
    });
  });

  it("reads a library multi-selection by track id, not by album criteria", () => {
    const payload = json({ type: "album", name: "3 tracks", tracks: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    expect(parsePlaylistDropPayload(payload)).toEqual({ kind: "tracks", trackIds: ["a", "b", "c"], title: "3 tracks" });
  });

  it("reads release tracks, selections and albums", () => {
    expect(parsePlaylistDropPayload(json({ type: "release-track", track: { id: "r1", title: "One" } }))).toEqual({
      kind: "tracks",
      trackIds: ["r1"],
      title: "One",
    });
    expect(
      parsePlaylistDropPayload(json({ type: "release-album", title: "LP", tracks: [{ id: "r1" }, { id: "r2" }] })),
    ).toEqual({ kind: "tracks", trackIds: ["r1", "r2"], title: "LP" });
  });

  it("resolves legacy album and artist payloads from the library", () => {
    expect(parsePlaylistDropPayload(json({ type: "album", name: "LP", artist: "Nova" }))).toEqual({
      kind: "criteria",
      criteria: { album: "LP", artist: "Nova" },
      title: "LP",
    });
    expect(parsePlaylistDropPayload(json({ type: "artist", name: "Nova" }))).toEqual({
      kind: "criteria",
      criteria: { artist: "Nova" },
      title: "Nova",
    });
  });

  it("reads an internal reorder", () => {
    expect(parsePlaylistDropPayload(json({ type: "reorder-track", playlistId: "p1", trackId: "t1", index: 2 }))).toEqual({
      kind: "reorder",
      playlistId: "p1",
      trackId: "t1",
      index: 2,
    });
  });

  it("reads a reorder payload that only names the track", () => {
    expect(parsePlaylistDropPayload(json({ type: "reorder-track", trackId: "t1", index: 0 }))).toEqual({
      kind: "reorder",
      playlistId: null,
      trackId: "t1",
      index: 0,
    });
    expect(parsePlaylistDropPayload(json({ type: "reorder-track", index: 0 }))).toBeNull();
  });

  it("ignores empty, invalid and unknown payloads", () => {
    expect(parsePlaylistDropPayload("")).toBeNull();
    expect(parsePlaylistDropPayload(null)).toBeNull();
    expect(parsePlaylistDropPayload("https://example.com")).toBeNull();
    expect(parsePlaylistDropPayload(json({ type: "track" }))).toBeNull();
    expect(parsePlaylistDropPayload(json({ type: "album", tracks: [] }))).toBeNull();
    expect(parsePlaylistDropPayload(json({ type: "mystery", id: "x" }))).toBeNull();
    expect(parsePlaylistDropPayload(json(["track"]))).toBeNull();
  });
});

describe("playlistDropToast", () => {
  it("names a single added track", () => {
    expect(playlistDropToast("Chill", 1, 1, "Song")).toEqual({
      type: "success",
      title: "Track Added",
      message: 'Added "Song" to Chill.',
    });
  });

  it("counts only tracks that were actually new", () => {
    expect(playlistDropToast("Chill", 5, 3)).toEqual({
      type: "success",
      title: "Tracks Added",
      message: "Added 3 tracks to Chill (2 already there).",
    });
  });

  it("says so when everything was already in the playlist", () => {
    expect(playlistDropToast("Chill", 1, 0, "Song")).toMatchObject({
      type: "info",
      message: '"Song" is already in Chill.',
    });
    expect(playlistDropToast("Chill", 4, 0)).toMatchObject({
      type: "info",
      message: "Those tracks are already in Chill.",
    });
  });
});

describe("cross-playlist drops", () => {
  const reorder = { kind: "reorder" as const, playlistId: "p1", trackId: "t1", index: 3 };

  it("keeps a drop onto the source playlist a reorder", () => {
    expect(playlistDropForTarget(reorder, "p1")).toBe(reorder);
  });

  it("copies a playlist track dropped onto another playlist", () => {
    expect(playlistDropForTarget(reorder, "p2")).toEqual({ kind: "tracks", trackIds: ["t1"] });
    expect(playlistDropForTarget({ ...reorder, playlistId: null }, "p2")).toEqual({ kind: "tracks", trackIds: ["t1"] });
  });

  it("passes non-reorder requests through and ignores nothing-to-do drops", () => {
    const tracks = { kind: "tracks" as const, trackIds: ["t9"] };
    expect(playlistDropForTarget(tracks, "p2")).toBe(tracks);
    expect(playlistDropForTarget(null, "p2")).toBeNull();
    expect(playlistDropForTarget({ ...reorder, trackId: null }, "p2")).toBeNull();
  });

  it("advertises move over the source playlist and copy over any other", () => {
    const types = ["application/json", "text/plain", playlistSourceType("P1")];
    expect(playlistDropEffect("copyMove", { types, playlistId: "p1" })).toBe("move");
    expect(playlistDropEffect("copyMove", { types, playlistId: "p2" })).toBe("copy");
    expect(playlistDropEffect("copy", { types: ["application/json"], playlistId: "p2" })).toBe("copy");
  });
});
