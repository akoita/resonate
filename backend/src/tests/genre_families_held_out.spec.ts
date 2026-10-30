/**
 * Held-out genre-matching decisions (#2453): written before the matcher fix and
 * kept out of the implementer's view, then added after it, to check that the
 * fix generalises beyond the Afrobeats and Pop Hits starters it was built for.
 * Each row: does a release labelled `release` satisfy a request for `request`?
 */
import { genreMatchesRequest } from "../modules/recommendations/genre_families";

const HELD_OUT: Array<{ request: string; release: string; matches: boolean; why: string }> = [
  { request: "Afro-Pop", release: "Pop", matches: false, why: "the generic half of a compound is not the compound" },
  { request: "Afro-Pop", release: "Dance Pop", matches: false, why: "another pop style is not Afro-Pop" },
  { request: "Afro-Pop", release: "Afrobeats", matches: true, why: "same Afrobeats family" },
  { request: "Baile Funk", release: "Funk", matches: false, why: "Brazilian baile funk is not American funk" },
  { request: "Latin Pop", release: "Pop", matches: false, why: "a plain Pop release is not Latin" },
  { request: "Soulful House", release: "Soul", matches: false, why: "soulful house is house music" },
  { request: "Dancehall", release: "Dance", matches: false, why: "dancehall is reggae, not dance" },
  { request: "Synthpop", release: "Synthwave", matches: false, why: "different styles sharing a prefix" },
  { request: "Hip-Hop", release: "French Rap", matches: true, why: "French rap is hip-hop" },
  { request: "Rap", release: "Trap", matches: true, why: "trap is in the hip-hop family" },
  { request: "Deep House", release: "Deep House", matches: true, why: "identical" },
  { request: "Amapiano", release: "Afrobeats", matches: true, why: "same Afrobeats family" },
  { request: "Psych-Rock", release: "Rock", matches: true, why: "rock is the head of psych-rock; a near miss, not a contradiction" },
];

describe("genre matching held-out decisions (#2453)", () => {
  it.each(HELD_OUT)("$request <- $release: $matches ($why)", ({ request, release, matches }) => {
    expect(genreMatchesRequest(release, request)).toBe(matches);
  });
});
