import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentEvaluationService } from "./agent_evaluation.service";
import { AgentMixerService } from "./agent_mixer.service";
import { AgentNegotiatorService } from "./agent_negotiator.service";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentPolicyService } from "./agent_policy.service";
import { AgentRunnerService } from "./agent_runner.service";
import { AgentSelectorService } from "./agent_selector.service";
import { AgentsController } from "./agents.controller";
import { EmbeddingService } from "../embeddings/embedding.service";
import { EmbeddingStore } from "../embeddings/embedding.store";
import { ToolRegistry } from "./tools/tool_registry";

@Module({
  controllers: [AgentsController],
  providers: [
    EventBus,
    EmbeddingService,
    EmbeddingStore,
    ToolRegistry,
    AgentPolicyService,
    AgentRunnerService,
    AgentEvaluationService,
    AgentSelectorService,
    AgentMixerService,
    AgentNegotiatorService,
    AgentOrchestratorService,
  ],
})
export class AgentsModule {}
