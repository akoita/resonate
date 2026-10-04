import type { AgentRequestCoverage, AgentSessionRequest, AgentSessionTempoRange } from "../agent_session_request";
import type { MyMixPreferences } from "../agent_my_mix";

export interface AgentRuntimeInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  /**
   * Wire-contract field kept for the remote runtime worker. Listening runs are
   * not priced or budget-limited (ADR-TE-1); it must not reduce the picks.
   */
  budgetRemainingUsd: number;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    stemTypes?: string[];
    learnedGenreWeights?: Record<string, number>;
    allowExplicit?: boolean;
    licenseType?: "personal" | "remix" | "commercial";
    sessionIntent?: string;
    sessionIntentName?: string;
    queueStyle?: string;
    source?: string;
    /** Every mood the listener described (#2037); each is also a search query. */
    moods?: string[];
    /**
     * The session's own genres (preset or described session, #2059), before
     * learned favourites and saved vibes are merged into `genres`. They rank
     * above learned taste.
     */
    sessionGenres?: string[];
    /** Requested tempo range in BPM (#2037); a ranking boost on measured tempo only. */
    tempoBpm?: AgentSessionTempoRange;
    /** The listening filters parsed from the listener's own words (#2037); never the text. */
    request?: AgentSessionRequest;
    /** Untrusted session-only preferences; resolved server-side at runtime. */
    myMix?: MyMixPreferences | null;
  };
}

export interface LlmTrackPick {
  trackId: string;
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: number;
  /**
   * Set by the runtime policy step (`AgentRuntimePolicyService`), never by the
   * model: the shared ranking core's view of the picked track.
   */
  score?: number;
  explanation?: string[];
  /** Primary categorical reason from the shared discovery vocabulary. */
  reasonCode?: string;
  signals?: Array<{ label: string; weight: number; reason: string }>;
}

export interface AgentRuntimeResult {
  status: "approved" | "rejected";
  trackId?: string;
  licenseType?: "personal" | "remix" | "commercial";
  priceUsd?: number;
  reason?: string;
  /** LLM-generated explanation for why these tracks were selected */
  reasoning?: string;
  /** Time taken for the adapter to produce a result, in milliseconds */
  latencyMs?: number;
  /** Multiple track picks from the LLM */
  picks?: LlmTrackPick[];
  /** Runtime policy step accounting (rules 1 to 4), when it ran. */
  policy?: {
    dropped: { hidden: number; aiGenerated: number; diversity: number; unknown: number };
    /** Rule 3; `injected` when the selector's discovery pick replaced the last model pick. */
    exploration?: { reserved: number; served: number; injected: boolean };
  };
  /**
   * How well the final picks matched the listener's described session (#2037).
   * Set by the runtime policy step, never by the model.
   */
  requestCoverage?: AgentRequestCoverage;
}

export interface AgentRuntimeAdapter {
  name: "vertex" | "langgraph" | "adk";
  run(input: AgentRuntimeInput): Promise<AgentRuntimeResult>;
}
