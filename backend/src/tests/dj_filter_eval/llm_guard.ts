/**
 * AI DJ filter-adherence eval, stage C: the LLM curation path's guard
 * (docs/engineering/ai-dj-filter-adherence-evals.md, issue #2454).
 *
 * In production with a model key configured the default runtime is an LLM
 * (`AGENT_RUNTIME=adk`). Its picks pass through
 * `AgentRuntimePolicyService.apply`, which tiers each pick with `requestTierOf`,
 * drops tier C unless `fillSimilar` is set, and tops the batch up from the
 * deterministic `AgentSelectorService`. A real model cannot be replayed offline,
 * so this stage feeds SIMULATED model replies through the REAL guard and grades
 * what comes out with the same independent grader as stages A and B.
 *
 * Measurement only: nothing here changes production code.
 *
 * Collaborators of the guard (see {@link buildEvalPolicyService}):
 *  - `ranking`        the real `DiscoveryRankingService`;
 *  - `policyContext`  an in-memory twin of `DiscoveryPolicyContextService` over the
 *                     eval catalog's OBSERVED layer; `loadTrackCandidates` returns
 *                     rows in the shape the real one returns;
 *  - `selector`       the stage-B golden selector (top-up and discovery swap);
 *  - `audioFeatures`  the stage-B `FixtureAudioFeatureService`;
 *  - left UNDEFINED:  tasteMemory (no hidden taste, no impressions consent),
 *                     learning (the caller's `learnedGenreWeights` stand in, as in
 *                     stage B), recommendations (a request-first session does not
 *                     read Home impressions anyway), cohorts and
 *                     firstListenerDiscovery (no placement reservations).
 *
 * Tests only; not shipped code. Docker-free.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { AgentRuntimePolicyService } from "../../modules/agents/agent_runtime.policy.service";
import {
  effectiveEnergyBand,
  requestScopeFor,
  requestTierOf,
  withoutSeedEvidence,
  type RequestTier,
} from "../../modules/agents/agent_session_request";
import type { AgentRuntimeInput, AgentRuntimeResult, LlmTrackPick } from "../../modules/agents/runtime/agent_runtime.adapter";
import { discoveryArtistKey } from "../../modules/recommendations/discovery-policy";
import { DiscoveryRankingService, type DiscoveryCandidate } from "../../modules/recommendations/discovery-ranking.service";
import { resolveCreditedArtistName, resolveCreditedArtistNames } from "../../modules/shared/artist_attribution";
import { FixtureAudioFeatureService, goldenDescriptor, goldenPolicyContext, InMemoryGoldenTools } from "../dj_retrieval_golden/harness";
import type { GoldenTrack } from "../dj_retrieval_golden/fixtures";
import { EVAL_CATALOG, OBSERVED_CATALOG, truthByKey, type EvalFamily, type Moment } from "./catalog";
import { EVAL_CASES, profileFor, type EvalCase, type ListenerProfile } from "./cases";
import { familiesForGenreName, gradePick, type Intent, type Verdict } from "./grader";
import { BATCH_SIZE, evalSelector, listenerPreferences } from "./harness";

export const LLM_GUARD_REPORT_SCHEMA_VERSION = "dj-llm-guard/v1";
export const LLM_GUARD_BASELINE_SCHEMA_VERSION = "dj-llm-guard-baseline/v1";

export type ModelStrategy = "adversarial" | "taste" | "faithful";
export type GuardMode = "normal" | "failOpenLookup" | "failOpenNoRanking";
export const STRATEGIES: readonly ModelStrategy[] = ["adversarial", "taste", "faithful"];
export const MODES: readonly GuardMode[] = ["normal", "failOpenLookup", "failOpenNoRanking"];

/** The (strategy, mode) pairs every case runs: all strategies in normal mode, the adversarial model in the fail-open modes. */
export const RUN_MATRIX: ReadonlyArray<{ strategy: ModelStrategy; mode: GuardMode }> = [
  ...STRATEGIES.map((strategy) => ({ strategy, mode: "normal" as const })),
  { strategy: "adversarial", mode: "failOpenLookup" },
  { strategy: "adversarial", mode: "failOpenNoRanking" },
];

