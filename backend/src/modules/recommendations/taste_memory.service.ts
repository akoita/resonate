import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import type { UserPreferences } from "./recommendations.service";

export const TASTE_SIGNAL_TYPES = [
  "genre",
  "mood",
  "artist",
  "scene",
  "intent",
  "novelty",
  "replay",
  "commerce",
] as const;

export const TASTE_SIGNAL_ACTIONS = ["hidden", "downranked"] as const;
export const RECOMMENDATION_EXPLANATION_PREFERENCES = ["compact", "balanced", "detailed"] as const;

export type TasteSignalType = (typeof TASTE_SIGNAL_TYPES)[number];
export type TasteSignalAction = (typeof TASTE_SIGNAL_ACTIONS)[number];
export type RecommendationExplanationPreference = (typeof RECOMMENDATION_EXPLANATION_PREFERENCES)[number];

export interface TasteMemorySettingsDto {
  socialMatchingEnabled: boolean;
  citySceneDiscoveryEnabled: boolean;
  agentPlaybackTrainingEnabled: boolean;
  recommendationExplanationPreference: RecommendationExplanationPreference;
  resetAt: string | null;
}

export interface TasteSignalControlDto {
  id: string;
  signalType: TasteSignalType;
  value: string;
  action: TasteSignalAction;
  source: string | null;
  createdAt: string;
}

export interface TasteMemoryPolicy {
  settings: TasteMemorySettingsDto;
  resetAt?: Date;
  hidden: Map<TasteSignalType, Set<string>>;
  downranked: Map<TasteSignalType, Set<string>>;
}

type SafeSignalMetadata = Record<string, unknown>;

const DEFAULT_SETTINGS: Omit<TasteMemorySettingsDto, "resetAt"> = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
};

@Injectable()
export class TasteMemoryService {
  constructor(private readonly eventBus: EventBus) {}

