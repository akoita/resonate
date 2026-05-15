import type { OrchestratedTrack } from "./agent_orchestrator.service";
import type { AgentRuntimeResult } from "./runtime/agent_runtime.adapter";

export type AgentLicenseType = "personal" | "remix" | "commercial";

export type AgentRuntimeOrchestratorResult = {
  status: string;
  tracks: OrchestratedTrack[];
  generationsUsed?: number;
  generationSpendUsd?: number;
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
  signals?: Array<{ label: string; weight: number; reason: string }>;
  audioFeatures?: unknown;
  mixPlan?: unknown;
  negotiation?: unknown;
}

export interface AgentRuntimeCommerceResult {
  status: AgentRuntimeCommerceStatus;
  tracks: AgentRuntimeCommerceTrack[];
  primaryTrack?: AgentRuntimeCommerceTrack;
  reason?: string;
  reasoning?: string;
  latencyMs?: number;
  generationsUsed?: number;
  generationSpendUsd?: number;
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

function normalizePriceUsd(value: unknown): number {
  const price = Number(value ?? 0);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

export function normalizeAgentRuntimeResult(
  result: AgentRuntimeRunResult,
): AgentRuntimeCommerceResult {
  if ("tracks" in result) {
    const tracks = result.tracks.map((track) => {
      const negotiation = track.negotiation as
        | {
            licenseType?: unknown;
          priceUsd?: unknown;
          reason?: string;
          recommendation?: {
            score?: number;
            explanation?: string[];
            signals?: Array<{ label: string; weight: number; reason: string }>;
            audioFeatures?: unknown;
          };
        }
        | undefined;
      return {
        trackId: track.trackId,
        licenseType: normalizeLicenseType(negotiation?.licenseType),
        priceUsd: normalizePriceUsd(negotiation?.priceUsd),
        reason: negotiation?.reason,
        score: negotiation?.recommendation?.score,
        explanation: negotiation?.recommendation?.explanation,
        signals: negotiation?.recommendation?.signals,
        audioFeatures: negotiation?.recommendation?.audioFeatures,
        mixPlan: track.mixPlan,
        negotiation: track.negotiation,
      };
    });

    return {
      status: normalizeStatus(result.status),
      tracks,
      primaryTrack: tracks[0],
      generationsUsed: result.generationsUsed,
      generationSpendUsd: result.generationSpendUsd,
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
              priceUsd: normalizePriceUsd(result.priceUsd),
            },
          ]
        : [];
  const tracks = picks.map((pick) => ({
    trackId: pick.trackId,
    licenseType: normalizeLicenseType(pick.licenseType),
    priceUsd: normalizePriceUsd(pick.priceUsd),
    reason: result.reason,
  }));

  return {
    status: normalizeStatus(result.status),
    tracks,
    primaryTrack: tracks[0],
    reason: result.reason,
    reasoning: result.reasoning,
    latencyMs: result.latencyMs,
    generationsUsed: result.generationsUsed,
    generationSpendUsd: result.generationSpendUsd,
  };
}
