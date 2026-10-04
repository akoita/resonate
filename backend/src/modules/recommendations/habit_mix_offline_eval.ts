/**
 * Explicit-cutoff replay for My Mix habit lanes (#2067).
 *
 * This deliberately uses a deterministic catalog-vector score (genre plus
 * mood dot products) instead of the online semantic ranker. Its purpose is to
 * measure whether lane construction and quotas improve sampled recall over a
 * genre-only profile on the same catalog pool; it is not an estimate of the
 * complete production selector or production reach.
 */
import {
  AGENT_SIGNAL_WEIGHTS,
  AGENT_TASTE_HISTORY_LIMIT,
} from "../../config/agent_learning";
import type { AgentTasteSignalInput } from "../agents/agent_learning.service";
import { computeListeningLanes } from "../agents/listening_lanes";
import type { ListeningLane } from "../agents/listening_lanes";
import {
  matchingMyMixLaneIds,
  resolveMyMixPlan,
} from "../agents/agent_my_mix";
import type { ResolvedMyMixLane } from "../agents/agent_my_mix";
import type { RankedDiscoveryCandidate } from "./discovery-ranking.service";
import { applyDiscoveryPolicy } from "./discovery-policy";
import { meanOverRankable, ndcgAtK, recallAtK } from "./rankingMetrics";
import { learnGenreWeights } from "./discovery_offline_eval";
import type { TrainingSignal } from "./discovery_offline_eval";
import { isPromotionEligible } from "../catalog/ai-disclosure.policy";
import {
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_GENRES,
  TASTE_EDIT_MOOD_ALIASES,
  TASTE_EDIT_MOODS,
} from "./taste_edit_vocabulary";

const MAX_EVAL_USERS = 500;
const MAX_EVAL_K = AGENT_TASTE_HISTORY_LIMIT;

/** A privacy-projected mart row. Raw IDs remain in memory and never enter reports. */
export interface HabitMixSignalMartRow {
  user_id?: unknown;
  track_id?: unknown;
  action?: unknown;
  event_name?: unknown;
  event_id?: unknown;
  signal_type?: unknown;
  signal_weight?: unknown;
  completion_ratio?: unknown;
  occurred_at?: unknown;
  /** Browser playback session key; required by production lane construction. */
  session_key?: unknown;
  session_id?: unknown;
  playback_session_id?: unknown;
  local_hour_bucket?: unknown;
  weekday_kind?: unknown;
  payload?: unknown;
}

/** Catalog fixture; only these metadata fields participate in replay. */
export interface HabitMixCatalogRow {
  id: string;
  genre?: string | null;
  moods?: string[] | null;
  artistId?: string | null;
  aiDisclosureLevel?: string | null;
}

export interface HabitMixOfflineEvalOptions {
  /** Exact UTC boundary: training uses timestamps `< cutoff`; targets use `>=`. */
  cutoff: Date;
  k: number;
  maxUsers: number;
}

export interface HabitMixMetricSummary {
  recallAtK: number | null;
  ndcgAtK: number | null;
  rankableUsers: number;
}

export interface HabitMixOfflineEvalReport {
  cutoff: string;
  k: number;
  sample: {
    users: number;
    signals: number;
    trainingSignals: number;
    targetEvents: number;
    targetTracks: number;
    reachableTargets: number;
    unreachableTargets: number;
    rankableUsers: number;
    laneUsers: number;
    noLaneUsers: number;
    noLaneTargetUsers: number;
    catalogTracks: number;
    eligibleCatalogTracks: number;
  };
  rankers: {
    myMixLanes: HabitMixMetricSummary;
    genreOnlyV1: HabitMixMetricSummary;
  };
  note: string;
}

interface NormalizedSignal {
  userId: string;
  trackId: string;
  action: string;
  eventName?: string;
  eventId?: string;
  signalType?: string;
  weight: number;
  completionRatio?: number;
  occurredAt: Date;
  sessionKey?: string;
  localHourBucket?: string;
  weekdayKind?: string;
}

