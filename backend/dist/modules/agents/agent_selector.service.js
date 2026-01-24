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
exports.AgentSelectorService = void 0;
const common_1 = require("@nestjs/common");
const tool_registry_1 = require("./tools/tool_registry");
let AgentSelectorService = class AgentSelectorService {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async select(input) {
        const tool = this.tools.get("catalog.search");
        const result = await tool.run({
            query: input.query ?? "",
            limit: 20,
            allowExplicit: input.allowExplicit ?? false,
        });
        const items = result.items ?? [];
        let candidates = items;
        if (input.useEmbeddings && items.length > 1) {
            const ranked = await this.tools.get("embeddings.similarity").run({
                query: input.query ?? "",
                candidates: items.map((track) => track.id),
            });
            const rankedIds = ranked.ranked ?? [];
            const ordered = rankedIds
                .map((entry) => items.find((track) => track.id === entry.trackId))
                .filter(Boolean);
            if (ordered.length) {
                candidates = ordered;
            }
        }
        const selected = candidates.find((track) => !input.recentTrackIds.includes(track.id)) ??
            candidates[0];
        return {
            candidates: candidates.map((track) => track.id),
            selected,
        };
    }
};
exports.AgentSelectorService = AgentSelectorService;
exports.AgentSelectorService = AgentSelectorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tool_registry_1.ToolRegistry])
], AgentSelectorService);
