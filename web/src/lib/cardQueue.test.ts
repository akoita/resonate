import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "./api";

const api = vi.hoisted(() => ({
  getRelease: vi.fn(),
  listArtistReleases: vi.fn(),
  listPublishedReleases: vi.fn(),
  getPublicPlaylistAPI: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  ...api,
}));

import { cardQueueIsEmpty, resolveCardQueueTracks } from "./cardQueue";

function release(id: string, trackIds: string[], createdAt = "2026-09-01T00:00:00.000Z"): Release {
  return {
    id,
    artistId: "artist-1",
    title: `Release ${id}`,
    status: "published",
    type: "ALBUM",
    primaryArtist: "Nova",
    explicit: false,
    createdAt,
    tracks: trackIds.map((trackId, index) => ({
      id: trackId,
      releaseId: id,
      title: `Track ${trackId}`,
      position: index + 1,
      explicit: false,
      createdAt,
    })),
  } as Release;
}

describe("resolveCardQueueTracks", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  it("queues a loaded release's tracks in order without fetching", async () => {
    const tracks = await resolveCardQueueTracks({ kind: "release", title: "A", release: release("a", ["t1", "t2"]) });
    expect(tracks.map((track) => track.id)).toEqual(["t1", "t2"]);
    expect(tracks[0].remoteUrl).toContain("/a/");
    expect(api.getRelease).not.toHaveBeenCalled();
  });

  it("fetches a release for a track tile and keeps only that track", async () => {
    api.getRelease.mockResolvedValue(release("a", ["t1", "t2", "t3"]));
    const tracks = await resolveCardQueueTracks({ kind: "track", title: "T2", releaseId: "a", trackId: "t2" });
    expect(api.getRelease).toHaveBeenCalledWith("a");
    expect(tracks.map((track) => track.id)).toEqual(["t2"]);
  });

  it("queues every track of a catalog artist once", async () => {
    const shared = release("b", ["t3"]);
    const tracks = await resolveCardQueueTracks({
      kind: "artist",
      title: "Nova",
      releases: [release("a", ["t1", "t2"]), shared, shared],
    });
    expect(tracks.map((track) => track.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("loads a ranked artist's releases by profile id, newest first", async () => {
    api.listArtistReleases.mockResolvedValue([
      release("old", ["o1"], "2025-01-01T00:00:00.000Z"),
      release("new", ["n1"], "2026-10-01T00:00:00.000Z"),
    ]);
    const tracks = await resolveCardQueueTracks({ kind: "artistRef", title: "Nova", artistId: "artist-1", name: "Nova" });
    expect(api.listArtistReleases).toHaveBeenCalledWith("artist-1");
    expect(tracks.map((track) => track.id)).toEqual(["n1", "o1"]);
  });

  it("falls back to the artist name when there is no profile id", async () => {
    api.listPublishedReleases.mockResolvedValue([release("a", ["t1"])]);
    await resolveCardQueueTracks({ kind: "artistRef", title: "Nova", artistId: null, name: "Nova" });
    expect(api.listPublishedReleases).toHaveBeenCalledWith(100, "Nova");
  });

  it("queues only the streamable tracks of a public playlist", async () => {
    api.getPublicPlaylistAPI.mockResolvedValue({
      tracks: [
        { id: "p1", title: "One", artist: null, album: null, duration: 10, streamPath: "/s/p1", artworkPath: null, catalogTrackId: "p1", releaseId: "a", playable: true },
        { id: "p2", title: "Two", artist: null, album: null, duration: 10, streamPath: null, artworkPath: null, catalogTrackId: null, releaseId: null, playable: false },
      ],
    });
    const tracks = await resolveCardQueueTracks({ kind: "playlist", title: "Mix", playlistId: "pl-1" });
    expect(tracks.map((track) => track.id)).toEqual(["p1"]);
  });
});

describe("cardQueueIsEmpty", () => {
  it("knows up front when a loaded card has nothing to queue", () => {
    expect(cardQueueIsEmpty({ kind: "release", title: "A", release: release("a", []) })).toBe(true);
    expect(cardQueueIsEmpty({ kind: "artist", title: "N", releases: [release("a", [])] })).toBe(true);
    expect(cardQueueIsEmpty({ kind: "track", title: "T", releaseId: "a", trackId: "t" })).toBe(false);
  });
});