interface ReplayUser {
  signals: NormalizedSignal[];
  train: NormalizedSignal[];
  targetEvents: NormalizedSignal[];
  targets: Map<string, number>;
  /** Every strictly pre-cutoff track in the supplied mart, before signal cap. */
  trainTrackIds: Set<string>;
  lanes: ListeningLane[];
}

interface ScoredCandidate extends RankedDiscoveryCandidate {
  id: string;
}

const behaviorWeightByAction = AGENT_SIGNAL_WEIGHTS as Record<string, number>;

/**
 * Run a deterministic, per-user replay over a bounded in-memory mart sample.
 * User and track identifiers are used only for grouping and matching and are
 * never copied into the returned report.
 */
export function evaluateHabitMixOffline(input: {
  signals: readonly HabitMixSignalMartRow[];
  catalog: readonly HabitMixCatalogRow[];
  options: HabitMixOfflineEvalOptions;
}): HabitMixOfflineEvalReport {
  const cutoff = input.options.cutoff;
  if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime())) {
    throw new Error("cutoff must be a valid Date");
  }

  const k = safePositiveInteger(input.options.k, MAX_EVAL_K);
  const maxUsers = safePositiveInteger(input.options.maxUsers, MAX_EVAL_USERS, MAX_EVAL_USERS);
  const catalog = normalizeCatalog(input.catalog);
  const catalogById = new Map(catalog.map((track) => [track.id, track]));
  const eligibleCatalog = catalog.filter((track) => isPromotionEligible(track.aiDisclosureLevel));
  const eligibleCatalogById = new Map(eligibleCatalog.map((track) => [track.id, track]));
  const grouped = groupBoundedSignals(input.signals, cutoff);
  const selectedUsers = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, maxUsers);

  const users: ReplayUser[] = selectedUsers.map(([, split]) => {
    const { train, targetEvents } = split;
    const targets = new Map<string, number>();
    for (const signal of targetEvents) {
      targets.set(signal.trackId, (targets.get(signal.trackId) ?? 0) + signal.weight);
    }
    const trainTrackIds = split.trainTrackIds;
    const tasteSignals = train.map((signal) => toAgentTasteSignal(signal, catalogById.get(signal.trackId)));
    // Lanes and the v1 baseline share exactly the same historical cutoff.
    const lanes = computeListeningLanes(tasteSignals, cutoff);
    return { signals: [...train, ...targetEvents], train, targetEvents, targets, trainTrackIds, lanes };
  });

  let totalTrainingSignals = 0;
  let targetEvents = 0;
  let targetTracks = 0;
  let reachableTargets = 0;
  let unreachableTargets = 0;
  let laneUsers = 0;
  let noLaneUsers = 0;
  let noLaneTargetUsers = 0;
  const laneRecalls: Array<number | null> = [];
  const laneNdcgs: Array<number | null> = [];
  const v1Recalls: Array<number | null> = [];
  const v1Ndcgs: Array<number | null> = [];

  for (const user of users) {
    totalTrainingSignals += user.train.length;
    targetEvents += user.targetEvents.length;
    targetTracks += user.targets.size;
    const reachable = new Map<string, number>();
    for (const [trackId, weight] of user.targets) {
      if (!user.trainTrackIds.has(trackId) && eligibleCatalogById.has(trackId)) {
        reachable.set(trackId, weight);
        reachableTargets += 1;
      } else {
        unreachableTargets += 1;
      }
    }

    if (user.lanes.length === 0) {
      noLaneUsers += 1;
      if (user.targets.size > 0) noLaneTargetUsers += 1;
      continue;
    }
    laneUsers += 1;
    if (reachable.size === 0) continue;

    const candidatePool = eligibleCatalog.filter((candidate) => !user.trainTrackIds.has(candidate.id));
    const plan = resolveMyMixPlan(
      { lanes: user.lanes.map((lane) => ({ id: lane.id })) },
      user.lanes,
      k,
    );
    if (!plan) {
      // `computeListeningLanes` returned eligible lanes, so this is defensive;
      // keep the user out of both arms rather than creating a different plan.
      continue;
    }

    const relevance = reachable;
    const laneRanks = rankWithLanes(candidatePool, plan.lanes);
    const lanePolicy = applyDiscoveryPolicy(laneRanks.ranked, {
      limit: k,
      laneQuotas: plan.lanes.map((lane) => ({
        id: lane.id,
        requested: lane.requested,
        strength: lane.allocationWeight,
      })),
      laneMatchesByCandidateId: laneRanks.matches,
      laneCandidateOrderByLaneId: laneRanks.orderByLane,
    });

    const v1Weights = genreOnlyWeights(user.train, catalogById);
    const v1Ranked = candidatePool
      .map((candidate) => ({
        candidate,
        score: genreScore(v1Weights, candidate.genre),
      }))
      .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id))
      .map(({ candidate, score }) => toRankedCandidate(candidate, score));
    const v1Policy = applyDiscoveryPolicy(v1Ranked, { limit: k });

    laneRecalls.push(recallAtK(lanePolicy.items.map((item) => item.id), new Set(relevance.keys()), k));
    laneNdcgs.push(ndcgAtK(lanePolicy.items.map((item) => item.id), relevance, k));
    v1Recalls.push(recallAtK(v1Policy.items.map((item) => item.id), new Set(relevance.keys()), k));
    v1Ndcgs.push(ndcgAtK(v1Policy.items.map((item) => item.id), relevance, k));
  }

  const rankableUsers = laneRecalls.filter((value) => value !== null).length;
  return {
    cutoff: cutoff.toISOString(),
    k,
    sample: {
      users: users.length,
      signals: users.reduce((sum, user) => sum + user.signals.length, 0),
      trainingSignals: totalTrainingSignals,
      targetEvents,
      targetTracks,
      reachableTargets,
      unreachableTargets,
      rankableUsers,
      laneUsers,
      noLaneUsers,
      noLaneTargetUsers,
      catalogTracks: catalog.length,
      eligibleCatalogTracks: eligibleCatalog.length,
    },
    rankers: {
      myMixLanes: {
        recallAtK: meanOverRankable(laneRecalls),
        ndcgAtK: meanOverRankable(laneNdcgs),
        rankableUsers,
      },
      genreOnlyV1: {
        recallAtK: meanOverRankable(v1Recalls),
        ndcgAtK: meanOverRankable(v1Ndcgs),
        rankableUsers: v1Recalls.filter((value) => value !== null).length,
      },
    },
    note: "Sampled catalog replay using production lane construction, My Mix quota allocation, strict catalog lane matching, and discovery diversity. Both arms share the lane-eligible users with reachable targets; no-lane users are reported separately. Fully AI-generated catalog rows are excluded through the existing promotion-eligibility policy; missing disclosure remains unspecified and eligible under that policy. Each side of the explicit cutoff is independently capped at 500 signals per user. The v1 baseline reuses the existing clipped signed genre-weight helper. Lane candidate ranking is a deterministic genre/mood vector dot product, not the online semantic ranker; metrics are not production reach estimates.",
  };
}

