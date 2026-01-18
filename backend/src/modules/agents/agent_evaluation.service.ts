import { Injectable } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentOrchestratorService } from "./agent_orchestrator.service";

export interface AgentEvalSession {
  sessionId: string;
  userId: string;
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
export class AgentEvaluationService {
  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    private readonly eventBus: EventBus
  ) {}

  async evaluate(sessions: AgentEvalSession[]) {
    const results = [];
    let approved = 0;
    let rejected = 0;
    let totalPrice = 0;
    let repeatCount = 0;
    const seenTracks = new Set<string>();

    for (const session of sessions) {
      const result = await this.orchestrator.orchestrate(session);
      if (result.status === "approved") {
        approved += 1;
        totalPrice += result.negotiation?.priceUsd ?? 0;
      } else {
        rejected += 1;
      }
      if (result.trackId) {
        if (seenTracks.has(result.trackId)) {
          repeatCount += 1;
        }
        seenTracks.add(result.trackId);
      }
      results.push(result);
    }

    const metrics = {
      total: sessions.length,
      approved,
      rejected,
      approvalRate: sessions.length ? approved / sessions.length : 0,
      avgPriceUsd: approved ? totalPrice / approved : 0,
      repeatRate: sessions.length ? repeatCount / sessions.length : 0,
    };

    this.eventBus.publish({
      eventName: "agent.evaluation_completed",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      total: metrics.total,
      approved: metrics.approved,
      rejected: metrics.rejected,
      approvalRate: metrics.approvalRate,
      avgPriceUsd: metrics.avgPriceUsd,
      repeatRate: metrics.repeatRate,
    });

    return { metrics, results };
  }
}
