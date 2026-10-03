import { createHash } from "crypto";
import {
  AGENT_SIGNAL_WEIGHTS,
  AGENT_LISTENING_LANE_MAX,
  AGENT_LISTENING_LANE_MIN_SESSIONS,
  AGENT_LISTENING_LANE_MIN_WEIGHT,
  AGENT_LISTENING_LANE_SIMILARITY_THRESHOLD,
  AGENT_TASTE_HISTORY_LIMIT,
  AGENT_TASTE_HISTORY_WINDOW_DAYS,
} from "../../config/agent_learning";
import {
  TASTE_EDIT_GENRES,
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_MOODS,
  TASTE_EDIT_MOOD_ALIASES,
} from "../recommendations/taste_edit_vocabulary";
import type { TasteMemoryPolicy, TasteSignalType } from "../recommendations/taste_memory.service";
import { AgentTasteSignalInput, computeAgentTasteProfileFromSignals } from "./agent_learning.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const GENRE_SIMILARITY_SHARE = 0.75;
const MOOD_SIMILARITY_SHARE = 0.2;
const CONTEXT_SIMILARITY_SHARE = 0.05;

export type ListeningLane = {
  id: string;
  label: string;
  genreWeights: Record<string, number>;
  moodWeights: Record<string, number>;
  strength: number;
  contexts: Record<string, number>;
  energyBand: "low" | "medium" | "high" | null;
};

type SignalWithTime = {
  signal: AgentTasteSignalInput;
  createdAt: Date;
  sortKey: string;
};

type MutableVector = {
  sessionKey: string;
  contextKey?: string;
  genres: Map<string, number>;
  moods: Map<string, number>;
  contexts: Map<string, number>;
  energy: Map<string, number>;
};

type SessionContextVector = MutableVector & {
  sortKey: string;
  positiveEvidence: number;
};

type LaneCluster = {
  genreWeights: Map<string, number>;
  moodWeights: Map<string, number>;
  contextWeights: Map<string, number>;
  energyWeights: Map<string, number>;
  /** Positive seed vectors determine the centroid and the session threshold. */
  positiveGenreCentroid: Map<string, number>;
  positiveMoodCentroid: Map<string, number>;
  positiveContextCentroid: Map<string, number>;
  positiveSessions: Set<string>;
  positiveVectorCount: number;
  positiveEvidence: number;
  sortKey: string;
};

/**
 * Derives private habit lanes from bounded, policy-governed playback history.
 * Session keys are used only as in-memory grouping keys and never enter the
 * returned lane summary.
 *
 * Clustering uses deterministic, sorted centroid assignment. It examines at
 * most 500 vectors and therefore at most 250,000 vector-to-centroid pairs; it
 * is intentionally bounded and stable rather than a globally optimal partition.
 */
