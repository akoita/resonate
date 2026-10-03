import {
  AGENT_BEHAVIORAL_HALF_LIFE_DAYS,
  AGENT_TASTE_HISTORY_LIMIT,
  AGENT_TASTE_HISTORY_WINDOW_DAYS,
} from "../../config/agent_learning";
import {
  HABIT_ORDERING_EARLY_SKIP_MAX_DURATION_SHARE,
  HABIT_ORDERING_EARLY_SKIP_MAX_POSITION_MS,
  HABIT_ORDERING_LARGE_ENERGY_MIN_POSITIVE,
  HABIT_ORDERING_LARGE_ENERGY_MIN_POSITIVE_SHARE,
  HABIT_ORDERING_MIN_TRANSITION_EVIDENCE,
  HABIT_ORDERING_PAIR_EVIDENCE,
  HABIT_ORDERING_SHORT_RUN_MAX,
  HABIT_ORDERING_SHORT_RUN_TARGET,
} from "../../config/habit_ordering";

const DAY_MS = 24 * 60 * 60 * 1000;
const ENERGY_BAND_INDEX: Record<HabitEnergyBand, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export type HabitEnergyBand = "low" | "medium" | "high";

export type HabitOrderingObservation = {
  id: string;
  sessionKey: string;
  trackId: string;
  createdAt: Date;
  action: string;
  playbackInstanceId?: string;
  agentSessionId?: string;
  laneId?: string;
  energyBand?: HabitEnergyBand;
  energySource?: string;
  positionMs?: number;
  durationMs?: number;
};

export type HabitTransition = {
  fromLaneId: string;
  toLaneId: string;
  good: number;
  bad: number;
  largeEnergyGood: number;
};

export type HabitOrderingState = {
  transitions: HabitTransition[];
  previous?: {
    laneId?: string;
    energyBand?: HabitEnergyBand;
    runLength: number;
  };
};

export type HabitOrderTrack = {
  id: string;
  /** Original unique position in the candidate list. */
  rank: number;
  laneId?: string;
  energyBand?: HabitEnergyBand;
  energySource?: string;
};

type StartedEpisode = {
  start: HabitOrderingObservation;
  at: number;
  episodeKey: string;
  agentSessionId?: string;
  hasGoodOutcome: boolean;
  hasEarlySkip: boolean;
};

type PairEvidence = {
  good: number;
  bad: number;
  largeEnergyGood: number;
};

type RankedTrack = {
  track: HabitOrderTrack;
  inputIndex: number;
  rank: number;
  strength: number;
  pairScore: number;
  energyScore: number;
  pairEvidence?: PairEvidence;
};

const START_ACTIONS = new Set(["accept", "start", "playback.started"]);
const GOOD_ACTIONS = new Set(["complete", "completed", "playback.completed", "replay", "save", "saved"]);
const SKIP_ACTIONS = new Set(["skip", "skipped", "playback.skipped"]);

/**
 * Derive lane transition evidence and the current DJ boundary from bounded
 * playback observations. Raw track and session identifiers are used only for
 * grouping and are never included in the returned state.
 */
