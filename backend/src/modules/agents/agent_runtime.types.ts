import type { OrchestratedTrack } from "./agent_orchestrator.service";
import type { AgentRequestCoverage } from "./agent_session_request";
import type { AgentRuntimeResult } from "./runtime/agent_runtime.adapter";

export type AgentLicenseType = "personal" | "remix" | "commercial";

export type AgentRuntimeOrchestratorResult = {
  status: string;
  tracks: OrchestratedTrack[];
  shortfall?: number;
  /** Coverage of the listener's described session (#2037); deterministic path only. */
  requestCoverage?: AgentRequestCoverage;
};

export type AgentRuntimeRunResult =
  | AgentRuntimeResult
  | AgentRuntimeOrchestratorResult;

export type AgentRuntimeCommerceStatus =
  | "approved"
  | "rejected"
  | "no_tracks"
  | "all_rejected";

export interface AgentRuntimeCommerceTrack {
  trackId: string;
  licenseType: AgentLicenseType;
  priceUsd: number;
  reason?: string;
  score?: number;
  explanation?: string[];
  /** Primary categorical reason from the shared discovery vocabulary. */
  reasonCode?: string;
  signals?: Array<{ label: string; weight: number; reason: string }>;
  audioFeatures?: unknown;
  mixPlan?: unknown;
  /** The orchestrator's pick record; never a priced negotiation (ADR-TE-1). */
  pick?: unknown;
}

export interface AgentRuntimeCommerceResult {
  status: AgentRuntimeCommerceStatus;
  tracks: AgentRuntimeCommerceTrack[];
  primaryTrack?: AgentRuntimeCommerceTrack;
  reason?: string;
  reasoning?: string;
  latencyMs?: number;
  /** Tracks requested minus tracks returned; agents never generate fills (ADR-TE-4). */
  shortfall?: number;
  /** How well the picks matched the listener's described session (#2037). Absent for LLM picks. */
  requestCoverage?: AgentRequestCoverage;
}

function normalizeStatus(status: string): AgentRuntimeCommerceStatus {
  if (status === "no_tracks" || status === "all_rejected" || status === "rejected") {
    return status;
  }
  return "approved";
}

function normalizeLicenseType(value: unknown): AgentLicenseType {
  return value === "remix" || value === "commercial" ? value : "personal";
}

export function normalizeAgentRuntimeResult(
  result: AgentRuntimeRunResult,
): AgentRuntimeCommerceResult {
  if ("tracks" in result) {
    const tracks = result.tracks.map((track) => {
      // Listening picks are never priced (ADR-TE-1): the pick record carries
      // no price, and the normalized price is always 0.
      const pick = track.pick as
        | {
            licenseType?: unknown;
            reason?: string;
            recommendation?: {
              score?: number;
              explanation?: string[];
              reasonCode?: string;
              signals?: Array<{ label: string; weight: number; reason: string }>;
              audioFeatures?: unknown;
            };
          }
        | undefined;
      return {
        trackId: track.trackId,
        licenseType: normalizeLicenseType(pick?.licenseType),
        priceUsd: 0,
        reason: pick?.reason,
        score: pick?.recommendation?.score,
        explanation: pick?.recommendation?.explanation,
        reasonCode: pick?.recommendation?.reasonCode,
        signals: pick?.recommendation?.signals,
        audioFeatures: pick?.recommendation?.audioFeatures,
        mixPlan: track.mixPlan,
        pick: track.pick,
      };
    });

    return {
      status: normalizeStatus(result.status),
      tracks,
      primaryTrack: tracks[0],
      shortfall: result.shortfall,
      ...(result.requestCoverage ? { requestCoverage: result.requestCoverage } : {}),
    };
  }

  const picks =
    result.picks && result.picks.length > 0
      ? result.picks
      : result.trackId
        ? [
            {
              trackId: result.trackId,
              licenseType: normalizeLicenseType(result.licenseType),
              priceUsd: 0,
            },
          ]
        : [];
  // Like the orchestrator path: a price the model reports is ignored, because
  // listening picks are never priced (ADR-TE-1).
  const tracks = picks.map((pick) => ({
    trackId: pick.trackId,
    licenseType: normalizeLicenseType(pick.licenseType),
    priceUsd: 0,
    reason: result.reason,
    // Present once the runtime policy step has scored the pick (same shape as
    // the deterministic path's recommendation).
    ...(pick.score !== undefined ? { score: pick.score } : {}),
    ...(pick.explanation ? { explanation: pick.explanation } : {}),
    ...(pick.reasonCode ? { reasonCode: pick.reasonCode } : {}),
    ...(pick.signals ? { signals: pick.signals } : {}),
  }));

  return {
    status: normalizeStatus(result.status),
    tracks,
    primaryTrack: tracks[0],
    reason: result.reason,
    reasoning: result.reasoning,
    latencyMs: result.latencyMs,
  };
}
