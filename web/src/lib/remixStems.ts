/**
 * Stem classification shared by the Remix Studio editor and its pure helpers
 * (#1879), so the recipes and the editor can never disagree.
 */

const FULL_MIX_STEM_TYPES = new Set(["original", "master"]);

/** Whether a stem is the track's full mix rather than a separated part. */
export function isFullMixStemType(type: string | null | undefined): boolean {
  return FULL_MIX_STEM_TYPES.has((type ?? "").trim().toLowerCase());
}
