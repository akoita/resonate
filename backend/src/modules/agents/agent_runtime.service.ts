import { Injectable, Logger } from "@nestjs/common";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRuntimeInput } from "./runtime/agent_runtime.adapter";
import { LangGraphAdapter } from "./runtime/langgraph_adapter";
import { VertexAiAdapter } from "./runtime/vertex_ai_adapter";

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    private readonly vertexAdapter: VertexAiAdapter,
    private readonly langGraphAdapter: LangGraphAdapter
  ) {}

  async run(input: AgentRuntimeInput) {
    const mode = process.env.AGENT_RUNTIME ?? "local";
    const adapter =
      mode === "vertex"
        ? this.vertexAdapter
        : mode === "langgraph"
        ? this.langGraphAdapter
        : undefined;
    if (!adapter) {
      return this.orchestrator.orchestrate(input);
    }
    try {
      return await adapter.run(input);
    } catch (error: any) {
      this.logger.warn(
        `${adapter.name} adapter failed (${error.message}) — falling back to deterministic orchestrator`
      );
      return this.orchestrator.orchestrate(input);
    }
  }
}