export function computeListeningLanes(
  signals: AgentTasteSignalInput[],
  now: Date,
  policy?: TasteMemoryPolicy,
): ListeningLane[] {
  if (!Number.isFinite(now.getTime())) return [];

  const cutoff = now.getTime() - AGENT_TASTE_HISTORY_WINDOW_DAYS * DAY_MS;
  const boundedSignals = signals
    .map((signal): SignalWithTime => {
      const createdAt = validDate(signal.createdAt) ?? now;
      return { signal, createdAt, sortKey: stableSignalKey(signal) };
    })
    .filter(({ signal, createdAt }) => {
      const weight = storedSignalWeight(signal);
      return Boolean(
        typeof signal.sessionKey === "string" &&
        signal.sessionKey.trim().length > 0 &&
        createdAt.getTime() >= cutoff &&
        (!policy?.resetAt || createdAt > policy.resetAt) &&
        typeof weight === "number" &&
        Number.isFinite(weight),
      );
    })
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.sortKey.localeCompare(right.sortKey))
    .slice(0, AGENT_TASTE_HISTORY_LIMIT);

  const normalizedPolicy = policyForCatalogSpellings(policy);
  const vectors = new Map<string, MutableVector>();
  for (const { signal, createdAt } of boundedSignals) {
    const sessionKey = signal.sessionKey!.trim();
    const canonicalGenre = canonicalCatalogValue(signal.genre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
    // Genres are the lane anchor. An unknown genre or a sessionless signal can
    // support neither a public label nor a stable habit identity.
    if (!canonicalGenre) continue;
    const canonicalMoods = canonicalCatalogValues(signal.moods, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES);
    const contextKey = playbackContextKey(signal.localHourBucket, signal.weekdayKind);
    const groupKey = JSON.stringify([sessionKey, contextKey ?? null]);
    const vector = vectors.get(groupKey) ?? {
      sessionKey: hashSessionKey(sessionKey),
      ...(contextKey ? { contextKey } : {}),
      genres: new Map<string, number>(),
      moods: new Map<string, number>(),
      contexts: new Map<string, number>(),
      energy: new Map<string, number>(),
    };

    const normalizedSignal: AgentTasteSignalInput = {
      ...signal,
      createdAt,
      genre: canonicalGenre,
      moods: canonicalMoods,
    };
    const profile = computeAgentTasteProfileFromSignals([normalizedSignal], [], now, {
      policy: normalizedPolicy,
    });

    addRecordToMap(vector.genres, profile.genreWeights);
    addRecordToMap(vector.moods, profile.moodWeights ?? {});
    addRecordToMap(vector.energy, profile.energyBandWeights ?? {});
    if (contextKey) {
      const signedGenreEvidence = Object.values(profile.genreWeights).reduce((sum, weight) => sum + weight, 0);
      addMapValue(vector.contexts, contextKey, signedGenreEvidence);
    }
    vectors.set(groupKey, vector);
  }

  const allVectors = [...vectors.values()]
    .map((vector): SessionContextVector => ({
      ...vector,
      sortKey: vectorSortKey(vector),
      positiveEvidence: positiveWeight(vector.genres),
    }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const positiveVectors = allVectors.filter((vector) => vector.positiveEvidence > 0);
  if (positiveVectors.length === 0) return [];

  const clusters: LaneCluster[] = [];
  for (const vector of positiveVectors) {
    let bestCluster: LaneCluster | undefined;
    let bestSimilarity = -1;
    for (const cluster of clusters) {
      const similarity = vectorSimilarity(vector, cluster);
      if (
        similarity > bestSimilarity ||
        (similarity === bestSimilarity && cluster.sortKey.localeCompare(bestCluster?.sortKey ?? "") < 0)
      ) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }
    if (bestCluster && bestSimilarity >= AGENT_LISTENING_LANE_SIMILARITY_THRESHOLD) {
      addPositiveVector(bestCluster, vector);
    } else {
      clusters.push(startCluster(vector));
    }
  }

  // A negative-only session cannot seed a habit or satisfy the distinct-session
  // floor. Once positive lanes exist, matching skips/unsaves still reduce the
  // corresponding lane's signed trait totals.
  for (const vector of allVectors.filter((candidate) => candidate.positiveEvidence <= 0 && hasNegativeGenre(candidate.genres))) {
    let bestCluster: LaneCluster | undefined;
    let bestSimilarity = -1;
    for (const cluster of clusters) {
      const similarity = vectorSimilarity(vector, cluster, true);
      if (
        similarity > bestSimilarity ||
        (similarity === bestSimilarity && cluster.sortKey.localeCompare(bestCluster?.sortKey ?? "") < 0)
      ) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }
    if (bestCluster && bestSimilarity >= AGENT_LISTENING_LANE_SIMILARITY_THRESHOLD) {
      addSignedVector(bestCluster, vector);
    }
  }

  const finalLanes = clusters
    .map((cluster) => toLane(cluster))
    .filter((lane): lane is ListeningLane => Boolean(lane));
  const eligibleEvidence = clusters.reduce((sum, cluster) => sum + positiveWeight(cluster.genreWeights), 0);
  if (eligibleEvidence <= 0) return [];

  return finalLanes
    .map((lane) => ({
      ...lane,
      strength: clamp01(roundWeight(lane.strength / eligibleEvidence)),
    }))
    .sort((left, right) => right.strength - left.strength || left.id.localeCompare(right.id))
    .slice(0, AGENT_LISTENING_LANE_MAX);
}

function startCluster(vector: SessionContextVector): LaneCluster {
  const cluster: LaneCluster = {
    genreWeights: new Map(),
    moodWeights: new Map(),
    contextWeights: new Map(),
    energyWeights: new Map(),
    positiveGenreCentroid: new Map(),
    positiveMoodCentroid: new Map(),
    positiveContextCentroid: new Map(),
    positiveSessions: new Set(),
    positiveVectorCount: 0,
    positiveEvidence: 0,
    sortKey: vector.sortKey,
  };
  addPositiveVector(cluster, vector);
  return cluster;
}

function addPositiveVector(cluster: LaneCluster, vector: SessionContextVector) {
  addMaps(cluster.genreWeights, vector.genres);
  addMaps(cluster.moodWeights, vector.moods);
  addMaps(cluster.contextWeights, vector.contexts);
  addMaps(cluster.energyWeights, vector.energy);
  addMaps(cluster.positiveGenreCentroid, positiveProjection(vector.genres));
  addMaps(cluster.positiveMoodCentroid, positiveProjection(vector.moods));
  addMaps(cluster.positiveContextCentroid, positiveProjection(vector.contexts));
  cluster.positiveSessions.add(vector.sessionKey);
  cluster.positiveVectorCount += 1;
  cluster.positiveEvidence += vector.positiveEvidence;
  cluster.sortKey = [cluster.sortKey, vector.sortKey].sort((a, b) => a.localeCompare(b))[0];
}

function addSignedVector(cluster: LaneCluster, vector: SessionContextVector) {
  addMaps(cluster.genreWeights, vector.genres);
  addMaps(cluster.moodWeights, vector.moods);
  addMaps(cluster.contextWeights, vector.contexts);
  addMaps(cluster.energyWeights, vector.energy);
}

function vectorSimilarity(vector: SessionContextVector, cluster: LaneCluster, absolute = false) {
  const genres = absolute ? absoluteProjection(vector.genres) : positiveProjection(vector.genres);
  const moods = absolute ? absoluteProjection(vector.moods) : positiveProjection(vector.moods);
  const contexts = absolute ? absoluteProjection(vector.contexts) : positiveProjection(vector.contexts);
  const genreSimilarity = weightedJaccard(genres, centroid(cluster.positiveGenreCentroid, cluster.positiveVectorCount));
  // A shared context or mood can support a match but can never join disjoint
  // catalog genres into the same listening lane.
  if (genreSimilarity <= 0) return 0;
  const moodSimilarity = weightedJaccard(moods, centroid(cluster.positiveMoodCentroid, cluster.positiveVectorCount));
  const contextSimilarity = weightedJaccard(contexts, centroid(cluster.positiveContextCentroid, cluster.positiveVectorCount));
  return (
    GENRE_SIMILARITY_SHARE * genreSimilarity +
    MOOD_SIMILARITY_SHARE * moodSimilarity +
    CONTEXT_SIMILARITY_SHARE * contextSimilarity
  );
}

function toLane(cluster: LaneCluster): ListeningLane | undefined {
  const genres = positiveProjection(cluster.genreWeights);
  const moods = positiveProjection(cluster.moodWeights);
  const contexts = positiveProjection(cluster.contextWeights);
  const evidence = positiveWeight(cluster.genreWeights);
  if (
    evidence < AGENT_LISTENING_LANE_MIN_WEIGHT ||
    cluster.positiveSessions.size < AGENT_LISTENING_LANE_MIN_SESSIONS ||
    genres.size === 0
  ) {
    return undefined;
  }

  const genreWeights = rankedRecord(genres);
  const moodWeights = rankedRecord(moods);
  const contextWeights = rankedRecord(contexts);
  const genreMembership = [...genres.keys()].sort((a, b) => a.localeCompare(b));
  const moodMembership = [...moods.keys()].sort((a, b) => a.localeCompare(b));
  const idMaterial = JSON.stringify({ genres: genreMembership, moods: moodMembership });
  const id = "lane_" + createHash("sha256").update(idMaterial).digest("hex").slice(0, 32);
  const topGenres = Object.keys(genreWeights).slice(0, 2);
  const topMood = Object.keys(moodWeights)[0];
  const label = [...topGenres, ...(topMood ? [topMood] : [])].join(" · ");
  const energyBand = (
    Object.keys(rankedRecord(positiveProjection(cluster.energyWeights)))[0] as ListeningLane["energyBand"] | undefined
  ) ?? null;

  return {
    id,
    label,
    genreWeights,
    moodWeights,
    strength: evidence,
    contexts: contextWeights,
    energyBand,
  };
}

function policyForCatalogSpellings(policy: TasteMemoryPolicy | undefined): TasteMemoryPolicy | undefined {
  if (!policy) return undefined;
  const hidden = cloneControls(policy.hidden);
  const downranked = cloneControls(policy.downranked);
  const boosted = cloneControls(policy.boosted);
  for (const type of ["genre", "mood"] as const) {
    const catalog = type === "genre" ? TASTE_EDIT_GENRES : TASTE_EDIT_MOODS;
    const aliases = type === "genre" ? TASTE_EDIT_GENRE_ALIASES : TASTE_EDIT_MOOD_ALIASES;
    const canonicalControls = new Map<string, { hidden: boolean; downranked: boolean; boosted: boolean }>();
    for (const [action, controls] of [
      ["hidden", policy.hidden],
      ["downranked", policy.downranked],
      ["boosted", policy.boosted],
    ] as const) {
      for (const control of controls.get(type) ?? []) {
        const canonical = canonicalCatalogValue(control, catalog, aliases);
        if (!canonical) continue;
        const existing = canonicalControls.get(canonical) ?? { hidden: false, downranked: false, boosted: false };
        existing[action] = true;
        canonicalControls.set(canonical, existing);
      }
    }
    for (const [canonical, actions] of canonicalControls) {
      const key = normalizeControlKey(canonical);
      if (actions.hidden) hidden.get(type)?.add(key);
      else if (actions.downranked) downranked.get(type)?.add(key);
      else if (actions.boosted) boosted.get(type)?.add(key);
    }
  }
  return { ...policy, hidden, downranked, boosted };
}

function cloneControls(controls: TasteMemoryPolicy["hidden"]) {
  return new Map<TasteSignalType, Set<string>>(
    [...controls.entries()].map(([type, values]) => [
      type,
      new Set([...values].map(normalizeControlKey)),
    ]),
  );
}

function normalizeControlKey(value: string) {
  return value.trim().toLowerCase();
}

function canonicalCatalogValue(
  value: unknown,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>>,
) {
  if (typeof value !== "string") return undefined;
  const key = normalizeVocabularyKey(value);
  if (!key) return undefined;
  const catalogValue = catalog.find((candidate) => normalizeVocabularyKey(candidate) === key);
  return catalogValue ?? aliases[key];
}

function canonicalCatalogValues(
  values: unknown,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>>,
) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => canonicalCatalogValue(value, catalog, aliases))
    .filter((value): value is string => Boolean(value)))];
}

