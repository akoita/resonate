import { Injectable } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";

export interface AgentSelectorInput {
  query?: string;
  recentTrackIds: string[];
  allowExplicit?: boolean;
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
    const selected =
      items.find((track) => !input.recentTrackIds.includes(track.id)) ?? items[0];
    return {
      candidates: items.map((track) => track.id),
      selected,
    };
  }
}