// ---------------------------------------------------------------------------
// The eval policy context: DiscoveryPolicyContextService over the observed catalog
// ---------------------------------------------------------------------------

const UPLOADER_ID = "uploader";
const observedByKey: ReadonlyMap<string, GoldenTrack> = new Map(OBSERVED_CATALOG.map((track) => [track.key, track]));

/**
 * One ranking candidate, in the shape `DiscoveryPolicyContextService.loadTrackCandidates`
 * returns for a stored track: id, title, credited artist, artist id (the one
 * uploading profile of the fixture), AI disclosure, the stored descriptor's
 * families and energy band, and the release's genre, title and moods, the
 * display name by the established credit order and, for a request-first
 * session (`performerCap`), the credited performer alone (#2316).
 */
export function candidateRow(track: GoldenTrack, performerCap: boolean): DiscoveryCandidate {
  const trackArtist = track.uncredited ? null : track.artist;
  const descriptor = goldenDescriptor(track);
  const credited = resolveCreditedArtistNames({ trackArtist, primaryArtist: trackArtist });
  return {
    id: track.key,
    title: track.title,
    artist: trackArtist,
    artistId: UPLOADER_ID,
    aiDisclosureLevel: "UNDECLARED",
    descriptorFamilies: descriptor.families,
    descriptorEnergyBand: descriptor.energyBand ?? null,
    release: {
      genre: track.genre,
      title: track.releaseTitle ?? track.title,
      moods: track.moods ?? [],
      artistDisplayName: resolveCreditedArtistName({
        trackArtist,
        primaryArtist: trackArtist,
        accountDisplayName: "Fixture uploader",
      }),
      ...(performerCap ? { creditedArtistName: credited[0] ?? null } : {}),
    },
  } as DiscoveryCandidate;
}

/** The policy context's lookups, over the observed catalog. `lookupFails` makes the candidate lookup throw. */
export function evalPolicyContext(options: { lookupFails?: boolean } = {}) {
  const loadTrackCandidates = async (trackIds: string[], lookup: { performerCap?: boolean } = {}) => {
    if (options.lookupFails) throw new Error("eval: candidate lookup unavailable");
    const rows = new Map<string, DiscoveryCandidate>();
    for (const id of new Set(trackIds.filter(Boolean))) {
      const track = observedByKey.get(id);
      // Unknown ids are simply absent, as in production.
      if (track) rows.set(id, candidateRow(track, Boolean(lookup.performerCap)));
    }
    return rows;
  };
  return {
    // Verified-human artists, no played artists, no prior discovery picks, no play history: as stage B.
    ...goldenPolicyContext({ verifiedArtistIds: [UPLOADER_ID] }),
    loadTrackCandidates,
    artistKeysForTracks: async (trackIds: string[], performerCap = false) => {
      const rows = await loadTrackCandidates(trackIds, { performerCap });
      return new Map([...rows].map(([id, row]) => [id, discoveryArtistKey(row)]));
    },
  };
}

const audioFeatures = new FixtureAudioFeatureService(new InMemoryGoldenTools(OBSERVED_CATALOG).tracksById);

/**
 * The real guard over the eval collaborators. `ranking: false` builds the
 * fail-open variant with no ranking core; `lookupFails` the one whose candidate
 * lookup throws. Both make `apply` pass the model's picks through.
 */
export function buildEvalPolicyService(options: { ranking?: boolean; lookupFails?: boolean } = {}): AgentRuntimePolicyService {
  return new AgentRuntimePolicyService(
    options.ranking === false ? undefined : new DiscoveryRankingService(),
    evalPolicyContext({ lookupFails: options.lookupFails }) as never,
    undefined, // tasteMemory
    undefined, // learning
    undefined, // recommendations
    undefined, // cohorts
    evalSelector(),
    undefined, // firstListenerDiscovery
    audioFeatures,
  );
}

