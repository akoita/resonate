import { AgentRunInput } from "../modules/agents/agent_runner.service";

export type AgentGoldenCaseCategory =
  | "catalog_search_intent"
  | "quote_tool_selection"
  | "policy_budget_refusal"
  | "no_license_refusal"
  | "paid_download_readiness"
  | "ambiguous_intent"
  | "learned_preference_regression";

export type AgentGoldenRubricDimension =
  | "genreMatch"
  | "budgetRespected"
  | "repeatAvoidance"
  | "licensabilityPreference"
  | "failureModeClarity"
  | "learnedPreference";

export interface AgentGoldenRubric {
  deterministicChecks: Array<"status" | "reason" | "licenseType" | "priceCeiling">;
  dimensions: AgentGoldenRubricDimension[];
  judgeSignals: string[];
}

export interface AgentGoldenCase {
  id: string;
  category: AgentGoldenCaseCategory;
  description: string;
  tags: string[];
  input: AgentRunInput;
  expected: {
    status: "approved" | "rejected";
    reason: "policy_ok" | "budget_exceeded";
    licenseType: "personal" | "remix" | "commercial";
    maxPriceUsd?: number;
  };
  rubric: AgentGoldenRubric;
}

const baseInput = {
  userId: "golden-user",
  recentTrackIds: [],
  preferences: {
    mood: "upbeat",
    energy: "medium" as const,
    genres: ["house"],
    allowExplicit: false,
  },
};

const BASE_RUBRIC: AgentGoldenRubric = {
  deterministicChecks: ["status", "reason", "licenseType", "priceCeiling"],
  dimensions: ["budgetRespected", "licensabilityPreference", "failureModeClarity"],
  judgeSignals: [
    "The agent should respect the requested or inferred license type.",
    "The agent should never approve a purchase whose price exceeds the remaining budget.",
    "The agent should provide a stable refusal reason that downstream clients can branch on.",
  ],
};

function makeCase(testCase: Omit<AgentGoldenCase, "rubric"> & { rubric?: AgentGoldenRubric }): AgentGoldenCase {
  const baseRubric = testCase.rubric ?? BASE_RUBRIC;
  return {
    ...testCase,
    rubric: {
      ...baseRubric,
      dimensions: Array.from(new Set([
        ...baseRubric.dimensions,
        ...(testCase.input.preferences.genres?.length ? ["genreMatch" as const] : []),
        ...(testCase.input.recentTrackIds.length ? ["repeatAvoidance" as const] : []),
        ...(Object.keys(testCase.input.preferences.learnedGenreWeights ?? {}).length ? ["learnedPreference" as const] : []),
      ])),
    },
  };
}

