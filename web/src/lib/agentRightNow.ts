import { hasFilters } from "./agentSessionRequest";
import { getMyMixLocalContext } from "./agentMyMix";
import type { AgentNextPreferences, AgentRightNow, ListeningLaneContextKey } from "./api";

/**
 * "Right now" (#2245): a session with no filters follows the listener's habits
 * for this coarse time of day, and the starter says why in plain words.
 *
 * The context is computed here from the device's local clock and sent as one of
 * eight buckets only, the same buckets My Mix uses: never a timezone, a
 * timestamp or a place.
 */

const WEEKDAY_WORDS = { weekday: "weekday", weekend: "weekend" } as const;

/** "weekday-evening": how the bucket reads in a sentence. */
export function rightNowPhrase(context: ListeningLaneContextKey): string {
  const [hour, day] = context.split(":") as [string, keyof typeof WEEKDAY_WORDS];
  return `${WEEKDAY_WORDS[day]}-${hour}`;
}

/** The starter's visible reason. A cold start says so and names the fallback. */
export function rightNowReason(rightNow: AgentRightNow): string {
  if (rightNow.status === "ready") {
    return `Your usual ${rightNowPhrase(rightNow.context)} mix: ${rightNow.highlights.join(", ")}.`;
  }
  return rightNow.reason === "no_context_history"
    ? `Not enough listening history for a ${rightNowPhrase(rightNow.context)} yet. Your DJ will start from your saved vibes.`
    : "Not enough listening history yet. Your DJ will start from your saved vibes.";
}

/**
 * Adds the "Right now" bucket to the preferences of a session that has no
 * filters of its own, so the server can weight the listener's habits by the
 * time of day. A session with a starter, a sentence, any filter, an artist, a
 * seed or My Mix is returned untouched: its request decides, not the clock.
 *
 * Saved vibes in `genres` are not filters: a plain pick carries them as the
 * cold-start fallback.
 */
export function withRightNowContext(
  preferences: AgentNextPreferences | undefined,
  now = new Date(),
): AgentNextPreferences | undefined {
  const bare = preferences ?? {};
  const hasOwnFilters =
    Boolean(bare.myMix) ||
    Boolean(bare.sessionIntent) ||
    Boolean(bare.sessionIntentName) ||
    hasFilters(bare.request) ||
    Boolean(bare.mood) ||
    Boolean(bare.energy) ||
    Boolean(bare.requestText?.trim()) ||
    (bare.artists?.length ?? 0) > 0 ||
    Boolean(bare.seed) ||
    Boolean(bare.seedTrackId) ||
    bare.newArtists === true;
  if (hasOwnFilters) return preferences;
  return { ...bare, listeningContext: getMyMixLocalContext(now) };
}
