import { describe, expect, it } from "vitest";
import { isFullMixStemType } from "../components/remix/RemixStudioEditor";
import {
  applicableRecipes,
  applyRecipe,
  REMIX_RECIPES,
  type RecipeStem,
  type StemEditLike,
} from "./remixRecipes";

const FULL_BAND: RecipeStem[] = [
  { stemId: "s-vox", type: "Vocals" },
  { stemId: "s-drums", type: "drums" },
  { stemId: "s-bass", type: "BASS" },
  { stemId: "s-perc", type: "percussion" },
  { stemId: "s-other", type: "other" },
  { stemId: "s-master", type: "original" },
];

function edits(
  stems: RecipeStem[],
  overrides: Record<string, Partial<StemEditLike>> = {},
): Record<string, StemEditLike> {
  const out: Record<string, StemEditLike> = {};
  for (const stem of stems) {
    out[stem.stemId] = {
      gainDb: null,
      muted: stem.type === "original",
      sections: null,
      ...overrides[stem.stemId],
    };
  }
  return out;
}

function ids(stems: RecipeStem[], grid: number): string[] {
  return applicableRecipes(stems, grid).map((recipe) => recipe.id);
}

describe("REMIX_RECIPES", () => {
  it("lists the four recipes with labels and descriptions", () => {
    expect(REMIX_RECIPES.map((recipe) => recipe.id)).toEqual([
      "acapella",
      "instrumental",
      "drums_bass",
      "breakdown_drop",
    ]);
    for (const recipe of REMIX_RECIPES) {
      expect(recipe.label).not.toBe("");
      expect(recipe.description).not.toBe("");
    }
  });
});

describe("applicableRecipes", () => {
  it("offers every recipe for a full band with a grid", () => {
    expect(ids(FULL_BAND, 4)).toEqual([
      "acapella",
      "instrumental",
      "drums_bass",
      "breakdown_drop",
    ]);
  });

  it("drops the breakdown without a grid of at least two sections", () => {
    expect(ids(FULL_BAND, 0)).not.toContain("breakdown_drop");
    expect(ids(FULL_BAND, 1)).not.toContain("breakdown_drop");
    expect(ids(FULL_BAND, 2)).toContain("breakdown_drop");
  });

  it("drops vocal recipes without a vocals stem", () => {
    const stems = FULL_BAND.filter((stem) => stem.stemId !== "s-vox");
    expect(ids(stems, 4)).toEqual(["drums_bass", "breakdown_drop"]);
  });

  it("drops drums_bass without drums or bass", () => {
    const stems: RecipeStem[] = [
      { stemId: "v", type: "vocals" },
      { stemId: "p", type: "percussion" },
      { stemId: "o", type: "other" },
    ];
    expect(ids(stems, 4)).toEqual(["acapella", "instrumental", "breakdown_drop"]);
  });

  it("offers drums_bass with only one of drums or bass", () => {
    const stems: RecipeStem[] = [
      { stemId: "b", type: "bass" },
      { stemId: "o", type: "other" },
    ];
    expect(ids(stems, 0)).toEqual(["drums_bass"]);
  });

  it("skips recipes that would change nothing", () => {
    // Only vocals: acapella is the current state, instrumental would be silent.
    expect(ids([{ stemId: "v", type: "vocals" }], 4)).toEqual([]);
    // Only rhythm stems: drums_bass changes nothing; a breakdown is silence.
    expect(
      ids(
        [
          { stemId: "d", type: "drums" },
          { stemId: "b", type: "bass" },
        ],
        4,
      ),
    ).toEqual([]);
  });

  it("never counts full-mix reference stems as parts", () => {
    expect(
      ids(
        [
          { stemId: "v", type: "vocals" },
          { stemId: "m", type: "master" },
          { stemId: "o", type: "original" },
        ],
        4,
      ),
    ).toEqual([]);
    expect(ids([{ stemId: "m", type: "original" }], 4)).toEqual([]);
  });
});

