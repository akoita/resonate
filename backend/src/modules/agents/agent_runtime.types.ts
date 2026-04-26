import type { OrchestratedTrack } from "./agent_orchestrator.service";
import type { AgentRuntimeResult } from "./runtime/agent_runtime.adapter";

export type AgentRuntimeOrchestratorResult = {
  status: string;
  tracks: OrchestratedTrack[];
  generationsUsed?: number;
  generationSpendUsd?: number;
};

export type AgentRuntimeRunResult =
  | AgentRuntimeResult
  | AgentRuntimeOrchestratorResult;