const services: Record<GuardMode, AgentRuntimePolicyService> = {
  normal: buildEvalPolicyService(),
  failOpenLookup: buildEvalPolicyService({ lookupFails: true }),
  failOpenNoRanking: buildEvalPolicyService({ ranking: false }),
};

// ---------------------------------------------------------------------------
// Simulated model replies
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<Verdict, number> = { contradiction: 0, partial: 1, on: 2 };

const gradeKey = (intent: Intent, key: string) => {
  const truth = truthByKey.get(key);
  if (!truth) throw new Error(`Track ${key} is not in the eval catalog`);
  return gradePick(intent, truth);
};

/** The families the listener's saved and learned taste names, favourites first. */
function tasteFamilies(profile: ListenerProfile): EvalFamily[] {
  const names = [...profile.favoredGenres, ...profile.vibes];
  return [...new Set(names.flatMap((name) => familiesForGenreName(name)))];
}

/** Round-robin over the families, catalog order within each (newest first). */
function interleaveFamilies(families: readonly EvalFamily[]): string[] {
  const queues = families.map((family) =>
    EVAL_CATALOG.filter((track) => track.truth.family === family).map((track) => track.observed.key),
  );
  const out: string[] = [];
  for (let index = 0; out.length < BATCH_SIZE && queues.some((queue) => index < queue.length); index += 1) {
    for (const queue of queues) {
      if (index < queue.length && out.length < BATCH_SIZE) out.push(queue[index]);
    }
  }
  return out;
}

/**
 * Track ids a simulated model names, 12 of them, chosen from the WHOLE eval
 * catalog (a model can name any id; it is not limited to what the request
 * allows). Deterministic: ties break by catalog order.
 *
 *  - adversarial: the worst tracks first. Contradictions of the intent (explicit
 *    settings included), then partials, then on-request tracks.
 *  - taste: the listener's saved and learned taste, ignoring the request (the
 *    "Zen played rap" failure mode). Genre names map to families by the grader's
 *    table, interleaved. A listener whose taste names no genre (the fresh
 *    default vibes are moments) gets the tracks that fit those vibes.
 *  - faithful: on-request tracks only, up to 12. The control for over-blocking.
 */
export function modelPicksFor(evalCase: EvalCase, strategy: ModelStrategy): string[] {
  const catalogKeys = EVAL_CATALOG.map((track) => track.observed.key);
  switch (strategy) {
    case "adversarial": {
      const graded = catalogKeys.map((key, index) => ({ key, index, rank: VERDICT_RANK[gradeKey(evalCase.intent, key).verdict] }));
      return graded.sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, BATCH_SIZE).map((entry) => entry.key);
    }
    case "taste": {
      const profile = profileFor(evalCase);
      const families = tasteFamilies(profile);
      if (families.length > 0) return interleaveFamilies(families);
      const vibes = new Set(profile.vibes.map((vibe) => vibe.trim().toLowerCase()));
      const fitting = EVAL_CATALOG.filter((track) => track.truth.fits.some((moment: Moment) => vibes.has(moment.toLowerCase())));
      return (fitting.length > 0 ? fitting : EVAL_CATALOG).slice(0, BATCH_SIZE).map((track) => track.observed.key);
    }
    case "faithful":
      return catalogKeys.filter((key) => gradeKey(evalCase.intent, key).verdict === "on").slice(0, BATCH_SIZE);
  }
}

/** A model reply as the runtime adapters return it (adk_adapter.ts): approved, the first pick mirrored, every pick personal and free. */
export function modelReply(trackIds: readonly string[]): AgentRuntimeResult {
  const picks: LlmTrackPick[] = trackIds.map((trackId) => ({ trackId, licenseType: "personal", priceUsd: 0 }));
  return {
    status: "approved",
    trackId: picks[0]?.trackId,
    licenseType: picks[0]?.licenseType,
    priceUsd: picks[0]?.priceUsd,
    reason: "adk_llm",
    reasoning: "simulated model reply",
    latencyMs: 0,
    picks,
  };
}

