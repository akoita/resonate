import { mergeSessionGenres } from "../modules/agents/agent_session_genres";

describe("mergeSessionGenres", () => {
  it("orders learned favorites, saved vibes, then the session's genres", () => {
    expect(
      mergeSessionGenres({
        learnedGenres: ["hip hop", "jazz"],
        vibes: ["focus"],
        sessionGenres: ["Ambient", "Lo-fi"],
      }),
    ).toEqual(["hip hop", "jazz", "focus", "Ambient", "Lo-fi"]);
  });

  it("keeps the preset's genres when learned genres and vibes exist", () => {
    const merged = mergeSessionGenres({
      learnedGenres: ["hip hop"],
      vibes: ["focus"],
      sessionGenres: ["Dark", "Industrial"],
    });
    expect(merged).toEqual(expect.arrayContaining(["Dark", "Industrial"]));
  });

  it("dedupes by first occurrence and drops empty values", () => {
    expect(
      mergeSessionGenres({
        learnedGenres: ["jazz", ""],
        vibes: ["jazz", "soul"],
        sessionGenres: ["soul", "funk"],
      }),
    ).toEqual(["jazz", "soul", "funk"]);
  });

  it("handles missing inputs and does not mutate them", () => {
    expect(mergeSessionGenres({})).toEqual([]);
    const vibes = ["focus"];
    const sessionGenres = ["soul"];
    mergeSessionGenres({ vibes, sessionGenres });
    expect(vibes).toEqual(["focus"]);
    expect(sessionGenres).toEqual(["soul"]);
  });
});
