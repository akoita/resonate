import { Injectable, Logger } from "@nestjs/common";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRuntimeRunResult } from "./agent_runtime.types";
import { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";
import { AdkAdapter } from "./runtime/adk_adapter";
import { LangGraphAdapter } from "./runtime/langgraph_adapter";
import { VertexAiAdapter } from "./runtime/vertex_ai_adapter";
import { getAgentTrackLimit } from "./agent_runtime.config";
import { resolveListeningLanes } from "./listening_lanes.service";
import { resolveMyMixPlan, ResolvedMyMixPlan } from "./agent_my_mix";

@Injectable()
export class AgentRuntimeExecutorService {
  private readonly logger = new Logger(AgentRuntimeExecutorService.name);

  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    private readonly vertexAdapter: VertexAiAdapter,
    private readonly langGraphAdapter: LangGraphAdapter,
    private readonly adkAdapter: AdkAdapter
  ) {}

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeRunResult> {
    const plan = input.preferences?.myMix == null
      ? undefined
      : resolveMyMixPlan(
          input.preferences.myMix,
          await resolveListeningLanes(input.userId),
          getAgentTrackLimit(),
        );
    const safeInput = withoutMyMix(input);
    if (plan) return this.runWithMyMix(safeInput, plan);

    const mode = process.env.AGENT_RUNTIME ?? "adk";
    const adapter =
      mode === "adk"
        ? this.adkAdapter
        : mode === "vertex"
        ? this.vertexAdapter
        : mode === "langgraph"
        ? this.langGraphAdapter
        : undefined;
    if (!adapter) {
      return this.orchestrator.orchestrate(safeInput);
    }
    try {
      return await adapter.run(safeInput);
    } catch (error: any) {
      this.logger.warn(
        `${adapter.name} adapter failed (${error.message}) - falling back to deterministic orchestrator`
      );
      return this.orchestrator.orchestrate(safeInput);
    }
  }

  /** The API runtime calls this only after resolving the lane plan for the owner. */
  runWithMyMix(input: AgentRuntimeInput, plan: ResolvedMyMixPlan): Promise<AgentRuntimeRunResult> {
    return this.orchestrator.orchestrate({ ...input, myMixPlan: plan });
  }
}

function withoutMyMix(input: AgentRuntimeInput): AgentRuntimeInput {
  const { myMix: _myMix, ...preferences } = input.preferences ?? {};
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    recentTrackIds: input.recentTrackIds,
    budgetRemainingUsd: input.budgetRemainingUsd,
    preferences,
  };
}
