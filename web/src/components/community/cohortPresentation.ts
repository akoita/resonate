import type { CommunityCohort } from "../../lib/api";

/**
 * Listener-facing presentation for community cohorts: short kind labels,
 * plain-language blurbs, and a deterministic generated cover.
 *
 * Cohorts carry no artwork of their own (a cohort is a signal, not a
 * release), so each tile gets a cover generated from its title: a hue picked
 * from the brand range and the subject's initials. The same cohort always gets
 * the same cover, and nothing here reads anything beyond what the card already
 * shows (type and title).
 */

export type CohortKind = "taste" | "artist_affinity" | "city_scene" | "collector" | "campaign" | "other";

const KNOWN_KINDS: readonly CohortKind[] = ["taste", "artist_affinity", "city_scene", "collector", "campaign"];

export function cohortKind(type: string): CohortKind {
  return (KNOWN_KINDS as readonly string[]).includes(type) ? (type as CohortKind) : "other";
}

/** Short label for filter chips and tile badges. */
export function cohortKindLabel(kind: CohortKind) {
  const labels: Record<CohortKind, string> = {
    taste: "Genre",
    artist_affinity: "Artist",
    city_scene: "Scene",
    collector: "Collectors",
    campaign: "Show",
    other: "Community",
  };
  return labels[kind];
}

/** Plural label for the filter chips ("Genres 8"). */
export function cohortKindFilterLabel(kind: CohortKind) {
  const labels: Record<CohortKind, string> = {
    taste: "Genres",
    artist_affinity: "Artists",
    city_scene: "Scenes",
    collector: "Collectors",
    campaign: "Shows",
    other: "Other",
  };
  return labels[kind];
}

/** Display order of the kinds in filters. */
export const COHORT_KIND_ORDER: readonly CohortKind[] = [
  "taste",
  "artist_affinity",
  "city_scene",
  "collector",
  "campaign",
  "other",
];

/**
 * The subject the cohort gathers around, from its title: "Soul listeners"
 * gives "Soul". Titles that do not follow the pattern are kept whole.
 */
export function cohortSubject(title: string) {
  const trimmed = title.trim();
  const subject = trimmed.replace(/\s+(listeners|supporters|collectors|fans)$/i, "").trim();
  return subject || trimmed;
}

/** One plain sentence on who is in the group. */
export function cohortBlurb(cohort: Pick<CommunityCohort, "cohortType" | "title">) {
  const subject = cohortSubject(cohort.title);
  switch (cohortKind(cohort.cohortType)) {
    case "taste":
      return `People who play a lot of ${subject}.`;
    case "artist_affinity":
      return `Fans who keep coming back to ${subject}.`;
    case "city_scene":
      return "Listeners who follow the same live scene.";
    case "collector":
      return "Listeners collecting stems from the same artists.";
    case "campaign":
      return "Listeners backing the same show.";
    default:
      return "Listeners who share your taste.";
  }
}

/** Up to two initials for the generated cover. */
export function cohortInitials(title: string) {
  const words = cohortSubject(title)
    .split(/[\s&/+-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "R";
  if (words.length === 1) {
    const [first = "", second = ""] = Array.from(words[0]);
    return `${first.toUpperCase()}${second.toLowerCase()}`;
  }
  const [first = ""] = Array.from(words[0]);
  const [second = ""] = Array.from(words[1]);
  return `${first}${second}`.toUpperCase();
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Two hues for the cover gradient. The base hue sweeps the brand range from
 * hyacinth violet through blue-violet, magenta and into the tomato coral, so
 * every cover reads as Resonate while neighbouring tiles still differ.
 */
export function cohortCoverHues(seed: string) {
  const hash = hashString(seed);
  // 230..380 wraps past 360 into the reds and corals (0..20).
  const base = (230 + (hash % 150)) % 360;
  const accent = (base + 28 + ((hash >>> 8) % 40)) % 360;
  return { base, accent };
}

/** Cohorts grouped for the page: the ones you joined, then suggestions. */
export function groupCohorts(cohorts: CommunityCohort[]) {
  const visible = cohorts.filter((cohort) => cohort.membership.status !== "hidden");
  return {
    joined: visible.filter((cohort) => cohort.membership.status === "joined"),
    suggested: visible.filter((cohort) => cohort.membership.status !== "joined"),
  };
}

/** Kinds present in the list, in display order, with their counts. */
export function cohortKindCounts(cohorts: CommunityCohort[]) {
  const counts = new Map<CohortKind, number>();
  for (const cohort of cohorts) {
    const kind = cohortKind(cohort.cohortType);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return COHORT_KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
}
