import { describe, expect, it } from "vitest";
import {
  cohortBlurb,
  cohortCoverHues,
  cohortInitials,
  cohortKind,
  cohortKindCounts,
  cohortSubject,
} from "./cohortPresentation";
import type { CommunityCohort } from "../../lib/api";

function cohort(cohortType: string, title: string): CommunityCohort {
  return { cohortType, title } as CommunityCohort;
}

describe("cohortPresentation", () => {
  it("reads the subject from the cohort title", () => {
    expect(cohortSubject("Soul listeners")).toBe("Soul");
    expect(cohortSubject("Lagos night show supporters")).toBe("Lagos night show");
    expect(cohortSubject("listeners")).toBe("listeners");
  });

  it("writes plain blurbs per kind", () => {
    expect(cohortBlurb(cohort("taste", "R&b listeners"))).toBe("People who play a lot of R&b.");
    expect(cohortBlurb(cohort("artist_affinity", "Mawa Traoré listeners"))).toBe("Fans who keep coming back to Mawa Traoré.");
    expect(cohortBlurb(cohort("mystery", "X"))).toBe("Listeners who share your taste.");
  });

  it("makes initials for covers, including non-Latin names", () => {
    expect(cohortInitials("Soul listeners")).toBe("So");
    expect(cohortInitials("Musiques Du Monde listeners")).toBe("MD");
    expect(cohortInitials("R&b listeners")).toBe("RB");
    expect(cohortInitials("Ólafur Arnalds listeners")).toBe("ÓA");
    expect(cohortInitials("   ")).toBe("R");
  });

  it("gives the same cohort the same cover hues, within the brand range", () => {
    const first = cohortCoverHues("taste:Soul listeners");
    expect(cohortCoverHues("taste:Soul listeners")).toEqual(first);
    for (const seed of ["a", "b", "taste:Rap", "artist:Fabolous", "scene:Paris"]) {
      const { base } = cohortCoverHues(seed);
      expect(base >= 230 || base < 20).toBe(true);
    }
  });

  it("counts kinds in display order", () => {
    expect(cohortKind("city_scene")).toBe("city_scene");
    expect(cohortKind("nope")).toBe("other");
    expect(cohortKindCounts([cohort("artist_affinity", "a"), cohort("taste", "b"), cohort("taste", "c")])).toEqual([
      { kind: "taste", count: 2 },
      { kind: "artist_affinity", count: 1 },
    ]);
  });
});