function groupBoundedSignals(
  rows: readonly HabitMixSignalMartRow[],
  cutoff: Date,
): Map<string, { train: NormalizedSignal[]; targetEvents: NormalizedSignal[]; trainTrackIds: Set<string> }> {
  const grouped = new Map<string, { train: NormalizedSignal[]; targetEvents: NormalizedSignal[]; trainTrackIds: Set<string> }>();
  const seenEventIds = new Set<string>();
  for (const row of rows) {
    const signal = normalizeSignal(row);
    if (!signal) continue;
    if (signal.eventId && seenEventIds.has(signal.eventId)) continue;
    if (signal.eventId) seenEventIds.add(signal.eventId);
    const split = grouped.get(signal.userId) ?? { train: [], targetEvents: [], trainTrackIds: new Set<string>() };
    if (signal.occurredAt.getTime() < cutoff.getTime()) {
      split.train.push(signal);
      split.trainTrackIds.add(signal.trackId);
    } else if (isPositiveTarget(signal)) {
      split.targetEvents.push(signal);
    }
    if (split.train.length > 0 || split.targetEvents.length > 0) grouped.set(signal.userId, split);
  }

  for (const [userId, split] of grouped) {
    const newestFirst = (left: NormalizedSignal, right: NormalizedSignal) =>
      right.occurredAt.getTime() - left.occurredAt.getTime() ||
      left.trackId.localeCompare(right.trackId) ||
      left.action.localeCompare(right.action) ||
      (left.eventId ?? "").localeCompare(right.eventId ?? "") ||
      (left.sessionKey ?? "").localeCompare(right.sessionKey ?? "");
    split.train.sort(newestFirst);
    // Keep the earliest bounded future target window after the cutoff.
    split.targetEvents.sort((left, right) => newestFirst(right, left));
    grouped.set(userId, {
      train: split.train.slice(0, AGENT_TASTE_HISTORY_LIMIT),
      targetEvents: split.targetEvents.slice(0, AGENT_TASTE_HISTORY_LIMIT),
      trainTrackIds: split.trainTrackIds,
    });
  }
  return grouped;
}