export function deriveHabitOrderingState(
  observations: readonly HabitOrderingObservation[],
  now: Date,
  agentSessionId?: string,
): HabitOrderingState {
  if (!Array.isArray(observations) || !Number.isFinite(now.getTime())) return { transitions: [] };

  const cutoff = now.getTime() - AGENT_TASTE_HISTORY_WINDOW_DAYS * DAY_MS;
  const bounded = deduplicateObservations(observations)
    .filter(({ createdAt }) => createdAt >= cutoff && createdAt <= now.getTime())
    .slice(-AGENT_TASTE_HISTORY_LIMIT);
  const starts = bounded
    .filter(({ observation }) => START_ACTIONS.has(normalizeAction(observation.action)))
    .map(({ observation, createdAt }) => ({ observation, createdAt }))
    .sort((left, right) => left.createdAt - right.createdAt || compareText(left.observation.id, right.observation.id));

  const episodes: StartedEpisode[] = [];
  const episodeByKey = new Map<string, StartedEpisode>();
  for (const { observation, createdAt } of starts) {
    const sessionKey = observation.sessionKey.trim();
    const trackId = observation.trackId.trim();
    const playbackInstanceId = cleanOptionalString(observation.playbackInstanceId);
    const episodeKey = playbackInstanceId
      ? JSON.stringify([sessionKey, playbackInstanceId, trackId])
      : JSON.stringify([sessionKey, "anonymous", trackId, createdAt]);

    // Duplicate starts for the same identified playback episode count once.
    if (episodeByKey.has(episodeKey)) continue;
    const episode: StartedEpisode = {
      start: observation,
      at: createdAt,
      episodeKey,
      ...(cleanOptionalString(observation.agentSessionId)
        ? { agentSessionId: cleanOptionalString(observation.agentSessionId) }
        : {}),
      hasGoodOutcome: false,
      hasEarlySkip: false,
    };
    episodeByKey.set(episodeKey, episode);
    episodes.push(episode);
  }
  episodes.sort(compareEpisodes);

  const episodesBySession = new Map<string, StartedEpisode[]>();
  for (const episode of episodes) {
    const sessionKey = episode.start.sessionKey.trim();
    const sessionEpisodes = episodesBySession.get(sessionKey) ?? [];
    sessionEpisodes.push(episode);
    episodesBySession.set(sessionKey, sessionEpisodes);
  }

  const outcomes = bounded
    .filter(({ observation }) => {
      const action = normalizeAction(observation.action);
      return GOOD_ACTIONS.has(action) || SKIP_ACTIONS.has(action);
    })
    .sort((left, right) => left.createdAt - right.createdAt || compareText(left.observation.id, right.observation.id));

  for (const { observation, createdAt } of outcomes) {
    const sessionKey = observation.sessionKey.trim();
    const trackId = observation.trackId.trim();
    const playbackInstanceId = cleanOptionalString(observation.playbackInstanceId);
    let episode: StartedEpisode | undefined;

    if (playbackInstanceId) {
      episode = episodeByKey.get(JSON.stringify([sessionKey, playbackInstanceId, trackId]));
    } else {
      // Legacy rows are safe only for the track that was current in this
      // browser session when the outcome occurred. A late outcome after the
      // listener started another track, or repeated the same track, is
      // ambiguous and cannot be attached to an earlier playback episode.
      const startedAtOutcome = (episodesBySession.get(sessionKey) ?? [])
        .filter((candidate) => candidate.at <= createdAt);
      const current = startedAtOutcome.at(-1);
      const sameTrackEpisodes = startedAtOutcome.filter((candidate) => candidate.start.trackId.trim() === trackId);
      if (sameTrackEpisodes.length === 1 && current === sameTrackEpisodes[0]) {
        episode = sameTrackEpisodes[0];
      }
    }
    if (!episode || createdAt < episode.at) continue;

    const action = normalizeAction(observation.action);
    if (GOOD_ACTIONS.has(action)) episode.hasGoodOutcome = true;
    if (SKIP_ACTIONS.has(action) && isMeasuredEarlySkip(observation)) episode.hasEarlySkip = true;
    if (!episode.agentSessionId) {
      episode.agentSessionId = cleanOptionalString(observation.agentSessionId);
    }
  }

  const transitionMap = new Map<string, PairEvidence>();
  for (const sessionEpisodes of episodesBySession.values()) {
    let previous: StartedEpisode | undefined;
    for (const episode of sessionEpisodes) {
      const toLaneId = cleanOptionalString(episode.start.laneId);
      const fromLaneId = cleanOptionalString(previous?.start.laneId);
      if (!toLaneId) {
        // A hidden or unmapped episode breaks lane adjacency.
        previous = undefined;
        continue;
      }

      if (previous && fromLaneId) {
        const outcome = episode.hasEarlySkip ? "bad" : episode.hasGoodOutcome ? "good" : null;
        if (outcome) {
          const weight = decayWeight(episode.at, now.getTime());
          const key = JSON.stringify([fromLaneId, toLaneId]);
          const evidence = transitionMap.get(key) ?? { good: 0, bad: 0, largeEnergyGood: 0 };
          evidence[outcome] += weight;
          if (outcome === "good" && isMeasuredLargeEnergyJump(previous.start, episode.start)) {
            evidence.largeEnergyGood += weight;
          }
          transitionMap.set(key, evidence);
        }
      }
      previous = episode;
    }
  }

  const transitions = [...transitionMap.entries()]
    .map(([key, evidence]) => {
      const [fromLaneId, toLaneId] = JSON.parse(key) as [string, string];
      return { fromLaneId, toLaneId, ...evidence };
    })
    .sort((left, right) => compareText(left.fromLaneId, right.fromLaneId) || compareText(left.toLaneId, right.toLaneId));

  const state: HabitOrderingState = { transitions };
  const currentEpisodes = agentSessionId
    ? episodes.filter((episode) => episode.agentSessionId === agentSessionId)
    : [];
  const latest = currentEpisodes.at(-1);
  if (latest) {
    const browserEpisodes = episodesBySession.get(latest.start.sessionKey.trim()) ?? [];
    const latestActual = browserEpisodes.at(-1);
    // A later untagged or differently tagged play means the DJ's tagged play
    // is no longer the actual browser-session boundary.
    if (latestActual === latest) {
      const latestLaneId = cleanOptionalString(latest.start.laneId);
      let runLength = 0;
      if (latestLaneId) {
        for (let index = browserEpisodes.length - 1; index >= 0; index -= 1) {
          if (cleanOptionalString(browserEpisodes[index].start.laneId) !== latestLaneId) break;
          runLength += 1;
        }
      }
      state.previous = {
        ...(latestLaneId ? { laneId: latestLaneId } : {}),
        ...(latest.start.energySource === "measured" && isEnergyBand(latest.start.energyBand)
          ? { energyBand: latest.start.energyBand }
          : {}),
        runLength,
      };
    }
  }

  return state;
}

