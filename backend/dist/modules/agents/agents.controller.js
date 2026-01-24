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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentsController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const roles_decorator_1 = require("../auth/roles.decorator");
const agent_evaluation_service_1 = require("./agent_evaluation.service");
const agent_orchestrator_service_1 = require("./agent_orchestrator.service");
const agent_runtime_service_1 = require("./agent_runtime.service");
const agent_runner_service_1 = require("./agent_runner.service");
let AgentsController = class AgentsController {
    agentRunner;
    orchestrator;
    evaluator;
    runtime;
    constructor(agentRunner, orchestrator, evaluator, runtime) {
        this.agentRunner = agentRunner;
        this.orchestrator = orchestrator;
        this.evaluator = evaluator;
        this.runtime = runtime;
    }
    run(body) {
        return this.agentRunner.run(body);
    }
    orchestrate(body) {
        return this.orchestrator.orchestrate(body);
    }
    evaluate(body) {
        return this.evaluator.evaluate(body.sessions);
    }
    runtimeRun(body) {
        return this.runtime.run(body);
    }
};
exports.AgentsController = AgentsController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    (0, common_1.Post)("run"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "run", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    (0, common_1.Post)("orchestrate"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "orchestrate", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    (0, common_1.Post)("evaluate"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "evaluate", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    (0, common_1.Post)("runtime"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "runtimeRun", null);
exports.AgentsController = AgentsController = __decorate([
    (0, common_1.Controller)("agents"),
    __metadata("design:paramtypes", [agent_runner_service_1.AgentRunnerService,
        agent_orchestrator_service_1.AgentOrchestratorService,
        agent_evaluation_service_1.AgentEvaluationService,
        agent_runtime_service_1.AgentRuntimeService])
], AgentsController);