function normalizeSignal(row: HabitMixSignalMartRow): NormalizedSignal | undefined {
  if (typeof row.user_id !== "string" || !row.user_id.trim()) return undefined;
  if (typeof row.track_id !== "string" || !row.track_id.trim()) return undefined;
  const occurredAt = row.occurred_at instanceof Date
    ? new Date(row.occurred_at.getTime())
    : new Date(String(row.occurred_at ?? ""));
  if (!Number.isFinite(occurredAt.getTime())) return undefined;

  const eventName = firstString(row.event_name)?.toLowerCase();
  const signalType = firstString(row.signal_type)?.toLowerCase();
  const completionRatio = finiteNumber(row.completion_ratio);
  const rawAction = typeof row.action === "string" ? row.action.trim().toLowerCase() : "";
  const action = canonicalAction(rawAction) || actionForMart(eventName, signalType, completionRatio);
  const explicitWeight = finiteNumber(row.signal_weight);
  const actionWeight = behaviorWeightByAction[action];
  const weight = explicitWeight ?? actionWeight;
  if (typeof weight !== "number" || !Number.isFinite(weight)) return undefined;
  const payload = asRecord(row.payload);
  const payloadContext = asRecord(payload?.context) ?? asRecord(payload?.playbackContext) ?? {};
  const session = firstString(
    row.session_key,
    row.playback_session_id,
    row.session_id,
    payload?.playbackSessionId,
    payload?.sessionId,
    payload?.agentSessionId,
  );
  const localHourBucket = firstString(row.local_hour_bucket, payload?.localHourBucket, payload?.local_hour_bucket, payloadContext.localHourBucket, payloadContext.local_hour_bucket);
  const weekdayKind = firstString(row.weekday_kind, payload?.weekdayKind, payload?.weekday_kind, payloadContext.weekdayKind, payloadContext.weekday_kind);
  return {
    userId: row.user_id.trim(),
    trackId: row.track_id.trim(),
    action: action || "offline_mart_signal",
    ...(eventName ? { eventName } : {}),
    ...(firstString(row.event_id) ? { eventId: firstString(row.event_id) } : {}),
    ...(signalType ? { signalType } : {}),
    weight,
    ...(completionRatio !== undefined ? { completionRatio } : {}),
    occurredAt,
    ...(session ? { sessionKey: session.slice(0, 160) } : {}),
    ...(isLocalHourBucket(localHourBucket) ? { localHourBucket } : {}),
    ...(isWeekdayKind(weekdayKind) ? { weekdayKind } : {}),
  };
}