/**
 * Return a stable permutation of candidate descriptors. This function never
 * clones, removes, or creates track descriptors; absent/invalid evidence is
 * neutral and leaves cold-start decisions to lane strength and rank.
 */
export function orderHabitTracks(
  tracks: readonly HabitOrderTrack[],
  state: HabitOrderingState,
  laneStrengths: Readonly<Record<string, number>>,
): HabitOrderTrack[] {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  let remaining: RankedTrack[] = tracks.map((track, inputIndex) => ({
    track,
    inputIndex,
    rank: Number.isFinite(track.rank) ? track.rank : inputIndex,
    strength: readLaneStrength(laneStrengths, track.laneId),
    pairScore: 0.5,
    energyScore: 0,
  }));
  const transitions = new Map<string, PairEvidence>();
  let totalEvidence = 0;
  for (const transition of state.transitions) {
    const good = nonNegativeFinite(transition.good);
    const bad = nonNegativeFinite(transition.bad);
    const largeEnergyGood = nonNegativeFinite(transition.largeEnergyGood);
    const evidence = { good, bad, largeEnergyGood };
    transitions.set(pairKey(transition.fromLaneId, transition.toLaneId), evidence);
    totalEvidence += good + bad;
  }
  const learnedOrdering = totalEvidence >= HABIT_ORDERING_MIN_TRANSITION_EVIDENCE;

  let previousLaneId = cleanOptionalString(state.previous?.laneId);
  let previousEnergyBand = isEnergyBand(state.previous?.energyBand) ? state.previous?.energyBand : undefined;
  let runLength = previousLaneId
    ? Math.max(0, Math.floor(nonNegativeFinite(state.previous?.runLength ?? 0)))
    : 0;

  const ordered: HabitOrderTrack[] = [];
  while (remaining.length > 0) {
    const ranked = remaining.map((candidate) => {
      const nextLaneId = cleanOptionalString(candidate.track.laneId);
      const evidence = previousLaneId && nextLaneId
        ? transitions.get(pairKey(previousLaneId, nextLaneId))
        : undefined;
      const pairEvidenceTotal = evidence ? evidence.good + evidence.bad : 0;
      const pairIsLearned = Boolean(evidence && pairEvidenceTotal >= HABIT_ORDERING_PAIR_EVIDENCE);
      const pairScore = learnedOrdering && pairIsLearned && evidence
        ? (evidence.good + 1) / (evidence.good + evidence.bad + 2)
        : 0.5;
      const energyScore = energyContinuityScore(
        previousEnergyBand,
        candidate.track,
        evidence,
        learnedOrdering,
      );
      return {
        ...candidate,
        pairScore,
        energyScore,
        ...(evidence ? { pairEvidence: evidence } : {}),
      };
    });

    // Measured one-band-or-less moves beat abrupt measured jumps whenever a
    // compatible option exists. Unknown energy stays neutral; only globally
    // learned large-jump evidence can preserve an abrupt measured candidate.
    // Apply this before pair avoidance so a negative but energy-safe choice is
    // still available when every alternative would make an unlearned jump.
    const hasMeasuredCompatibleOption = ranked.some((candidate) =>
      isMeasuredEnergyCompatible(previousEnergyBand, candidate.track),
    );
    let eligible = hasMeasuredCompatibleOption
      ? ranked.filter((candidate) =>
        !isMeasuredAbruptJump(previousEnergyBand, candidate.track) ||
        (learnedOrdering && hasLearnedLargeEnergyJump(candidate.pairEvidence)),
      )
      : ranked;

    if (learnedOrdering && previousLaneId) {
      const nonNegative = eligible.filter((candidate) =>
        !isNegativePair(candidate.pairEvidence),
      );
      if (nonNegative.length > 0) eligible = nonNegative;
    }

    // Preserve a short same-lane run, then prefer an acceptable switch. At the
    // soft target, switch only when a measured-energy-compatible alternative
    // exists. Extend to the maximum otherwise, then accept any nonnegative
    // alternative after energy filtering.
    if (previousLaneId && runLength < HABIT_ORDERING_SHORT_RUN_TARGET) {
      const continuation = eligible.filter((candidate) => candidate.track.laneId === previousLaneId);
      if (continuation.length > 0) eligible = continuation;
    } else if (previousLaneId && runLength < HABIT_ORDERING_SHORT_RUN_MAX) {
      const compatibleAlternatives = eligible.filter((candidate) =>
        candidate.track.laneId !== previousLaneId &&
        isMeasuredEnergyCompatible(previousEnergyBand, candidate.track),
      );
      if (compatibleAlternatives.length > 0) {
        eligible = compatibleAlternatives;
      } else {
        const continuation = eligible.filter((candidate) => candidate.track.laneId === previousLaneId);
        if (continuation.length > 0) eligible = continuation;
      }
    } else if (previousLaneId && runLength >= HABIT_ORDERING_SHORT_RUN_MAX) {
      const alternatives = eligible.filter((candidate) => candidate.track.laneId !== previousLaneId);
      if (alternatives.length > 0) eligible = alternatives;
    }

    eligible.sort((left, right) => {
      if (learnedOrdering && left.pairScore !== right.pairScore) return right.pairScore - left.pairScore;
      if (left.strength !== right.strength) return right.strength - left.strength;
      if (left.energyScore !== right.energyScore) return right.energyScore - left.energyScore;
      if (left.rank !== right.rank) return left.rank - right.rank;
      const byId = compareText(left.track.id, right.track.id);
      return byId || left.inputIndex - right.inputIndex;
    });

    const chosen = eligible[0];
    ordered.push(chosen.track);
    remaining = remaining.filter((candidate) => candidate.inputIndex !== chosen.inputIndex);
    const chosenLaneId = cleanOptionalString(chosen.track.laneId);
    if (!chosenLaneId) {
      previousLaneId = undefined;
      runLength = 0;
    } else if (chosenLaneId === previousLaneId) {
      runLength += 1;
    } else {
      previousLaneId = chosenLaneId;
      runLength = 1;
    }
    previousEnergyBand = chosen.track.energySource === "measured" && isEnergyBand(chosen.track.energyBand)
      ? chosen.track.energyBand
      : undefined;
  }
  return ordered;
}

