import { describe, expect, it } from "vitest";
import type { Release } from "./api";
import {
  getArtistName,
  getCatalogSortTime,
  summarizeCreditedArtists,
} from "./catalogDisplay";

describe("catalog display helpers", () => {
  it("sorts recent catalog surfaces by upload time instead of original release date", () => {
    const release = {
      id: "rel-rednex",
      artistId: "manager-bouba",
      title: "Sex & Violins",
      status: "ready",
      type: "single",
      primaryArtist: "Rednex",
      releaseDate: "1995-01-01T00:00:00.000Z",
      createdAt: "2026-06-05T14:11:17.092Z",
      explicit: false,
    } satisfies Release;

    expect(getCatalogSortTime(release)).toBe(new Date("2026-06-05T14:11:17.092Z").getTime());
  });

  it("summarizes artists from main release credits rather than uploader profiles", () => {
    const releases = [
      {
        id: "rel-rednex",
        artistId: "manager-bouba",
        title: "Sex & Violins",
        status: "ready",
        type: "single",
        primaryArtist: "Rednex",
        genre: "Pop",
        releaseDate: "1995-01-01T00:00:00.000Z",
        createdAt: "2026-06-05T14:11:17.092Z",
        explicit: false,
        artist: { id: "manager-bouba", displayName: "bouba" },
        artistCredits: [
          {
            id: "credit-rednex",
            releaseId: "rel-rednex",
            artistId: "public-rednex",
            role: "main",
            displayName: "Rednex",
            sortOrder: 0,
          },
        ],
        tracks: [
          {
            id: "trk-rednex",
            title: "Wish You Were Here",
            artist: "Rednex",
            position: 1,
            explicit: false,
            createdAt: "2026-06-05T14:11:17.092Z",
            stems: [
              { id: "stem-original", type: "original", uri: "/stem-original", title: "Original" },
              { id: "stem-vocals", type: "vocals", uri: "/stem-vocals", title: "Vocals" },
            ],
          },
        ],
      },
    ] satisfies Release[];

    expect(getArtistName(releases[0])).toBe("Rednex");
    expect(summarizeCreditedArtists(releases)).toEqual([
      expect.objectContaining({
        name: "Rednex",
        artistId: "public-rednex",
        releaseCount: 1,
        stemCount: 2,
        latestAt: new Date("2026-06-05T14:11:17.092Z").getTime(),
      }),
    ]);
  });
});