function canonicalAction(action: string): string {
  if (action === "playback.completed" || action === "playback_completed" || action === "completed") return "complete";
  if (action === "library.saved" || action === "library_saved" || action === "saved") return "save";
  if (action === "strong_play") return "complete";
  if (action === "partial_play") return "accept";
  if (action === "agent_selected") return "agent_selected";
  return action;
}

function actionForMart(eventName?: string, signalType?: string, completionRatio?: number): string {
  if (signalType) {
    const signalAction = canonicalAction(signalType);
    if (signalAction) return signalAction;
  }
  if (eventName === "playback.completed") {
    if (completionRatio !== undefined && completionRatio >= 0.8) return "complete";
    if (completionRatio !== undefined && completionRatio < 0.2) return "skip";
    return "accept";
  }
  if (eventName === "library.saved") return "save";
  if (eventName === "playlist.track_added") return "add_to_playlist";
  if (eventName && /purchase|settled/.test(eventName)) return "purchase";
  return eventName ?? "offline_mart_signal";
}

function isPositiveTarget(signal: NormalizedSignal): boolean {
  if (signal.weight <= 0) return false;
  if (signal.eventName) {
    if (signal.eventName === "playback.completed") {
      return signal.completionRatio !== undefined && signal.completionRatio >= 0.8;
    }
    if (signal.eventName === "library.saved") return true;
    return signal.eventName === "playlist.track_added" && signal.signalType === "save";
  }
  // Action aliases support simple, already-projected unit fixtures. `replay`
  // is deliberately not a held-out target event.
  return signal.action === "complete" || signal.action === "save";
}

function normalizeCatalog(rows: readonly HabitMixCatalogRow[]): HabitMixCatalogRow[] {
  const safeRows = rows
    .filter((row) => row && typeof row.id === "string" && row.id.trim().length > 0)
    .map((row) => ({
      id: row.id.trim(),
      genre: safeString(row.genre),
      moods: Array.isArray(row.moods)
        ? [...new Set(row.moods.filter((mood): mood is string => typeof mood === "string").map((mood) => mood.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
        : [],
      artistId: safeString(row.artistId),
      ...(row.aiDisclosureLevel !== undefined
        ? { aiDisclosureLevel: safeString(row.aiDisclosureLevel) }
        : {}),
    }))
    .sort((left, right) =>
      left.id.localeCompare(right.id) ||
      JSON.stringify([left.genre, left.moods, left.artistId, left.aiDisclosureLevel])
        .localeCompare(JSON.stringify([right.genre, right.moods, right.artistId, right.aiDisclosureLevel])),
    );
  const unique = new Map<string, HabitMixCatalogRow>();
  for (const row of safeRows) if (!unique.has(row.id)) unique.set(row.id, row);
  return [...unique.values()];
}

function toAgentTasteSignal(signal: NormalizedSignal, catalogTrack?: HabitMixCatalogRow): AgentTasteSignalInput {
  return {
    action: signal.action,
    trackId: signal.trackId,
    sessionKey: signal.sessionKey,
    createdAt: signal.occurredAt,
    weight: signal.weight,
    genre: catalogTrack?.genre ?? null,
    moods: catalogTrack?.moods ?? [],
    localHourBucket: signal.localHourBucket,
    weekdayKind: signal.weekdayKind,
  };
}

function genreOnlyWeights(
  train: readonly NormalizedSignal[],
  catalogById: ReadonlyMap<string, HabitMixCatalogRow>,
): Record<string, number> {
  const trainingSignals: TrainingSignal[] = train.map((signal) => ({
    userId: signal.userId,
    trackId: signal.trackId,
    weight: signal.weight,
    occurredAt: signal.occurredAt,
  }));
  return learnGenreWeights(
    trainingSignals,
    new Map([...catalogById].map(([trackId, track]) => [trackId, track.genre])),
  );
}

function rankWithLanes(
  candidates: readonly HabitMixCatalogRow[],
  lanes: readonly ResolvedMyMixLane[],
) {
  // The resolved plan contains only bounded server-derived lanes; none of its
  // labels or IDs are copied into the report.
  const laneList = [...lanes];
  const matches = new Map<string, string[]>();
  const scoreByCandidateAndLane = new Map<string, Map<string, number>>();
  for (const candidate of candidates) {
    const laneIds = matchingMyMixLaneIds(laneList, { genre: candidate.genre, moods: candidate.moods });
    matches.set(candidate.id, laneIds);
    const perLane = new Map<string, number>();
    for (const laneId of laneIds) {
      const lane = laneList.find((entry) => entry.id === laneId)!;
      perLane.set(laneId, laneDotScore(lane, candidate));
    }
    scoreByCandidateAndLane.set(candidate.id, perLane);
  }

  const orderByLane = new Map<string, string[]>();
  for (const lane of laneList) {
    const ordered = candidates
      .filter((candidate) => matches.get(candidate.id)?.includes(lane.id))
      .sort((left, right) =>
        (scoreByCandidateAndLane.get(right.id)?.get(lane.id) ?? 0) -
          (scoreByCandidateAndLane.get(left.id)?.get(lane.id) ?? 0) ||
        left.id.localeCompare(right.id),
      )
      .map((candidate) => candidate.id);
    orderByLane.set(lane.id, ordered);
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: Math.max(0, ...(scoreByCandidateAndLane.get(candidate.id)?.values() ?? [])),
    }))
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id))
    .map(({ candidate, score }) => toRankedCandidate(candidate, score));
  return { ranked, matches, orderByLane };
}

