import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { TasteNoteEmbeddingService } from "../embeddings/taste_note_embedding.service";
import { EventBus } from "../shared/event_bus";
import { sanitizeSignalMetadataString } from "../shared/signal_metadata_sanitizer";
import type { UserPreferences } from "./recommendations.service";
import { TASTE_EDIT_PARSER } from "./model_taste_edit_parser";
import {
  candidateArtistNames,
  DECLARED_ENERGY_VALUES,
  DECLARED_TEXT_EDIT_SOURCE,
  isAllowedDeclaredEdit,
  ParsedTasteEdits,
  TASTE_EDIT_MAX_TEXT_LENGTH,
  TasteEditParser,
  deterministicTasteEditParser,
} from "./taste_edit_parser";

export const TASTE_SIGNAL_TYPES = [
  "genre",
  "mood",
  "artist",
  "scene",
  "intent",
  "novelty",
  "replay",
  "commerce",
  // Declared-only types (#1961, ADR-TE-5): written through confirmed taste
  // edits, never through the manual signal control route.
  "energy",
  "note",
] as const;

export const TASTE_SIGNAL_ACTIONS = ["hidden", "downranked", "boosted", "declared"] as const;

/** Signal types and actions the manual `POST /taste-memory/signals` route accepts. */
const MANUAL_SIGNAL_TYPES: readonly TasteSignalType[] = [
  "genre",
  "mood",
  "artist",
  "scene",
  "intent",
  "novelty",
  "replay",
  "commerce",
];
const MANUAL_SIGNAL_ACTIONS: readonly TasteSignalAction[] = ["hidden", "downranked"];

/** Score multiplier for a listener-downranked signal. */
export const DOWNRANKED_SCORE_MULTIPLIER = 0.35;
/**
 * Score multiplier for a listener-boosted signal (#1961). Hidden still wins
 * over everything; a boost never resurrects a hidden signal.
 */
export const BOOSTED_SCORE_MULTIPLIER = 1.5;
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
  /**
   * Declared "more of this" signals (#1961). Keyed by normalized value, like
   * `hidden` and `downranked`. `note` controls never appear here: a written
   * preference steers Home through its embedding (#2006), not through this map.
   */
  boosted: Map<TasteSignalType, Set<string>>;
  /**
   * The same boosts with their original casing, plus the declared energy band,
   * for the places that feed values back into preference matching.
   */
  declared?: DeclaredTastePreferences;
}

export interface DeclaredTastePreferences {
  boostedGenres: string[];
  boostedMoods: string[];
  energy?: "low" | "medium" | "high";
}

export type TasteEditPreview = ParsedTasteEdits;


type SafeSignalMetadata = Record<string, unknown>;

/** Most confirmed edits one apply request may carry. */
const MAX_CONFIRMED_EDITS = 20;
/** Most distinct artist names a single preview looks up. */
const MAX_ARTIST_LOOKUPS = 10;

const DEFAULT_SETTINGS: Omit<TasteMemorySettingsDto, "resetAt"> = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
};

