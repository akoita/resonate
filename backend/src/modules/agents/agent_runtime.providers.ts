import { EventBus } from "../shared/event_bus";
import { EmbeddingService } from "../embeddings/embedding.service";
import { EmbeddingStore } from "../embeddings/embedding.store";
import { AgentEvaluationService } from "./agent_evaluation.service";
import { AgentAudioFeatureService } from "./agent_audio_feature.service";
import { AgentGoldenEvalService } from "./agent_golden_eval.service";
import { AgentLearningService } from "./agent_learning.service";
import { AgentMixerService } from "./agent_mixer.service";
import { AgentNegotiatorService } from "./agent_negotiator.service";
import { AgentObservabilityService } from "./agent_observability.service";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentPolicyService } from "./agent_policy.service";
import { AgentRecommendationEvalService } from "./agent_recommendation_eval.service";
import { AgentRecommendationService } from "./agent_recommendation.service";
import { PaymentRouterService } from "./payment_router.service";
import { PolicyGuardService } from "./policy_guard.service";
import { AgentRunnerService } from "./agent_runner.service";
import { AgentRuntimeExecutorService } from "./agent_runtime.executor.service";
import { AgentRuntimeService } from "./agent_runtime.service";
import { AgentRuntimeRemoteClient } from "./agent_runtime_remote.client";
import { AgentSelectorService } from "./agent_selector.service";
import { DeterministicRecommendationAdapter } from "./deterministic_recommendation.adapter";
import { ModelAssistedRecommendationAdapter } from "./model_assisted_recommendation.adapter";
import { ToolRegistry } from "./tools/tool_registry";
import { AdkAdapter } from "./runtime/adk_adapter";
import { LangGraphAdapter } from "./runtime/langgraph_adapter";
import { VertexAiAdapter } from "./runtime/vertex_ai_adapter";

export const AGENT_RUNTIME_CORE_PROVIDERS = [
  EventBus,
  EmbeddingService,
  EmbeddingStore,
  ToolRegistry,
  AgentAudioFeatureService,
  AgentPolicyService,
  PolicyGuardService,
  PaymentRouterService,
  AgentRunnerService,
  AgentRuntimeService,
  AgentRuntimeExecutorService,
  AgentRuntimeRemoteClient,
  AgentEvaluationService,
  AgentGoldenEvalService,
  AgentLearningService,
  AgentObservabilityService,
  AgentRecommendationEvalService,
  AgentRecommendationService,
  AgentSelectorService,
  DeterministicRecommendationAdapter,
  ModelAssistedRecommendationAdapter,
  AgentMixerService,
  AgentNegotiatorService,
  AgentOrchestratorService,
  VertexAiAdapter,
  AdkAdapter,
  LangGraphAdapter,
];
