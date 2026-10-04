import { BadRequestException } from "@nestjs/common";
import { createHash } from "crypto";
import {
  AGENT_LISTENING_LANE_MAX,
  AGENT_MIX_BOOST_MULTIPLIER,
  AGENT_MIX_CONTEXT_GAIN,
  AGENT_MIX_MAX_ADDITIONS,
  AGENT_MIX_MAX_LANES,
} from "../../config/agent_learning";
import {
  TASTE_EDIT_GENRES,
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_MOODS,
  TASTE_EDIT_MOOD_ALIASES,
} from "../recommendations/taste_edit_vocabulary";
import type { ListeningLane } from "./listening_lanes";

export const MY_MIX_CONTEXTS = [
  "night:weekday",
  "night:weekend",
  "morning:weekday",
  "morning:weekend",
  "afternoon:weekday",
  "afternoon:weekend",
  "evening:weekday",
  "evening:weekend",
] as const;

export type MyMixContext = (typeof MY_MIX_CONTEXTS)[number];

/** Untrusted, bounded shape accepted from session preferences. */
export interface MyMixPreferences {
  context?: MyMixContext;
  /** Omitted means all visible lanes; [] explicitly opts out of learned lanes. */
  lanes?: Array<{ id: string; boost?: boolean }>;
  additions?: Array<{ genre?: string; mood?: string }>;
}

export interface ResolvedMyMixLane extends ListeningLane {
  requested: number;
  boost: boolean;
  addition: boolean;
  /** Effective share weight after the session context and boost multipliers. */
  allocationWeight: number;
}

export interface ResolvedMyMixPlan {
  /** Trusted runtime experiment decision; raw preferences cannot set this. */
  orderingVariant?: "habit" | "neutral";
  context?: MyMixContext;
  lanes: ResolvedMyMixLane[];
}

export interface MixCoverage {
  lanes: Array<{ id: string; label: string; requested: number; matched: number }>;
}

/**
 * Resolve only current server-side visible lane records and catalog terms.
 * Arbitrary client labels, strengths and weights are never read.
 */
export function resolveMyMixPlan(
  raw: unknown,
  visibleLanes: ListeningLane[],
  limit: number,
): ResolvedMyMixPlan | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) throw new BadRequestException({ reason: "invalid_my_mix" });
  const context = raw.context;
  if (context !== undefined && !isMixContext(context)) {
    throw new BadRequestException({ reason: "invalid_my_mix_context" });
  }

  const rawLaneRequests = raw.lanes;
  if (rawLaneRequests !== undefined && !Array.isArray(rawLaneRequests)) {
    throw new BadRequestException({ reason: "invalid_my_mix_lanes" });
  }
  const requestedLaneInputs = rawLaneRequests === undefined
    ? visibleLanes.map((lane) => ({ id: lane.id, boost: false }))
    : rawLaneRequests;
  if (requestedLaneInputs.length > AGENT_LISTENING_LANE_MAX) {
    throw new BadRequestException({ reason: "too_many_my_mix_lanes" });
  }

  const visibleById = new Map(visibleLanes.map((lane) => [lane.id, lane]));
  const selected: Array<{ lane: ListeningLane; boost: boolean }> = [];
  const seenIds = new Set<string>();
  for (const rawLane of requestedLaneInputs) {
    if (!isRecord(rawLane) || typeof rawLane.id !== "string") {
      throw new BadRequestException({ reason: "invalid_my_mix_lane" });
    }
    const id = rawLane.id.trim();
    if (!id || id.length > 100 || (rawLane.boost !== undefined && typeof rawLane.boost !== "boolean")) {
      throw new BadRequestException({ reason: "invalid_my_mix_lane" });
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const lane = visibleById.get(id);
    if (!lane) throw new BadRequestException({ reason: "unknown_or_hidden_my_mix_lane" });
    selected.push({ lane, boost: rawLane.boost === true });
  }

  const rawAdditions = raw.additions === undefined ? [] : raw.additions;
  if (!Array.isArray(rawAdditions) || rawAdditions.length > AGENT_MIX_MAX_ADDITIONS) {
    throw new BadRequestException({ reason: "invalid_my_mix_additions" });
  }
  const positiveStrengths = selected
    .map(({ lane }) => lane.strength)
    .filter((strength) => Number.isFinite(strength) && strength > 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(positiveStrengths.length / 2);
  const additionStrength = positiveStrengths.length === 0
    ? 1
    : positiveStrengths.length % 2 === 1
      ? positiveStrengths[middle]
      : (positiveStrengths[middle - 1] + positiveStrengths[middle]) / 2;

  const lanes: ResolvedMyMixLane[] = selected.map(({ lane, boost }) => ({
    ...lane,
    requested: 0,
    boost,
    addition: false,
    allocationWeight: 0,
  }));
  const laneIds = new Set(lanes.map((lane) => lane.id));
  for (const addition of rawAdditions) {
    if (!isRecord(addition)) throw new BadRequestException({ reason: "invalid_my_mix_addition" });
    const genre = canonicalCatalogTerm(addition.genre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
    const mood = canonicalCatalogTerm(addition.mood, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES);
    if ((addition.genre !== undefined && !genre) || (addition.mood !== undefined && !mood) || (!genre && !mood)) {
      throw new BadRequestException({ reason: "invalid_my_mix_addition" });
    }
    const digest = createHash("sha256").update(`${genre ?? ""}\0${mood ?? ""}`).digest("hex").slice(0, 32);
    const id = `mix_${digest}`;
    if (laneIds.has(id)) continue;
    laneIds.add(id);
    lanes.push({
      id,
      label: [genre, mood].filter(Boolean).join(" · "),
      genreWeights: genre ? { [genre]: 1 } : {},
      moodWeights: mood ? { [mood]: 1 } : {},
      strength: additionStrength,
      contexts: {},
      energyBand: null,
      requested: 0,
      boost: false,
      addition: true,
      allocationWeight: 0,
    });
  }

  if (lanes.length > AGENT_MIX_MAX_LANES) {
    throw new BadRequestException({ reason: "too_many_my_mix_lanes" });
  }
  if (!lanes.length) return undefined;

  const weighted = lanes.map((lane) => {
    const contextWeight = context === undefined ? 0 : finitePositive(lane.contexts[context]);
    const laneContextMax = Math.max(0, ...Object.values(lane.contexts).map(finitePositive));
    const contextMultiplier = laneContextMax > 0 && contextWeight > 0
      ? 1 + AGENT_MIX_CONTEXT_GAIN * contextWeight / laneContextMax
      : 1;
    return {
      lane,
      weight: Math.max(0, finitePositive(lane.strength)) * contextMultiplier *
        (lane.boost ? AGENT_MIX_BOOST_MULTIPLIER : 1),
    };
  });
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return undefined;
  const safeLimit = Math.max(0, Math.floor(limit));
  const shares = weighted.map((entry) => {
    const exact = safeLimit * entry.weight / totalWeight;
    const requested = Math.floor(exact);
    return { ...entry, requested, remainder: exact - requested };
  });
  const remaining = safeLimit - shares.reduce((sum, entry) => sum + entry.requested, 0);
  const remainderOrder = [...shares].sort((a, b) =>
    b.remainder - a.remainder || b.weight - a.weight || a.lane.id.localeCompare(b.lane.id),
  );
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index % remainderOrder.length]!.requested += 1;
  }
  return {
    ...(isMixContext(context) ? { context } : {}),
    lanes: shares.map(({ lane, requested, weight }) => ({ ...lane, requested, allocationWeight: weight })),
  };
}

