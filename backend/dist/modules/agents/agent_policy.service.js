"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentPolicyService = void 0;
const common_1 = require("@nestjs/common");
const pricing_1 = require("../../pricing/pricing");
let AgentPolicyService = class AgentPolicyService {
    evaluate(input) {
        const licenseType = input.preferences.licenseType ?? "personal";
        const priceUsd = (0, pricing_1.calculatePrice)(licenseType, this.defaultPricing(), input.recentTrackIds.length > 5);
        const allowed = priceUsd <= input.budgetRemainingUsd;
        return {
            allowed,
            licenseType,
            priceUsd,
            reason: allowed ? "policy_ok" : "budget_exceeded",
        };
    }
    defaultPricing() {
        return {
            basePlayPriceUsd: 0.02,
            remixSurchargeMultiplier: 3,
            commercialMultiplier: 5,
            volumeDiscountPercent: 5,
            floorUsd: 0.01,
            ceilingUsd: 1,
        };
    }
};
exports.AgentPolicyService = AgentPolicyService;
exports.AgentPolicyService = AgentPolicyService = __decorate([
    (0, common_1.Injectable)()
], AgentPolicyService);
