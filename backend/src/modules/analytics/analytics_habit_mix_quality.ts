import {
  HABIT_MIX_MEASUREMENT,
  HABIT_MIX_SESSION_SOURCES,
  HabitMixSessionSource,
} from "../../config/habit_measurement";
import type { AnalyticsFactRow } from "./analytics_warehouse";

const PLAYBACK_START = "playback.started";
const PLAYBACK_SKIP = "playback.skipped";
const PLAYBACK_COMPLETE = "playback.completed";
const PLAYBACK_HEARTBEAT = "playback.heartbeat";
const LIBRARY_SAVE = "library.saved";
const PLAYLIST_ADD = "playlist.track_added";
const IMPRESSION = "recommendation.generated";
const UNATTRIBUTED = "unattributed";

type SourceRow = HabitMixSessionSource;

interface QualityMetrics {
  impressions: number;
  plays: number;
  skips: number;
  earlySkips: number;
  completions: number;
  saves: number;
  playlistAdds: number;
  resonance: number;
  explorationPlays: number;
  explorationAccepted: number;
  playedMs: number;
  sessions: Map<string, SessionMetrics>;
}

interface SessionMetrics {
  trackStarts: number;
  playedMs: number;
}

interface ImpressionRecord {
  actorId: string;
  agentSessionId: string;
  trackId: string;
  at: number;
  eventId: string;
  sessionSource: SourceRow;
  experimentKey: string | null;
  rankerVariant: string;
  orderingVariant: string;
  explorationPick: boolean;
}

interface PlaybackStart {
  actorId?: string;
  browserSessionId?: string;
  agentSessionId?: string;
  playbackInstanceId?: string;
  trackId?: string;
  at: number;
  eventId: string;
  episode?: PlaybackEpisode;
}

interface PlaybackEpisode {
  actorId: string;
  browserSessionId: string;
  agentSessionId: string;
  trackId: string;
  at: number;
  eventId: string;
  playbackInstanceId?: string;
  sessionSource: SourceRow;
  experimentKey: string | null;
  rankerVariant: string;
  orderingVariant: string;
  explorationPick: boolean;
  skipped: boolean;
  earlySkipped: boolean;
  completed: boolean;
  saved: boolean;
  playlistAdded: boolean;
  playedMs: number;
}

interface MutableVariant {
  sessionSource: SourceRow;
  experimentKey: string | null;
  rankerVariant: string;
  orderingVariant: string;
  metrics: QualityMetrics;
}

interface QualityRow {
  sessionSource: SourceRow;
  experimentKey?: string | null;
  rankerVariant?: string;
  orderingVariant?: string;
  impressions: number;
  plays: number;
  skips: number;
  earlySkips: number;
  completions: number;
  saves: number;
  playlistAdds: number;
  resonance: number;
  explorationPlays: number;
  explorationAccepted: number;
  earlySkipRate: number;
  saveRate: number;
  playlistAddRate: number;
  sessions: number;
  sessionTracks: number;
  averageTracksPerSession: number;
  playedMinutes: number;
  averagePlayedMinutesPerSession: number;
  skipRate: number;
  completionRate: number;
  resonanceRate: number;
  explorationAcceptanceRate: number;
}

interface HabitMixMeasurementCounters {
  inputFacts: number;
  duplicateEventIds: number;
  invalidTimestamps: number;
  rejectedImpressions: number;
  validImpressions: number;
  playbackStarts: number;
  duplicatePlaybackStarts: number;
  unattributedPlaybackStarts: number;
  attributedPlays: number;
  matchedPlaybackOutcomes: number;
  unmatchedPlaybackOutcomes: number;
  ambiguousLegacyPlaybackOutcomes: number;
  attributedSaves: number;
  unattributedSaves: number;
  expiredSaveFallbacks: number;
  attributedPlaylistTrackAdds: number;
  unattributedPlaylistTrackAdds: number;
  expiredPlaylistFallbacks: number;
  excludedRailActions: number;
  actionFactsMissingActorOrTrack: number;
}

function emptyMetrics(): QualityMetrics {
  return {
    impressions: 0,
    plays: 0,
    skips: 0,
    earlySkips: 0,
    completions: 0,
    saves: 0,
    playlistAdds: 0,
    resonance: 0,
    explorationPlays: 0,
    explorationAccepted: 0,
    playedMs: 0,
    sessions: new Map(),
  };
}

