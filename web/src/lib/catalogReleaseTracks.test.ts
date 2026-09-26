import { describe, expect, it } from "vitest";
import { getReleaseTrackStreamUrl, getStemPreviewUrl, type Release } from "./api";
import { isMixerStem, mapReleaseToLocalTracks } from "./catalogReleaseTracks";

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "rel-1",
    artistId: "manager-1",
    title: "Lovebird",
    status: "ready",
    type: "SINGLE",
    primaryArtist: "Nova",
    genre: "Pop",
    explicit: false,
    releaseDate: "2025-05-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    artworkUrl: "https://cdn/lovebird.jpg",
    tracks: [
      {
        id: "trk-1",
        releaseId: "rel-1",
        title: "Lovebird",
        position: 1,
        explicit: false,
        createdAt: "2026-09-02T00:00:00.000Z",
        stems: [
          {
            id: "stem-master",
            trackId: "trk-1",
            type: "master",
            uri: "ipfs://master",
            durationSeconds: 201,
            isEncrypted: true,
            encryptionMetadata: "{\"k\":1}",
          },
          {
            id: "stem-vocals",
            trackId: "trk-1",
            type: "Vocals",
            uri: "ipfs://vocals",
            durationSeconds: 201,
            isEncrypted: true,
            encryptionMetadata: "{\"k\":2}",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("mapReleaseToLocalTracks", () => {
  it("maps each catalog track to a remote library track", () => {
    const [track] = mapReleaseToLocalTracks(makeRelease());
    expect(track).toMatchObject({
      id: "trk-1",
      catalogTrackId: "trk-1",
      title: "Lovebird",
      artist: "Nova",
      album: "Lovebird",
      year: 2025,
      genre: "Pop",
      duration: 201,
      releaseId: "rel-1",
      artistId: "manager-1",
      source: "remote",
      remoteUrl: getReleaseTrackStreamUrl("rel-1", "trk-1"),
      remoteArtworkUrl: "https://cdn/lovebird.jpg",
      createdAt: "2026-09-02T00:00:00.000Z",
    });
  });

  it("points mixer stems at their public preview and keeps the master's stored URI", () => {
    const [track] = mapReleaseToLocalTracks(makeRelease());
    const [master, vocals] = track.stems ?? [];
    expect(master).toMatchObject({ uri: "ipfs://master", isEncrypted: true, encryptionMetadata: "{\"k\":1}" });
    expect(vocals).toMatchObject({ uri: getStemPreviewUrl("stem-vocals"), isEncrypted: false, encryptionMetadata: null });
  });

  it("returns no tracks for a release without tracks", () => {
    expect(mapReleaseToLocalTracks(makeRelease({ tracks: undefined }))).toEqual([]);
    expect(mapReleaseToLocalTracks(makeRelease({ tracks: [] }))).toEqual([]);
  });

  it("falls back to release metadata when track data is missing", () => {
    const release = makeRelease({ releaseDate: undefined, genre: undefined, artworkUrl: undefined });
    release.tracks = [{ ...release.tracks![0], stems: undefined, createdAt: "" }];
    const [track] = mapReleaseToLocalTracks(release);
    expect(track.year).toBeNull();
    expect(track.genre).toBeNull();
    expect(track.duration).toBeNull();
    expect(track.remoteArtworkUrl).toBeUndefined();
    expect(track.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("isMixerStem", () => {
  it("treats everything but the original/master as a mixer stem", () => {
    expect(isMixerStem("vocals")).toBe(true);
    expect(isMixerStem(" Master ")).toBe(false);
    expect(isMixerStem("ORIGINAL")).toBe(false);
    expect(isMixerStem("")).toBe(false);
    expect(isMixerStem(null)).toBe(false);
  });
});