function normalizeVocabularyKey(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function playbackContextKey(hour: unknown, weekday: unknown) {
  const validHours = ["night", "morning", "afternoon", "evening"];
  const validWeekdays = ["weekday", "weekend"];
  if (typeof hour !== "string" || typeof weekday !== "string") return undefined;
  if (!validHours.includes(hour) || !validWeekdays.includes(weekday)) return undefined;
  return `${hour}:${weekday}`;
}

function storedSignalWeight(signal: AgentTasteSignalInput) {
  if (signal.weight !== undefined && signal.weight !== null) return signal.weight;
  return AGENT_SIGNAL_WEIGHTS[signal.action as keyof typeof AGENT_SIGNAL_WEIGHTS];
}

function validDate(value: unknown): Date | undefined {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : undefined;
}

function stableSignalKey(signal: AgentTasteSignalInput) {
  const aliases = Object.entries(signal.artistAliases ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, values]) => [label, [...values].sort((left, right) => left.localeCompare(right))]);
  return JSON.stringify([
    signal.sessionKey ?? "",
    signal.trackId,
    signal.action,
    storedSignalWeight(signal),
    signal.genre ?? "",
    [...(signal.moods ?? [])].sort((left, right) => left.localeCompare(right)),
    [...(signal.artists ?? [])].sort((left, right) => left.localeCompare(right)),
    aliases,
    signal.localHourBucket ?? "",
    signal.weekdayKind ?? "",
    signal.audioFeatures?.energy ?? null,
    signal.audioFeatures?.energySource ?? "",
    signal.audioFeatures?.tempoBpm ?? null,
    signal.audioFeatures?.tempoSource ?? "",
  ]);
}

