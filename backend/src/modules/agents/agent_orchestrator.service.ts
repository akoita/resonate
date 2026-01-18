import { Injectable } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentMixerService } from "./agent_mixer.service";
import { AgentNegotiatorService } from "./agent_negotiator.service";
import { AgentSelectorService } from "./agent_selector.service";

export interface AgentOrchestratorInput {
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
export class AgentOrchestratorService {
  constructor(
    private readonly selector: AgentSelectorService,
    private readonly mixer: AgentMixerService,
    private readonly negotiator: AgentNegotiatorService,
    private readonly eventBus: EventBus
  ) {}

  async orchestrate(input: AgentOrchestratorInput) {
    const selection = await this.selector.select({
      query: input.preferences.genres?.[0],
      recentTrackIds: input.recentTrackIds,
      allowExplicit: input.preferences.allowExplicit,
    });
    if (!selection.selected) {
      return { status: "no_tracks" };
    }
    this.eventBus.publish({
      eventName: "agent.selection",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackId: selection.selected.id,
      candidates: selection.candidates,
    });

    const mixPlan = this.mixer.plan({
      trackId: selection.selected.id,
      previousTrackId: input.recentTrackIds[0],
      mood: input.preferences.mood,
      energy: input.preferences.energy,
    });
    this.eventBus.publish({
      eventName: "agent.mix_planned",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackId: selection.selected.id,
      transition: mixPlan.transition,
    });

    const negotiation = await this.negotiator.negotiate({
      trackId: selection.selected.id,
      licenseType: input.preferences.licenseType,
      budgetRemainingUsd: input.budgetRemainingUsd,
    });
    this.eventBus.publish({
      eventName: "agent.negotiated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackId: selection.selected.id,
      licenseType: negotiation.licenseType,
      priceUsd: negotiation.priceUsd,
      reason: negotiation.reason,
    });

    return {
      status: negotiation.allowed ? "approved" : "rejected",
      trackId: selection.selected.id,
      mixPlan,
      negotiation,
    };
  }
}