  async getTasteMemory(userId: string) {
    const settings = await this.getOrCreateSettings(userId);
    const resetAt = settings.resetAt ?? undefined;

    const [controls, config, signals] = await Promise.all([
      prisma.listenerTasteSignalControl.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.agentConfig.findUnique({
        where: { userId },
        select: { learnedTasteProfile: true, vibes: true },
      }),
      prisma.agentSignal.findMany({
        where: {
          userId,
          ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          track: {
            select: {
              artist: true,
              release: {
                select: {
                  genre: true,
                  primaryArtist: true,
                  artist: { select: { displayName: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const policy = buildPolicy(settingsDto(settings), controls.map(controlDto));
    const profile = tasteProfile(config?.learnedTasteProfile);
    const genreWeights = new Map<string, number>();
    const moodWeights = new Map<string, number>();
    const artistWeights = new Map<string, number>();
    const intentWeights = new Map<string, number>();
    let replayWeight = 0;
    let skipWeight = 0;
    let commerceWeight = 0;
    let libraryWeight = 0;

    for (const [genre, weight] of Object.entries(profile?.genreWeights ?? {})) {
      addWeighted(genreWeights, genre, Number(weight) || 0, policy, "genre");
    }

    for (const signal of signals) {
      const weight = Number(signal.weight) || 0;
      const metadata = jsonObject(signal.metadata);
      addWeighted(genreWeights, signal.track.release.genre, weight, policy, "genre");
      addWeighted(moodWeights, metadata.mood, weight, policy, "mood");
      addWeighted(
        artistWeights,
        signal.track.artist || signal.track.release.primaryArtist || signal.track.release.artist?.displayName,
        weight,
        policy,
        "artist",
      );
      addWeighted(intentWeights, metadata.sessionIntentName || metadata.sessionIntent, weight, policy, "intent");

      if (signal.action === "replay") replayWeight += weight;
      if (signal.action === "skip") skipWeight += Math.abs(weight);
      if (signal.action === "purchase") commerceWeight += weight;
      if (signal.action === "save" || signal.action === "add_to_playlist") libraryWeight += weight;
    }

    return {
      schemaVersion: "listener-taste-memory/v1",
      settings: settingsDto(settings),
      summary: {
        favoredGenres: rankedLabels(genreWeights, policy, "genre"),
        favoredMoods: rankedLabels(moodWeights, policy, "mood"),
        favoredArtists: rankedLabels(artistWeights, policy, "artist"),
        recentIntents: rankedLabels(intentWeights, policy, "intent"),
        noveltyPattern: noveltyPattern(replayWeight, skipWeight),
        commercePreference: commercePreference(commerceWeight, libraryWeight),
        explanationPreference: settings.recommendationExplanationPreference,
      },
      controls: controls.map(controlDto),
      privacy: {
        socialMatching: settings.socialMatchingEnabled ? "enabled" : "disabled",
        citySceneDiscovery: settings.citySceneDiscoveryEnabled ? "enabled" : "disabled",
        agentPlaybackTraining: settings.agentPlaybackTrainingEnabled ? "enabled" : "disabled",
        notes: [
          "Raw listening events, wallet data, ownership data, and private identifiers are not shown here.",
          "Social matching remains disabled unless explicitly enabled.",
        ],
      },
    };
  }

  async updateSettings(userId: string, input: Partial<Omit<TasteMemorySettingsDto, "resetAt">>) {
    await this.ensureUser(userId);
    const data: Prisma.ListenerTasteMemorySettingsUpdateInput = {};
    if (typeof input.socialMatchingEnabled === "boolean") {
      data.socialMatchingEnabled = input.socialMatchingEnabled;
    }
    if (typeof input.citySceneDiscoveryEnabled === "boolean") {
      data.citySceneDiscoveryEnabled = input.citySceneDiscoveryEnabled;
    }
    if (typeof input.agentPlaybackTrainingEnabled === "boolean") {
      data.agentPlaybackTrainingEnabled = input.agentPlaybackTrainingEnabled;
    }
    const explanationPreference = normalizeExplanationPreference(input.recommendationExplanationPreference);
    if (explanationPreference) {
      data.recommendationExplanationPreference = explanationPreference;
    }

    const settings = await prisma.listenerTasteMemorySettings.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        socialMatchingEnabled:
          (data.socialMatchingEnabled as boolean | undefined) ?? DEFAULT_SETTINGS.socialMatchingEnabled,
        citySceneDiscoveryEnabled:
          (data.citySceneDiscoveryEnabled as boolean | undefined) ?? DEFAULT_SETTINGS.citySceneDiscoveryEnabled,
        agentPlaybackTrainingEnabled:
          (data.agentPlaybackTrainingEnabled as boolean | undefined) ?? DEFAULT_SETTINGS.agentPlaybackTrainingEnabled,
        recommendationExplanationPreference:
          (data.recommendationExplanationPreference as string | undefined)
          ?? DEFAULT_SETTINGS.recommendationExplanationPreference,
      },
    });

    this.publish("taste_memory.settings_updated", userId, {
      settings: settingsDto(settings),
    });

    return settingsDto(settings);
  }

  async resetTasteMemory(userId: string) {
    await this.ensureUser(userId);
    const settings = await prisma.listenerTasteMemorySettings.upsert({
      where: { userId },
      update: { resetAt: new Date() },
      create: {
        userId,
        ...DEFAULT_SETTINGS,
        resetAt: new Date(),
      },
    });
    await prisma.agentConfig.updateMany({
      where: { userId },
      data: {
        learnedTasteProfile: Prisma.JsonNull,
        tasteScore: 0,
        tasteUpdatedAt: null,
      },
    });
    this.publish("taste_memory.reset", userId, { resetAt: settings.resetAt?.toISOString() ?? null });
    return settingsDto(settings);
  }

  async upsertSignalControl(userId: string, input: {
    signalType: unknown;
    value: unknown;
    action?: unknown;
    source?: unknown;
  }) {
    await this.ensureUser(userId);
    const signalType = normalizeSignalType(input.signalType);
    const value = normalizeSignalValue(input.value);
    const action = normalizeSignalAction(input.action) ?? "hidden";
    const source = normalizeOptionalString(input.source, 80);
    if (!signalType || !value) {
      throw new BadRequestException("signalType and value are required");
    }

    const control = await prisma.listenerTasteSignalControl.upsert({
      where: {
        userId_signalType_value: {
          userId,
          signalType,
          value,
        },
      },
      update: { action, source },
      create: { userId, signalType, value, action, source },
    });

    this.publish(action === "hidden" ? "taste_memory.signal_hidden" : "taste_memory.signal_downranked", userId, {
      signalType,
      value,
      action,
    });

    return controlDto(control);
  }

  async removeSignalControl(userId: string, controlId: string) {
    const control = await prisma.listenerTasteSignalControl.findFirst({
      where: { id: controlId, userId },
    });
    if (!control) {
      throw new NotFoundException("Taste signal control not found");
    }
    await prisma.listenerTasteSignalControl.delete({ where: { id: control.id } });
    this.publish("taste_memory.signal_restored", userId, {
      signalType: control.signalType,
      value: control.value,
      action: control.action,
    });
    return { status: "restored", control: controlDto(control) };
  }

  async getPolicy(userId: string): Promise<TasteMemoryPolicy> {
    const settings = await prisma.listenerTasteMemorySettings.findUnique({ where: { userId } });
    const controls = await prisma.listenerTasteSignalControl.findMany({ where: { userId } });
    return buildPolicy(settingsDto(settings ?? defaultSettingsRecord()), controls.map(controlDto));
  }

  async shouldTrainAgentPlayback(userId: string, metadata?: SafeSignalMetadata | null) {
    const source = typeof metadata?.source === "string" ? metadata.source : undefined;
    if (source !== "agent_session") {
      return true;
    }
    const settings = await prisma.listenerTasteMemorySettings.findUnique({ where: { userId } });
    return settings?.agentPlaybackTrainingEnabled ?? DEFAULT_SETTINGS.agentPlaybackTrainingEnabled;
  }

  async canUseTasteForSocialMatching(userId: string) {
    const settings = await prisma.listenerTasteMemorySettings.findUnique({ where: { userId } });
    return settings?.socialMatchingEnabled ?? DEFAULT_SETTINGS.socialMatchingEnabled;
  }

  async filterPreferences(userId: string, prefs: UserPreferences) {
    const policy = await this.getPolicy(userId);
    return filterPreferencesWithPolicy(prefs, policy);
  }

  filterPreferencesWithPolicy(prefs: UserPreferences, policy: TasteMemoryPolicy) {
    return filterPreferencesWithPolicy(prefs, policy);
  }

  private async getOrCreateSettings(userId: string) {
    await this.ensureUser(userId);
    return prisma.listenerTasteMemorySettings.upsert({
      where: { userId },
      update: {},
      create: { userId, ...DEFAULT_SETTINGS },
    });
  }

  private async ensureUser(userId: string) {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: `${userId}@wallet.local`,
      },
    });
  }

  private publish(eventName: string, userId: string, payload: Record<string, unknown>) {
    this.eventBus.publish({
      eventName,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      ...payload,
    } as never);
  }
}

export function filterPreferencesWithPolicy(
  prefs: UserPreferences,
  policy: TasteMemoryPolicy,
): UserPreferences {
  const genres = (prefs.genres ?? [])
    .filter((genre) => !hasSignal(policy.hidden, "genre", genre));
  const mood = hasSignal(policy.hidden, "mood", prefs.mood) ? undefined : prefs.mood;
  return {
    ...prefs,
    ...(prefs.genres ? { genres } : {}),
    ...(mood ? { mood } : { mood: undefined }),
  };
}

export function scoreMultiplierForSignal(
  policy: TasteMemoryPolicy | undefined,
  signalType: TasteSignalType,
  value?: string | null,
) {
  if (!policy || !value) return 1;
  if (hasSignal(policy.hidden, signalType, value)) return 0;
  if (hasSignal(policy.downranked, signalType, value)) return 0.35;
  return 1;
}

export function hasSignal(
  controls: Map<TasteSignalType, Set<string>>,
  signalType: TasteSignalType,
  value?: string | null,
) {
  if (!value) return false;
  return controls.get(signalType)?.has(normalizeKey(value)) ?? false;
}

function buildPolicy(
  settings: TasteMemorySettingsDto,
  controls: TasteSignalControlDto[],
): TasteMemoryPolicy {
  const hidden = new Map<TasteSignalType, Set<string>>();
  const downranked = new Map<TasteSignalType, Set<string>>();
  for (const control of controls) {
    const target = control.action === "downranked" ? downranked : hidden;
    const values = target.get(control.signalType) ?? new Set<string>();
    values.add(normalizeKey(control.value));
    target.set(control.signalType, values);
  }
  return {
    settings,
    resetAt: settings.resetAt ? new Date(settings.resetAt) : undefined,
    hidden,
    downranked,
  };
}

function settingsDto(settings: {
  socialMatchingEnabled: boolean;
  citySceneDiscoveryEnabled: boolean;
  agentPlaybackTrainingEnabled: boolean;
  recommendationExplanationPreference: string;
  resetAt: Date | null;
}): TasteMemorySettingsDto {
  return {
    socialMatchingEnabled: settings.socialMatchingEnabled,
    citySceneDiscoveryEnabled: settings.citySceneDiscoveryEnabled,
    agentPlaybackTrainingEnabled: settings.agentPlaybackTrainingEnabled,
    recommendationExplanationPreference:
      normalizeExplanationPreference(settings.recommendationExplanationPreference) ?? "balanced",
    resetAt: settings.resetAt?.toISOString() ?? null,
  };
}

function defaultSettingsRecord() {
  return {
    ...DEFAULT_SETTINGS,
    resetAt: null,
  };
}

function controlDto(control: {
  id: string;
  signalType: string;
  value: string;
  action: string;
  source: string | null;
  createdAt: Date;
}): TasteSignalControlDto {
  return {
    id: control.id,
    signalType: normalizeSignalType(control.signalType) ?? "genre",
    value: control.value,
    action: normalizeSignalAction(control.action) ?? "hidden",
    source: control.source,
    createdAt: control.createdAt.toISOString(),
  };
}

function addWeighted(
  target: Map<string, number>,
  value: unknown,
  weight: number,
  policy: TasteMemoryPolicy,
  signalType: TasteSignalType,
) {
  const label = normalizeSignalValue(value);
  if (!label || hasSignal(policy.hidden, signalType, label)) return;
  const multiplier = hasSignal(policy.downranked, signalType, label) ? 0.35 : 1;
  target.set(label, (target.get(label) ?? 0) + weight * multiplier);
}

function rankedLabels(
  values: Map<string, number>,
  policy: TasteMemoryPolicy,
  signalType: TasteSignalType,
) {
  return Array.from(values.entries())
    .filter(([value, weight]) => weight > 0 && !hasSignal(policy.hidden, signalType, value))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([value]) => value);
}

function noveltyPattern(replayWeight: number, skipWeight: number) {
  if (replayWeight > skipWeight * 1.5 && replayWeight > 0) return "Replay-friendly";
  if (skipWeight > replayWeight * 1.5 && skipWeight > 0) return "Discovery-seeking";
  return "Balanced discovery";
}

function commercePreference(commerceWeight: number, libraryWeight: number) {
  if (commerceWeight > 0 && commerceWeight >= libraryWeight) return "Buyer intent";
  if (libraryWeight > 0) return "Library builder";
  return "Listening first";
}

function normalizeSignalType(value: unknown): TasteSignalType | undefined {
  return typeof value === "string" && TASTE_SIGNAL_TYPES.includes(value as TasteSignalType)
    ? value as TasteSignalType
    : undefined;
}

function normalizeSignalAction(value: unknown): TasteSignalAction | undefined {
  return typeof value === "string" && TASTE_SIGNAL_ACTIONS.includes(value as TasteSignalAction)
    ? value as TasteSignalAction
    : undefined;
}

function normalizeExplanationPreference(value: unknown): RecommendationExplanationPreference | undefined {
  return typeof value === "string"
    && RECOMMENDATION_EXPLANATION_PREFERENCES.includes(value as RecommendationExplanationPreference)
    ? value as RecommendationExplanationPreference
    : undefined;
}

function normalizeSignalValue(value: unknown) {
  return normalizeOptionalString(value, 80);
}

function normalizeOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /https?:\/\//i.test(cleaned) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(cleaned)) return undefined;
  if (/\b(?:0x[a-fA-F0-9]{16,}|user[_:-]?[A-Za-z0-9_-]{6,}|session[_:-]?[A-Za-z0-9_-]{6,})\b/.test(cleaned)) {
    return undefined;
  }
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trimEnd() : cleaned;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function tasteProfile(value: unknown): { genreWeights?: Record<string, number> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as { genreWeights?: Record<string, number> };
}
