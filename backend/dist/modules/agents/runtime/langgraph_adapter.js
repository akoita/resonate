"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangGraphAdapter = void 0;
const common_1 = require("@nestjs/common");
let LangGraphAdapter = class LangGraphAdapter {
    name = "langgraph";
    async run(input) {
        return {
            status: input.budgetRemainingUsd > 0 ? "approved" : "rejected",
            trackId: input.recentTrackIds[0],
            licenseType: input.preferences.licenseType ?? "personal",
            priceUsd: Math.min(0.03, input.budgetRemainingUsd),
            reason: "langgraph_stub",
        };
    }
};
exports.LangGraphAdapter = LangGraphAdapter;
exports.LangGraphAdapter = LangGraphAdapter = __decorate([
    (0, common_1.Injectable)()
], LangGraphAdapter);
