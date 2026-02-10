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

export interface OrchestratedTrack {
  trackId: string;
  mixPlan: any;
  negotiation: any;
}

@Injectable()
export class AgentOrchestratorService {
  constructor(
    private readonly selector: AgentSelectorService,
    private readonly mixer: AgentMixerService,
    private readonly negotiator: AgentNegotiatorService,
    private readonly eventBus: EventBus
  ) { }

  async orchestrate(input: AgentOrchestratorInput): Promise<{
    status: string;
    tracks: OrchestratedTrack[];
  }> {
    // Build queries from ALL vibes + mood
    const queries: string[] = [];
    if (input.preferences.genres?.length) {
      queries.push(...input.preferences.genres);
    }
    if (input.preferences.mood && !queries.includes(input.preferences.mood)) {
      queries.push(input.preferences.mood);
    }

    // Select multiple candidates across all vibes
    const selection = await this.selector.select({
      queries,
      recentTrackIds: input.recentTrackIds,
      allowExplicit: input.preferences.allowExplicit,
      useEmbeddings: queries.length > 0,
      limit: parseInt(process.env.AGENT_TRACK_LIMIT ?? "5", 10),
    });

    if (!selection.selected || selection.selected.length === 0) {
      this.eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: "",
        reason: "no_tracks",
      });
      return { status: "no_tracks", tracks: [] };
    }

    this.eventBus.publish({
      eventName: "agent.selection",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackId: selection.selected[0]?.id,
      candidates: selection.candidates,
      count: selection.selected.length,
    });

    // Process each selected track through mixer + negotiator
    const tracks: OrchestratedTrack[] = [];
    let budgetLeft = input.budgetRemainingUsd;
    let previousTrackId = input.recentTrackIds[0];

    for (const track of selection.selected) {
      const mixPlan = this.mixer.plan({
        trackId: track.id,
        previousTrackId,
        mood: input.preferences.mood,
        energy: input.preferences.energy,
      });

      this.eventBus.publish({
        eventName: "agent.mix_planned",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: track.id,
        trackTitle: track.title ?? "Unknown",
        transition: mixPlan.transition,
      });

      const negotiation = await this.negotiator.negotiate({
        trackId: track.id,
        licenseType: input.preferences.licenseType,
        budgetRemainingUsd: budgetLeft,
      });

      this.eventBus.publish({
        eventName: "agent.negotiated",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: track.id,
        trackTitle: track.title ?? "Unknown",
        licenseType: negotiation.licenseType,
        priceUsd: negotiation.priceUsd,
        reason: negotiation.reason,
      });

      if (negotiation.allowed) {
        budgetLeft -= negotiation.priceUsd;
        tracks.push({ trackId: track.id, mixPlan, negotiation });
      }

      previousTrackId = track.id;

      if (budgetLeft <= 0) break;
    }

    // Final decision event
    this.eventBus.publish({
      eventName: "agent.decision_made",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackCount: tracks.length,
      totalSpend: tracks.reduce((sum, t) => sum + t.negotiation.priceUsd, 0),
      reason: tracks.length > 0 ? "approved" : "all_rejected",
    });

    return {
      status: tracks.length > 0 ? "approved" : "all_rejected",
      tracks,
    };
  }
}
