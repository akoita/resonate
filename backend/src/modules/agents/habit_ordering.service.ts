import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { readTasteHistory } from "./agent_learning.service";
import type { AgentTasteSignalInput } from "./agent_learning.service";
import type { ResolvedMyMixPlan } from "./agent_my_mix";
import {
  HabitEnergyBand,
  HabitOrderTrack,
  HabitOrderingObservation,
  deriveHabitOrderingState,
  orderHabitTracks,
} from "./habit_ordering";
import { AnalyticsConsentService } from "../analytics/analytics_consent.service";
import { readTasteMemoryPolicy, hasSignal, TasteMemoryPolicy } from "../recommendations/taste_memory.service";
import {
  TASTE_EDIT_GENRES,
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_MOODS,
  TASTE_EDIT_MOOD_ALIASES,
} from "../recommendations/taste_edit_vocabulary";

const PLAYBACK_SESSION_KEY = /^playback_[a-f0-9]{32}$/;
const ENERGY_THRESHOLDS = { medium: 0.38, high: 0.67 };

type LaneDefinition = {
  id: string;
  strength: number;
  genreWeights: Record<string, number>;
  moodWeights: Record<string, number>;
};

type SelectableTrack = {
  id: string;
  mixLaneId?: string;
  release?: {
    genre?: string | null;
    moods?: string[] | null;
  };
  agentRecommendation?: {
    audioFeatures?: {
      energyBand?: string;
      featureSources?: { energy?: string };
    };
  };
};

/**
 * Applies private, consented playback sequencing to a server-resolved My Mix.
 * It only returns the incoming selected objects, in a different order; missing
 * evidence or disabled learning falls back to server lane strength and rank.
 */
@Injectable()
export class HabitOrderingService {
  private readonly analyticsConsent = new AnalyticsConsentService();

  async orderMyMix<T extends SelectableTrack>(
    userId: string,
    sessionId: string,
    selected: readonly T[],
    plan: ResolvedMyMixPlan,
  ): Promise<T[]> {
    const original = [...selected];
    if (!userId || !sessionId || original.length < 2 || !Array.isArray(plan?.lanes)) {
      return original;
    }

    try {
      const ownedSession = await prisma.session.findFirst({
        where: { id: sessionId, userId },
        select: { id: true },
      });
      if (!ownedSession) return original;

      const now = new Date();
      const lanes = plan.lanes
        .map((value) => parseLane(value))
        .filter((lane): lane is LaneDefinition => Boolean(lane));
      let policy: TasteMemoryPolicy | undefined;
      try {
        policy = await readTasteMemoryPolicy(userId);
      } catch {
        // Without fresh controls the already resolved server plan still gives
        // a safe, deterministic cold-start ordering; no history is consulted.
      }
      const visibleLanes = lanes.filter((lane) => !policy || !hasSignal(policy.hidden, "lane", lane.id));
      const visibleStrengths = Object.fromEntries(visibleLanes.map((lane) => [lane.id, lane.strength]));
      const descriptors = original.map((track, rank): HabitOrderTrack => {
        const assignedLane = typeof track.mixLaneId === "string"
          ? visibleLanes.find((lane) => lane.id === track.mixLaneId)
          : undefined;
        const audio = track.agentRecommendation?.audioFeatures;
        const energySource = audio?.featureSources?.energy === "measured" ? "measured" : "inferred";
        return {
          id: track.id,
          rank,
          ...(assignedLane ? { laneId: assignedLane.id } : {}),
          ...(energySource === "measured" && isEnergyBand(audio?.energyBand)
            ? { energyBand: audio.energyBand }
            : {}),
          energySource,
        };
      });
      let state = { transitions: [] } as ReturnType<typeof deriveHabitOrderingState>;
      let consentAllowed = false;
      try {
        consentAllowed = await this.analyticsConsent.isProductAnalyticsAllowed(userId);
      } catch {
        // Treat an unreadable decision as no consent and use only cold-start
        // lane strength; no behavioral history is consulted.
      }
      if (consentAllowed && policy?.settings.agentPlaybackTrainingEnabled) {
        try {
          const { rows, inputs } = await readTasteHistory(userId, { policy, now });
          const observations = rows.flatMap((row, index) => {
            const observation = trustedObservation(row, inputs[index], visibleLanes, policy!);
            return observation ? [observation] : [];
          });
          state = deriveHabitOrderingState(observations, now, sessionId);
        } catch {
          // A history read failure leaves the lane-strength cold start intact.
        }
      }
      const ordered = orderHabitTracks(descriptors, state, visibleStrengths);
      // `rank` is an internal stable index, not a track identifier. It keeps
      // duplicate catalog IDs and the original object identity intact.
      const ranks = ordered.map(({ rank }) => rank);
      if (
        ordered.length !== original.length ||
        ranks.some((rank) => !Number.isInteger(rank) || rank < 0 || rank >= original.length) ||
        new Set(ranks).size !== original.length
      ) {
        return original;
      }
      return ordered.map(({ rank }) => original[rank]);
    } catch {
      // Ordering is a private enhancement. A read failure never blocks a pick.
      return original;
    }
  }
}

