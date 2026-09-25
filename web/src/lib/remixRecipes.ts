/**
 * One-click arrangement recipes for the free "Mix stems" render (#1879
 * Phase 2). A recipe rewrites only the mute state and section masks of the
 * user's stems — gain choices are always preserved — so the result is still
 * the user's own arrangement, rendered exactly as heard.
 */

import { isFullMixStemType } from "./remixStems";

export type RemixRecipeId =
  | "acapella"
  | "instrumental"
  | "drums_bass"
  | "breakdown_drop";

export type RemixRecipe = {
  id: RemixRecipeId;
  label: string;
  description: string;
};

/** Structural subset of the studio's per-stem edit. */
export type StemEditLike = {
  gainDb: number | null;
  muted: boolean;
  /** Section mask: null = every section on. */
  sections: boolean[] | null;
};

export type RecipeStem = { stemId: string; type: string };

export const REMIX_RECIPES: readonly RemixRecipe[] = [
  {
    id: "acapella",
    label: "Acapella",
    description: "Only the vocals stay audible.",
  },
  {
    id: "instrumental",
    label: "Instrumental",
    description: "Everything except the vocals.",
  },
  {
    id: "drums_bass",
    label: "Drums & bass",
    description: "Only the drums and bass stay audible.",
  },
  {
    id: "breakdown_drop",
    label: "Breakdown → drop",
    description:
      "Drums, bass and percussion drop out for the first half, then come back in.",
  },
];

const VOCAL_TYPES = new Set(["vocals", "vocal"]);
const DRUM_TYPES = new Set(["drums", "drum"]);
const BASS_TYPES = new Set(["bass"]);
const PERCUSSION_TYPES = new Set(["percussion"]);

function normalizedType(type: string | null | undefined): string {
  return (type ?? "").trim().toLowerCase();
}

function isFullMix(stem: RecipeStem): boolean {
  return isFullMixStemType(stem.type);
}

function isVocal(stem: RecipeStem): boolean {
  return VOCAL_TYPES.has(normalizedType(stem.type));
}

function isDrumsOrBass(stem: RecipeStem): boolean {
  const type = normalizedType(stem.type);
  return DRUM_TYPES.has(type) || BASS_TYPES.has(type);
}

function isRhythm(stem: RecipeStem): boolean {
  return isDrumsOrBass(stem) || PERCUSSION_TYPES.has(normalizedType(stem.type));
}

/** For each recipe: which separated stems stay audible (breakdown: all). */
function recipeKeeps(id: RemixRecipeId): (stem: RecipeStem) => boolean {
  switch (id) {
    case "acapella":
      return isVocal;
    case "instrumental":
      return (stem) => !isVocal(stem);
    case "drums_bass":
      return isDrumsOrBass;
    case "breakdown_drop":
      return () => true;
  }
}

function recipeApplies(
  id: RemixRecipeId,
  separated: RecipeStem[],
  gridSectionCount: number,
): boolean {
  if (id === "breakdown_drop") {
    // Needs a grid to split in half, a rhythm section to drop, and something
    // left playing during the breakdown.
    return (
      gridSectionCount >= 2 &&
      separated.some(isRhythm) &&
      separated.some((stem) => !isRhythm(stem))
    );
  }
  // Mute recipes must keep something and silence something — otherwise they
  // either play nothing or change nothing.
  const keeps = recipeKeeps(id);
  return separated.some(keeps) && separated.some((stem) => !keeps(stem));
}

/**
 * Recipes that make sense for these stems: each needs the stem types it acts
 * on and must actually change the arrangement. Full-mix reference stems never
 * count as parts.
 */
export function applicableRecipes(
  stems: RecipeStem[],
  gridSectionCount: number,
): RemixRecipe[] {
  const separated = stems.filter((stem) => !isFullMix(stem));
  return REMIX_RECIPES.filter((recipe) =>
    recipeApplies(recipe.id, separated, gridSectionCount),
  );
}

function normalizeMask(mask: boolean[] | null): boolean[] | null {
  if (!mask) return null;
  return mask.every(Boolean) ? null : mask;
}

/** First half of the sections off, the rest on. */
function breakdownMask(gridSectionCount: number): boolean[] {
  const offCount = Math.floor(gridSectionCount / 2);
  return Array.from({ length: gridSectionCount }, (_, index) => index >= offCount);
}

/**
 * Applies a recipe to the current per-stem edits. Only `muted` and `sections`
 * change; `gainDb` (and any other field) is preserved. Audible stems play
 * every section (breakdown excepted); silenced stems keep their masks.
 * Full-mix reference stems are kept muted so they never double the parts.
 * Unknown or inapplicable recipes return the edits unchanged.
 */
export function applyRecipe(
  recipeId: string,
  stems: RecipeStem[],
  current: Record<string, StemEditLike>,
  gridSectionCount: number,
): Record<string, StemEditLike> {
  const next: Record<string, StemEditLike> = { ...current };
  const recipe = REMIX_RECIPES.find((entry) => entry.id === recipeId);
  if (!recipe) return next;
  const separated = stems.filter((stem) => !isFullMix(stem));
  if (!recipeApplies(recipe.id, separated, gridSectionCount)) return next;

  const keeps = recipeKeeps(recipe.id);
  for (const stem of stems) {
    const existing: StemEditLike = current[stem.stemId] ?? {
      gainDb: null,
      muted: false,
      sections: null,
    };
    if (isFullMix(stem)) {
      next[stem.stemId] = { ...existing, muted: true };
      continue;
    }
    if (recipe.id === "breakdown_drop") {
      next[stem.stemId] = {
        ...existing,
        muted: false,
        sections: isRhythm(stem) ? normalizeMask(breakdownMask(gridSectionCount)) : null,
      };
      continue;
    }
    next[stem.stemId] = keeps(stem)
      ? { ...existing, muted: false, sections: null }
      : { ...existing, muted: true, sections: normalizeMask(existing.sections) };
  }
  return next;
}