@Injectable()
export class TasteMemoryService {
  constructor(
    private readonly eventBus: EventBus,
    // Embeds written notes so they can steer Home (#2006). Absent or disabled:
    // a note is stored and shown but has no ranking effect.
    @Optional() private readonly noteEmbeddings?: TasteNoteEmbeddingService,
    // Chosen by TASTE_EDIT_PARSER_STRATEGY (#2006); direct construction in
    // specs keeps the deterministic parser.
    @Optional()
    @Inject(TASTE_EDIT_PARSER)
    private readonly tasteEditParser: TasteEditParser = deterministicTasteEditParser,
  ) {}

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
    const source = sanitizeSignalMetadataString(input.source, 80);
    if (!signalType || !value) {
      throw new BadRequestException("signalType and value are required");
    }
    // Boosted, energy and note controls exist only as confirmed taste edits
    // (#1961): the manual route keeps its original hide/downrank contract.
    if (!MANUAL_SIGNAL_TYPES.includes(signalType) || !MANUAL_SIGNAL_ACTIONS.includes(action)) {
      throw new BadRequestException("This signal can only be set through taste edits");
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
      // A written note holds the listener's own words: never published.
      ...(control.signalType === "note" ? {} : { value: control.value }),
      action: control.action,
    });
    return { status: "restored", control: controlDto(control) };
  }

  /**
   * Proposes taste edits for free text (#1961, ADR-TE-5). NEVER writes: the
   * only database access is a read-only artist-name lookup, and the text is
   * not stored, logged or published. `parser` is the model seam: the injected
   * parser is deterministic unless `TASTE_EDIT_PARSER_STRATEGY=model-assisted`
   * (#2006), which falls back to deterministic on any failure.
   */
  async previewTasteEdits(
    text: unknown,
    parser: TasteEditParser = this.tasteEditParser,
  ): Promise<TasteEditPreview> {
    if (typeof text !== "string") {
      throw new BadRequestException("text is required");
    }
    const bounded = text.slice(0, TASTE_EDIT_MAX_TEXT_LENGTH);
    const artists = await this.lookupArtistNames(candidateArtistNames(bounded));
    const parsed = await parser.parse(bounded, {
      resolveArtist: (name) => artists.get(name.trim().toLowerCase()),
      // For parsers that name artists the deterministic pass did not (model).
      resolveArtistAsync: async (name) => {
        const key = name.trim().toLowerCase();
        return (await this.lookupArtistNames([name.trim()])).get(key);
      },
    });
    return { items: parsed.items };
  }

  /**
   * Applies ONLY the edits the listener confirmed (#1961). Each item is
   * validated against the allowed (signalType, action) combinations before any
   * write; one invalid item rejects the whole request. Applied controls carry
   * `source: "declared_text_edit"`. Controls never decay: they stay until the
   * listener removes them, like every other taste control.
   */
  async applyTasteEdits(userId: string, rawItems: unknown) {
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_CONFIRMED_EDITS) {
      throw new BadRequestException(`items must list between 1 and ${MAX_CONFIRMED_EDITS} edits`);
    }

    const confirmed = new Map<string, { signalType: TasteSignalType; value: string; action: TasteSignalAction }>();
    let ignoredCount = 0;
    for (const raw of rawItems as Array<Record<string, unknown> | null>) {
      const item = raw && typeof raw === "object" ? raw : {};
      // Unmapped rows have nothing to apply; tolerate them rather than fail.
      if (item.kind === "unmapped" || item.signalType == null || item.action == null) {
        ignoredCount += 1;
        continue;
      }
      if (!isAllowedDeclaredEdit(item.signalType, item.action)) {
        throw new BadRequestException("Unsupported taste edit");
      }
      const signalType = normalizeSignalType(item.signalType);
      const action = normalizeSignalAction(item.action);
      let value = normalizeSignalValue(item.value);
      if (!signalType || !action || !value) {
        throw new BadRequestException("Invalid taste edit value");
      }
      if (signalType === "energy") {
        value = value.toLowerCase();
        if (!(DECLARED_ENERGY_VALUES as readonly string[]).includes(value)) {
          throw new BadRequestException("Invalid energy value");
        }
      }
      // The last of two edits on the same signal wins, as a listener would expect.
      const key = `${signalType}:${normalizeKey(value)}`;
      confirmed.delete(key);
      confirmed.set(key, { signalType, value, action });
    }

    const edits = [...confirmed.values()];
    if (edits.length > 0) {
      await this.ensureUser(userId);
      const declaredEnergy = edits.filter((edit) => edit.signalType === "energy").pop();
      const staleEnergy = declaredEnergy
        ? await prisma.listenerTasteSignalControl.findMany({
            where: {
              userId,
              signalType: "energy",
              value: { not: declaredEnergy.value },
            },
          })
        : [];

      const written = await prisma.$transaction([
        ...edits.map((edit) =>
          prisma.listenerTasteSignalControl.upsert({
            where: {
              userId_signalType_value: {
                userId,
                signalType: edit.signalType,
                value: edit.value,
              },
            },
            update: { action: edit.action, source: DECLARED_TEXT_EDIT_SOURCE },
            create: {
              userId,
              signalType: edit.signalType,
              value: edit.value,
              action: edit.action,
              source: DECLARED_TEXT_EDIT_SOURCE,
            },
          }),
        ),
        // One declared energy band at a time: the newest replaces the rest.
        ...(staleEnergy.length > 0
          ? [prisma.listenerTasteSignalControl.deleteMany({
              where: { id: { in: staleEnergy.map((control) => control.id) } },
            })]
          : []),
      ]);

      // Best-effort ranking seed for each written note (#2006). The control is
      // already saved: a missing provider or a failed call only means this note
      // has no ranking effect. The text goes to the provider and nowhere else.
      await Promise.all(
        edits.flatMap((edit, index) =>
          edit.signalType === "note" && edit.action === "declared"
            ? [this.embedNoteSafely((written[index] as { id: string }).id, edit.value)]
            : [],
        ),
      );

      for (const control of staleEnergy) {
        this.publish("taste_memory.signal_restored", userId, {
          signalType: control.signalType,
          value: control.value,
          action: control.action,
        });
      }
      for (const edit of edits) {
        // A written note can hold the listener's own words, so it is never
        // published; only its count appears in `edits_applied`.
        if (edit.action === "declared") continue;
        const eventName = edit.action === "boosted"
          ? "taste_memory.signal_boosted"
          : edit.action === "hidden"
            ? "taste_memory.signal_hidden"
            : "taste_memory.signal_downranked";
        this.publish(eventName, userId, {
          signalType: edit.signalType,
          value: edit.value,
          action: edit.action,
        });
      }
      this.publish("taste_memory.edits_applied", userId, {
        appliedCount: edits.length,
        ignoredCount,
        boostedCount: edits.filter((edit) => edit.action === "boosted").length,
        downrankedCount: edits.filter((edit) => edit.action === "downranked").length,
        hiddenCount: edits.filter((edit) => edit.action === "hidden").length,
        declaredCount: edits.filter((edit) => edit.action === "declared").length,
      });
    }

    const memory = await this.getTasteMemory(userId);
    return { ...memory, edits: { appliedCount: edits.length, ignoredCount } };
  }

  private async embedNoteSafely(controlId: string, text: string) {
    try {
      await this.noteEmbeddings?.embedNote(controlId, text);
    } catch {
      // Never fail an apply over a ranking seed, and never surface the text.
    }
  }

  private async lookupArtistNames(names: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const candidates = names.filter((name) => name.length > 0).slice(0, MAX_ARTIST_LOOKUPS);
    if (candidates.length === 0) return found;
    const artists = await prisma.artist.findMany({
      where: {
        OR: candidates.map((name) => ({ displayName: { equals: name, mode: "insensitive" as const } })),
      },
      select: { displayName: true },
      take: 50,
    });
    for (const artist of artists) {
      const key = artist.displayName.trim().toLowerCase();
      if (!found.has(key)) found.set(key, artist.displayName);
    }
    return found;
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
  const kept = (prefs.genres ?? [])
    .filter((genre) => !hasSignal(policy.hidden, "genre", genre));
  const declared = policy.declared;

  // Declared taste is added to what the listener already asked for, never
  // instead of it (#1961, ADR-TE-2 rule 6: declared over inferred). Hidden
  // still wins: one key holds one action, so a hidden signal cannot also be
  // boosted, but the check keeps the rule local.
  const seen = new Set(kept.map(normalizeKey));
  const boostedGenres = (declared?.boostedGenres ?? []).filter((genre) => {
    const key = normalizeKey(genre);
    if (seen.has(key) || hasSignal(policy.hidden, "genre", genre)) return false;
    seen.add(key);
    return true;
  });
  const genres = [...kept, ...boostedGenres];

  const requestedMood = hasSignal(policy.hidden, "mood", prefs.mood) ? undefined : prefs.mood;
  // The legacy contract carries one mood: a declared one fills the gap, the
  // rest reach ranking through the declared-preference signal.
  const mood = requestedMood
    ?? (declared?.boostedMoods ?? []).find((candidate) => !hasSignal(policy.hidden, "mood", candidate));
  const energy = prefs.energy ?? declared?.energy;

  return {
    ...prefs,
    ...(prefs.genres || boostedGenres.length > 0 ? { genres } : {}),
    ...(mood ? { mood } : { mood: undefined }),
    ...(energy ? { energy } : {}),
  };
}

