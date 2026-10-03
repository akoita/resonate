import { randomUUID } from "crypto";

export type PopularityWindow = "24h" | "7d" | "30d";
export type DiscoveryPopularitySourceMode = "local" | "warehouse";

export const POPULARITY_WINDOWS: Record<PopularityWindow, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

export const DISCOVERY_POPULARITY_CACHE_TTL_SECONDS = 120;
export const DISCOVERY_POPULARITY_CACHE_GENERATION_KEY =
  "discovery:popularity:generation";
const GENERATION_TOKEN_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export interface PopularityCacheGenerationStore {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export interface DiscoveryPopularityConfig {
  source: DiscoveryPopularitySourceMode;
  minimumAudience: number;
  refreshIntervalMs: number;
  snapshotMaxAgeMinutes: number;
  rowLimit: number;
  maximumBytesBilled: string;
  queryTimeoutMs: number;
  projectId: string;
  datasetId: string;
  apiBaseUrl: string;
  trackPopularityTable: string;
  artistEngagementTable: string;
  snapshotTable: string;
}

export interface PopularitySignal {
  kind: "play" | "save" | "purchase";
  occurredAt: Date;
  completionRatio?: number | null;
  purchaseId?: string | null;
}

export interface PopularitySignalContribution {
  plays: number;
  saves: number;
  purchases: number;
  score: number;
}

export const POPULARITY_SCORE_WEIGHTS = {
  save: 2,
  purchase: 5,
} as const;

export const DISCOVERY_PURCHASE_CONTRACT_BASES = [
  "contract",
  "performance_of_contract",
] as const;

export const DISCOVERY_SETTLED_PURCHASE_EVENT_NAMES = [
  "commerce.settled",
  "payment.settled",
  "x402.purchase",
  "agent.purchase_completed",
] as const;

export function discoveryPopularityConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DiscoveryPopularityConfig {
  const source = (env.DISCOVERY_POPULARITY_SOURCE ?? "local").trim().toLowerCase();
  if (source !== "local" && source !== "warehouse") {
    throw new Error("DISCOVERY_POPULARITY_SOURCE must be local or warehouse");
  }

  const analyticsProject =
    env.ANALYTICS_BIGQUERY_PROJECT_ID ||
    env.ANALYTICS_WAREHOUSE_PROJECT_ID ||
    env.GCP_PROJECT_ID ||
    "local";
  const analyticsDataset =
    env.ANALYTICS_BIGQUERY_DATASET ||
    env.ANALYTICS_WAREHOUSE_DATASET_PREFIX ||
    "analytics_local";

  const projectId = identifier(
    env.DISCOVERY_POPULARITY_BIGQUERY_PROJECT_ID || analyticsProject,
    "DISCOVERY_POPULARITY_BIGQUERY_PROJECT_ID",
  );
  if (source === "warehouse" && projectId === "local") {
    throw new Error("Warehouse popularity source requires a BigQuery project configuration");
  }

  return {
    source,
    minimumAudience: positiveInteger(env.DISCOVERY_MIN_AUDIENCE, 3),
    refreshIntervalMs: nonNegativeInteger(env.DISCOVERY_POPULARITY_REFRESH_MINUTES, 15) * 60_000,
    snapshotMaxAgeMinutes: positiveInteger(env.DISCOVERY_POPULARITY_SNAPSHOT_MAX_AGE_MINUTES, 120),
    rowLimit: positiveInteger(env.DISCOVERY_POPULARITY_EXPORT_ROW_LIMIT, 50_000),
    maximumBytesBilled: positiveInteger(
      env.DISCOVERY_POPULARITY_MAXIMUM_BYTES_BILLED ||
        env.ANALYTICS_BIGQUERY_MAXIMUM_BYTES_BILLED,
      100_000_000,
    ).toString(),
    queryTimeoutMs: positiveInteger(
      env.DISCOVERY_POPULARITY_QUERY_TIMEOUT_MS ||
        env.ANALYTICS_BIGQUERY_QUERY_TIMEOUT_MS,
      30_000,
    ),
    projectId,
    datasetId: identifier(
      env.DISCOVERY_POPULARITY_BIGQUERY_DATASET || analyticsDataset,
      "DISCOVERY_POPULARITY_BIGQUERY_DATASET",
    ),
    apiBaseUrl:
      env.DISCOVERY_POPULARITY_BIGQUERY_API_BASE_URL ||
      env.ANALYTICS_BIGQUERY_API_BASE_URL ||
      "https://bigquery.googleapis.com",
    trackPopularityTable: identifier(
      env.DISCOVERY_POPULARITY_TRACKS_TABLE || "track_popularity",
      "DISCOVERY_POPULARITY_TRACKS_TABLE",
    ),
    artistEngagementTable: identifier(
      env.DISCOVERY_POPULARITY_ARTISTS_TABLE || "artist_engagement",
      "DISCOVERY_POPULARITY_ARTISTS_TABLE",
    ),
    snapshotTable: identifier(
      env.DISCOVERY_POPULARITY_SNAPSHOT_TABLE || "discovery_popularity_snapshot",
      "DISCOVERY_POPULARITY_SNAPSHOT_TABLE",
    ),
  };
}

export function minimumAudienceFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return positiveInteger(env.DISCOVERY_MIN_AUDIENCE, 3);
}

