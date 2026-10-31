/** Golden Moments kinds (#1476 slice 2). Pure units. */
import {
  PUNCHLINE_MOMENT_KINDS,
  defaultMomentKindForGenre,
  isPunchlineMomentKind,
} from "../modules/punchline/punchline-kind";

describe("punchline moment kinds", () => {
  it("offers Punchline, Crescendo, Hook and Solo, never Drop", () => {
    expect([...PUNCHLINE_MOMENT_KINDS]).toEqual([
      "punchline",
      "crescendo",
      "hook",
      "solo",
    ]);
    expect(isPunchlineMomentKind("drop")).toBe(false);
    expect(isPunchlineMomentKind("hook")).toBe(true);
  });

  it.each([
    ["Hip-Hop", "punchline"],
    ["UK Drill", "punchline"],
    ["Orchestral", "crescendo"],
    ["Cinematic Soundtrack", "crescendo"],
    ["Jazz", "solo"],
    ["Hard Rock", "solo"],
    ["Pop", "hook"],
    ["Electronic", "hook"],
  ])("defaults %s to %s", (genre, kind) => {
    expect(defaultMomentKindForGenre(genre)).toBe(kind);
  });

  it("keeps the stored default when the genre is unknown", () => {
    expect(defaultMomentKindForGenre(null)).toBe("punchline");
    expect(defaultMomentKindForGenre("  ")).toBe("punchline");
  });
});
