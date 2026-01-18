import { Injectable } from "@nestjs/common";
import { AgentRuntimeAdapter, AgentRuntimeInput, AgentRuntimeResult } from "./agent_runtime.adapter";

@Injectable()
export class LangGraphAdapter implements AgentRuntimeAdapter {
  name: "langgraph" = "langgraph";

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    return {
      status: input.budgetRemainingUsd > 0 ? "approved" : "rejected",
      trackId: input.recentTrackIds[0],
      licenseType: input.preferences.licenseType ?? "personal",
      priceUsd: Math.min(0.03, input.budgetRemainingUsd),
      reason: "langgraph_stub",
    };
  }
}