function emptyCounters(inputFacts: number): HabitMixMeasurementCounters {
  return {
    inputFacts,
    duplicateEventIds: 0,
    invalidTimestamps: 0,
    rejectedImpressions: 0,
    validImpressions: 0,
    playbackStarts: 0,
    duplicatePlaybackStarts: 0,
    unattributedPlaybackStarts: 0,
    attributedPlays: 0,
    matchedPlaybackOutcomes: 0,
    unmatchedPlaybackOutcomes: 0,
    ambiguousLegacyPlaybackOutcomes: 0,
    attributedSaves: 0,
    unattributedSaves: 0,
    expiredSaveFallbacks: 0,
    attributedPlaylistTrackAdds: 0,
    unattributedPlaylistTrackAdds: 0,
    expiredPlaylistFallbacks: 0,
    excludedRailActions: 0,
    actionFactsMissingActorOrTrack: 0,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dimensionString(fact: AnalyticsFactRow, key: string): string | undefined {
  return stringValue(fact.dimensions[key]);
}

function dimensionNumber(fact: AnalyticsFactRow, key: string): number | undefined {
  const value = fact.dimensions[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dimensionBoolean(fact: AnalyticsFactRow, key: string): boolean {
  return fact.dimensions[key] === true;
}

function trackIdOf(fact: AnalyticsFactRow): string | undefined {
  return dimensionString(fact, "trackId") ?? stringValue(fact.trackId);
}

function eventNameOf(fact: AnalyticsFactRow): string | undefined {
  return dimensionString(fact, "eventName");
}

function occurredAtOf(fact: AnalyticsFactRow): number | undefined {
  const timestamp = Date.parse(fact.occurredAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function compareTimedEvents<T extends { at: number; eventId: string }>(left: T, right: T): number {
  return left.at - right.at || left.eventId.localeCompare(right.eventId);
}

function deduplicateEventIds(facts: readonly AnalyticsFactRow[], counters: HabitMixMeasurementCounters) {
  const seen = new Set<string>();
  const unique: AnalyticsFactRow[] = [];
  for (const fact of facts) {
    const eventId = stringValue(fact.eventId);
    if (eventId && seen.has(eventId)) {
      counters.duplicateEventIds += 1;
      continue;
    }
    if (eventId) seen.add(eventId);
    unique.push(fact);
  }
  return unique;
}

function isSessionSource(value: string | undefined): value is SourceRow {
  return HABIT_MIX_SESSION_SOURCES.some((source) => source === value);
}

function episodeKey(actorId: string, agentSessionId: string, trackId: string): string {
  return JSON.stringify([actorId, agentSessionId, trackId]);
}

function instanceKey(start: PlaybackStart): string | undefined {
  if (!start.actorId || !start.browserSessionId || !start.playbackInstanceId || !start.trackId) return undefined;
  return JSON.stringify([start.actorId, start.browserSessionId, start.playbackInstanceId, start.trackId]);
}

function sourceVariantKey(source: SourceRow, experimentKey: string | null, rankerVariant: string, orderingVariant: string) {
  return JSON.stringify([source, experimentKey, rankerVariant, orderingVariant]);
}

function newSessionSourceMetrics(): Record<SourceRow, QualityMetrics> {
  return {
    my_mix: emptyMetrics(),
    preset: emptyMetrics(),
    described: emptyMetrics(),
  };
}

function recordImpression(metrics: QualityMetrics) {
  metrics.impressions += 1;
}

function recordEpisode(metrics: QualityMetrics, episode: PlaybackEpisode) {
  metrics.plays += 1;
  if (episode.skipped) metrics.skips += 1;
  if (episode.earlySkipped) metrics.earlySkips += 1;
  if (episode.completed) metrics.completions += 1;
  if (episode.saved) metrics.saves += 1;
  if (episode.playlistAdded) metrics.playlistAdds += 1;
  if (episode.saved || episode.playlistAdded) metrics.resonance += 1;
  if (episode.explorationPick) {
    metrics.explorationPlays += 1;
    if (episode.completed || episode.saved) metrics.explorationAccepted += 1;
  }
  metrics.playedMs += episode.playedMs;

  const sessionKey = episodeKey(episode.actorId, episode.agentSessionId, "");
  const session = metrics.sessions.get(sessionKey) ?? { trackStarts: 0, playedMs: 0 };
  session.trackStarts += 1;
  session.playedMs += episode.playedMs;
  metrics.sessions.set(sessionKey, session);
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function metricRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function finalizeMetrics(sessionSource: SourceRow, metrics: QualityMetrics, variant?: MutableVariant): QualityRow {
  const sessionTracks = [...metrics.sessions.values()].reduce((sum, session) => sum + session.trackStarts, 0);
  const sessionPlayedMs = [...metrics.sessions.values()].reduce((sum, session) => sum + session.playedMs, 0);
  const sessions = metrics.sessions.size;
  return {
    sessionSource,
    ...(variant
      ? {
          experimentKey: variant.experimentKey,
          rankerVariant: variant.rankerVariant,
          orderingVariant: variant.orderingVariant,
        }
      : {}),
    impressions: metrics.impressions,
    plays: metrics.plays,
    skips: metrics.skips,
    earlySkips: metrics.earlySkips,
    completions: metrics.completions,
    saves: metrics.saves,
    playlistAdds: metrics.playlistAdds,
    resonance: metrics.resonance,
    explorationPlays: metrics.explorationPlays,
    explorationAccepted: metrics.explorationAccepted,
    sessions,
    sessionTracks,
    averageTracksPerSession: sessions === 0 ? 0 : round4(sessionTracks / sessions),
    playedMinutes: round4(metrics.playedMs / 60_000),
    averagePlayedMinutesPerSession: sessions === 0 ? 0 : round4(sessionPlayedMs / 60_000 / sessions),
    skipRate: safeRate(metrics.skips, metrics.plays),
    earlySkipRate: safeRate(metrics.earlySkips, metrics.plays),
    completionRate: safeRate(metrics.completions, metrics.plays),
    saveRate: safeRate(metrics.saves, metrics.plays),
    playlistAddRate: safeRate(metrics.playlistAdds, metrics.plays),
    resonanceRate: safeRate(metrics.resonance, metrics.plays),
    explorationAcceptanceRate: safeRate(metrics.explorationAccepted, metrics.explorationPlays),
  };
}

function getMatchingImpression(
  impressions: Map<string, ImpressionRecord[]>,
  actorId: string,
  agentSessionId: string,
  trackId: string,
  at: number,
): ImpressionRecord | undefined {
  const candidates = impressions.get(episodeKey(actorId, agentSessionId, trackId)) ?? [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index].at <= at) return candidates[index];
  }
  return undefined;
}

function createEpisode(start: PlaybackStart, impression: ImpressionRecord): PlaybackEpisode {
  return {
    actorId: start.actorId!,
    browserSessionId: start.browserSessionId!,
    agentSessionId: start.agentSessionId!,
    trackId: start.trackId!,
    at: start.at,
    eventId: start.eventId,
    playbackInstanceId: start.playbackInstanceId,
    sessionSource: impression.sessionSource,
    experimentKey: impression.experimentKey,
    rankerVariant: impression.rankerVariant,
    orderingVariant: impression.orderingVariant,
    explorationPick: impression.explorationPick,
    skipped: false,
    earlySkipped: false,
    completed: false,
    saved: false,
    playlistAdded: false,
    playedMs: 0,
  };
}

function validMeasuredPosition(fact: AnalyticsFactRow): number | undefined {
  const positionMs = dimensionNumber(fact, "positionMs");
  const durationMs = dimensionNumber(fact, "durationMs");
  if (positionMs === undefined || positionMs < 0 || durationMs === undefined || durationMs <= 0) return undefined;
  return Math.min(positionMs, durationMs);
}

function measuredPosition(fact: AnalyticsFactRow, eventName: string): number | undefined {
  const explicitPosition = validMeasuredPosition(fact);
  if (explicitPosition !== undefined) return explicitPosition;
  if (eventName !== PLAYBACK_COMPLETE) return undefined;
  const durationMs = dimensionNumber(fact, "durationMs");
  const completionRatio = dimensionNumber(fact, "completionRatio");
  if (durationMs === undefined || durationMs <= 0 || completionRatio === undefined || completionRatio < 0) {
    return undefined;
  }
  return Math.min(completionRatio * durationMs, durationMs);
}

function completionRatioOf(fact: AnalyticsFactRow, eventName: string): number | undefined {
  const reportedRatio = dimensionNumber(fact, "completionRatio");
  if (eventName === PLAYBACK_COMPLETE) return reportedRatio;
  if (eventName !== PLAYBACK_HEARTBEAT) return undefined;
  const positionMs = dimensionNumber(fact, "positionMs");
  const durationMs = dimensionNumber(fact, "durationMs");
  if (durationMs === undefined || durationMs <= 0) return undefined;
  if (positionMs !== undefined && positionMs >= 0) return Math.min(positionMs, durationMs) / durationMs;
  return reportedRatio;
}

function assignPlaybackOutcome(
  fact: AnalyticsFactRow,
  starts: readonly PlaybackStart[],
  counters: HabitMixMeasurementCounters,
): PlaybackEpisode | undefined {
  const actorId = dimensionString(fact, "actorId");
  const browserSessionId = dimensionString(fact, "sessionId");
  const trackId = trackIdOf(fact);
  const playbackInstanceId = dimensionString(fact, "playbackInstanceId");
  const agentSessionId = dimensionString(fact, "agentSessionId");
  const at = occurredAtOf(fact);
  if (!actorId || !browserSessionId || !trackId || at === undefined) {
    counters.unmatchedPlaybackOutcomes += 1;
    return undefined;
  }

  const browserStarts = starts.filter(
    (start) =>
      start.actorId === actorId &&
      start.browserSessionId === browserSessionId &&
      start.at <= at,
  );
  const sameTrackStarts = browserStarts.filter((start) => start.trackId === trackId);
  let candidates: PlaybackStart[];
  if (playbackInstanceId) {
    candidates = sameTrackStarts.filter(
      (start) =>
        start.playbackInstanceId === playbackInstanceId &&
        (!agentSessionId || start.agentSessionId === agentSessionId),
    );
  } else {
    const eligible = agentSessionId
      ? sameTrackStarts.filter((start) => start.agentSessionId === agentSessionId)
      : sameTrackStarts;
    const currentStart = browserStarts[browserStarts.length - 1];
    if (eligible.length > 1) {
      counters.ambiguousLegacyPlaybackOutcomes += 1;
      return undefined;
    }
    candidates = eligible.length === 1 && eligible[0] === currentStart ? eligible : [];
  }

  const match = candidates[candidates.length - 1];
  if (!match?.episode) {
    counters.unmatchedPlaybackOutcomes += 1;
    return undefined;
  }
  counters.matchedPlaybackOutcomes += 1;
  return match.episode;
}

function assignDjAction(
  fact: AnalyticsFactRow,
  trackId: string,
  starts: readonly PlaybackStart[],
  at: number,
  counters: HabitMixMeasurementCounters,
  action: "save" | "playlist",
): PlaybackEpisode | undefined {
  const actorId = dimensionString(fact, "actorId");
  const agentSessionId = dimensionString(fact, "agentSessionId");
  const browserSessionId = dimensionString(fact, "sessionId");
  if (!actorId) {
    counters.actionFactsMissingActorOrTrack += 1;
    return undefined;
  }

  let candidates = starts.filter(
    (start) => start.actorId === actorId && start.trackId === trackId && start.at <= at,
  );
  if (agentSessionId) {
    candidates = candidates.filter(
      (start) =>
        start.agentSessionId === agentSessionId &&
        (!browserSessionId || start.browserSessionId === browserSessionId),
    );
  } else {
    const isTrustedDjAction =
      dimensionString(fact, "surface") === "dj" ||
      (action === "playlist" && dimensionString(fact, "producer") === "playlist-service");
    if (!isTrustedDjAction) return undefined;
    const latestStart = candidates[candidates.length - 1];
    if (!latestStart || at - latestStart.at > HABIT_MIX_MEASUREMENT.recentDjActionWithinMs) {
      if (action === "save") counters.expiredSaveFallbacks += 1;
      else counters.expiredPlaylistFallbacks += 1;
      return undefined;
    }
    candidates = [latestStart];
  }

  const latest = candidates[candidates.length - 1];
  return latest?.episode;
}

function recordImpressionOnMetrics(
  impression: ImpressionRecord,
  sourceMetrics: Record<SourceRow, QualityMetrics>,
  variants: Map<string, MutableVariant>,
) {
  recordImpression(sourceMetrics[impression.sessionSource]);
  const key = sourceVariantKey(
    impression.sessionSource,
    impression.experimentKey,
    impression.rankerVariant,
    impression.orderingVariant,
  );
  const variant =
    variants.get(key) ?? {
      sessionSource: impression.sessionSource,
      experimentKey: impression.experimentKey,
      rankerVariant: impression.rankerVariant,
      orderingVariant: impression.orderingVariant,
      metrics: emptyMetrics(),
    };
  recordImpression(variant.metrics);
  variants.set(key, variant);
}

function recordEpisodeOnMetrics(
  episode: PlaybackEpisode,
  sourceMetrics: Record<SourceRow, QualityMetrics>,
  variants: Map<string, MutableVariant>,
) {
  recordEpisode(sourceMetrics[episode.sessionSource], episode);
  const key = sourceVariantKey(
    episode.sessionSource,
    episode.experimentKey,
    episode.rankerVariant,
    episode.orderingVariant,
  );
  const variant = variants.get(key) ?? {
    sessionSource: episode.sessionSource,
    experimentKey: episode.experimentKey,
    rankerVariant: episode.rankerVariant,
    orderingVariant: episode.orderingVariant,
    metrics: emptyMetrics(),
  };
  recordEpisode(variant.metrics, episode);
  variants.set(key, variant);
}

function promotionComparisons(variants: readonly MutableVariant[]) {
  const groups = new Map<string, MutableVariant>();
  for (const variant of variants) {
    if (variant.sessionSource !== "my_mix" || !variant.experimentKey) continue;
    groups.set(
      sourceVariantKey(
        variant.sessionSource,
        variant.experimentKey,
        variant.rankerVariant,
        variant.orderingVariant,
      ),
      variant,
    );
  }

  const byExperiment = new Map<string, { candidate?: MutableVariant; baseline?: MutableVariant }>();
  for (const variant of groups.values()) {
    const pair = byExperiment.get(variant.experimentKey!) ?? {};
    if (
      variant.rankerVariant === HABIT_MIX_MEASUREMENT.candidateRankerVariant &&
      variant.orderingVariant === HABIT_MIX_MEASUREMENT.candidateOrderingVariant
    ) {
      pair.candidate = variant;
    }
    if (
      variant.rankerVariant === HABIT_MIX_MEASUREMENT.baselineRankerVariant &&
      variant.orderingVariant === HABIT_MIX_MEASUREMENT.baselineOrderingVariant
    ) {
      pair.baseline = variant;
    }
    byExperiment.set(variant.experimentKey!, pair);
  }

  return [...byExperiment.entries()]
    .filter(([, pair]) => pair.candidate && pair.baseline)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([experimentKey, pair]) => {
      const candidate = pair.candidate!;
      const baseline = pair.baseline!;
      const candidateMetrics = candidate.metrics;
      const baselineMetrics = baseline.metrics;
      const candidateSkipRate = metricRate(candidateMetrics.skips, candidateMetrics.plays);
      const baselineSkipRate = metricRate(baselineMetrics.skips, baselineMetrics.plays);
      const candidateCompletionRate = metricRate(candidateMetrics.completions, candidateMetrics.plays);
      const baselineCompletionRate = metricRate(baselineMetrics.completions, baselineMetrics.plays);
      const candidateResonanceRate = metricRate(candidateMetrics.resonance, candidateMetrics.plays);
      const baselineResonanceRate = metricRate(baselineMetrics.resonance, baselineMetrics.plays);
      const skipImprovement = baselineSkipRate - candidateSkipRate;
      const completionImprovement = candidateCompletionRate - baselineCompletionRate;
      const resonanceImprovement = candidateResonanceRate - baselineResonanceRate;
      const sampleReady =
        candidateMetrics.sessions.size >= HABIT_MIX_MEASUREMENT.promotionMinimumSessions &&
        candidateMetrics.plays >= HABIT_MIX_MEASUREMENT.promotionMinimumPlays &&
        baselineMetrics.sessions.size >= HABIT_MIX_MEASUREMENT.promotionMinimumSessions &&
        baselineMetrics.plays >= HABIT_MIX_MEASUREMENT.promotionMinimumPlays;
      const skipNoWorse = skipImprovement >= 0;
      const qualityImproves = completionImprovement > 0 || resonanceImprovement > 0;
      const eligible = sampleReady && skipNoWorse && qualityImproves;

      return {
        experimentKey,
        sessionSource: "my_mix" as const,
        candidate: {
          rankerVariant: candidate.rankerVariant,
          orderingVariant: candidate.orderingVariant,
          sessions: candidateMetrics.sessions.size,
          plays: candidateMetrics.plays,
          skipRate: safeRate(candidateMetrics.skips, candidateMetrics.plays),
          completionRate: safeRate(candidateMetrics.completions, candidateMetrics.plays),
          resonanceRate: safeRate(candidateMetrics.resonance, candidateMetrics.plays),
        },
        baseline: {
          rankerVariant: baseline.rankerVariant,
          orderingVariant: baseline.orderingVariant,
          sessions: baselineMetrics.sessions.size,
          plays: baselineMetrics.plays,
          skipRate: safeRate(baselineMetrics.skips, baselineMetrics.plays),
          completionRate: safeRate(baselineMetrics.completions, baselineMetrics.plays),
          resonanceRate: safeRate(baselineMetrics.resonance, baselineMetrics.plays),
        },
        improvements: {
          skipRate: round4(skipImprovement),
          completionRate: round4(completionImprovement),
          resonanceRate: round4(resonanceImprovement),
        },
        minimumSample: {
          sessions: HABIT_MIX_MEASUREMENT.promotionMinimumSessions,
          plays: HABIT_MIX_MEASUREMENT.promotionMinimumPlays,
        },
        eligible,
        reason: !sampleReady
          ? "minimum sample thresholds not met"
          : !skipNoWorse
            ? "candidate skip rate was higher than baseline"
            : !qualityImproves
              ? "no completion or resonance improvement"
              : "minimum sample and quality thresholds met",
      };
    });
}

/**
 * Build privacy-preserving Habit Mix quality metrics from durable facts.
 * Identity, browser-session, agent-session and track dimensions are used only
 * for in-memory joins and are never included in the returned report.
 */
export function buildHabitMixQualityReport(facts: readonly AnalyticsFactRow[]) {
  const counters = emptyCounters(facts.length);
  const uniqueFacts = deduplicateEventIds(facts, counters);
  const sourceMetrics = newSessionSourceMetrics();
  const variants = new Map<string, MutableVariant>();
  const impressions = new Map<string, ImpressionRecord[]>();
  const starts: PlaybackStart[] = [];

  const relevant = uniqueFacts
    .map((fact) => ({ fact, eventName: eventNameOf(fact), at: occurredAtOf(fact) }))
    .filter(({ eventName }) =>
      eventName === IMPRESSION ||
      eventName === PLAYBACK_START ||
      eventName === PLAYBACK_SKIP ||
      eventName === PLAYBACK_COMPLETE ||
      eventName === PLAYBACK_HEARTBEAT ||
      eventName === LIBRARY_SAVE ||
      eventName === PLAYLIST_ADD,
    )
    .sort((left, right) => {
      const leftAt = left.at ?? Number.POSITIVE_INFINITY;
      const rightAt = right.at ?? Number.POSITIVE_INFINITY;
      return leftAt - rightAt || left.fact.eventId.localeCompare(right.fact.eventId);
    });

  for (const item of relevant) {
    if (item.at === undefined) counters.invalidTimestamps += 1;
  }

  for (const { fact, eventName, at } of relevant) {
    if (eventName !== IMPRESSION || at === undefined) continue;
    const actorId = dimensionString(fact, "actorId");
    const agentSessionId = dimensionString(fact, "agentSessionId");
    const trackId = trackIdOf(fact);
    const sessionSourceValue = dimensionString(fact, "sessionSource");
    if (
      dimensionString(fact, "surface") !== "dj" ||
      !actorId ||
      !agentSessionId ||
      !trackId ||
      !isSessionSource(sessionSourceValue)
    ) {
      counters.rejectedImpressions += 1;
      continue;
    }
    const impression: ImpressionRecord = {
      actorId,
      agentSessionId,
      trackId,
      at,
      eventId: fact.eventId,
      sessionSource: sessionSourceValue,
      experimentKey: dimensionString(fact, "experimentKey") ?? null,
      rankerVariant: dimensionString(fact, "rankerVariant") ?? UNATTRIBUTED,
      orderingVariant: dimensionString(fact, "orderingVariant") ?? UNATTRIBUTED,
      explorationPick: dimensionBoolean(fact, "explorationPick"),
    };
    const key = episodeKey(actorId, agentSessionId, trackId);
    const entries = impressions.get(key) ?? [];
    entries.push(impression);
    impressions.set(key, entries);
    recordImpressionOnMetrics(impression, sourceMetrics, variants);
    counters.validImpressions += 1;
  }

  const startFacts = relevant
    .filter(({ eventName, at }) => eventName === PLAYBACK_START && at !== undefined)
    .map(({ fact, at }) => ({ fact, at: at! }))
    .sort((left, right) => left.at - right.at || left.fact.eventId.localeCompare(right.fact.eventId));
  const seenPlaybackInstances = new Set<string>();
  for (const { fact, at } of startFacts) {
    counters.playbackStarts += 1;
    const start: PlaybackStart = {
      actorId: dimensionString(fact, "actorId"),
      browserSessionId: dimensionString(fact, "sessionId"),
      agentSessionId: dimensionString(fact, "agentSessionId"),
      playbackInstanceId: dimensionString(fact, "playbackInstanceId"),
      trackId: trackIdOf(fact),
      at,
      eventId: fact.eventId,
    };
    const key = instanceKey(start);
    if (key && seenPlaybackInstances.has(key)) {
      counters.duplicatePlaybackStarts += 1;
      continue;
    }
    if (key) seenPlaybackInstances.add(key);

    const actorId = start.actorId;
    const agentSessionId = start.agentSessionId;
    const trackId = start.trackId;
    if (actorId && start.browserSessionId && agentSessionId && trackId) {
      const impression = getMatchingImpression(impressions, actorId, agentSessionId, trackId, at);
      if (impression) {
        start.episode = createEpisode(start, impression);
        counters.attributedPlays += 1;
      } else {
        counters.unattributedPlaybackStarts += 1;
      }
    } else {
      counters.unattributedPlaybackStarts += 1;
    }
    // Keep untagged / unattributed starts as boundaries. A later legacy event
    // cannot be attached to an older attributed start across that boundary.
    starts.push(start);
  }

  const playbackOutcomeFacts = relevant
    .filter(({ eventName, at }) =>
      (eventName === PLAYBACK_SKIP || eventName === PLAYBACK_COMPLETE || eventName === PLAYBACK_HEARTBEAT) &&
      at !== undefined,
    )
    .map(({ fact, eventName, at }) => ({ fact, eventName: eventName!, at: at! }))
    .sort((left, right) => left.at - right.at || left.fact.eventId.localeCompare(right.fact.eventId));
  for (const { fact, eventName } of playbackOutcomeFacts) {
    const episode = assignPlaybackOutcome(fact, starts, counters);
    if (!episode) continue;
    const positionMs = dimensionNumber(fact, "positionMs");
    if (eventName === PLAYBACK_SKIP) {
      episode.skipped = true;
      if (positionMs !== undefined && positionMs >= 0 && positionMs < HABIT_MIX_MEASUREMENT.earlySkipBeforeMs) {
        episode.earlySkipped = true;
      }
    } else {
      const completionRatio = completionRatioOf(fact, eventName);
      if (completionRatio !== undefined && completionRatio >= HABIT_MIX_MEASUREMENT.completionRatioAtLeast) {
        episode.completed = true;
      }
    }
    const position = measuredPosition(fact, eventName);
    if (position !== undefined) episode.playedMs = Math.max(episode.playedMs, position);
  }

  const actionFacts = relevant
    .filter(({ eventName, at }) => (eventName === LIBRARY_SAVE || eventName === PLAYLIST_ADD) && at !== undefined)
    .map(({ fact, eventName, at }) => ({ fact, eventName: eventName!, at: at! }))
    .sort((left, right) => left.at - right.at || left.fact.eventId.localeCompare(right.fact.eventId));
  for (const { fact, eventName, at } of actionFacts) {
    if (dimensionString(fact, "railId")) {
      counters.excludedRailActions += 1;
      continue;
    }
    const tracks = eventName === PLAYLIST_ADD
      ? (Array.isArray(fact.dimensions.trackIds)
          ? fact.dimensions.trackIds.map(stringValue).filter((trackId): trackId is string => Boolean(trackId))
          : [])
      : [];
    const singleTrack = trackIdOf(fact);
    const trackIds = [...new Set(tracks.length > 0 ? tracks : singleTrack ? [singleTrack] : [])];
    if (trackIds.length === 0) {
      counters.actionFactsMissingActorOrTrack += 1;
      if (eventName === LIBRARY_SAVE) counters.unattributedSaves += 1;
      else counters.unattributedPlaylistTrackAdds += 1;
      continue;
    }
    for (const trackId of trackIds) {
      const episode = assignDjAction(
        fact,
        trackId,
        starts,
        at,
        counters,
        eventName === LIBRARY_SAVE ? "save" : "playlist",
      );
      if (!episode) {
        if (eventName === LIBRARY_SAVE) counters.unattributedSaves += 1;
        else counters.unattributedPlaylistTrackAdds += 1;
        continue;
      }
      if (eventName === LIBRARY_SAVE) {
        episode.saved = true;
        counters.attributedSaves += 1;
      } else {
        episode.playlistAdded = true;
        counters.attributedPlaylistTrackAdds += 1;
      }
    }
  }

  const episodes = starts.flatMap((start) => (start.episode ? [start.episode] : []));
  for (const episode of episodes) recordEpisodeOnMetrics(episode, sourceMetrics, variants);

  const sessionSourceBreakdown = HABIT_MIX_SESSION_SOURCES.map((source) =>
    finalizeMetrics(source, sourceMetrics[source]),
  );
  const sessionVariantBreakdown = [...variants.values()]
    .map((variant) => finalizeMetrics(variant.sessionSource, variant.metrics, variant))
    .sort(
      (left, right) =>
        String(left.experimentKey).localeCompare(String(right.experimentKey)) ||
        left.sessionSource.localeCompare(right.sessionSource) ||
        String(left.rankerVariant).localeCompare(String(right.rankerVariant)) ||
        String(left.orderingVariant).localeCompare(String(right.orderingVariant)),
    );

  return {
    sessionSourceBreakdown,
    sessionVariantBreakdown,
    habitMixPromotion: {
      automaticActivation: false as const,
      minimumSample: {
        sessions: HABIT_MIX_MEASUREMENT.promotionMinimumSessions,
        plays: HABIT_MIX_MEASUREMENT.promotionMinimumPlays,
      },
      comparisons: promotionComparisons([...variants.values()]),
    },
    habitMixMeasurement: {
      counters,
      definitions: {
        impressions: "Unique recommendation.generated DJ track facts with a known Habit Mix session source.",
        play: "A deduplicated playback.started instance attributed to its preceding actor, agent session and track impression.",
        skip: "An episode with at least one matched playback.skipped outcome; skip rate is skips divided by attributed plays.",
        earlySkip: `A skipped episode with a measured skip position below ${HABIT_MIX_MEASUREMENT.earlySkipBeforeMs} milliseconds; the boundary itself is not early.`,
        completion: `An episode with playback.completed completionRatio or heartbeat position / positive duration at least ${HABIT_MIX_MEASUREMENT.completionRatioAtLeast}; the legacy 30-second completion signal alone does not qualify.`,
        resonance: "An episode with a matched library save or playlist add, counted once as the union of both actions.",
        explorationAcceptance: "An exploration-flagged attributed play later completed or was saved; playlist adds contribute to resonance but not this acceptance union.",
        session: "A distinct actor and agent-session pair with at least one attributed play; only aggregate counts are returned.",
        sessionTracks: "Deduplicated attributed playback episodes summed within each actor and agent-session pair; repeat plays of the same track count separately.",
        playedMinutes: "Sum of the greatest measured outcome position per attributed episode, capped to a positive duration; unknown or non-positive durations contribute no minutes.",
        actionAttribution: `Actions with explicit agentSessionId join the latest preceding matching episode. Without it, DJ-attributed actions require a latest same-actor track start within ${HABIT_MIX_MEASUREMENT.recentDjActionWithinMs / 60_000} minutes; rail-attributed actions are excluded.`,
        promotion: `Evidence only: same-experiment My Mix habit ordering is compared with single-profile ordering after each arm reaches ${HABIT_MIX_MEASUREMENT.promotionMinimumSessions} sessions and ${HABIT_MIX_MEASUREMENT.promotionMinimumPlays} plays; the candidate must not worsen skips and must improve completion or resonance.`,
      },
      limitations: [
        "Facts without private actor, browser session, agent session, track, or reliable timestamps cannot be joined into attributed plays.",
        "Legacy playback outcomes without playbackInstanceId are accepted only when exactly one preceding same-track start is current in that browser session; ambiguous or intervening starts are excluded.",
        "Unmatched and expired actions remain unattributed; no wall-clock listening duration is inferred.",
        "This report does not perform a significance test and never enables an experiment arm automatically.",
      ],
    },
  };
}
