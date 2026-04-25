import { AgentRunInput } from "../modules/agents/agent_runner.service";

export interface AgentGoldenCase {
  id: string;
  description: string;
  input: AgentRunInput;
  expected: {
    status: "approved" | "rejected";
    reason: "policy_ok" | "budget_exceeded";
    licenseType: "personal" | "remix" | "commercial";
    maxPriceUsd?: number;
  };
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

export const AGENT_GOLDEN_SET: AgentGoldenCase[] = [
  {
    id: "personal-budget-pass",
    description: "Approves a personal license within a tiny but sufficient budget.",
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
  },
  {
    id: "remix-budget-pass",
    description: "Approves a remix license when the remix surcharge fits the remaining budget.",
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
  },
  {
    id: "commercial-budget-fail",
    description: "Rejects a commercial license when the policy price exceeds remaining budget.",
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
  },
  {
    id: "repeat-listener-discount",
    description: "Keeps repeat-listener personal pricing within budget after rounded policy pricing.",
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
  },
];
