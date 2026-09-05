/**
 * Punchline Drops — shared rights posture (#480).
 *
 * A Punchline Drop is a fan collectible, NOT a license. The MVP maps every
 * drop to a single, deliberately restrictive rights class so the UI, the
 * eligibility gate, and the later create/publish APIs (#482) all speak the
 * same label. See docs/features/punchline_drops_mvp.md → "Default MVP rights".
 */

/** Stable machine label for the non-commercial collectible rights class. */
export const PUNCHLINE_RIGHTS_LABEL = "NON_COMMERCIAL_COLLECTIBLE";

/**
 * UI-safe, one-sentence human summary of what a collector actually gets. Kept
 * short enough to render verbatim on a collectible card / publish warning.
 */
export const PUNCHLINE_RIGHTS_SUMMARY =
  "Personal collectible for playback and profile display only — no commercial use, " +
  "no remix or sampling rights, and no transfer of copyright or master ownership.";

/**
 * Release statuses that count as "published" for punchline eligibility. Mirrors
 * the catalog/rights convention (a release is publishable once it reaches
 * `ready` or `published`; anything earlier is still processing).
 */
export const PUNCHLINE_PUBLISHED_RELEASE_STATUSES = [
  "ready",
  "published",
] as const;

/** The only stem type a Punchline Drop can be sourced from in the MVP. */
export const PUNCHLINE_SOURCE_STEM_TYPE = "vocals";