// ---------------------------------------------------------------------------
// Running the guard
// ---------------------------------------------------------------------------

const SESSION_ID = "eval-llm-session";
const USER_ID = "eval-listener";

/** What the request reduces to for a model pick the guard can verify (`withoutSeedEvidence`). */
export type GuardScope = "none" | "gated" | "softGated" | "seedOnly" | "sentenceOnly";

export interface GuardInput {
  input: AgentRuntimeInput;
  scope: GuardScope;
}

/** The runtime input of a case's first batch (session start), with the case's listener. */
export async function guardInputFor(evalCase: EvalCase, overrides: Partial<AgentRuntimeInput["preferences"]> = {}): Promise<GuardInput> {
  const preferences = {
    ...(await listenerPreferences(evalCase.request, profileFor(evalCase), "start")),
    ...overrides,
  } as AgentRuntimeInput["preferences"];
  const scope = requestScopeFor(preferences);
  const verifiable = scope ? withoutSeedEvidence(scope) : undefined;
  const kind: GuardScope = !scope
    ? "none"
    : verifiable?.gated
      ? "gated"
      : verifiable?.softGated
        ? "softGated"
        : scope.seeded
          ? "seedOnly"
          : "sentenceOnly";
  return {
    input: { sessionId: SESSION_ID, userId: USER_ID, recentTrackIds: [], budgetRemainingUsd: 5, preferences },
    scope: kind,
  };
}

/** Runs the real guard on a model reply. */
export async function applyGuard(input: AgentRuntimeInput, trackIds: readonly string[], mode: GuardMode): Promise<AgentRuntimeResult> {
  return services[mode].apply(input, modelReply(trackIds));
}

export interface SurvivingPick {
  case: string;
  strategy: ModelStrategy;
  mode: GuardMode;
  guardScope: GuardScope;
  key: string;
  observedGenre: string | null;
  truth: { artist: string; family: string; energy: string; bpm: number };
  /** Which single filters the pick contradicts. */
  kinds: string[];
  /** The tier the guard's own predicate gives the pick (mirror of the policy step; "n/a" without a request). */
  tier: RequestTier | "n/a";
  /** `requestMatch` on the final pick; absent when the guard did not set it. */
  requestMatch: boolean | null;
  reasons: string[];
}

export interface FinalPick {
  key: string;
  source: "model" | "topup";
  verdict: Verdict;
  requestMatch: boolean | null;
}

export interface GuardRunResult {
  id: string;
  group: EvalCase["group"];
  profile: EvalCase["profile"];
  strategy: ModelStrategy;
  mode: GuardMode;
  guardScope: GuardScope;
  modelPicks: number;
  modelContradictions: number;
  survivingModelContradictions: number;
  /** Model picks graded on-request that are absent from the output (over-blocking). */
  wronglyDropped: number;
  /** Of those, the ones the request guard (tier C) dropped; the rest were lost to the artist cap or the discovery swap. */
  wronglyDroppedByGuard: number;
  policy: { offRequest: number; diversity: number; unknown: number; toppedUp: number };
  final: { count: number; onRequest: number | null; contradictions: number; silentLeaks: number };
  finalPicks: FinalPick[];
  survivors: SurvivingPick[];
}

/** Which single filters of the intent a track contradicts. */
function contradictionKinds(intent: Intent, key: string): string[] {
  const truth = truthByKey.get(key)!;
  const open: Intent = { explicitAllowed: true };
  const single: Array<[string, Intent]> = [
    ["genre", { ...open, families: intent.families }],
    ["moment", { ...open, moment: intent.moment }],
    ["energy", { ...open, energy: intent.energy }],
    ["tempo", { ...open, bpm: intent.bpm }],
    ["artist", { ...open, artist: intent.artist }],
    ["explicit", { explicitAllowed: intent.explicitAllowed }],
  ];
  return single.filter(([, filter]) => gradePick(filter, truth).verdict === "contradiction").map(([name]) => name);
}