export const AGENT_GOLDEN_SET: AgentGoldenCase[] = [
  makeCase({
    id: "personal-budget-pass",
    category: "paid_download_readiness",
    description: "Approves a personal license within a tiny but sufficient budget.",
    tags: ["personal", "budget", "download"],
    input: {
      ...baseInput,
      sessionId: "golden-personal-pass",
      trackId: "track-personal",
      budgetRemainingUsd: 0.02,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "remix-budget-pass",
    category: "quote_tool_selection",
    description: "Approves a remix license when the remix surcharge fits the remaining budget.",
    tags: ["remix", "quote", "budget"],
    input: {
      ...baseInput,
      sessionId: "golden-remix-pass",
      trackId: "track-remix",
      budgetRemainingUsd: 0.06,
      preferences: { ...baseInput.preferences, licenseType: "remix" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "remix",
      maxPriceUsd: 0.061,
    },
  }),
  makeCase({
    id: "commercial-budget-fail",
    category: "policy_budget_refusal",
    description: "Rejects a commercial license when the policy price exceeds remaining budget.",
    tags: ["commercial", "budget", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-commercial-fail",
      trackId: "track-commercial",
      budgetRemainingUsd: 0.05,
      preferences: { ...baseInput.preferences, licenseType: "commercial" },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "commercial",
    },
  }),
  makeCase({
    id: "repeat-listener-discount",
    category: "paid_download_readiness",
    description: "Keeps repeat-listener personal pricing within budget after rounded policy pricing.",
    tags: ["personal", "repeat-listener", "rounding"],
    input: {
      ...baseInput,
      sessionId: "golden-volume-discount",
      trackId: "track-volume",
      recentTrackIds: ["a", "b", "c", "d", "e", "f"],
      budgetRemainingUsd: 0.02,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "default-license-ambiguous-intent",
    category: "ambiguous_intent",
    description: "Defaults ambiguous buying intent to a personal license within budget.",
    tags: ["ambiguous", "default-license"],
    input: {
      ...baseInput,
      sessionId: "golden-default-license",
      trackId: "track-default",
      budgetRemainingUsd: 0.02,
      preferences: { mood: "warm", energy: "medium", genres: ["soul"] },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "personal-budget-under-floor-refusal",
    category: "policy_budget_refusal",
    description: "Rejects a personal quote when the remaining budget is below the minimum price.",
    tags: ["personal", "budget", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-personal-under-budget",
      trackId: "track-personal-under-budget",
      budgetRemainingUsd: 0.019,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "personal",
    },
  }),
  makeCase({
    id: "personal-exact-budget-pass",
    category: "paid_download_readiness",
    description: "Approves a personal quote exactly at the remaining budget boundary.",
    tags: ["personal", "budget-boundary"],
    input: {
      ...baseInput,
      sessionId: "golden-personal-exact-budget",
      trackId: "track-personal-exact-budget",
      budgetRemainingUsd: 0.02,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "personal-large-budget-pass",
    category: "paid_download_readiness",
    description: "Approves a personal license when budget headroom is large.",
    tags: ["personal", "budget-headroom"],
    input: {
      ...baseInput,
      sessionId: "golden-personal-large-budget",
      trackId: "track-personal-large-budget",
      budgetRemainingUsd: 1,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "remix-budget-under-refusal",
    category: "policy_budget_refusal",
    description: "Rejects a remix license when budget is just below the remix quote.",
    tags: ["remix", "budget-boundary", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-remix-under-budget",
      trackId: "track-remix-under-budget",
      budgetRemainingUsd: 0.059,
      preferences: { ...baseInput.preferences, licenseType: "remix" },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "remix",
    },
  }),
  makeCase({
    id: "remix-exact-budget-pass",
    category: "quote_tool_selection",
    description: "Approves a remix license exactly at the remaining budget boundary.",
    tags: ["remix", "budget-boundary", "quote"],
    input: {
      ...baseInput,
      sessionId: "golden-remix-exact-budget",
      trackId: "track-remix-exact-budget",
      budgetRemainingUsd: 0.06,
      preferences: { ...baseInput.preferences, licenseType: "remix" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "remix",
      maxPriceUsd: 0.061,
    },
  }),
  makeCase({
    id: "commercial-budget-pass",
    category: "quote_tool_selection",
    description: "Approves a commercial license when the full commercial quote fits budget.",
    tags: ["commercial", "quote", "budget"],
    input: {
      ...baseInput,
      sessionId: "golden-commercial-pass",
      trackId: "track-commercial-pass",
      budgetRemainingUsd: 0.1,
      preferences: { ...baseInput.preferences, licenseType: "commercial" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "commercial",
      maxPriceUsd: 0.1,
    },
  }),
  makeCase({
    id: "commercial-budget-under-refusal",
    category: "policy_budget_refusal",
    description: "Rejects a commercial license when budget is just below the commercial quote.",
    tags: ["commercial", "budget-boundary", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-commercial-under-budget",
      trackId: "track-commercial-under-budget",
      budgetRemainingUsd: 0.099,
      preferences: { ...baseInput.preferences, licenseType: "commercial" },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "commercial",
    },
  }),
  makeCase({
    id: "repeat-remix-budget-pass",
    category: "quote_tool_selection",
    description: "Keeps repeat-listener remix pricing stable at the rounded quote.",
    tags: ["remix", "repeat-listener", "rounding"],
    input: {
      ...baseInput,
      sessionId: "golden-repeat-remix-pass",
      trackId: "track-repeat-remix",
      recentTrackIds: ["a", "b", "c", "d", "e", "f"],
      budgetRemainingUsd: 0.06,
      preferences: { ...baseInput.preferences, licenseType: "remix" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "remix",
      maxPriceUsd: 0.06,
    },
  }),
  makeCase({
    id: "repeat-commercial-budget-pass",
    category: "quote_tool_selection",
    description: "Keeps repeat-listener commercial pricing stable at the rounded quote.",
    tags: ["commercial", "repeat-listener", "rounding"],
    input: {
      ...baseInput,
      sessionId: "golden-repeat-commercial-pass",
      trackId: "track-repeat-commercial",
      recentTrackIds: ["a", "b", "c", "d", "e", "f"],
      budgetRemainingUsd: 0.1,
      preferences: { ...baseInput.preferences, licenseType: "commercial" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "commercial",
      maxPriceUsd: 0.1,
    },
  }),
  makeCase({
    id: "repeat-personal-under-budget-refusal",
    category: "policy_budget_refusal",
    description: "Rejects repeat-listener personal purchase when rounded quote still exceeds budget.",
    tags: ["personal", "repeat-listener", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-repeat-personal-under-budget",
      trackId: "track-repeat-personal-under-budget",
      recentTrackIds: ["a", "b", "c", "d", "e", "f"],
      budgetRemainingUsd: 0.019,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "personal",
    },
  }),
  makeCase({
    id: "catalog-high-energy-house-personal",
    category: "catalog_search_intent",
    description: "Preserves high-energy house intent while approving a personal license.",
    tags: ["catalog-intent", "house", "high-energy"],
    input: {
      ...baseInput,
      sessionId: "golden-house-high-energy",
      trackId: "track-house-high-energy",
      budgetRemainingUsd: 0.02,
      preferences: {
        mood: "club",
        energy: "high",
        genres: ["house", "garage"],
        allowExplicit: false,
        licenseType: "personal",
      },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "catalog-low-energy-jazz-personal",
    category: "catalog_search_intent",
    description: "Preserves low-energy jazz intent while approving a personal license.",
    tags: ["catalog-intent", "jazz", "low-energy"],
    input: {
      ...baseInput,
      sessionId: "golden-jazz-low-energy",
      trackId: "track-jazz-low-energy",
      budgetRemainingUsd: 0.02,
      preferences: {
        mood: "late night",
        energy: "low",
        genres: ["jazz"],
        allowExplicit: false,
        licenseType: "personal",
      },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "explicit-allowed-remix-budget-pass",
    category: "quote_tool_selection",
    description: "Approves a remix quote when explicit content is allowed by preference.",
    tags: ["explicit", "remix", "quote"],
    input: {
      ...baseInput,
      sessionId: "golden-explicit-remix-pass",
      trackId: "track-explicit-remix",
      budgetRemainingUsd: 0.06,
      preferences: {
        mood: "aggressive",
        energy: "high",
        genres: ["rap"],
        allowExplicit: true,
        licenseType: "remix",
      },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "remix",
      maxPriceUsd: 0.061,
    },
  }),
  makeCase({
    id: "explicit-disallowed-commercial-budget-pass",
    category: "quote_tool_selection",
    description: "Commercial pricing remains stable when explicit content is disallowed.",
    tags: ["explicit-filter", "commercial", "quote"],
    input: {
      ...baseInput,
      sessionId: "golden-explicit-filter-commercial",
      trackId: "track-explicit-filter-commercial",
      budgetRemainingUsd: 0.1,
      preferences: {
        mood: "clean radio",
        energy: "medium",
        genres: ["pop"],
        allowExplicit: false,
        licenseType: "commercial",
      },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "commercial",
      maxPriceUsd: 0.1,
    },
  }),
  makeCase({
    id: "no-license-personal-safe-default",
    category: "no_license_refusal",
    description: "Falls back to personal pricing when no license type is supplied.",
    tags: ["missing-license", "safe-default"],
    input: {
      ...baseInput,
      sessionId: "golden-no-license-safe-default",
      trackId: "track-no-license-safe-default",
      budgetRemainingUsd: 0.02,
      preferences: {
        mood: "curious",
        energy: "medium",
        genres: ["ambient"],
        allowExplicit: false,
      },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "no-license-budget-refusal",
    category: "no_license_refusal",
    description: "Rejects the safe default personal license when no license is supplied and budget is too low.",
    tags: ["missing-license", "budget", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-no-license-budget-refusal",
      trackId: "track-no-license-budget-refusal",
      budgetRemainingUsd: 0,
      preferences: {
        mood: "curious",
        energy: "medium",
        genres: ["ambient"],
        allowExplicit: false,
      },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "personal",
    },
  }),
  makeCase({
    id: "ambiguous-empty-preferences-budget-pass",
    category: "ambiguous_intent",
    description: "Handles empty preferences by using the personal-license default within budget.",
    tags: ["ambiguous", "empty-preferences"],
    input: {
      ...baseInput,
      sessionId: "golden-empty-preferences-budget-pass",
      trackId: "track-empty-preferences-budget-pass",
      budgetRemainingUsd: 0.02,
      preferences: {},
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "ambiguous-empty-preferences-budget-refusal",
    category: "ambiguous_intent",
    description: "Rejects empty-preference personal default when budget is too low.",
    tags: ["ambiguous", "empty-preferences", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-empty-preferences-budget-refusal",
      trackId: "track-empty-preferences-budget-refusal",
      budgetRemainingUsd: 0.01,
      preferences: {},
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "personal",
    },
  }),
  makeCase({
    id: "paid-download-personal-repeat-ready",
    category: "paid_download_readiness",
    description: "Marks a repeat-listener personal purchase as ready for paid download flow.",
    tags: ["download", "repeat-listener", "personal"],
    input: {
      ...baseInput,
      sessionId: "golden-download-personal-repeat",
      trackId: "track-download-personal-repeat",
      recentTrackIds: ["track-1", "track-2", "track-3", "track-4", "track-5", "track-6"],
      budgetRemainingUsd: 0.03,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "paid-download-remix-ready",
    category: "paid_download_readiness",
    description: "Marks an approved remix purchase as ready for paid stem download.",
    tags: ["download", "remix"],
    input: {
      ...baseInput,
      sessionId: "golden-download-remix-ready",
      trackId: "track-download-remix-ready",
      budgetRemainingUsd: 0.08,
      preferences: { ...baseInput.preferences, licenseType: "remix" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "remix",
      maxPriceUsd: 0.061,
    },
  }),
  makeCase({
    id: "paid-download-commercial-ready",
    category: "paid_download_readiness",
    description: "Marks an approved commercial purchase as ready for paid stem download.",
    tags: ["download", "commercial"],
    input: {
      ...baseInput,
      sessionId: "golden-download-commercial-ready",
      trackId: "track-download-commercial-ready",
      budgetRemainingUsd: 0.2,
      preferences: { ...baseInput.preferences, licenseType: "commercial" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "commercial",
      maxPriceUsd: 0.1,
    },
  }),
  makeCase({
    id: "paid-download-blocked-by-budget",
    category: "paid_download_readiness",
    description: "Blocks paid download readiness when the chosen license exceeds budget.",
    tags: ["download", "budget", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-download-budget-blocked",
      trackId: "track-download-budget-blocked",
      budgetRemainingUsd: 0.03,
      preferences: { ...baseInput.preferences, licenseType: "remix" },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "remix",
    },
  }),
  makeCase({
    id: "learned-house-personal-budget-pass",
    category: "learned_preference_regression",
    description: "Honors a learned house preference while keeping personal licensing inside budget.",
    tags: ["learned-preference", "house", "personal"],
    input: {
      ...baseInput,
      sessionId: "golden-learned-house-personal",
      trackId: "track-learned-house-personal",
      budgetRemainingUsd: 0.02,
      preferences: {
        mood: "club",
        energy: "high",
        genres: ["house"],
        learnedGenreWeights: { house: 9, ambient: 1 },
        licenseType: "personal",
      },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "learned-ambient-remix-budget-pass",
    category: "learned_preference_regression",
    description: "Approves a learned ambient remix preference when the quote fits.",
    tags: ["learned-preference", "ambient", "remix"],
    input: {
      ...baseInput,
      sessionId: "golden-learned-ambient-remix",
      trackId: "track-learned-ambient-remix",
      budgetRemainingUsd: 0.07,
      preferences: {
        mood: "focus",
        energy: "low",
        genres: ["ambient", "drone"],
        learnedGenreWeights: { ambient: 12, drone: 3, house: -2 },
        licenseType: "remix",
      },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "remix",
      maxPriceUsd: 0.061,
    },
  }),
  makeCase({
    id: "learned-jazz-commercial-budget-refusal",
    category: "learned_preference_regression",
    description: "Still refuses a learned jazz commercial intent when budget is insufficient.",
    tags: ["learned-preference", "jazz", "commercial", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-learned-jazz-commercial-refusal",
      trackId: "track-learned-jazz-commercial-refusal",
      budgetRemainingUsd: 0.08,
      preferences: {
        mood: "late night",
        energy: "low",
        genres: ["jazz"],
        learnedGenreWeights: { jazz: 10, techno: -1 },
        licenseType: "commercial",
      },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "commercial",
    },
  }),
  makeCase({
    id: "repeat-track-marker-personal-pass",
    category: "catalog_search_intent",
    description: "Keeps repeat-avoidance context visible while approving a different personal track.",
    tags: ["repeat-avoidance", "catalog-intent", "personal"],
    input: {
      ...baseInput,
      sessionId: "golden-repeat-track-marker-personal",
      trackId: "track-new-house-candidate",
      recentTrackIds: ["track-old-house-candidate", "track-old-jazz-candidate"],
      budgetRemainingUsd: 0.02,
      preferences: { ...baseInput.preferences, licenseType: "personal" },
    },
    expected: {
      status: "approved",
      reason: "policy_ok",
      licenseType: "personal",
      maxPriceUsd: 0.02,
    },
  }),
  makeCase({
    id: "failure-mode-commercial-zero-budget",
    category: "policy_budget_refusal",
    description: "Keeps the commercial zero-budget failure mode stable and branchable.",
    tags: ["failure-mode", "commercial", "budget", "refusal"],
    input: {
      ...baseInput,
      sessionId: "golden-failure-commercial-zero-budget",
      trackId: "track-failure-commercial-zero-budget",
      budgetRemainingUsd: 0,
      preferences: { ...baseInput.preferences, licenseType: "commercial" },
    },
    expected: {
      status: "rejected",
      reason: "budget_exceeded",
      licenseType: "commercial",
    },
  }),
];
