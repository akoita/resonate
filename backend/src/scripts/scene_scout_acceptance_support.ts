import { createHash } from "crypto";
import {
  normalizeAnalyticsGeoDimension,
  resolveAnalyticsEnvironment,
} from "../modules/analytics/analytics_event";
import {
  CRATE_STEM_TYPES,
  type CrateCandidateFacts,
  type CrateCoverage,
  type CrateFilters,
} from "../modules/crates/crate.types";
import { normalizeCamelotCode } from "../modules/crates/crate_camelot";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import { computeCoverage, failedFilters, isExcludedAsFullyAi } from "../modules/crates/crate_selection";
import { deriveCrateUnmetDemand } from "../modules/scene_scout/unmet_demand.derivation";
import {
  FIRST_LISTENER_MAX_RELEASE_PLACEMENTS,
  FIRST_LISTENER_PUBLIC_RIGHTS_ROUTES,
  FIRST_LISTENER_WINDOW_MS,
} from "../modules/recommendations/first_listener.contracts";
import { deriveCreatorVerificationStates } from "../modules/trust/verification-semantics";

export const SCENE_SCOUT_ACCEPTANCE_PHASES = [
  "preview",
  "seed",
  "verify",
  "withdraw-consent",
  "erase-listener",
  "unmet-demand",
  "access-check",
  "first-listener",
  "first-listener-reception",
  "cleanup",
] as const;
export type SceneScoutAcceptancePhase = (typeof SCENE_SCOUT_ACCEPTANCE_PHASES)[number];

/** Phases that write nothing: no --confirm or analytics salt is required (staging is still enforced). */
export const SCENE_SCOUT_ACCEPTANCE_READ_ONLY_PHASES: readonly SceneScoutAcceptancePhase[] = ["preview", "access-check"];

export const SCENE_SCOUT_ACCEPTANCE_PRODUCER ="scene_scout_acceptance";
export const SCENE_SCOUT_ACCEPTANCE_MAX_USERS = 50;
/**
 * Listener play/save pairs for the user maximum, one first-listener reception
 * play each, plus the erase-scenario markers.
 */
export const SCENE_SCOUT_ACCEPTANCE_MAX_EVENTS = 200;
/** Fixture listener (zero-based ordinal) whose consent the withdraw scenario withdraws. */
export const SCENE_SCOUT_ACCEPTANCE_WITHDRAW_ORDINAL = 0;
/** Fixture listener (zero-based ordinal) the erase scenario erases. */
export const SCENE_SCOUT_ACCEPTANCE_ERASE_ORDINAL = 1;
/** The only non-listening event the tool writes: it records an erased fixture account's new id. */
export const SCENE_SCOUT_ACCEPTANCE_MARKER_EVENT_NAME = "scene_scout_acceptance.fixture_marker";
export const SCENE_SCOUT_ACCEPTANCE_MARKER_KINDS = ["erasure_started", "erased_account"] as const;
/** The only phase that accepts `--ineligible-release-id`. */
export const SCENE_SCOUT_ACCEPTANCE_INELIGIBLE_RELEASE_PHASE: SceneScoutAcceptancePhase = "first-listener";
export type SceneScoutAcceptanceMarkerKind = (typeof SCENE_SCOUT_ACCEPTANCE_MARKER_KINDS)[number];

export class SceneScoutAcceptanceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneScoutAcceptanceInputError";
  }
}

function inputError(message: string): never {
  throw new SceneScoutAcceptanceInputError(message);
}

export interface SceneScoutAcceptanceInvocation {
  phase: SceneScoutAcceptancePhase;
  artistId: string;
  releaseId: string;
  /** Defaults to the catalog-owning artist; may identify a distinct credited Shows artist. */
  showArtistId: string;
  /** The `first` selector is stable for cleanup even if the catalog later changes. */
  trackId?: string;
  /**
   * `first-listener` only: an existing release the operator expects to be
   * ineligible. It is read and reservation is attempted, but it is never
   * changed and it does not take part in the fixture namespace.
   */
  ineligibleReleaseId?: string;
  runId: string;
  citySlug: string;
  countryCode: string;
  confirm: boolean;
}