function trustedObservation(
  row: {
    id: string;
    userId: string;
    sessionId: string | null;
    trackId: string;
    action: string;
    createdAt: Date;
    metadata: unknown;
  },
  signal: AgentTasteSignalInput | undefined,
  lanes: readonly LaneDefinition[],
  policy: TasteMemoryPolicy,
): HabitOrderingObservation | undefined {
  if (!signal || row.sessionId !== null) return undefined;
  const metadata = asRecord(row.metadata);
  if (
    metadata.telemetryMirror !== true ||
    metadata.agentOriginated === true ||
    metadata.source === "agent_session"
  ) return undefined;

  const playbackSessionId = safeString(metadata.playbackSessionId);
  if (!playbackSessionId || !PLAYBACK_SESSION_KEY.test(playbackSessionId) || signal.sessionKey !== playbackSessionId) {
    return undefined;
  }

  const outcome = asRecord(metadata.outcome);
  const outcomeType = safeString(outcome.type);
  let action: string;
  if (row.action === "accept" && outcomeType === "playback_started") {
    action = "accept";
  } else if ((row.action === "complete" || row.action === "replay") && outcomeType === "playback_completed") {
    action = row.action;
  } else if (row.action === "skip" && outcomeType === "playback_skipped") {
    action = "skip";
  } else if (row.action === "save" && outcomeType === "library.saved") {
    action = "save";
  } else {
    return undefined;
  }

  const lane = matchingLane(signal.genre, signal.moods ?? [], lanes, policy, signal.artists, signal.artistAliases);
  const energy = signal.audioFeatures?.energy;
  const measuredEnergy = signal.audioFeatures?.energySource === "measured" &&
    typeof energy === "number" && Number.isFinite(energy)
    ? energy
    : undefined;
  const energyBand = measuredEnergy === undefined ? undefined : bandForEnergy(measuredEnergy);
  const createdAt = row.createdAt instanceof Date && Number.isFinite(row.createdAt.getTime())
    ? row.createdAt
    : undefined;
  if (!createdAt || (policy.resetAt && createdAt <= policy.resetAt)) return undefined;

  const observation: HabitOrderingObservation = {
    id: row.id,
    sessionKey: playbackSessionId,
    trackId: row.trackId,
    createdAt,
    action,
    ...(safeString(metadata.playbackInstanceId) ? { playbackInstanceId: safeString(metadata.playbackInstanceId) } : {}),
    ...(safeString(metadata.agentSessionId)
      ? { agentSessionId: safeString(metadata.agentSessionId) }
      : {}),
    ...(lane ? { laneId: lane.id } : {}),
    ...(energyBand ? { energyBand, energySource: "measured" } : {}),
    ...(finiteNumber(outcome.positionMs) !== undefined ? { positionMs: finiteNumber(outcome.positionMs) } : {}),
    ...(finiteNumber(outcome.durationMs) !== undefined ? { durationMs: finiteNumber(outcome.durationMs) } : {}),
  };
  return observation;
}

function parseLane(value: ResolvedMyMixPlan["lanes"][number]): LaneDefinition | undefined {
  const id = safeString(value.id);
  if (!id) return undefined;
  const strength = finiteNumber(value.strength);
  return {
    id,
    strength: strength === undefined ? 0 : Math.max(0, strength),
    genreWeights: canonicalWeights(value.genreWeights, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES),
    moodWeights: canonicalWeights(value.moodWeights, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES),
  };
}