/** The tier the policy step gives a pick, from the same inputs it reads (mirror; used to explain survivors). */
async function tierOfPick(input: AgentRuntimeInput, key: string): Promise<RequestTier | "n/a"> {
  const scope = requestScopeFor(input.preferences);
  const track = observedByKey.get(key);
  if (!scope || !track) return "n/a";
  const candidate = candidateRow(track, true);
  const result = await audioFeatures.getOrCreate(key);
  const features = result.status === "ok" ? result.features : undefined;
  return requestTierOf(withoutSeedEvidence(scope), {
    genre: candidate.release?.genre ?? null,
    descriptorFamilies: candidate.descriptorFamilies ?? [],
    moods: candidate.release?.moods ?? [],
    energyBand: effectiveEnergyBand(features, candidate.descriptorEnergyBand),
    tempoBpm: features?.tempoBpm,
    tempoMeasured: features?.featureSources?.tempo === "measured",
  });
}

/** Runs one case with one simulated model in one guard mode, batch 1 only, default retrieval. */
export async function runGuardCase(evalCase: EvalCase, strategy: ModelStrategy, mode: GuardMode): Promise<GuardRunResult> {
  const { input, scope } = await guardInputFor(evalCase);
  const modelKeys = modelPicksFor(evalCase, strategy);
  const modelSet = new Set(modelKeys);
  const result = await applyGuard(input, modelKeys, mode);
  const outPicks = result.picks ?? [];
  const outKeys = outPicks.map((pick) => pick.trackId);
  const outSet = new Set(outKeys);

  const modelGrades = modelKeys.map((key) => ({ key, grade: gradeKey(evalCase.intent, key) }));
  const modelContradictions = modelGrades.filter((entry) => entry.grade.verdict === "contradiction");
  const droppedOnRequest = modelGrades.filter((entry) => entry.grade.verdict === "on" && !outSet.has(entry.key));

  // Which of the over-blocked picks the request guard itself dropped: run again allowing similar
  // sounds; a pick that comes back was held by tier C, one that does not was lost to the cap or the swap.
  let wronglyDroppedByGuard = 0;
  if (mode === "normal" && droppedOnRequest.length > 0 && scope !== "none") {
    const relaxed = await applyGuard({ ...input, preferences: { ...input.preferences, fillSimilar: true } }, modelKeys, mode);
    const relaxedKeys = new Set((relaxed.picks ?? []).map((pick) => pick.trackId));
    wronglyDroppedByGuard = droppedOnRequest.filter((entry) => relaxedKeys.has(entry.key)).length;
  }

  const finalPicks: FinalPick[] = outPicks.map((pick) => ({
    key: pick.trackId,
    source: modelSet.has(pick.trackId) ? "model" : "topup",
    verdict: gradeKey(evalCase.intent, pick.trackId).verdict,
    requestMatch: pick.requestMatch ?? null,
  }));
  const survivorKeys = modelContradictions.filter((entry) => outSet.has(entry.key)).map((entry) => entry.key);
  const survivors: SurvivingPick[] = [];
  for (const key of survivorKeys) {
    const final = finalPicks.find((pick) => pick.key === key)!;
    survivors.push({
      case: evalCase.id,
      strategy,
      mode,
      guardScope: scope,
      key,
      observedGenre: observedByKey.get(key)?.genre ?? null,
      truth: (({ artist, family, energy, bpm }) => ({ artist, family, energy, bpm }))(truthByKey.get(key)!),
      kinds: contradictionKinds(evalCase.intent, key),
      tier: mode === "normal" ? await tierOfPick(input, key) : "n/a",
      requestMatch: final.requestMatch,
      reasons: gradeKey(evalCase.intent, key).reasons,
    });
  }

  const on = finalPicks.filter((pick) => pick.verdict === "on").length;
  const dropped = result.policy?.dropped;
  return {
    id: evalCase.id,
    group: evalCase.group,
    profile: evalCase.profile,
    strategy,
    mode,
    guardScope: scope,
    modelPicks: modelKeys.length,
    modelContradictions: modelContradictions.length,
    survivingModelContradictions: survivors.length,
    wronglyDropped: droppedOnRequest.length,
    wronglyDroppedByGuard,
    policy: {
      offRequest: dropped?.offRequest ?? 0,
      diversity: dropped?.diversity ?? 0,
      unknown: dropped?.unknown ?? 0,
      toppedUp: result.policy?.toppedUp ?? 0,
    },
    final: {
      count: finalPicks.length,
      onRequest: finalPicks.length > 0 ? on / finalPicks.length : null,
      contradictions: finalPicks.filter((pick) => pick.verdict === "contradiction").length,
      // Not on-request and shown without the "Outside your request" mark (requestMatch false).
      silentLeaks: finalPicks.filter((pick) => pick.verdict !== "on" && pick.requestMatch !== false).length,
    },
    finalPicks,
    survivors,
  };
}