export function scoreMultiplierForSignal(
  policy: TasteMemoryPolicy | undefined,
  signalType: TasteSignalType,
  value?: string | null,
) {
  if (!policy || !value) return 1;
  if (hasSignal(policy.hidden, signalType, value)) return 0;
  if (hasSignal(policy.downranked, signalType, value)) return DOWNRANKED_SCORE_MULTIPLIER;
  if (hasSignal(policy.boosted, signalType, value)) return BOOSTED_SCORE_MULTIPLIER;
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

export function buildPolicy(
  settings: TasteMemorySettingsDto,
  controls: TasteSignalControlDto[],
): TasteMemoryPolicy {
  const hidden = new Map<TasteSignalType, Set<string>>();
  const downranked = new Map<TasteSignalType, Set<string>>();
  const boosted = new Map<TasteSignalType, Set<string>>();
  const declared: DeclaredTastePreferences = { boostedGenres: [], boostedMoods: [] };
  let energyCreatedAt = "";
  for (const control of controls) {
    // `declared` (written notes) deliberately reaches no map: a note steers
    // Home through its embedding vector (#2006), which is looked up separately.
    const target = control.action === "downranked"
      ? downranked
      : control.action === "boosted"
        ? boosted
        : control.action === "hidden"
          ? hidden
          : undefined;
    if (!target) continue;
    const values = target.get(control.signalType) ?? new Set<string>();
    values.add(normalizeKey(control.value));
    target.set(control.signalType, values);

    if (control.action !== "boosted") continue;
    if (control.signalType === "genre") declared.boostedGenres.push(control.value);
    if (control.signalType === "mood") declared.boostedMoods.push(control.value);
    if (control.signalType === "energy" && control.createdAt >= energyCreatedAt) {
      const band = normalizeKey(control.value);
      if (band === "low" || band === "medium" || band === "high") {
        declared.energy = band;
        energyCreatedAt = control.createdAt;
      }
    }
  }
  declared.boostedGenres.sort((a, b) => a.localeCompare(b));
  declared.boostedMoods.sort((a, b) => a.localeCompare(b));
  return {
    settings,
    resetAt: settings.resetAt ? new Date(settings.resetAt) : undefined,
    hidden,
    downranked,
    boosted,
    declared,
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
  const multiplier = hasSignal(policy.downranked, signalType, label)
    ? DOWNRANKED_SCORE_MULTIPLIER
    : hasSignal(policy.boosted, signalType, label)
      ? BOOSTED_SCORE_MULTIPLIER
      : 1;
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
  return sanitizeSignalMetadataString(value, 80);
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
