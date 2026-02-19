"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentsModule = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
const agent_evaluation_service_1 = require("./agent_evaluation.service");
const agent_mixer_service_1 = require("./agent_mixer.service");
const agent_negotiator_service_1 = require("./agent_negotiator.service");
const agent_orchestrator_service_1 = require("./agent_orchestrator.service");
const agent_policy_service_1 = require("./agent_policy.service");
const agent_runner_service_1 = require("./agent_runner.service");
const agent_runtime_service_1 = require("./agent_runtime.service");
const agent_selector_service_1 = require("./agent_selector.service");
const agent_wallet_service_1 = require("./agent_wallet.service");
const agent_purchase_service_1 = require("./agent_purchase.service");
const agents_controller_1 = require("./agents.controller");
const agent_config_controller_1 = require("./agent_config.controller");
const embedding_service_1 = require("../embeddings/embedding.service");
const embedding_store_1 = require("../embeddings/embedding.store");
const tool_registry_1 = require("./tools/tool_registry");
const adk_adapter_1 = require("./runtime/adk_adapter");
const langgraph_adapter_1 = require("./runtime/langgraph_adapter");
const vertex_ai_adapter_1 = require("./runtime/vertex_ai_adapter");
const identity_module_1 = require("../identity/identity.module");
let AgentsModule = class AgentsModule {
};
exports.AgentsModule = AgentsModule;
exports.AgentsModule = AgentsModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => identity_module_1.IdentityModule)],
        controllers: [agents_controller_1.AgentsController, agent_config_controller_1.AgentConfigController],
        providers: [
            event_bus_1.EventBus,
            embedding_service_1.EmbeddingService,
            embedding_store_1.EmbeddingStore,
            tool_registry_1.ToolRegistry,
            agent_policy_service_1.AgentPolicyService,
            agent_runner_service_1.AgentRunnerService,
            agent_runtime_service_1.AgentRuntimeService,
            agent_evaluation_service_1.AgentEvaluationService,
            agent_selector_service_1.AgentSelectorService,
            agent_mixer_service_1.AgentMixerService,
            agent_negotiator_service_1.AgentNegotiatorService,
            agent_orchestrator_service_1.AgentOrchestratorService,
            vertex_ai_adapter_1.VertexAiAdapter,
            adk_adapter_1.AdkAdapter,
            langgraph_adapter_1.LangGraphAdapter,
            agent_wallet_service_1.AgentWalletService,
            agent_purchase_service_1.AgentPurchaseService,
        ],
        exports: [agent_wallet_service_1.AgentWalletService, agent_purchase_service_1.AgentPurchaseService],
    })
], AgentsModule);
