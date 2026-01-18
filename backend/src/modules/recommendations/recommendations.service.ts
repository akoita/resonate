import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

export interface UserPreferences {
  mood?: string;
  energy?: "low" | "medium" | "high";
  genres?: string[];
  allowExplicit?: boolean;
}

@Injectable()
export class RecommendationsService {
  private preferences = new Map<string, UserPreferences>();
  private recentTrackIds = new Map<string, string[]>();

  constructor(private readonly eventBus: EventBus) {}

  setPreferences(userId: string, prefs: UserPreferences) {
    const existing = this.preferences.get(userId) ?? {};
    const merged = { ...existing, ...prefs };
    this.preferences.set(userId, merged);
    this.eventBus.publish({
      eventName: "recommendation.preferences_updated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      preferences: merged as Record<string, unknown>,
    });
    return { userId, preferences: merged };
  }

  getPreferences(userId: string) {
    return this.preferences.get(userId) ?? {};
  }

  async getRecommendations(userId: string, limit = 10) {
    const prefs = this.getPreferences(userId);
    const allowExplicit = prefs.allowExplicit ?? false;
    const candidates = await prisma.track.findMany({
      where: {
        ...(prefs.genres?.length ? { genre: { in: prefs.genres } } : {}),
        ...(allowExplicit ? {} : { explicit: false }),
      } as any,
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    const recent = this.recentTrackIds.get(userId) ?? [];
    const filtered = candidates.filter((track) => !recent.includes(track.id));
    const selected = (filtered.length ? filtered : candidates).slice(0, limit);

    const updatedRecent = [
      ...selected.map((track) => track.id),
      ...recent,
    ].slice(0, 50);
    this.recentTrackIds.set(userId, updatedRecent);

    this.eventBus.publish({
      eventName: "recommendation.generated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      trackIds: selected.map((track) => track.id),
      strategy: prefs.genres?.length ? "genre_match" : "recent_first",
    });

    return {
      userId,
      preferences: prefs,
      items: selected.map((track) => ({
        id: track.id,
        title: track.title,
        artistId: track.artistId,
      })),
    };
  }
}