function vectorSortKey(vector: MutableVector) {
  const serialize = (map: Map<string, number>) => [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([
    vector.sessionKey,
    vector.contextKey ?? "",
    serialize(vector.genres),
    serialize(vector.moods),
    serialize(vector.contexts),
    serialize(vector.energy),
  ]);
}

function hashSessionKey(sessionKey: string) {
  return createHash("sha256").update(sessionKey).digest("hex");
}

function addRecordToMap(target: Map<string, number>, values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) addMapValue(target, key, value);
}

function addMaps(target: Map<string, number>, values: Map<string, number>) {
  for (const [key, value] of values) addMapValue(target, key, value);
}

function addMapValue(target: Map<string, number>, key: string, value: number) {
  if (Number.isFinite(value)) target.set(key, (target.get(key) ?? 0) + value);
}

function positiveProjection(values: Map<string, number>) {
  return new Map([...values.entries()].filter(([, value]) => value > 0));
}

function absoluteProjection(values: Map<string, number>) {
  return new Map([...values.entries()]
    .map(([key, value]) => [key, Math.abs(value)] as const)
    .filter(([, value]) => value > 0));
}

function positiveWeight(values: Map<string, number>) {
  return [...positiveProjection(values).values()].reduce((sum, value) => sum + value, 0);
}

