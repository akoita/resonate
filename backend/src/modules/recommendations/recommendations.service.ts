import { Injectable, Optional } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { scoreMultiplierForSignal, TasteMemoryPolicy, TasteMemoryService } from "./taste_memory.service";

const PUBLIC_RELEASE_ROUTES = [
  "LIMITED_MONITORING",
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
];

export interface UserPreferences {
  mood?: string;
  energy?: "low" | "medium" | "high";
  genres?: string[];
  allowExplicit?: boolean;
}

@Injectable()
export class RecommendationsService {
  private preferences = new Map<string, UserPreferences>();
  private preferencesUpdatedAt = new Map<string, Date>();
  private recentTrackIds = new Map<string, string[]>();

  constructor(
    private readonly eventBus: EventBus,
    @Optional() private readonly tasteMemoryService?: TasteMemoryService,
  ) { }

  setPreferences(userId: string, prefs: UserPreferences) {
    const existing = this.preferences.get(userId) ?? {};
    const merged = { ...existing, ...prefs };
    this.preferences.set(userId, merged);
    this.preferencesUpdatedAt.set(userId, new Date());
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

  async getRecommendations(userId: string, limit = 10, preferenceOverrides?: UserPreferences) {
    const policy = await this.tasteMemoryService?.getPolicy(userId);
    const storedPreferences = shouldUseStoredPreferences(
      this.getPreferences(userId),
      this.preferencesUpdatedAt.get(userId),
      policy,
    );
    const mergedPrefs = { ...storedPreferences, ...(preferenceOverrides ?? {}) };
    const prefs = policy && this.tasteMemoryService
      ? this.tasteMemoryService.filterPreferencesWithPolicy(mergedPrefs, policy)
      : mergedPrefs;
    const allowExplicit = prefs.allowExplicit ?? false;
    const normalizedGenres = (prefs.genres ?? [])
      .map((genre) => genre.trim())
      .filter(Boolean);
    const normalizedMood = prefs.mood?.trim();
    const candidates = await prisma.track.findMany({
      where: {
        release: {
          status: { in: ["ready", "published"] },
          OR: [
            { rightsRoute: null },
            { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
          ],
        },
        ...(allowExplicit ? {} : { explicit: false }),
      },
      include: {
        release: {
          include: {
            artist: { select: { id: true, displayName: true } },
          },
        },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    const recent = this.recentTrackIds.get(userId) ?? [];
    const scored = candidates.map((track) => {
      const genre = track.release.genre ?? "";
      const moods = track.release.moods ?? [];
      const reasons: string[] = [];
      let score = 0;

      if (normalizedGenres.length) {
        const matchedGenre = normalizedGenres.find((candidate) =>
          genre.toLowerCase().includes(candidate.toLowerCase()),
        );
        if (matchedGenre) {
          const multiplier = scoreMultiplierForSignal(policy, "genre", matchedGenre);
          score += 50 * multiplier;
          if (multiplier < 1) {
            reasons.push(`downranked:genre:${matchedGenre}`);
          }
          reasons.push(`genre:${matchedGenre}`);
        }
      }

      if (normalizedMood) {
        const moodNeedle = normalizedMood.toLowerCase();
        if (
          track.title.toLowerCase().includes(moodNeedle) ||
          track.release.title.toLowerCase().includes(moodNeedle) ||
          genre.toLowerCase().includes(moodNeedle) ||
          moods.some((mood) => mood.toLowerCase().includes(moodNeedle))
        ) {
          const multiplier = scoreMultiplierForSignal(policy, "mood", normalizedMood);
          score += 35 * multiplier;
          if (multiplier < 1) {
            reasons.push(`downranked:mood:${normalizedMood}`);
          }
          reasons.push(`mood:${normalizedMood}`);
        }
      }

      if (track.release.genre) {
        score += 5;
      }
      if (recent.includes(track.id)) {
        score -= 100;
        reasons.push("recently_played");
      }

      return { track, score, reasons };
    });

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return b.track.createdAt.getTime() - a.track.createdAt.getTime();
    });

    const preferenceMatches = scored.filter((entry) =>
      !recent.includes(entry.track.id)
      && entry.reasons.some((reason) => reason.startsWith("genre:") || reason.startsWith("mood:")),
    );
    const freshFallback = scored.filter((entry) => !recent.includes(entry.track.id));
    const selected = (preferenceMatches.length ? preferenceMatches : freshFallback.length ? freshFallback : scored)
      .slice(0, limit);

    const updatedRecent = [
      ...selected.map((entry) => entry.track.id),
      ...recent,
    ].slice(0, 50);
    this.recentTrackIds.set(userId, updatedRecent);

    this.eventBus.publish({
      eventName: "recommendation.generated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      trackIds: selected.map((entry) => entry.track.id),
      strategy: normalizedGenres.length || normalizedMood ? "preference_mapping" : "recent_first",
    });

    return {
      userId,
      preferences: prefs,
      items: selected.map(({ track, score, reasons }) => ({
        id: track.id,
        title: track.title,
        artistId: track.release.artistId,
        artist: track.artist || track.release.primaryArtist || track.release.artist?.displayName || null,
        releaseId: track.releaseId,
        releaseTitle: track.release.title,
        genre: track.release.genre,
        moods: track.release.moods,
        score: Math.max(0, score),
        reasons: reasons.filter((reason) => reason !== "recently_played" && !reason.startsWith("downranked:")),
      })),
    };
  }
}

function shouldUseStoredPreferences(
  preferences: UserPreferences,
  updatedAt: Date | undefined,
  policy?: TasteMemoryPolicy,
) {
  if (!policy?.resetAt) {
    return preferences;
  }
  if (updatedAt && updatedAt > policy.resetAt) {
    return preferences;
  }
  return {};
}