function deduplicateObservations(
  observations: readonly HabitOrderingObservation[],
): Array<{ observation: HabitOrderingObservation; createdAt: number }> {
  const valid = observations
    .filter((observation) =>
      Boolean(
        observation &&
          typeof observation.id === "string" && observation.id.trim() &&
          typeof observation.sessionKey === "string" && observation.sessionKey.trim() &&
          typeof observation.trackId === "string" && observation.trackId.trim() &&
          typeof observation.action === "string" &&
          observation.createdAt instanceof Date && Number.isFinite(observation.createdAt.getTime()),
      ),
    )
    .map((observation) => ({ observation, createdAt: observation.createdAt.getTime() }))
    .sort((left, right) =>
      left.createdAt - right.createdAt ||
      compareText(left.observation.id, right.observation.id) ||
      compareText(stableObservationKey(left.observation), stableObservationKey(right.observation)),
    );

  const unique = new Map<string, { observation: HabitOrderingObservation; createdAt: number }>();
  for (const item of valid) {
    if (!unique.has(item.observation.id)) unique.set(item.observation.id, item);
  }
  return [...unique.values()];
}

function stableObservationKey(observation: HabitOrderingObservation): string {
  return JSON.stringify([
    observation.sessionKey,
    observation.trackId,
    normalizeAction(observation.action),
    cleanOptionalString(observation.playbackInstanceId) ?? "",
    cleanOptionalString(observation.laneId) ?? "",
    observation.positionMs ?? null,
    observation.durationMs ?? null,
  ]);
}

