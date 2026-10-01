import { discoveryVariantForUser } from "../recommendations/discovery_experiment";

/**
 * #2005 WS-8: ranker variant labels for an accepted AI DJ pick.
 *
 * Uses the same deterministic assignment the agent runtime records on the
 * DJ's `recommendation.generated` event (`discoveryVariantForUser`), so a
 * pick's play, skip and save are attributed to the variant the listener was
 * in, never re-bucketed. Labels only: the bucket is not exposed, and the
 * response field is additive. `experimentKey` appears only when an experiment
 * is configured.
 */
export interface DjPickVariantFields {
  rankerVariant: string;
  experimentKey?: string;
}

export function djPickVariantFields(
  userId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): DjPickVariantFields {
  const variant = discoveryVariantForUser(userId, env);
  return {
    rankerVariant: variant.rankerVariant,
    ...(variant.experimentKey ? { experimentKey: variant.experimentKey } : {}),
  };
}
