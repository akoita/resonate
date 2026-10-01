/**
 * The bounded, categorical explanation vocabulary shared by every discovery
 * surface (Home feed, AI DJ, Crate Digger). RFC docs/rfc/taste-engine.md §3.5,
 * ADR-TE-2 rule 4 (docs/strategy/taste-engine-decisions.md).
 *
 * Rules for this file:
 *  - Sentences are categorical: they describe WHY a track fits the listener,
 *    never name another listener or itemize anyone's history.
 *  - Every explanation string emitted by the ranking core or the policy stage
 *    comes from here, so the set of reasons a listener can see stays small and
 *    reviewable. The web app localizes by `DiscoveryReasonCode`.
 *  - There is deliberately NO code for commercial availability: having stems
 *    for sale is not a reason to recommend a track (ADR-TE-2 rule 1).
 */

export const DISCOVERY_REASON_CODES = [
  "taste_match",
  "nearby_taste",
  "learned_taste",
  "similar_sound",
  "session_fit",
  "listening_pattern",
  "fresh_pick",
  "library_signal",
  "scene",
  "discovery_pick",
  "catalog",
] as const;

export type DiscoveryReasonCode = (typeof DISCOVERY_REASON_CODES)[number];

/** The primary sentence for each reason code. */
export const DISCOVERY_EXPLANATIONS: Record<DiscoveryReasonCode, string> = {
  taste_match: "Selected vibe match",
  nearby_taste: "Nearby vibe match",
  learned_taste: "Boosted by learned taste",
  similar_sound: "Sounds close to your taste",
  session_fit: "Fits this session intent",
  listening_pattern: "Learned listening pattern fit",
  fresh_pick: "Fresh pick based on replay and skip patterns",
  library_signal: "Strong save or purchase signal",
  // Scene / cohort sentences are templated by the community module
  // ("From your {cohort} cohort"); this is the generic fallback.
  scene: "Popular with listeners in your scene",
  discovery_pick: "Discovery pick: new verified artist close to your taste",
  catalog: "Catalog candidate",
};

/** Sentence variants that share a reason code with a primary sentence. */
export const DISCOVERY_EXPLANATION_VARIANTS = {
  /** `learned_taste` when the genre was downranked by the listener (x0.35; a boost is x1.5). */
  learned_taste_light: "Lightly boosted by learned taste",
  /** A genre or mood the listener asked for more of in a confirmed taste edit. */
  declared_taste: "You asked for more of this",
} as const;

/** Energy match is templated by the requested band; stays categorical. */
export function energyMatchExplanation(energy: "low" | "medium" | "high") {
  return `${energy} energy match`;
}

/** Categories a warehouse taste explanation can fall into. */
export type AnalyticsExplanationType =
  | "taste_fit"
  | "intent_fit"
  | "novelty_fit"
  | "commerce_fit";

const ANALYTICS_REASON_CODE: Record<
  AnalyticsExplanationType,
  DiscoveryReasonCode
> = {
  taste_fit: "listening_pattern",
  intent_fit: "session_fit",
  novelty_fit: "fresh_pick",
  commerce_fit: "library_signal",
};

/**
 * Classify a free-text warehouse explanation into at most three bounded
 * categories (first = primary). The free text itself is never shown to the
 * listener, only the category sentence.
 */
export function classifyAnalyticsExplanation(
  explanation?: string,
): AnalyticsExplanationType[] {
  const normalized = explanation?.toLowerCase() ?? "";
  const types: AnalyticsExplanationType[] = [];

  if (/\b(intent|mood|vibe|focus|chill|hype|zen|session)\b/.test(normalized)) {
    types.push("intent_fit");
  }
  if (
    /\b(save|playlist|purchase|bought|commerce|listing|x402)\b/.test(normalized)
  ) {
    types.push("commerce_fit");
  }
  if (/\b(skips?|replays?|repeats?|fresh|novel|new|recent)\b/.test(normalized)) {
    types.push("novelty_fit");
  }
  if (
    types.length === 0 ||
    /\b(taste|listen|listening|pattern|signal|score|similar)\b/.test(normalized)
  ) {
    types.unshift("taste_fit");
  }
  return Array.from(new Set(types)).slice(0, 3);
}

export function reasonCodeForAnalyticsType(
  type: AnalyticsExplanationType,
): DiscoveryReasonCode {
  return ANALYTICS_REASON_CODE[type];
}

export function analyticsExplanationSentence(
  type: AnalyticsExplanationType,
): string {
  return DISCOVERY_EXPLANATIONS[ANALYTICS_REASON_CODE[type]];
}

/** Minimal shape `primaryReasonFor` needs, so it works on any ranked item. */
export interface ReasonSignal {
  label: string;
  weight: number;
  reason: string;
}

/**
 * Tie-break order when two explainable signals carry equal weight. Earlier =
 * preferred. Fixed so the primary reason is deterministic.
 */
const LABEL_PRIORITY = [
  "taste_match",
  "expanded_taste_match",
  "declared_preference",
  "declared_note_match",
  "learned_preference",
  "bigquery_taste_score",
  "session_intent_fit",
  "energy_match",
  "cohort_context",
  "semantic_similarity",
  "embedding_similarity",
] as const;

function codeForSignal(signal: ReasonSignal): DiscoveryReasonCode | null {
  switch (signal.label) {
    case "taste_match":
      return "taste_match";
    case "expanded_taste_match":
      return "nearby_taste";
    case "learned_preference":
      return "learned_taste";
    // A declared boost reads as an explicit selection, so it shares the
    // `taste_match` code; the sentence above distinguishes it (#1961).
    case "declared_preference":
      return "taste_match";
    // A written note is a declared preference too (#2006): same code, and the
    // "You asked for more of this" sentence tells it apart.
    case "declared_note_match":
      return "taste_match";
    case "semantic_similarity":
    // Neighbour of a saved or finished track (#2003): "sounds close to your taste".
    case "embedding_similarity":
      return "similar_sound";
    case "energy_match":
    case "session_intent_fit":
      return "session_fit";
    case "cohort_context":
      return "scene";
    case "bigquery_taste_score": {
      const [primary] = classifyAnalyticsExplanation(signal.reason);
      return reasonCodeForAnalyticsType(primary ?? "taste_fit");
    }
    // `audio_features` (no sentence), `recently_played` and
    // `negative_preference` (penalties) never explain a recommendation.
    default:
      return null;
  }
}

/**
 * The primary reason code for a ranked item: the explainable positive signal
 * with the greatest weight (ties broken by `LABEL_PRIORITY`), or `catalog`
 * when nothing explainable fired. Pure and deterministic.
 */
export function primaryReasonFor(
  signals: readonly ReasonSignal[],
): DiscoveryReasonCode {
  let best: { code: DiscoveryReasonCode; weight: number; rank: number } | null =
    null;
  for (const signal of signals) {
    if (!(signal.weight > 0)) continue;
    const code = codeForSignal(signal);
    if (!code) continue;
    const priority = LABEL_PRIORITY.indexOf(
      signal.label as (typeof LABEL_PRIORITY)[number],
    );
    const rank = priority === -1 ? LABEL_PRIORITY.length : priority;
    if (
      !best ||
      signal.weight > best.weight ||
      (signal.weight === best.weight && rank < best.rank)
    ) {
      best = { code, weight: signal.weight, rank };
    }
  }
  return best?.code ?? "catalog";
}