/** Runs every case through the whole {@link RUN_MATRIX}. */
export async function runAllGuardCases(cases: readonly EvalCase[] = EVAL_CASES): Promise<GuardRunResult[]> {
  const results: GuardRunResult[] = [];
  for (const evalCase of cases) {
    for (const { strategy, mode } of RUN_MATRIX) results.push(await runGuardCase(evalCase, strategy, mode));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface GuardAggregate {
  runs: number;
  modelPicks: number;
  modelContradictions: number;
  survivingModelContradictions: number;
  wronglyDropped: number;
  wronglyDroppedByGuard: number;
  finalCount: number;
  finalOnRequest: number;
  /** On-request share of the final picks. */
  onRequestShare: number | null;
  finalContradictions: number;
  finalSilentLeaks: number;
}

function aggregate(runs: readonly GuardRunResult[]): GuardAggregate {
  const sum = (pick: (run: GuardRunResult) => number) => runs.reduce((total, run) => total + pick(run), 0);
  const finalCount = sum((run) => run.final.count);
  const finalOnRequest = sum((run) => run.finalPicks.filter((pick) => pick.verdict === "on").length);
  return {
    runs: runs.length,
    modelPicks: sum((run) => run.modelPicks),
    modelContradictions: sum((run) => run.modelContradictions),
    survivingModelContradictions: sum((run) => run.survivingModelContradictions),
    wronglyDropped: sum((run) => run.wronglyDropped),
    wronglyDroppedByGuard: sum((run) => run.wronglyDroppedByGuard),
    finalCount,
    finalOnRequest,
    onRequestShare: finalCount > 0 ? finalOnRequest / finalCount : null,
    finalContradictions: sum((run) => run.final.contradictions),
    finalSilentLeaks: sum((run) => run.final.silentLeaks),
  };
}

function groupBy(runs: readonly GuardRunResult[], keyOf: (run: GuardRunResult) => string): Record<string, GuardAggregate> {
  const keys = [...new Set(runs.map(keyOf))];
  return Object.fromEntries(keys.map((key) => [key, aggregate(runs.filter((run) => keyOf(run) === key))]));
}

export interface SurvivalCause {
  mode: GuardMode;
  guardScope: GuardScope;
  tier: string;
  kinds: string;
  count: number;
  example: { case: string; strategy: ModelStrategy; key: string; observedGenre: string | null; reasons: string[] };
}

/** Distinct ways a contradicting model pick survived, by (mode, guard scope, tier, contradicted filters). */
export function survivalCauses(results: readonly GuardRunResult[]): SurvivalCause[] {
  const causes = new Map<string, SurvivalCause>();
  for (const survivor of results.flatMap((run) => run.survivors)) {
    const kinds = survivor.kinds.join("+") || "n/a";
    const id = [survivor.mode, survivor.guardScope, survivor.tier, kinds].join("|");
    const existing = causes.get(id);
    if (existing) existing.count += 1;
    else {
      causes.set(id, {
        mode: survivor.mode,
        guardScope: survivor.guardScope,
        tier: survivor.tier,
        kinds,
        count: 1,
        example: {
          case: survivor.case,
          strategy: survivor.strategy,
          key: survivor.key,
          observedGenre: survivor.observedGenre,
          reasons: survivor.reasons,
        },
      });
    }
  }
  return [...causes.values()].sort((a, b) => b.count - a.count || `${a.mode}${a.guardScope}`.localeCompare(`${b.mode}${b.guardScope}`));
}

export interface GuardReport {
  schemaVersion: typeof LLM_GUARD_REPORT_SCHEMA_VERSION;
  note: string;
  batchSize: number;
  summary: {
    cases: number;
    runs: number;
    byStrategyAndMode: Record<string, GuardAggregate>;
    /** Adversarial model, normal mode. */
    byGroup: Record<string, GuardAggregate>;
    byGuardScope: Record<string, GuardAggregate>;
    /** Normal mode, by strategy and listener profile. */
    byProfile: Record<string, GuardAggregate>;
    survivalCauses: SurvivalCause[];
  };
  worstSurvivors: SurvivingPick[];
  results: GuardRunResult[];
}

const WORST_COUNT = 10;

/** Survivors ranked normal-mode first (the guard working), then by how many filters they contradict. */
export function worstSurvivors(results: readonly GuardRunResult[], count = WORST_COUNT): SurvivingPick[] {
  return results
    .flatMap((run) => run.survivors)
    .sort(
      (a, b) =>
        Number(b.mode === "normal") - Number(a.mode === "normal") ||
        b.kinds.length - a.kinds.length ||
        a.case.localeCompare(b.case) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, count);
}

export function buildGuardReport(results: GuardRunResult[]): GuardReport {
  const normal = results.filter((run) => run.mode === "normal");
  return {
    schemaVersion: LLM_GUARD_REPORT_SCHEMA_VERSION,
    note:
      "Simulated model replies (12 picks from the whole eval catalog) through the real AgentRuntimePolicyService.apply, over an in-memory policy context " +
      "and the stage-B golden selector for the top-up, graded by the independent grader. Batch 1, default retrieval. " +
      "wronglyDropped counts model picks graded on-request that are absent from the output (the guard's tier-C drop, the artist cap or the discovery swap). " +
      "The baseline is what the guard does today, not a goal.",
    batchSize: BATCH_SIZE,
    summary: {
      cases: new Set(results.map((run) => run.id)).size,
      runs: results.length,
      byStrategyAndMode: groupBy(results, (run) => `${run.strategy} / ${run.mode}`),
      byGroup: groupBy(normal.filter((run) => run.strategy === "adversarial"), (run) => run.group),
      byGuardScope: groupBy(normal.filter((run) => run.strategy === "adversarial"), (run) => run.guardScope),
      byProfile: groupBy(normal, (run) => `${run.strategy} / ${run.profile}`),
      survivalCauses: survivalCauses(results),
    },
    worstSurvivors: worstSurvivors(results),
    results,
  };
}

const pct = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);

function aggregateTable(title: string, rows: Record<string, GuardAggregate>): string[] {
  return [
    `### ${title}`,
    "",
    "| | Runs | Model contradictions | Surviving | Wrongly dropped (by guard) | Final picks | On-request | Final contradictions | Final silent leaks |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(rows).map(
      ([name, row]) =>
        `| ${name} | ${row.runs} | ${row.modelContradictions} | ${row.survivingModelContradictions} | ${row.wronglyDropped} (${row.wronglyDroppedByGuard}) | ${row.finalCount} | ${pct(row.onRequestShare)} | ${row.finalContradictions} | ${row.finalSilentLeaks} |`,
    ),
    "",
  ];
}

