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
        const queries = (input.queries ?? []).filter(Boolean);
        const limit = input.limit ?? 5;
        // Gather candidates from all vibes/queries
        const seen = new Set();
        let allCandidates = [];
        for (const query of queries.length > 0 ? queries : [""]) {
            const tool = this.tools.get("catalog.search");
            const result = await tool.run({
                query,
                limit: 20,
                allowExplicit: input.allowExplicit ?? false,
            });
            const items = result.items ?? [];
            for (const item of items) {
                if (!seen.has(item.id)) {
                    seen.add(item.id);
                    allCandidates.push(item);
                }
            }
        }
        if (allCandidates.length === 0) {
            return { candidates: [], selected: [] };
        }
        // Optionally rank by embedding similarity to the combined query
        if (input.useEmbeddings && allCandidates.length > 1 && queries.length > 0) {
            const combinedQuery = queries.join(" ");
            const ranked = await this.tools.get("embeddings.similarity").run({
                query: combinedQuery,
                candidates: allCandidates.map((track) => track.id),
            });
            const rankedIds = ranked.ranked ?? [];
            const ordered = rankedIds
                .map((entry) => allCandidates.find((track) => track.id === entry.trackId))
                .filter(Boolean);
            if (ordered.length) {
                allCandidates = ordered;
            }
        }
        // Stable-sort: listed tracks first (preserves embedding rank within each group)
        allCandidates.sort((a, b) => {
            const aListed = a.hasListing ? 1 : 0;
            const bListed = b.hasListing ? 1 : 0;
            return bListed - aListed;
        });
        // Filter out recently played tracks, then take up to `limit`
        const fresh = allCandidates.filter((track) => !input.recentTrackIds.includes(track.id));
        const pool = fresh.length > 0 ? fresh : allCandidates;
        const selected = pool.slice(0, limit);
        return {
            candidates: allCandidates.map((track) => track.id),
            selected,
        };
    }
};
exports.AgentSelectorService = AgentSelectorService;
exports.AgentSelectorService = AgentSelectorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tool_registry_1.ToolRegistry])
], AgentSelectorService);