const VALUE_FLAGS: ReadonlyMap<string, string> = new Map([
  ["--artist-id", "artistId"],
  ["--release-id", "releaseId"],
  ["--show-artist-id", "showArtistId"],
  ["--track-id", "trackId"],
  ["--ineligible-release-id", "ineligibleReleaseId"],
  ["--run-id", "runId"],
  ["--city-slug", "citySlug"],
  ["--country-code", "countryCode"],
] as const);
const REQUIRED_VALUE_FLAGS = [
  "--artist-id",
  "--release-id",
  "--run-id",
  "--city-slug",
  "--country-code",
] as const;

/** Parse `[phase] --artist-id … --release-id … --run-id … --city-slug … --country-code …`. */
export function parseSceneScoutAcceptanceArgs(args: string[]): SceneScoutAcceptanceInvocation {
  const seen = new Set<string>();
  const values: Record<string, string> = {};
  let phase: string | undefined;
  let confirm = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--confirm") {
      if (confirm) inputError("Duplicate flag --confirm");
      confirm = true;
      continue;
    }

    const valueKey = VALUE_FLAGS.get(token);
    if (valueKey) {
      if (seen.has(token)) inputError(`Duplicate flag ${token}`);
      seen.add(token);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) inputError(`${token} requires a value`);
      values[valueKey] = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) inputError(`Unknown flag ${token}`);
    if (phase !== undefined) inputError(`Unexpected extra argument ${token}`);
    phase = token;
  }

  const selectedPhase = phase ?? "preview";
  if (!(SCENE_SCOUT_ACCEPTANCE_PHASES as readonly string[]).includes(selectedPhase)) {
    inputError(`Unknown phase ${selectedPhase}`);
  }

  for (const flag of REQUIRED_VALUE_FLAGS) {
    const valueKey = VALUE_FLAGS.get(flag)!;
    if (!values[valueKey]) inputError(`Missing required flag ${flag}`);
  }

  const runId = values.runId;
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(runId)) {
    inputError("--run-id must start with a lowercase letter or digit and contain at most 24 lowercase letters, digits, or hyphens");
  }

  const artistId = values.artistId.trim();
  const releaseId = values.releaseId.trim();
  if (!artistId) inputError("--artist-id must not be empty");
  if (!releaseId) inputError("--release-id must not be empty");
  const showArtistId = values.showArtistId === undefined ? artistId : values.showArtistId.trim();
  const trackId = values.trackId === undefined ? undefined : values.trackId.trim();
  if (values.showArtistId !== undefined && !showArtistId) inputError("--show-artist-id must not be empty");
  if (values.trackId !== undefined && !trackId) inputError("--track-id must not be empty");
  const ineligibleReleaseId = values.ineligibleReleaseId === undefined ? undefined : values.ineligibleReleaseId.trim();
  if (values.ineligibleReleaseId !== undefined) {
    if (!ineligibleReleaseId) inputError("--ineligible-release-id must not be empty");
    if (selectedPhase !== SCENE_SCOUT_ACCEPTANCE_INELIGIBLE_RELEASE_PHASE) {
      inputError(`--ineligible-release-id is only valid for the ${SCENE_SCOUT_ACCEPTANCE_INELIGIBLE_RELEASE_PHASE} phase`);
    }
    if (ineligibleReleaseId === releaseId) {
      inputError("--ineligible-release-id must differ from --release-id");
    }
  }

  let city: ReturnType<typeof normalizeAnalyticsGeoDimension>;
  try {
    city = normalizeAnalyticsGeoDimension({
      citySlug: values.citySlug,
      countryCode: values.countryCode,
      source: "user_declared",
      precision: "city",
    });
  } catch {
    inputError("--city-slug and --country-code must form a valid city geo dimension");
  }
  if (!city?.citySlug) {
    inputError("--city-slug and --country-code must form a valid city geo dimension");
  }

  return {
    phase: selectedPhase as SceneScoutAcceptancePhase,
    artistId,
    releaseId,
    showArtistId,
    trackId,
    ...(ineligibleReleaseId === undefined ? {} : { ineligibleReleaseId }),
    runId,
    citySlug: city.citySlug,
    countryCode: city.countryCode,
    confirm,
  };
}