function laneDotScore(lane: ListeningLane, candidate: HabitMixCatalogRow): number {
  const genre = canonicalCatalogValue(candidate.genre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
  const moods = new Set((candidate.moods ?? [])
    .map((mood) => canonicalCatalogValue(mood, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES))
    .filter((mood): mood is string => Boolean(mood)));
  const genreScore = genre ? positive(lane.genreWeights[genre]) : 0;
  const moodScore = [...moods].reduce((sum, mood) => sum + positive(lane.moodWeights[mood]), 0);
  return genreScore + moodScore;
}

function genreScore(weights: Record<string, number>, rawGenre: string | null | undefined): number {
  if (!rawGenre) return 0;
  const canonical = canonicalCatalogValue(rawGenre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
  const weight = weights[canonical ?? rawGenre] ?? weights[rawGenre];
  return typeof weight === "number" && Number.isFinite(weight) ? weight : 0;
}

function canonicalCatalogValue(
  raw: string | null | undefined,
  vocabulary: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  const key = normalizeTerm(value);
  return vocabulary.find((entry) => normalizeTerm(entry) === key) ?? aliases[key];
}

function toRankedCandidate(candidate: HabitMixCatalogRow, score: number): ScoredCandidate {
  return {
    id: candidate.id,
    artistId: candidate.artistId,
    aiDisclosureLevel: candidate.aiDisclosureLevel,
    release: { genre: candidate.genre, moods: candidate.moods },
    score,
    signals: [],
    explanation: ["Catalog candidate"],
    reasonCode: "listening_pattern",
    recentlyPlayed: false,
  };
}

function safePositiveInteger(value: number, ceiling: number, fallback = 10): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.min(ceiling, Math.floor(value)));
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function isLocalHourBucket(value: unknown): value is "night" | "morning" | "afternoon" | "evening" {
  return value === "night" || value === "morning" || value === "afternoon" || value === "evening";
}

function isWeekdayKind(value: unknown): value is "weekday" | "weekend" {
  return value === "weekday" || value === "weekend";
}
