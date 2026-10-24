import {
  AGENT_RIGHT_NOW_MAX_HIGHLIGHTS,
  AGENT_RIGHT_NOW_MIN_CONTEXT_SHARE,
} from "../../config/agent_learning";
import { genreFamilyById } from "../recommendations/genre_families";
import {
  MY_MIX_CONTEXTS,
  resolveMyMixPlan,
  type MyMixContext,
  type ResolvedMyMixLane,
  type ResolvedMyMixPlan,
} from "./agent_my_mix";
import type { ListeningLane } from "./listening_lanes";

/**
 * "Right now" (#2245): a session with no filters weights the listener's habit
 * lanes by the current coarse time/day bucket instead of the flat saved vibes.
 *
 * It reuses My Mix wholesale: the same eight buckets, the same context gain and
 * the same largest-remainder lane allocation (`resolveMyMixPlan`). What is new
 * is only the decision of when the history is enough, and the plain summary the
 * web shows as the reason. Pure: no database, no clock, no logging. The bucket
 * is the only thing a client sends (never a timezone, a timestamp or a place),
 * and nothing here stores it.
 */

/** Why "Right now" cannot weight the habits yet; the session then uses the saved vibes. */
export type RightNowColdReason = "no_history" | "no_context_history";

export type RightNowSummary =
  | {
    status: "ready";
    context: MyMixContext;
    /** The genres the listener usually plays in this bucket, strongest first. */
    highlights: string[];
  }
  | {
    status: "cold_start";
    context: MyMixContext;
    reason: RightNowColdReason;
  };

export interface RightNowResolution {
  summary: RightNowSummary;
  /** The My Mix lane plan weighted by the bucket. Absent on a cold start. */
  plan?: ResolvedMyMixPlan;
}

export function isRightNowContext(value: unknown): value is MyMixContext {
  return typeof value === "string" && (MY_MIX_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Resolves "Right now" for the listener's current visible lanes. A lane belongs
 * to the bucket when its weight there is a meaningful share of its strongest
 * bucket. No lanes at all, or no lane with that bucket in its habits, is a cold
 * start: the plan is withheld and the caller keeps the taste-driven path.
 */
export function resolveRightNow(
  visibleLanes: readonly ListeningLane[],
  context: MyMixContext,
  limit: number,
): RightNowResolution {
  if (visibleLanes.length === 0) {
    return { summary: { status: "cold_start", context, reason: "no_history" } };
  }
  const plan = resolveMyMixPlan({ context }, [...visibleLanes], limit);
  const inBucket = (plan?.lanes ?? [])
    .filter((lane) => contextShare(lane, context) >= AGENT_RIGHT_NOW_MIN_CONTEXT_SHARE)
    .sort((left, right) => right.allocationWeight - left.allocationWeight || left.id.localeCompare(right.id));
  if (!plan || inBucket.length === 0) {
    return { summary: { status: "cold_start", context, reason: "no_context_history" } };
  }
  const highlights: string[] = [];
  for (const lane of inBucket) {
    const label = topGenreLabel(lane);
    if (label && !highlights.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
      highlights.push(label);
    }
    if (highlights.length >= AGENT_RIGHT_NOW_MAX_HIGHLIGHTS) break;
  }
  return { summary: { status: "ready", context, highlights }, plan };
}

/** The lane's weight in the bucket, as a share of its strongest bucket (0 when it has none). */
function contextShare(lane: ListeningLane, context: MyMixContext): number {
  const here = finitePositive(lane.contexts[context]);
  const strongest = Math.max(0, ...Object.values(lane.contexts).map(finitePositive));
  return here > 0 && strongest > 0 ? here / strongest : 0;
}

/** A lane's strongest genre as a listener reads it ("african" is the family "African"). */
function topGenreLabel(lane: ResolvedMyMixLane): string | undefined {
  const [key] = Object.entries(lane.genreWeights)
    .filter(([, weight]) => finitePositive(weight) > 0)
    .sort(([leftKey, leftWeight], [rightKey, rightWeight]) =>
      rightWeight - leftWeight || leftKey.localeCompare(rightKey),
    )[0] ?? [];
  if (!key) return undefined;
  return genreFamilyById(key)?.label ?? key;
}

function finitePositive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
