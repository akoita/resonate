import { describe, expect, it } from "vitest";
import type { Release } from "./api";
import { catalogArtistPlaybackTracks } from "./catalogArtistPlayback";

describe("catalog artist playback (#1820)", () => {
  it("maps releases into one playable artist queue with stable catalog identity", () => {
    const releases = [{
      id: "release-1",
      title: "Release One",
      primaryArtist: "Credited Artist",
      releaseDate: "2026-09-20T00:00:00.000Z",
      genre: "Rock",
      tracks: [{
        id: "track-1",
        title: "Track One",
        createdAt: "2026-09-20T00:00:00.000Z",
        stems: [{ durationSeconds: 123 }],
      }],
    }] as Release[];

    expect(catalogArtistPlaybackTracks(releases)).toEqual([
      expect.objectContaining({
        id: "track-1",
        artist: "Credited Artist",
        album: "Release One",
        year: 2026,
        duration: 123,
        catalogTrackId: "track-1",
        releaseId: "release-1",
        source: "remote",
      }),
    ]);
  });

  it("keeps a track-level artist credit ahead of the release credit", () => {
    const releases = [{
      id: "release-2",
      title: "Release Two",
      primaryArtist: "Release Artist",
      tracks: [{ id: "track-2", title: "Duet", artist: "Track Artist" }],
    }] as Release[];

    expect(catalogArtistPlaybackTracks(releases)[0]?.artist).toBe("Track Artist");
  });
});