function matchingLane(
  rawGenre: unknown,
  rawMoods: unknown,
  lanes: readonly LaneDefinition[],
  policy: TasteMemoryPolicy,
  artists?: readonly string[],
  artistAliases?: Record<string, string[]>,
): LaneDefinition | undefined {
  const genre = canonicalCatalogValue(rawGenre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
  if (genre && isCatalogValueHidden(policy, "genre", rawGenre, genre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES)) {
    return undefined;
  }
  if (hasHiddenArtist(policy, artists, artistAliases)) return undefined;

  const moods = canonicalCatalogValues(rawMoods, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES)
    .filter((mood) => !isCatalogValueHidden(policy, "mood", mood, mood, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES));
  const matching = lanes.flatMap((lane) => {
    if (hasSignal(policy.hidden, "lane", lane.id)) return [];
    const genreWeight = genre ? lane.genreWeights[genre] ?? 0 : 0;
    const moodWeight = moods.reduce((best, mood) => Math.max(best, lane.moodWeights[mood] ?? 0), 0);
    const genreAnchored = Object.keys(lane.genreWeights).length > 0;
    if (genreAnchored ? !(genreWeight > 0) : !(moodWeight > 0)) return [];
    return [{ lane, genreWeight, moodWeight }];
  });
  matching.sort((left, right) =>
    Number(right.genreWeight > 0) - Number(left.genreWeight > 0) ||
    right.genreWeight - left.genreWeight ||
    right.moodWeight - left.moodWeight ||
    right.lane.strength - left.lane.strength ||
    left.lane.id.localeCompare(right.lane.id),
  );
  return matching[0]?.lane;
}

function isCatalogValueHidden(
  policy: TasteMemoryPolicy,
  type: "genre" | "mood",
  rawValue: unknown,
  canonicalValue: string,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>>,
) {
  if (
    hasSignal(policy.hidden, type, canonicalValue) ||
    (typeof rawValue === "string" && hasSignal(policy.hidden, type, rawValue))
  ) return true;
  const hiddenValues = policy.hidden.get(type) ?? new Set<string>();
  return [...hiddenValues].some((hidden) =>
    canonicalCatalogValue(hidden, catalog, aliases) === canonicalValue,
  );
}

function hasHiddenArtist(
  policy: TasteMemoryPolicy,
  artists: readonly string[] = [],
  aliases: Record<string, string[]> = {},
) {
  const labels = new Set(artists);
  for (const [label, values] of Object.entries(aliases)) {
    labels.add(label);
    for (const value of values) labels.add(value);
  }
  return [...labels].some((label) => hasSignal(policy.hidden, "artist", label));
}

function canonicalWeights(
  value: unknown,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>>,
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const [rawLabel, rawWeight] of Object.entries(asRecord(value))) {
    const label = canonicalCatalogValue(rawLabel, catalog, aliases);
    const weight = finiteNumber(rawWeight);
    if (label && weight !== undefined && weight > 0) weights[label] = (weights[label] ?? 0) + weight;
  }
  return weights;
}

function canonicalCatalogValues(value: unknown, catalog: readonly string[], aliases: Readonly<Record<string, string>>) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => canonicalCatalogValue(item, catalog, aliases))
    .filter((item): item is string => Boolean(item)))];
}

function canonicalCatalogValue(value: unknown, catalog: readonly string[], aliases: Readonly<Record<string, string>>) {
  const raw = safeString(value);
  if (!raw) return undefined;
  const normalized = raw.toLocaleLowerCase("en-US").trim();
  const alias = aliases[normalized];
  return alias ?? catalog.find((item) => item.toLocaleLowerCase("en-US") === normalized);
}

function bandForEnergy(energy: number): HabitEnergyBand {
  if (energy >= ENERGY_THRESHOLDS.high) return "high";
  if (energy >= ENERGY_THRESHOLDS.medium) return "medium";
  return "low";
}

function isEnergyBand(value: unknown): value is HabitEnergyBand {
  return value === "low" || value === "medium" || value === "high";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