export function guardReportMarkdown(report: GuardReport): string {
  const { summary } = report;
  return [
    "# AI DJ LLM-path guard report (stage C)",
    "",
    `${summary.cases} cases, ${summary.runs} runs (case x model strategy x guard mode). Batch of ${report.batchSize}.`,
    "",
    ...aggregateTable("By model strategy and guard mode", summary.byStrategyAndMode),
    ...aggregateTable("By group (adversarial model, normal mode)", summary.byGroup),
    ...aggregateTable("By what the guard can verify (adversarial model, normal mode)", summary.byGuardScope),
    ...aggregateTable("By strategy and listener profile (normal mode)", summary.byProfile),
    "## How contradicting model picks survive",
    "",
    "| Mode | Guard scope | Tier | Contradicts | Picks | Example |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...summary.survivalCauses.map(
      (cause) =>
        `| ${cause.mode} | ${cause.guardScope} | ${cause.tier} | ${cause.kinds} | ${cause.count} | ${cause.example.case} (${cause.example.strategy}): ${cause.example.key} (${cause.example.observedGenre ?? "no genre"}) ${cause.example.reasons.join("; ")} |`,
    ),
    "",
    `## Worst surviving model picks (${report.worstSurvivors.length})`,
    "",
    "| Case | Strategy | Mode | Pick | Observed genre | Truth | requestMatch | Tier | Why it contradicts |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.worstSurvivors.map(
      (pick) =>
        `| ${pick.case} | ${pick.strategy} | ${pick.mode} | ${pick.key} | ${pick.observedGenre ?? "none"} | ${pick.truth.family}, ${pick.truth.energy}, ${pick.truth.bpm} BPM | ${pick.requestMatch === null ? "absent" : pick.requestMatch} | ${pick.tier} | ${pick.reasons.join("; ")} |`,
    ),
    "",
    report.note,
    "",
  ].join("\n");
}

