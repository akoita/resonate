import { Module, forwardRef, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentEvaluationService } from "./agent_evaluation.service";
import { AgentMixerService } from "./agent_mixer.service";
import { AgentNegotiatorService } from "./agent_negotiator.service";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentPolicyService } from "./agent_policy.service";
import { AgentRunnerService } from "./agent_runner.service";
import { AgentRuntimeService } from "./agent_runtime.service";
import { AgentSelectorService } from "./agent_selector.service";
import { AgentWalletService } from "./agent_wallet.service";
import { AgentPurchaseService } from "./agent_purchase.service";
import { AgentsController } from "./agents.controller";
import { AgentConfigController } from "./agent_config.controller";
import { CuratorAgentService } from "./curator_agent.service";
import { EmbeddingService } from "../embeddings/embedding.service";
import { EmbeddingStore } from "../embeddings/embedding.store";
import { ToolRegistry } from "./tools/tool_registry";
import { AdkAdapter } from "./runtime/adk_adapter";
import { LangGraphAdapter } from "./runtime/langgraph_adapter";
import { VertexAiAdapter } from "./runtime/vertex_ai_adapter";
import { IdentityModule } from "../identity/identity.module";

@Module({
  imports: [forwardRef(() => IdentityModule)],
  controllers: [AgentsController, AgentConfigController],
  providers: [
    EventBus,
    EmbeddingService,
    EmbeddingStore,
    ToolRegistry,
    AgentPolicyService,
    AgentRunnerService,
    AgentRuntimeService,
    AgentEvaluationService,
    AgentSelectorService,
    AgentMixerService,
    AgentNegotiatorService,
    AgentOrchestratorService,
    CuratorAgentService,
    VertexAiAdapter,
    AdkAdapter,
    LangGraphAdapter,
    AgentWalletService,
    AgentPurchaseService,
  ],
  exports: [AgentWalletService, AgentPurchaseService, CuratorAgentService],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    private readonly curator: CuratorAgentService,
    private readonly tools: ToolRegistry,
    private readonly selector: AgentSelectorService,
  ) {}

  onModuleInit() {
    // Wire up circular references that can't be handled by NestJS DI
    this.tools.setCuratorService(this.curator);
    this.selector.setCuratorService(this.curator);
  }
}


