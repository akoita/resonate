import {
  externalIdMatchConfidence,
  storedArtistIdSignal,
} from "../modules/artist/artist-external-ids";

const MBID = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";

describe("externalIdMatchConfidence (#2258)", () => {
  it.each([
    ["Ada Example", "Ada Example", "high"],
    ["ada  example", "ADA EXAMPLE", "high"],
    ["Beyoncé", "Beyonce", "high"],
    ["AC/DC", "AC DC", "high"],
    ["Ada Example", "Ada Example Band", "medium"],
    ["The Ada Example", "Ada Example", "medium"],
    ["Ada Example", "Grace Example", "low"],
    ["Ada", "Adam", "low"],
    ["Ada Example", "Example Ada", "low"],
    ["", "Ada Example", "low"],
    ["Ada Example", "   ", "low"],
  ])("compares %j with %j as %s", (profile, matched, expected) => {
    expect(externalIdMatchConfidence(profile, matched)).toBe(expected);
  });
});

describe("storedArtistIdSignal (#2258)", () => {
  const stored = {
    musicbrainzArtistId: MBID,
    wikidataQid: "Q42",
    externalIdMatchConfidence: "high",
    externalIdMatchedAt: new Date("2026-10-20T10:00:00.000Z"),
  };

  it("returns the ids for a usable match", () => {
    expect(storedArtistIdSignal(stored)).toEqual({
      musicbrainzArtistId: MBID,
      wikidataQid: "Q42",
      confidence: "high",
      matchedAt: stored.externalIdMatchedAt,
    });
  });

  it("drops a malformed QID but keeps the MusicBrainz id", () => {
    expect(storedArtistIdSignal({ ...stored, wikidataQid: "42" })).toMatchObject({
      musicbrainzArtistId: MBID,
      wikidataQid: null,
    });
  });

  it.each([
    ["no artist", null],
    ["no ids", {}],
    ["a low match", { ...stored, externalIdMatchConfidence: "low" }],
    ["an unknown confidence", { ...stored, externalIdMatchConfidence: "sure" }],
    ["a malformed MusicBrainz id", { ...stored, musicbrainzArtistId: "x" }],
    ["an uppercase MusicBrainz id", { ...stored, musicbrainzArtistId: MBID.toUpperCase() }],
  ])("returns null for %s", (_label, artist) => {
    expect(storedArtistIdSignal(artist)).toBeNull();
  });
});