export function linearPopularityDecay(
  occurredAt: Date,
  now: Date,
  window: PopularityWindow,
): number {
  const windowMs = POPULARITY_WINDOWS[window] * 3_600_000;
  const ageMs = Math.max(0, now.getTime() - occurredAt.getTime());
  return Math.max(0.1, 1 - ageMs / windowMs);
}

/**
 * Completion events alone count as plays: a start followed by completion is
 * one play, and a start with no completion is not a play. Purchase IDs are
 * deduplicated so mirrored settlement events cannot inflate purchase counts.
 */
export function scorePopularitySignals(
  signals: readonly PopularitySignal[],
  window: PopularityWindow,
  now: Date,
): PopularitySignalContribution {
  let plays = 0;
  let saves = 0;
  let purchases = 0;
  let score = 0;
  const seenPurchases = new Set<string>();

  for (const signal of signals) {
    const decay = linearPopularityDecay(signal.occurredAt, now, window);
    if (signal.kind === "play") {
      const ratio = finiteNumber(signal.completionRatio);
      if (ratio === null) continue;
      plays += 1;
      score += Math.min(1.5, Math.max(0, ratio)) * decay;
    } else if (signal.kind === "save") {
      saves += 1;
      score += POPULARITY_SCORE_WEIGHTS.save * decay;
    } else {
      const purchaseId = signal.purchaseId?.trim();
      if (!purchaseId || seenPurchases.has(purchaseId)) continue;
      seenPurchases.add(purchaseId);
      purchases += 1;
      score += POPULARITY_SCORE_WEIGHTS.purchase * decay;
    }
  }

  return { plays, saves, purchases, score };
}

export function audienceMeetsThreshold(
  actors: ReadonlySet<string>,
  minimumAudience: number,
) {
  return actors.size >= minimumAudience;
}

export function audienceActorId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const actor = value.trim();
  return /^user_[0-9a-f]{32}$/i.test(actor) ? actor : null;
}

export function eventHasTrustedPopularityMetadata(input: {
  eventName: string;
  privacyTier: string;
  actorId: unknown;
  consentBasis: string | null | undefined;
  payload: Record<string, unknown> | null;
}): boolean {
  if (!audienceActorId(input.actorId) || input.privacyTier !== "pseudonymous") {
    return false;
  }

  const isBrowserEngagement = [
    "playback.completed",
    "library.saved",
    "playlist.track_added",
  ].includes(input.eventName);
  const isSettledPurchase = (
    DISCOVERY_SETTLED_PURCHASE_EVENT_NAMES as readonly string[]
  ).includes(input.eventName);
  const basis = input.consentBasis?.trim();
  if (isBrowserEngagement && basis !== "consent") return false;
  if (
    isSettledPurchase &&
    !(DISCOVERY_PURCHASE_CONTRACT_BASES as readonly string[]).includes(basis ?? "")
  ) {
    return false;
  }
  if (!isBrowserEngagement && !isSettledPurchase) return false;

  if (input.payload?.selfEngagement !== false) return false;
  const aiDisclosureLevel = input.payload?.aiDisclosureLevel;
  if (
    typeof aiDisclosureLevel !== "string" ||
    !["NONE", "PARTLY", "UNDECLARED"].includes(aiDisclosureLevel.toUpperCase())
  ) {
    return false;
  }
  return true;
}

export async function popularityCacheGeneration(
  cache?: PopularityCacheGenerationStore,
): Promise<string> {
  return (
    (await cache?.getJson<string>(DISCOVERY_POPULARITY_CACHE_GENERATION_KEY)) ??
    "initial"
  );
}

export async function rotatePopularityCacheGeneration(
  cache?: PopularityCacheGenerationStore,
): Promise<string> {
  const generation = randomUUID();
  await cache?.setJson(
    DISCOVERY_POPULARITY_CACHE_GENERATION_KEY,
    generation,
    GENERATION_TOKEN_TTL_SECONDS,
  );
  return generation;
}

function positiveInteger(value: string | undefined, fallback: number) {
  return strictInteger(value, fallback, (parsed) => parsed > 0);
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  return strictInteger(value, fallback, (parsed) => parsed >= 0);
}

function strictInteger(
  value: string | undefined,
  fallback: number,
  isAllowed: (parsed: number) => boolean,
) {
  const candidate = value?.trim();
  if (!candidate) return fallback;
  if (!/^\d+$/.test(candidate)) {
    throw new Error(`Expected a whole-number configuration value, received ${candidate}`);
  }
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || !isAllowed(parsed)) {
    throw new Error(`Configuration value is outside its allowed range: ${candidate}`);
  }
  return parsed;
}

function identifier(value: string, name: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must be a BigQuery identifier`);
  }
  return value;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