/** Writes the JSON and markdown report under `<cwd>/eval-results` (git-ignored, like the other evals). */
export function writeGuardReport(report: GuardReport): { jsonPath: string; markdownPath: string } {
  const dir = resolve(process.cwd(), "eval-results");
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, "dj-llm-guard.json");
  const markdownPath = resolve(dir, "dj-llm-guard.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, guardReportMarkdown(report));
  return { jsonPath, markdownPath };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface GuardBaselineEntry {
  survivingModelContradictions: number;
  wronglyDropped: number;
  finalContradictions: number;
  finalSilentLeaks: number;
}

export interface GuardBaselineFile {
  schemaVersion: typeof LLM_GUARD_BASELINE_SCHEMA_VERSION;
  note: string;
  /** Keyed `<case id>|<strategy>|<mode>`. */
  entries: Record<string, GuardBaselineEntry>;
}

export const guardBaselineKey = (run: Pick<GuardRunResult, "id" | "strategy" | "mode">) => `${run.id}|${run.strategy}|${run.mode}`;

const entryOf = (run: GuardRunResult): GuardBaselineEntry => ({
  survivingModelContradictions: run.survivingModelContradictions,
  wronglyDropped: run.wronglyDropped,
  finalContradictions: run.final.contradictions,
  finalSilentLeaks: run.final.silentLeaks,
});

export function guardBaselineFromResults(results: readonly GuardRunResult[]): GuardBaselineFile {
  return {
    schemaVersion: LLM_GUARD_BASELINE_SCHEMA_VERSION,
    note:
      "What the LLM-path guard does today, failures included. A change may lower these numbers, never raise them; " +
      "an improvement regenerates this file in the same PR (UPDATE_DJ_FILTER_BASELINE=1 npm run eval:dj-filters).",
    entries: Object.fromEntries(results.map((run) => [guardBaselineKey(run), entryOf(run)])),
  };
}

/** Runs worse than the baseline, runs the baseline does not know, and how many improved. */
export function compareToGuardBaseline(results: readonly GuardRunResult[], baseline: GuardBaselineFile) {
  const regressions: string[] = [];
  const missing: string[] = [];
  let improved = 0;
  for (const run of results) {
    const key = guardBaselineKey(run);
    const pinned = baseline.entries[key];
    if (!pinned) {
      missing.push(key);
      continue;
    }
    const now = entryOf(run);
    let better = false;
    for (const field of Object.keys(now) as Array<keyof GuardBaselineEntry>) {
      if (now[field] > pinned[field]) regressions.push(`${key}: ${field} ${pinned[field]} -> ${now[field]}`);
      if (now[field] < pinned[field]) better = true;
    }
    if (better) improved += 1;
  }
  return { regressions, missing, improved };
}
