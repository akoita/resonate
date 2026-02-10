import { Injectable } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRuntimeService } from "./agent_runtime.service";

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

export interface EvaluateOptions {
  /** When set, routes sessions through AgentRuntimeService (vertex/langgraph) */
  runtime?: "vertex" | "langgraph" | "local";
}

@Injectable()
export class AgentEvaluationService {
  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    private readonly runtimeService: AgentRuntimeService,
    private readonly eventBus: EventBus
  ) { }

  async evaluate(sessions: AgentEvalSession[], options?: EvaluateOptions) {
    const useRuntime = options?.runtime && options.runtime !== "local";
    const results = [];
    let approved = 0;
    let rejected = 0;
    let totalPrice = 0;
    let totalLatencyMs = 0;
    let repeatCount = 0;
    const seenTracks = new Set<string>();

    for (const session of sessions) {
      if (useRuntime) {
        // Route through the runtime adapter (vertex / langgraph)
        const saved = process.env.AGENT_RUNTIME;
        process.env.AGENT_RUNTIME = options!.runtime;
        try {
          const result = await this.runtimeService.run(session);
          if (result.status === "approved") {
            approved += 1;
            totalPrice += (result as any).priceUsd ?? 0;
          } else {
            rejected += 1;
          }
          if ((result as any).trackId && seenTracks.has((result as any).trackId)) {
            repeatCount += 1;
          }
          if ((result as any).trackId) {
            seenTracks.add((result as any).trackId);
          }
          totalLatencyMs += (result as any).latencyMs ?? 0;
          results.push(result);
        } finally {
          process.env.AGENT_RUNTIME = saved;
        }
      } else {
        const result = await this.orchestrator.orchestrate(session);
        for (const track of result.tracks) {
          if (track.negotiation) {
            approved += 1;
            totalPrice += track.negotiation.priceUsd ?? 0;
          } else {
            rejected += 1;
          }
          if (seenTracks.has(track.trackId)) {
            repeatCount += 1;
          }
          seenTracks.add(track.trackId);
        }
        if (result.tracks.length === 0) {
          rejected += 1;
        }
        results.push(result);
      }
    }

    const metrics = {
      runtime: options?.runtime ?? "local",
      total: sessions.length,
      approved,
      rejected,
      approvalRate: sessions.length ? approved / sessions.length : 0,
      avgPriceUsd: approved ? totalPrice / approved : 0,
      repeatRate: sessions.length ? repeatCount / sessions.length : 0,
      ...(useRuntime
        ? { avgLatencyMs: sessions.length ? totalLatencyMs / sessions.length : 0 }
        : {}),
    };

    this.eventBus.publish({
      eventName: "agent.evaluation_completed",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      ...metrics,
    });

    return { metrics, results };
  }
}
