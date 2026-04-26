import { Injectable, Optional } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentObservabilityService } from "./agent_observability.service";
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
    stemTypes?: string[];
    learnedGenreWeights?: Record<string, number>;
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
    private readonly eventBus: EventBus,
    @Optional()
    private readonly observability?: AgentObservabilityService
  ) { }

  async evaluate(sessions: AgentEvalSession[], options?: EvaluateOptions) {
    const startedAt = new Date();
    const useRuntime = options?.runtime && options.runtime !== "local";
    const results = [];
    let approved = 0;
    let rejected = 0;
    let totalPrice = 0;
    let totalLatencyMs = 0;
    let repeatCount = 0;
    const seenTracks = new Set<string>();
    const sessionAccepted: boolean[] = [];

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
            sessionAccepted.push(true);
          } else {
            rejected += 1;
            sessionAccepted.push(false);
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
          sessionAccepted.push(false);
        } else {
          sessionAccepted.push(true);
        }
        results.push(result);
      }
    }

    const midpoint = Math.ceil(sessionAccepted.length / 2);
    const early = sessionAccepted.slice(0, midpoint);
    const late = sessionAccepted.slice(midpoint);
    const rate = (values: boolean[]) =>
      values.length ? values.filter(Boolean).length / values.length : 0;
    const earlyAcceptanceRate = rate(early);
    const lateAcceptanceRate = rate(late);

    const metrics = {
      runtime: options?.runtime ?? "local",
      total: sessions.length,
      approved,
      rejected,
      approvalRate: sessions.length ? approved / sessions.length : 0,
      earlyAcceptanceRate,
      lateAcceptanceRate,
      acceptanceRateImprovement: late.length ? lateAcceptanceRate - earlyAcceptanceRate : 0,
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

    await this.observability?.traceEvaluation({
      name: "agent.evaluate",
      sessions,
      metrics,
      startedAt,
      endedAt: new Date(),
    });

    return { metrics, results };
  }
}
