import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { calculatePrice, PricingInput } from "../../pricing/pricing";

export interface AgentPreferences {
  mood?: string;
  energy?: "low" | "medium" | "high";
  genres?: string[];
  allowExplicit?: boolean;
  licenseType?: "personal" | "remix" | "commercial";
}

interface AgentSessionState {
  preferences: AgentPreferences;
  recentTrackIds: string[];
}

@Injectable()
export class AgentOrchestrationService {
  private states = new Map<string, AgentSessionState>();

  constructor(private readonly eventBus: EventBus) {}

  configureSession(sessionId: string, preferences: AgentPreferences = {}) {
    const existing = this.states.get(sessionId);
    const merged = { ...(existing?.preferences ?? {}), ...preferences };
    this.states.set(sessionId, {
      preferences: merged,
      recentTrackIds: existing?.recentTrackIds ?? [],
    });
  }

  async selectNextTrack(input: { sessionId: string; preferences?: AgentPreferences }) {
    if (input.preferences) {
      this.configureSession(input.sessionId, input.preferences);
    }
    const state = this.states.get(input.sessionId) ?? {
      preferences: {},
      recentTrackIds: [],
    };
    const preferences = state.preferences;
    const allowExplicit = preferences.allowExplicit ?? false;

    const candidates = await prisma.track.findMany({
      where: {
        ...(preferences.genres?.length ? { genre: { in: preferences.genres } } : {}),
        ...(allowExplicit ? {} : { explicit: false }),
      } as any,
      take: 25,
      orderBy: { createdAt: "desc" },
    });

    const selected =
      candidates.find((track) => !state.recentTrackIds.includes(track.id)) ??
      candidates[0];
    if (!selected) {
      return { status: "no_tracks" };
    }

    const licenseType = preferences.licenseType ?? "personal";
    const priceUsd = calculatePrice(
      licenseType,
      this.defaultPricing(),
      state.recentTrackIds.length > 5
    );

    state.recentTrackIds = [selected.id, ...state.recentTrackIds].slice(0, 20);
    this.states.set(input.sessionId, state);

    this.eventBus.publish({
      eventName: "agent.track_selected",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackId: selected.id,
      strategy: "recent-first",
      preferences: preferences as Record<string, unknown>,
    });
    this.eventBus.publish({
      eventName: "agent.decision_made",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackId: selected.id,
      licenseType,
      priceUsd,
      reason: "pricing_policy_default",
    });

    return {
      status: "ok",
      track: {
        id: selected.id,
        title: selected.title,
        artistId: selected.artistId,
      },
      licenseType,
      priceUsd,
    };
  }

  private defaultPricing(): PricingInput {
    return {
      basePlayPriceUsd: 0.02,
      remixSurchargeMultiplier: 3,
      commercialMultiplier: 5,
      volumeDiscountPercent: 5,
      floorUsd: 0.01,
      ceilingUsd: 1,
    };
  }
}
