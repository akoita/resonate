"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionsModule = void 0;
const common_1 = require("@nestjs/common");
const identity_module_1 = require("../identity/identity.module");
const event_bus_1 = require("../shared/event_bus");
const agent_orchestration_service_1 = require("./agent_orchestration.service");
const sessions_controller_1 = require("./sessions.controller");
const sessions_service_1 = require("./sessions.service");
let SessionsModule = class SessionsModule {
};
exports.SessionsModule = SessionsModule;
exports.SessionsModule = SessionsModule = __decorate([
    (0, common_1.Module)({
        imports: [identity_module_1.IdentityModule],
        controllers: [sessions_controller_1.SessionsController],
        providers: [event_bus_1.EventBus, agent_orchestration_service_1.AgentOrchestrationService, sessions_service_1.SessionsService],
    })
], SessionsModule);