/** All deployment labels must explicitly identify staging; NODE_ENV is irrelevant. */
export function assertSceneScoutAcceptanceStagingEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  const keys = ["RESONATE_ENVIRONMENT_ID", "DEPLOY_ENV", "APP_ENV"] as const;
  const labels = keys.filter((key) => env[key] !== undefined);
  if (labels.length === 0) {
    inputError("Scene Scout acceptance fixtures require at least one staging environment label");
  }

  for (const key of labels) {
    const value = env[key] ?? "";
    const tokens = value.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (["prod", "production", "prd", "live", "local", "test", "testing", "integration", "dev", "development"]
      .some((token) => tokens.includes(token))) {
      inputError(`${key} identifies a non-staging environment; Scene Scout acceptance fixtures are staging-only`);
    }
    if (resolveAnalyticsEnvironment({ RESONATE_ENVIRONMENT_ID: value }) !== "staging") {
      inputError(`${key} must resolve to staging for Scene Scout acceptance fixtures`);
    }
  }
}

export function assertSceneScoutAcceptanceMutationRequirements(
  invocation: Pick<SceneScoutAcceptanceInvocation, "phase" | "confirm">,
  env: Record<string, string | undefined> = process.env,
) {
  if (SCENE_SCOUT_ACCEPTANCE_READ_ONLY_PHASES.includes(invocation.phase)) return;
  if (!invocation.confirm) {
    inputError(`Phase ${invocation.phase} requires --confirm`);
  }
  if (!env.ANALYTICS_ACTOR_ID_SALT?.trim()) {
    inputError("ANALYTICS_ACTOR_ID_SALT is required for mutating Scene Scout acceptance phases");
  }
}

/** Run id namespaces one operation; this digest additionally binds the target and city. */
export function sceneScoutAcceptancePrefix(
  invocation: Pick<SceneScoutAcceptanceInvocation, "artistId" | "releaseId" | "showArtistId" | "trackId" | "citySlug" | "countryCode" | "runId">,
) {
  const targetCityDigest = createHash("sha256")
    .update(JSON.stringify([
      invocation.artistId,
      invocation.releaseId,
      invocation.showArtistId,
      invocation.trackId ?? "first",
      invocation.citySlug,
      invocation.countryCode,
    ]))
    .digest("hex")
    .slice(0, 12);
  return `scaccept_${invocation.runId}_${targetCityDigest}_`;
}

export function sceneScoutAcceptanceUserId(prefix: string, ordinal: number) {
  return `${prefix}user_${String(ordinal).padStart(2, "0")}`;
}

/** `playback_started` is written only by the `first-listener-reception` phase. */
export type SceneScoutAcceptanceEventKind = "playback_completed" | "library_saved" | "playback_started";

export function sceneScoutAcceptanceEventId(prefix: string, ordinal: number, kind: SceneScoutAcceptanceEventKind) {
  return `${prefix}event_${String(ordinal).padStart(2, "0")}_${kind}`;
}

export function sceneScoutAcceptanceMarkerEventId(
  prefix: string,
  ordinal: number,
  kind: SceneScoutAcceptanceMarkerKind,
) {
  return `${prefix}marker_${String(ordinal).padStart(2, "0")}_${kind}`;
}

/** Deterministic request id for one fixture listener's synthetic crate request. */
export function sceneScoutAcceptanceCrateRequestId(prefix: string, ordinal: number) {
  return `${prefix}crate_request_${String(ordinal).padStart(2, "0")}`;
}

/** The categorical gap the `unmet-demand` phase will record for the selected track. */
export interface SceneScoutAcceptanceUnmetGap {
  kind: "stem" | "bpm" | "key" | "energy";
  /** A bounded enum, fixed numeric bin, Camelot code, or energy band; never an id or free text. */
  value: string;
  targetType: "track" | "artist";
  filters: CrateFilters;
  coverage: CrateCoverage;
}