function hasNegativeGenre(values: Map<string, number>) {
  return [...values.values()].some((value) => value < 0);
}

function centroid(values: Map<string, number>, count: number) {
  if (count <= 0) return new Map<string, number>();
  return new Map([...values.entries()].map(([key, value]) => [key, value / count]));
}

function weightedJaccard(left: Map<string, number>, right: Map<string, number>) {
  const normalizedLeft = normalizeMass(left);
  const normalizedRight = normalizeMass(right);
  const keys = new Set([...normalizedLeft.keys(), ...normalizedRight.keys()]);
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    const leftWeight = normalizedLeft.get(key) ?? 0;
    const rightWeight = normalizedRight.get(key) ?? 0;
    intersection += Math.min(leftWeight, rightWeight);
    union += Math.max(leftWeight, rightWeight);
  }
  return union <= 0 ? 0 : intersection / union;
}

function normalizeMass(values: Map<string, number>) {
  const total = [...values.values()].reduce((sum, value) => sum + Math.max(0, value), 0);
  return total <= 0
    ? new Map<string, number>()
    : new Map([...values.entries()].map(([key, value]) => [key, Math.max(0, value) / total]));
}

function rankedRecord(values: Map<string, number>) {
  const entries = [...values.entries()]
    .filter(([, weight]) => weight > 0 && Number.isFinite(weight))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, weight]) => [label, roundWeight(weight)] as const);
  return Object.fromEntries(entries);
}

function roundWeight(value: number) {
  return Number(value.toFixed(8));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
