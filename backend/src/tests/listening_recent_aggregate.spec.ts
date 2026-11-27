import {
  groupRecentPlays,
  type RecentPlaylistInfo,
  type RecentTrackInfo,
} from "../modules/listening_stats/listening_recent.aggregate";

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 10, 27, 12, 0) - minutesAgo * 60_000);

function track(id: string, releaseId: string, overrides: Partial<RecentTrackInfo> = {}): RecentTrackInfo {
  return {
    trackId: id,
    title: `Song ${id}`,
    available: true,
    releaseId,
    releaseTitle: `Release ${releaseId}`,
    releaseType: "album",
    isRemix: false,
    artistId: `artist_${releaseId}`,
    artistName: `Artist ${releaseId}`,
    artworkUrl: null,
    hasUploadedArtwork: true,
    artworkRevision: 1,
    aiDisclosure: null,
    ...overrides,
  };
}

const playlist = (id: string, overrides: Partial<RecentPlaylistInfo> = {}): RecentPlaylistInfo => ({
  playlistId: id,
  name: `Playlist ${id}`,
  isOwner: true,
  visibility: "private",
  trackCount: 5,
  ...overrides,
});

describe("groupRecentPlays", () => {
  const tracks = new Map([
    ["t1", track("t1", "r1")],
    ["t2", track("t2", "r1")],
    ["t3", track("t3", "r2")],
    ["t4", track("t4", "r3")],
    ["gone", track("gone", "r4", { available: false })],
  ]);

  it("lists each release once at its newest play, newest first, and resumes at the last track", () => {
    const items = groupRecentPlays({
      plays: [
        { trackId: "t1", createdAt: at(300), metadata: {} },
        { trackId: "t3", createdAt: at(60), metadata: {} },
        { trackId: "t2", createdAt: at(5), metadata: {} },
      ],
      tracks,
      playlists: new Map(),
      limit: 12,
    });
    expect(items.map((item) => item.kind === "release" && item.releaseId)).toEqual(["r1", "r2"]);
    expect(items[0]).toMatchObject({ lastTrackId: "t2", lastPlayedAt: at(5).toISOString() });
  });

  it("credits a play from a playlist the listener can open to that playlist", () => {
    const items = groupRecentPlays({
      plays: [
        { trackId: "t1", createdAt: at(1), metadata: { playlistId: "p1" } },
        { trackId: "t3", createdAt: at(2), metadata: { playlistId: "p1" } },
        { trackId: "t4", createdAt: at(3), metadata: { playlistId: "hidden" } },
      ],
      tracks,
      playlists: new Map([["p1", playlist("p1")]]),
      limit: 12,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "playlist", playlistId: "p1", lastTrackId: "t1" });
    expect(items[0].kind === "playlist" && items[0].covers.map((cover) => cover.releaseId)).toEqual(["r1", "r2"]);
    // A playlist the listener cannot open falls back to the track's release.
    expect(items[1]).toMatchObject({ kind: "release", releaseId: "r3" });
  });

  it("leaves out unavailable and unknown tracks", () => {
    const items = groupRecentPlays({
      plays: [
        { trackId: "gone", createdAt: at(1), metadata: {} },
        { trackId: "device-file", createdAt: at(2), metadata: {} },
        { trackId: "t4", createdAt: at(3), metadata: {} },
      ],
      tracks,
      playlists: new Map(),
      limit: 12,
    });
    expect(items.map((item) => item.kind === "release" && item.releaseId)).toEqual(["r3"]);
  });

  it("stops at the limit", () => {
    const items = groupRecentPlays({
      plays: [
        { trackId: "t1", createdAt: at(1), metadata: {} },
        { trackId: "t3", createdAt: at(2), metadata: {} },
        { trackId: "t4", createdAt: at(3), metadata: {} },
      ],
      tracks,
      playlists: new Map(),
      limit: 2,
    });
    expect(items).toHaveLength(2);
  });
});