export type SceneScoutAcceptanceUnmetGapPlan =
  | { gap: SceneScoutAcceptanceUnmetGap; blocked?: undefined }
  | { gap?: undefined; blocked: string };

/** Candidate 10-BPM ranges, tried in order; the first one excluding the track's tempo is used. */
const UNMET_GAP_BPM_RANGES = [
  { min: 180, max: 189 },
  { min: 80, max: 89 },
] as const;

/** Candidate energy ranges that derive the `low` and `high` bands. */
const UNMET_GAP_ENERGY_RANGES = [
  { min: 0, max: 0.4 },
  { min: 0.6, max: 1 },
] as const;

/** Half way round the Camelot wheel: never the same key and never a neighbour. */
function oppositeCamelotKey(camelot: string): string | null {
  const normalized = normalizeCamelotCode(camelot);
  const match = normalized ? /^(\d{1,2})([AB])$/.exec(normalized) : null;
  if (!match) return null;
  return `${((Number(match[1]) - 1 + 6) % 12) + 1}${match[2]}`;
}

/**
 * Chooses the categorical gap the selected track really has, from its real
 * facts, using only the pure crate filter and demand-derivation code the
 * product uses. A stem gap is preferred; a track with every stem type falls
 * back to a BPM, then key, then energy gap. A candidate is used only when the
 * track fails exactly that one filter, a coverage gap is reported for it, and
 * the derivation yields a draft of that kind for this track, so the recorded
 * observation is the one the product would record.
 */
export function planSceneScoutAcceptanceUnmetGap(facts: CrateCandidateFacts): SceneScoutAcceptanceUnmetGapPlan {
  const base = defaultCrateFilters();
  if (isExcludedAsFullyAi(facts, base)) {
    return { blocked: "The selected track is fully AI-generated and crate requests exclude such tracks by default; choose another track." };
  }

  const attempts: Array<{ kind: SceneScoutAcceptanceUnmetGap["kind"]; filters: CrateFilters }> = [];
  const missingStem = CRATE_STEM_TYPES.find((stem) => !facts.stemTypes.includes(stem));
  if (missingStem) attempts.push({ kind: "stem", filters: { ...base, requiredStems: [missingStem] } });
  if (facts.tempoBpm !== null) {
    for (const range of UNMET_GAP_BPM_RANGES) attempts.push({ kind: "bpm", filters: { ...base, bpm: { ...range } } });
  }
  const oppositeKey = facts.camelot === null ? null : oppositeCamelotKey(facts.camelot);
  if (oppositeKey) attempts.push({ kind: "key", filters: { ...base, keys: [oppositeKey] } });
  if (facts.energy !== null) {
    for (const range of UNMET_GAP_ENERGY_RANGES) attempts.push({ kind: "energy", filters: { ...base, energy: { ...range } } });
  }

  for (const { kind, filters } of attempts) {
    const failed = failedFilters(facts, filters);
    if (failed.length !== 1) continue;
    const coverage = computeCoverage([facts], 0, filters);
    if (!coverage.gaps.some((gap) => gap.filter === failed[0])) continue;
    const drafts = deriveCrateUnmetDemand({ filters, considered: [facts], coverage }).candidates
      .filter((draft) => draft.kind === kind && draft.candidateTrackId === facts.trackId);
    if (drafts.length !== 1) continue;
    return { gap: { kind, value: drafts[0].value, targetType: drafts[0].targetType, filters, coverage } };
  }
  return {
    blocked: missingStem === undefined
      ? "The selected track already has every crate stem type and no measured tempo, key, or energy to build a categorical gap from; choose another track."
      : "No categorical gap could be derived for the selected track; choose another track.",
  };
}

/**
 * Categorical reasons a release (or one selected track of it) cannot receive a
 * first-listener placement, mirroring `FirstListenerDiscoveryService` with the
 * default listener preference (explicit tracks excluded). Never an id or text.
 */
export const FIRST_LISTENER_INELIGIBILITY_REASONS = [
  "stale",
  "future_created",
  "not_public",
  "withdrawn",
  "rights_route",
  "future_release_date",
  "no_playable_track",
  "ai_disclosure_all",
  "explicit_track",
  "artist_without_user",
  "not_human_verified",
  "placement_cap_reached",
] as const;
export type FirstListenerIneligibilityReason = (typeof FIRST_LISTENER_INELIGIBILITY_REASONS)[number];