describe("applyRecipe", () => {
  it("acapella leaves only the vocals audible and keeps gain", () => {
    const current = edits(FULL_BAND, {
      "s-vox": { gainDb: -3, sections: [true, false, true, true] },
      "s-drums": { gainDb: 2 },
    });
    const next = applyRecipe("acapella", FULL_BAND, current, 4);
    expect(next["s-vox"]).toEqual({ gainDb: -3, muted: false, sections: null });
    expect(next["s-drums"]).toEqual({ gainDb: 2, muted: true, sections: null });
    expect(next["s-bass"].muted).toBe(true);
    expect(next["s-perc"].muted).toBe(true);
    expect(next["s-other"].muted).toBe(true);
    expect(next["s-master"]).toEqual(current["s-master"]);
  });

  it("instrumental mutes the vocals and plays everything else", () => {
    const next = applyRecipe(
      "instrumental",
      FULL_BAND,
      edits(FULL_BAND, { "s-drums": { muted: true } }),
      4,
    );
    expect(next["s-vox"].muted).toBe(true);
    for (const id of ["s-drums", "s-bass", "s-perc", "s-other"]) {
      expect(next[id].muted).toBe(false);
      expect(next[id].sections).toBeNull();
    }
    expect(next["s-master"].muted).toBe(true);
  });

  it("drums_bass keeps only drums and bass (percussion is not included)", () => {
    const next = applyRecipe("drums_bass", FULL_BAND, edits(FULL_BAND), 4);
    expect(next["s-drums"].muted).toBe(false);
    expect(next["s-bass"].muted).toBe(false);
    expect(next["s-perc"].muted).toBe(true);
    expect(next["s-vox"].muted).toBe(true);
    expect(next["s-other"].muted).toBe(true);
  });

  it("silenced stems keep their section masks, normalized", () => {
    const next = applyRecipe(
      "acapella",
      FULL_BAND,
      edits(FULL_BAND, {
        "s-drums": { sections: [true, false, true, true] },
        "s-bass": { sections: [true, true, true, true] },
      }),
      4,
    );
    expect(next["s-drums"].sections).toEqual([true, false, true, true]);
    expect(next["s-bass"].sections).toBeNull();
  });

  it("breakdown_drop switches rhythm off for the first half", () => {
    const current = edits(FULL_BAND, {
      "s-vox": { muted: true, sections: [false, true, true, true] },
      "s-drums": { gainDb: 4 },
    });
    const next = applyRecipe("breakdown_drop", FULL_BAND, current, 4);
    const half = [false, false, true, true];
    expect(next["s-drums"]).toEqual({ gainDb: 4, muted: false, sections: half });
    expect(next["s-bass"].sections).toEqual(half);
    expect(next["s-perc"].sections).toEqual(half);
    expect(next["s-vox"]).toEqual({ gainDb: null, muted: false, sections: null });
    expect(next["s-other"]).toEqual({ gainDb: null, muted: false, sections: null });
    expect(next["s-master"].muted).toBe(true);
  });

  it("breakdown_drop rounds the first half down on odd grids", () => {
    expect(
      applyRecipe("breakdown_drop", FULL_BAND, edits(FULL_BAND), 3)["s-drums"].sections,
    ).toEqual([false, true, true]);
    expect(
      applyRecipe("breakdown_drop", FULL_BAND, edits(FULL_BAND), 2)["s-drums"].sections,
    ).toEqual([false, true]);
  });

  it("keeps an unmuted legacy full-mix stem muted so it cannot double the parts", () => {
    const current = edits(FULL_BAND, {
      "s-master": { muted: false, gainDb: -6, sections: [true, false, true, true] },
    });
    const next = applyRecipe("instrumental", FULL_BAND, current, 4);
    expect(next["s-master"]).toEqual({
      gainDb: -6,
      muted: true,
      sections: [true, false, true, true],
    });
  });

  it("returns the edits unchanged for unknown or inapplicable recipes", () => {
    const current = edits(FULL_BAND);
    expect(applyRecipe("mystery", FULL_BAND, current, 4)).toEqual(current);
    expect(applyRecipe("breakdown_drop", FULL_BAND, current, 1)).toEqual(current);
    const noVocals = FULL_BAND.filter((stem) => stem.stemId !== "s-vox");
    const withoutVocals = edits(noVocals);
    expect(applyRecipe("acapella", noVocals, withoutVocals, 4)).toEqual(withoutVocals);
  });

  it("does not mutate the input and preserves unknown stems", () => {
    const current = { ...edits(FULL_BAND), ghost: { gainDb: 1, muted: false, sections: null } };
    const snapshot = JSON.parse(JSON.stringify(current));
    const next = applyRecipe("acapella", FULL_BAND, current, 4);
    expect(current).toEqual(snapshot);
    expect(next.ghost).toEqual(current.ghost);
  });

  it("fills in missing edits with defaults", () => {
    const next = applyRecipe("acapella", FULL_BAND, {}, 4);
    expect(next["s-vox"]).toEqual({ gainDb: null, muted: false, sections: null });
    expect(next["s-drums"]).toEqual({ gainDb: null, muted: true, sections: null });
  });

  it("classifies full-mix types exactly like the editor", () => {
    for (const type of ["original", " Master ", "MASTER", "other", "", "drums"]) {
      const stems: RecipeStem[] = [
        { stemId: "v", type: "vocals" },
        { stemId: "x", type },
      ];
      // A full-mix stem is not a part, so vocals alone cannot form an acapella.
      expect(ids(stems, 0).includes("acapella")).toBe(!isFullMixStemType(type));
    }
  });
});
