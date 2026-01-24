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
exports.AgentNegotiatorService = void 0;
const common_1 = require("@nestjs/common");
const tool_registry_1 = require("./tools/tool_registry");
let AgentNegotiatorService = class AgentNegotiatorService {
    constructor(tools) {
        this.tools = tools;
    }
    async negotiate(input) {
        const tool = this.tools.get("pricing.quote");
        const quote = await tool.run({
            licenseType: input.licenseType ?? "personal",
            volume: false,
        });
        const priceUsd = Number(quote.priceUsd ?? 0);
        const allowed = priceUsd <= input.budgetRemainingUsd;
        return {
            licenseType: input.licenseType ?? "personal",
            priceUsd,
            allowed,
            reason: allowed ? "within_budget" : "over_budget",
        };
    }
};
exports.AgentNegotiatorService = AgentNegotiatorService;
exports.AgentNegotiatorService = AgentNegotiatorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tool_registry_1.ToolRegistry])
], AgentNegotiatorService);
