import type { AgentRequestCoverage, AgentSessionRequest, AgentSessionTempoRange } from "../agent_session_request";
import type { MyMixContext, MyMixPreferences } from "../agent_my_mix";
import type { SessionSeed } from "../agent_session_seed";

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
    /**
     * The listener's sentence, bounded (#2241). Joins this session's semantic
     * query only; never stored, logged, published or sent to a model on the pick path.
     */
    requestText?: string;
    /** Catalog artists the sentence named (#2241); seed neighbours for retrieval. */
    artists?: string[];
    /** Untrusted session-only preferences; resolved server-side at runtime. */
    myMix?: MyMixPreferences | null;
    /**
     * "Right now" (#2245): the client's current coarse time/day bucket (one of
     * eight; never a timezone, timestamp or place). Read only when the session
     * has no filters; the runtime weights the listener's habit lanes by it and
     * strips it before anything else sees the preferences. Never stored or published.
     */
    listeningContext?: MyMixContext;
    /**
     * "More like this" (#2243): a track of this session whose stored-embedding
     * neighbours become one more semantic source for this request only.
     * Set by the sessions service after it checked the track belongs to the session.
     */
    seedTrackId?: string;
    /**
     * The session's seed (#2244): a track, an artist or a playlist the session
     * started from, kept for the whole live session. Resolved and access-checked
     * by the server before it gets here; never published.
     */
    seed?: SessionSeed;
    /**
     * Request-first selection (#2316): the listener allows marked off-request
     * tracks ("Fill with similar sounds") to fill a batch the catalog cannot
     * fill with matches. Off by default: a short batch is returned and said so.
     */
    fillSimilar?: boolean;
    /**
     * "New artists" (#2249): play only artists the listener has never interacted
     * with. Only `true` counts. Such a session runs through the deterministic
     * selector, which owns the played-artist lookup.
     */
    newArtists?: boolean;
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
  /**
   * Set by the runtime policy step (#2312, #2316): whether the pick belongs to
   * the listener's request (tier A or B); false only for a marked off-request
   * pick the listener allowed. Absent without a request.
   */
  requestMatch?: boolean;
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
    dropped: { hidden: number; aiGenerated: number; diversity: number; unknown: number; offRequest?: number };
    /** Rule 3; `injected` when the selector's discovery pick replaced the last model pick. */
    exploration?: { reserved: number; served: number; injected: boolean };
    /** Picks the selector added so the page reaches the selection target. */
    toppedUp?: number;
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