function compareEpisodes(left: StartedEpisode, right: StartedEpisode): number {
  return left.at - right.at ||
    compareText(left.start.id, right.start.id) ||
    compareText(left.start.sessionKey, right.start.sessionKey) ||
    compareText(left.start.trackId, right.start.trackId);
}

function isMeasuredEarlySkip(observation: HabitOrderingObservation): boolean {
  const positionMs = observation.positionMs;
  const durationMs = observation.durationMs;
  return Number.isFinite(positionMs) &&
    Number.isFinite(durationMs) &&
    (positionMs as number) >= 0 &&
    (positionMs as number) <= HABIT_ORDERING_EARLY_SKIP_MAX_POSITION_MS &&
    (durationMs as number) > 0 &&
    (positionMs as number) / (durationMs as number) <= HABIT_ORDERING_EARLY_SKIP_MAX_DURATION_SHARE;
}

function isMeasuredLargeEnergyJump(
  from: HabitOrderingObservation,
  to: HabitOrderingObservation,
): boolean {
  return from.energySource === "measured" &&
    to.energySource === "measured" &&
    isEnergyBand(from.energyBand) &&
    isEnergyBand(to.energyBand) &&
    Math.abs(ENERGY_BAND_INDEX[from.energyBand] - ENERGY_BAND_INDEX[to.energyBand]) > 1;
}

function energyContinuityScore(
  previous: HabitEnergyBand | undefined,
  candidate: HabitOrderTrack,
  evidence?: PairEvidence,
  learnedOrdering = false,
): number {
  if (!previous || candidate.energySource !== "measured" || !isEnergyBand(candidate.energyBand)) return 0;
  const difference = Math.abs(ENERGY_BAND_INDEX[previous] - ENERGY_BAND_INDEX[candidate.energyBand]);
  if (difference <= 1) return 2 - difference;
  return learnedOrdering && hasLearnedLargeEnergyJump(evidence) ? 0 : -1;
}

function hasLearnedLargeEnergyJump(evidence?: PairEvidence): boolean {
  if (!evidence || evidence.largeEnergyGood < HABIT_ORDERING_LARGE_ENERGY_MIN_POSITIVE) return false;
  const total = evidence.good + evidence.bad;
  return total > 0 && evidence.good / total >= HABIT_ORDERING_LARGE_ENERGY_MIN_POSITIVE_SHARE;
}

function isMeasuredEnergyCompatible(
  previous: HabitEnergyBand | undefined,
  candidate: HabitOrderTrack,
): boolean {
  return Boolean(
    previous &&
      candidate.energySource === "measured" &&
      isEnergyBand(candidate.energyBand) &&
      Math.abs(ENERGY_BAND_INDEX[previous] - ENERGY_BAND_INDEX[candidate.energyBand]) <= 1,
  );
}

function isMeasuredAbruptJump(
  previous: HabitEnergyBand | undefined,
  candidate: HabitOrderTrack,
): boolean {
  return Boolean(
    previous &&
      candidate.energySource === "measured" &&
      isEnergyBand(candidate.energyBand) &&
      Math.abs(ENERGY_BAND_INDEX[previous] - ENERGY_BAND_INDEX[candidate.energyBand]) > 1,
  );
}

function isNegativePair(evidence?: PairEvidence): boolean {
  if (!evidence || evidence.good + evidence.bad < HABIT_ORDERING_PAIR_EVIDENCE) return false;
  return evidence.good < evidence.bad;
}

function readLaneStrength(strengths: Readonly<Record<string, number>>, laneId?: string): number {
  if (!laneId) return 0;
  return nonNegativeFinite(strengths[laneId]);
}

function decayWeight(createdAt: number, now: number): number {
  const ageMs = Math.max(0, now - createdAt);
  return 2 ** (-ageMs / (AGENT_BEHAVIORAL_HALF_LIFE_DAYS * DAY_MS));
}

function pairKey(fromLaneId: string, toLaneId: string): string {
  return JSON.stringify([fromLaneId, toLaneId]);
}

function normalizeAction(action: string): string {
  return action.trim().toLowerCase();
}

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isEnergyBand(value: unknown): value is HabitEnergyBand {
  return value === "low" || value === "medium" || value === "high";
}

function nonNegativeFinite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
