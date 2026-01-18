import { Injectable } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";

export interface AgentSelectorInput {
  query?: string;
  recentTrackIds: string[];
  allowExplicit?: boolean;
  useEmbeddings?: boolean;
}

@Injectable()
export class AgentSelectorService {
  constructor(private readonly tools: ToolRegistry) {}

  async select(input: AgentSelectorInput) {
    const tool = this.tools.get("catalog.search");
    const result = await tool.run({
      query: input.query ?? "",
      limit: 20,
      allowExplicit: input.allowExplicit ?? false,
    });
    const items = (result.items as any[]) ?? [];
    let candidates = items;
    if (input.useEmbeddings && items.length > 1) {
      const ranked = await this.tools.get("embeddings.similarity").run({
        query: input.query ?? "",
        candidates: items.map((track) => track.id),
      });
      const rankedIds = (ranked.ranked as { trackId: string }[]) ?? [];
      const ordered = rankedIds
        .map((entry) => items.find((track) => track.id === entry.trackId))
        .filter(Boolean) as any[];
      if (ordered.length) {
        candidates = ordered;
      }
    }
    const selected =
      candidates.find((track) => !input.recentTrackIds.includes(track.id)) ??
      candidates[0];
    return {
      candidates: candidates.map((track) => track.id),
      selected,
    };
  }
}
