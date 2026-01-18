import { Injectable } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
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

@Injectable()
export class AgentRunnerService {
  constructor(
    private readonly policyService: AgentPolicyService,
    private readonly eventBus: EventBus
  ) {}

  run(input: AgentRunInput) {
    const decision = this.policyService.evaluate(input);
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
    return {
      status: decision.allowed ? "approved" : "rejected",
      decision,
    };
  }
}
