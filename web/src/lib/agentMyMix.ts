import type {
  AgentMixCoverage,
  AgentMixVocabulary,
  AgentNextPreferences,
  AgentMyMixAddition,
  AgentMyMixPreferences,
  ConfirmedTasteEdit,
  ListeningLane,
  ListeningLaneContextKey,
} from "./api";
import { getPlaybackLocalContext } from "./playbackAnalytics";

export const MAX_MY_MIX_ADDITIONS = 2;
export const MAX_MY_MIX_TASTE_EDITS = 20;
const MAX_SAVED_LANE_TERMS_PER_KIND = 5;

const CONTEXT_LABELS: Record<ListeningLaneContextKey, string> = {
  "night:weekday": "Night · weekdays",
  "night:weekend": "Night · weekends",
  "morning:weekday": "Morning · weekdays",
  "morning:weekend": "Morning · weekends",
  "afternoon:weekday": "Afternoon · weekdays",
  "afternoon:weekend": "Afternoon · weekends",
  "evening:weekday": "Evening · weekdays",
  "evening:weekend": "Evening · weekends",
};

/** One centralized entitlement seam; Listener Pro controls stay off until entitlement policy exists. */
export function isListenerProEnabled(): boolean {
  return false;
}

/** Read only local Date fields and return the existing coarse context bucket. */
export function getMyMixLocalContext(now = new Date()): ListeningLaneContextKey {
  const { localHourBucket, weekdayKind } = getPlaybackLocalContext(now);
  return `${localHourBucket}:${weekdayKind}` as ListeningLaneContextKey;
}

/** Re-bucket My Mix at each request, so a long session follows the current local context. */
export function withCurrentMyMixContext(
  preferences: AgentNextPreferences,
  now = new Date(),
): AgentNextPreferences {
  if (!preferences.myMix) return preferences;
  return {
    ...preferences,
    myMix: { ...preferences.myMix, context: getMyMixLocalContext(now) },
  };
}

export function myMixContextLabel(context: ListeningLaneContextKey | undefined): string | null {
  return context ? CONTEXT_LABELS[context] : null;
}

/** Omit `lanes` so the backend's documented default selects every visible lane. */
export function createMyMixPreferences(now = new Date()): AgentMyMixPreferences {
  return { context: getMyMixLocalContext(now) };
}

/** Resolve the editor's selected lanes against the current visible catalog lanes. */
export function selectedMyMixLanes(
  preferences: AgentMyMixPreferences,
  visibleLanes: readonly ListeningLane[],
): Array<{ id: string; boost?: boolean }> {
  const configured = preferences.lanes;
  const configuredById = new Map(configured?.map((lane) => [lane.id, lane]));
  return visibleLanes
    .filter((lane) => !lane.hidden)
    .flatMap((lane) => {
      const selected = configured === undefined ? true : configuredById.has(lane.id);
      if (!selected) return [];
      const boost = configuredById.get(lane.id)?.boost === true;
      return [{ id: lane.id, ...(boost ? { boost: true } : {}) }];
    });
}

export function setMyMixLaneIncluded(
  preferences: AgentMyMixPreferences,
  visibleLanes: readonly ListeningLane[],
  laneId: string,
  included: boolean,
): AgentMyMixPreferences {
  if (!visibleLanes.some((lane) => lane.id === laneId && !lane.hidden)) return preferences;
  const selected = selectedMyMixLanes(preferences, visibleLanes);
  const current = selected.some((lane) => lane.id === laneId);
  if (current === included) return preferences;
  const lanes = included
    ? [...selected, { id: laneId }]
    : selected.filter((lane) => lane.id !== laneId);
  return { ...preferences, lanes };
}

export function setMyMixLaneBoost(
  preferences: AgentMyMixPreferences,
  visibleLanes: readonly ListeningLane[],
  laneId: string,
  boost: boolean,
): AgentMyMixPreferences {
  const selected = selectedMyMixLanes(preferences, visibleLanes);
  if (!selected.some((lane) => lane.id === laneId)) return preferences;
  return {
    ...preferences,
    lanes: selected.map((lane) =>
      lane.id === laneId
        ? { id: lane.id, ...(boost ? { boost: true } : {}) }
        : lane,
    ),
  };
}