/** Reasons the fresh-candidate source itself enforces; the others are enforced by shared policy or reservation. */
export const FIRST_LISTENER_CANDIDATE_SOURCE_REASONS: readonly FirstListenerIneligibilityReason[] = [
  "stale",
  "future_created",
  "not_public",
  "withdrawn",
  "rights_route",
  "future_release_date",
  "no_playable_track",
  "ai_disclosure_all",
  "explicit_track",
];

/** Reasons enforced by the shared verified-human discovery policy (and again at reservation). */
export const FIRST_LISTENER_VERIFICATION_REASONS: readonly FirstListenerIneligibilityReason[] = [
  "artist_without_user",
  "not_human_verified",
];

/** Mirrors the discovery service's public release statuses. */
const FIRST_LISTENER_PUBLIC_RELEASE_STATUSES = ["ready", "published"];

export interface FirstListenerEligibilityFacts {
  now: Date;
  release: {
    createdAt: Date;
    status: string;
    withdrawnAt: Date | null;
    rightsRoute: string | null;
    releaseDate: Date | null;
  };
  /** The selected target track only, or every (bounded) track of the release. */
  tracks: Array<{
    processingStatus: string;
    contentStatus: string;
    aiDisclosureLevel: string;
    rightsRoute: string | null;
    explicit: boolean;
  }>;
  artistUserId: string | null;
  humanVerificationStatus?: string | null;
  humanVerifiedAt?: Date | null;
  /** max(Release.firstListenerPlacementsUsed, exposure rows), as the reservation computes it. */
  placementsUsed: number;
  /** Placements this run needs; the cap must leave room for all of them. */
  placementsNeeded: number;
}

function permittedRightsRoute(route: string | null) {
  return route === null || (FIRST_LISTENER_PUBLIC_RIGHTS_ROUTES as readonly string[]).includes(route);
}

export function firstListenerIneligibilityReasons(facts: FirstListenerEligibilityFacts): FirstListenerIneligibilityReason[] {
  const reasons: FirstListenerIneligibilityReason[] = [];
  const now = facts.now.getTime();
  const { release } = facts;
  if (release.createdAt.getTime() < now - FIRST_LISTENER_WINDOW_MS) reasons.push("stale");
  if (release.createdAt.getTime() > now) reasons.push("future_created");
  if (!FIRST_LISTENER_PUBLIC_RELEASE_STATUSES.includes(release.status)) reasons.push("not_public");
  if (release.withdrawnAt !== null) reasons.push("withdrawn");
  if (!permittedRightsRoute(release.rightsRoute)) reasons.push("rights_route");
  if (release.releaseDate !== null && release.releaseDate.getTime() > now) reasons.push("future_release_date");

  const tracks = facts.tracks;
  const playable = tracks.filter((track) =>
    track.processingStatus === "complete" &&
    track.contentStatus === "clean" &&
    track.aiDisclosureLevel !== "ALL" &&
    permittedRightsRoute(track.rightsRoute),
  );
  if (tracks.length > 0 && tracks.every((track) => track.aiDisclosureLevel === "ALL")) {
    reasons.push("ai_disclosure_all");
  } else if (playable.length === 0) {
    reasons.push("no_playable_track");
  } else if (playable.every((track) => track.explicit)) {
    reasons.push("explicit_track");
  }

  if (!facts.artistUserId) {
    reasons.push("artist_without_user");
  } else if (deriveCreatorVerificationStates({
    humanVerificationStatus: facts.humanVerificationStatus,
    humanVerifiedAt: facts.humanVerifiedAt,
  }).humanVerificationStatus !== "human_verified") {
    reasons.push("not_human_verified");
  }

  if (facts.placementsUsed + facts.placementsNeeded > FIRST_LISTENER_MAX_RELEASE_PLACEMENTS) {
    reasons.push("placement_cap_reached");
  }
  return reasons;
}
