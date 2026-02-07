import { Injectable } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";

export interface AgentSelectorInput {
  queries?: string[];
  recentTrackIds: string[];
  allowExplicit?: boolean;
  useEmbeddings?: boolean;
  limit?: number;
}

@Injectable()
export class AgentSelectorService {
  constructor(private readonly tools: ToolRegistry) { }

  async select(input: AgentSelectorInput) {
    const queries = (input.queries ?? []).filter(Boolean);
    const limit = input.limit ?? 5;

    // Gather candidates from all vibes/queries
    const seen = new Set<string>();
    let allCandidates: any[] = [];

    for (const query of queries.length > 0 ? queries : [""]) {
      const tool = this.tools.get("catalog.search");
      const result = await tool.run({
        query,
        limit: 20,
        allowExplicit: input.allowExplicit ?? false,
      });
      const items = (result.items as any[]) ?? [];
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
      const rankedIds = (ranked.ranked as { trackId: string }[]) ?? [];
      const ordered = rankedIds
        .map((entry) => allCandidates.find((track) => track.id === entry.trackId))
        .filter(Boolean) as any[];
      if (ordered.length) {
        allCandidates = ordered;
      }
    }

    // Filter out recently played tracks, then take up to `limit`
    const fresh = allCandidates.filter(
      (track) => !input.recentTrackIds.includes(track.id)
    );
    const pool = fresh.length > 0 ? fresh : allCandidates;
    const selected = pool.slice(0, limit);

    return {
      candidates: allCandidates.map((track) => track.id),
      selected,
    };
  }
}