export function myMixAdditionOptions(vocabulary: AgentMixVocabulary) {
  return {
    genres: [...new Set(vocabulary.genres.map((genre) => genre.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    moods: [...new Set(vocabulary.moods.map((mood) => mood.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  };
}

function additionKey(addition: AgentMyMixAddition): string | null {
  const genre = addition.genre?.trim();
  const mood = addition.mood?.trim();
  if (genre && !mood) return `genre:${genre.toLowerCase()}`;
  if (mood && !genre) return `mood:${mood.toLowerCase()}`;
  return null;
}

export function addMyMixAddition(
  preferences: AgentMyMixPreferences,
  vocabulary: AgentMixVocabulary,
  addition: AgentMyMixAddition,
): AgentMyMixPreferences {
  const key = additionKey(addition);
  if (!key) return preferences;
  const options = myMixAdditionOptions(vocabulary);
  const kind = addition.genre?.trim() ? "genre" : "mood";
  const normalizedValue = kind === "genre" ? addition.genre!.trim().toLowerCase() : addition.mood!.trim().toLowerCase();
  const values = kind === "genre" ? options.genres : options.moods;
  const canonicalValue = values.find((value) => value.toLocaleLowerCase() === normalizedValue);
  if (!canonicalValue) return preferences;

  const additions = preferences.additions ?? [];
  if (additions.some((candidate) => additionKey(candidate) === key) || additions.length >= MAX_MY_MIX_ADDITIONS) {
    return preferences;
  }
  return {
    ...preferences,
    additions: [...additions, kind === "genre" ? { genre: canonicalValue } : { mood: canonicalValue }],
  };
}

export function removeMyMixAddition(
  preferences: AgentMyMixPreferences,
  addition: AgentMyMixAddition,
): AgentMyMixPreferences {
  const key = additionKey(addition);
  if (!key) return preferences;
  return {
    ...preferences,
    additions: (preferences.additions ?? []).filter((candidate) => additionKey(candidate) !== key),
  };
}

/**
 * Explicitly saved My Mix additions and boosted lanes become catalog boosts.
 * The bounded, stable payload favors explicit additions and never includes
 * removed or unchanged lanes.
 */
export function buildMyMixTasteEdits(
  preferences: AgentMyMixPreferences,
  visibleLanes: readonly ListeningLane[],
): ConfirmedTasteEdit[] {
  const edits: ConfirmedTasteEdit[] = [];
  const seen = new Set<string>();
  const add = (signalType: "genre" | "mood", rawValue: string) => {
    const value = rawValue.trim();
    const key = `${signalType}:${value.toLowerCase()}`;
    if (!value || seen.has(key) || edits.length >= MAX_MY_MIX_TASTE_EDITS) return;
    seen.add(key);
    edits.push({ signalType, value, action: "boosted" });
  };

  for (const addition of preferences.additions ?? []) {
    if (addition.genre?.trim() && !addition.mood?.trim()) add("genre", addition.genre);
    else if (addition.mood?.trim() && !addition.genre?.trim()) add("mood", addition.mood);
  }

  const laneById = new Map(visibleLanes.filter((lane) => !lane.hidden).map((lane) => [lane.id, lane]));
  for (const selection of selectedMyMixLanes(preferences, visibleLanes)) {
    if (!selection.boost) continue;
    const lane = laneById.get(selection.id);
    if (!lane) continue;
    for (const [genre] of positiveRankedTerms(lane.genreWeights).slice(0, MAX_SAVED_LANE_TERMS_PER_KIND)) {
      add("genre", genre);
    }
    for (const [mood] of positiveRankedTerms(lane.moodWeights).slice(0, MAX_SAVED_LANE_TERMS_PER_KIND)) {
      add("mood", mood);
    }
  }
  return edits;
}

function positiveRankedTerms(weights: Record<string, number>): Array<[string, number]> {
  return Object.entries(weights)
    .filter(([term, weight]) => term.trim() && Number.isFinite(weight) && weight > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function myMixCoverageNotes(coverage: AgentMixCoverage | null | undefined): string[] {
  if (!coverage) return [];
  return coverage.lanes
    .filter((lane) => lane.requested > lane.matched)
    .map((lane) => {
      const label = lane.label.trim();
      const safeLabel = !label || label === lane.id || /^(?:lane|mix)_[a-f0-9]{16,}$/i.test(label)
        ? "this lane"
        : label;
      return lane.matched <= 0
        ? `Not enough new tracks for ${safeLabel} yet.`
        : `Only ${lane.matched} of ${lane.requested} picks matched ${safeLabel}.`;
    });
}