/** Exact catalog metadata matching: genre is the anchor when present. */
export function matchingMyMixLaneIds(
  lanePlan: ResolvedMyMixLane[],
  release: { genre?: string | null; moods?: string[] | null } | undefined,
): string[] {
  if (!release) return [];
  const genre = canonicalizeCatalogMetadata(release.genre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
  const moods = new Set((release.moods ?? [])
    .map((mood) => canonicalizeCatalogMetadata(mood, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES))
    .filter(Boolean));
  return lanePlan.filter((lane) => {
    const laneGenres = Object.keys(lane.genreWeights)
      .map((value) => canonicalizeCatalogMetadata(value, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES));
    if (laneGenres.length > 0) return laneGenres.includes(genre);
    return Object.keys(lane.moodWeights)
      .map((value) => canonicalizeCatalogMetadata(value, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES))
      .some((mood) => moods.has(mood));
  }).map((lane) => lane.id);
}

/** Keep retrieval bounded while preserving the most representative lane terms. */
export function myMixSearchTerms(plan: ResolvedMyMixPlan): string[] {
  return plan.lanes.flatMap((lane) => [
    ...topTerms(lane.genreWeights, 2),
    ...topTerms(lane.moodWeights, 1),
  ]);
}

export function buildMixCoverage(plan: ResolvedMyMixPlan, assignments: ReadonlyMap<string, string>): MixCoverage {
  const matched = new Map<string, number>();
  for (const laneId of assignments.values()) matched.set(laneId, (matched.get(laneId) ?? 0) + 1);
  return {
    lanes: plan.lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      requested: lane.requested,
      matched: matched.get(lane.id) ?? 0,
    })),
  };
}

function canonicalCatalogTerm(
  raw: unknown,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.trim().length > 64) return undefined;
  const value = raw.trim();
  const canonical = catalog.find((candidate) => normalizeTerm(candidate) === normalizeTerm(value));
  if (canonical) return canonical;
  return aliases[normalizeTerm(value)];
}

function canonicalizeCatalogMetadata(
  raw: string | null | undefined,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string {
  const normalized = normalizeTerm(raw);
  const canonical = catalog.find((candidate) => normalizeTerm(candidate) === normalized);
  return normalizeTerm(canonical ?? aliases[normalized] ?? raw);
}

function normalizeTerm(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function finitePositive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function topTerms(weights: Record<string, number>, take: number): string[] {
  return Object.entries(weights)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .sort(([leftTerm, leftWeight], [rightTerm, rightWeight]) =>
      rightWeight - leftWeight || leftTerm.localeCompare(rightTerm),
    )
    .slice(0, take)
    .map(([term]) => term);
}

function isMixContext(value: unknown): value is MyMixContext {
  return typeof value === "string" && (MY_MIX_CONTEXTS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
