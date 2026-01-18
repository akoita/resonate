import { Injectable } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";

export interface AgentNegotiatorInput {
  trackId: string;
  licenseType?: "personal" | "remix" | "commercial";
  budgetRemainingUsd: number;
}

@Injectable()
export class AgentNegotiatorService {
  constructor(private readonly tools: ToolRegistry) {}

  async negotiate(input: AgentNegotiatorInput) {
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
}
