import { Injectable, Optional } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentObservabilityService } from "./agent_observability.service";
import { AgentPolicyService } from "./agent_policy.service";

export interface AgentRunInput {
  sessionId: string;
  userId: string;
  trackId: string;
  recentTrackIds: string[];
  budgetRemainingUsd: number;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    allowExplicit?: boolean;
    licenseType?: "personal" | "remix" | "commercial";
  };
}

export interface AgentRunResult {
  status: "approved" | "rejected";
  decision: {
    allowed: boolean;
    licenseType: "personal" | "remix" | "commercial";
    priceUsd: number;
    reason: string;
  };
}

@Injectable()
export class AgentRunnerService {
  constructor(
    private readonly policyService: AgentPolicyService,
    private readonly eventBus: EventBus,
    @Optional()
    private readonly observability?: AgentObservabilityService
  ) {}

  run(input: AgentRunInput): AgentRunResult {
    const startedAt = new Date();
    const decision = this.policyService.evaluate(input);
    const status: AgentRunResult["status"] = decision.allowed ? "approved" : "rejected";
    this.eventBus.publish({
      eventName: "agent.evaluated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackId: input.trackId,
      licenseType: decision.licenseType,
      priceUsd: decision.priceUsd,
      reason: decision.reason,
    });
    const result = {
      status,
      decision,
    };
    void this.observability?.traceEvaluation({
      name: "agent.policy.evaluate",
      sessions: [input],
      metrics: {
        total: 1,
        approved: status === "approved" ? 1 : 0,
        rejected: status === "rejected" ? 1 : 0,
        approvalRate: status === "approved" ? 1 : 0,
        avgPriceUsd: decision.priceUsd,
        repeatRate: 0,
      },
      startedAt,
      endedAt: new Date(),
    });
    return result;
  }
}
