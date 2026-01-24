"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRuntimeService = void 0;
const common_1 = require("@nestjs/common");
const agent_orchestrator_service_1 = require("./agent_orchestrator.service");
const langgraph_adapter_1 = require("./runtime/langgraph_adapter");
const vertex_ai_adapter_1 = require("./runtime/vertex_ai_adapter");
let AgentRuntimeService = class AgentRuntimeService {
    orchestrator;
    vertexAdapter;
    langGraphAdapter;
    constructor(orchestrator, vertexAdapter, langGraphAdapter) {
        this.orchestrator = orchestrator;
        this.vertexAdapter = vertexAdapter;
        this.langGraphAdapter = langGraphAdapter;
    }
    async run(input) {
        const mode = process.env.AGENT_RUNTIME ?? "local";
        const adapter = mode === "vertex"
            ? this.vertexAdapter
            : mode === "langgraph"
                ? this.langGraphAdapter
                : undefined;
        if (!adapter) {
            return this.orchestrator.orchestrate(input);
        }
        try {
            return await adapter.run(input);
        }
        catch (error) {
            return this.orchestrator.orchestrate(input);
        }
    }
};
exports.AgentRuntimeService = AgentRuntimeService;
exports.AgentRuntimeService = AgentRuntimeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [agent_orchestrator_service_1.AgentOrchestratorService,
        vertex_ai_adapter_1.VertexAiAdapter,
        langgraph_adapter_1.LangGraphAdapter])
], AgentRuntimeService);
