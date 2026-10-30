/**
 * AI DJ filter-adherence eval harness
 * (docs/engineering/ai-dj-filter-adherence-evals.md). Drives the REAL
 * deterministic selector (AgentSelectorService + DiscoveryRankingService) over
 * the in-memory twin of the catalog tools, for the preferences a listener's
 * session would send, and grades every pick with the independent grader.
 *
 * Tests only; not shipped code. Docker-free.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { AgentRecommendationInput } from "../../modules/agents/agent_recommendation.adapter";
import { deterministicSelectorInput } from "../../modules/agents/deterministic_recommendation.adapter";
import { HYBRID_RETRIEVAL_VARIANT } from "../../modules/agents/agent_hybrid_retrieval";
import { mergeSessionGenres } from "../../modules/agents/agent_session_genres";
import { sanitizeArtistNames } from "../../modules/agents/agent_session_artists";
import { ArtistAwareRulesParser } from "../../modules/agents/agent_session_parser";
import {
  listeningRequestFromCrateParse,
  requestRankingPreferences,
  sanitizeRequestText,
  sanitizeSessionRequest,
} from "../../modules/agents/agent_session_request";
import {
  buildGoldenSelector,
  FixtureAudioFeatureService,
  fixtureArtistResolver,
  goldenPolicyContext,
  InMemoryGoldenTools,
} from "../dj_retrieval_golden/harness";
import { EVAL_CATALOG, OBSERVED_CATALOG, truthByKey, type EvalEnergy } from "./catalog";
import { EVAL_CASES, profileFor, type EvalCase, type EvalRequest, type ListenerProfile, type RequestFilters } from "./cases";
import { attainableCount, gradePick, type Verdict } from "./grader";

export const FILTER_REPORT_SCHEMA_VERSION = "dj-filter-adherence/v1";
export const FILTER_BASELINE_SCHEMA_VERSION = "dj-filter-adherence-baseline/v1";
/** The batch size a session plays: the DJ's own default target. */
export const BATCH_SIZE = 12;
/** Target per case and batch: zero contradictions, zero silent leaks, adherence at least this. */
export const ADHERENCE_TARGET = 0.8;
const EPSILON = 1e-9;

/** The retrieval variants every case runs under; `undefined` is the default path. */
export const EVAL_VARIANTS: ReadonlyArray<string | undefined> = [undefined, HYBRID_RETRIEVAL_VARIANT];
export const variantLabel = (variant: string | undefined) => variant ?? "default";

// ---------------------------------------------------------------------------
// Listener preferences: what a listening session sends the DJ
// ---------------------------------------------------------------------------

type Preferences = AgentRecommendationInput["preferences"];
export type SessionPhase = "start" | "next";

/** What the web sends for a session start or a pick (`AgentNextPreferences`), before the server touches it. */
interface WebPreferences {
  genres?: string[];
  request?: RequestFilters;
  requestText?: string;
  artists?: string[];
  mood?: string;
  energy?: EvalEnergy;
  sessionIntent?: string;
  sessionIntentName?: string;
  queueStyle?: string;
  source?: string;
  discovery?: "familiar" | "mixed" | "new";
}

const hasChips = (request: RequestFilters | null | undefined): request is RequestFilters =>
  !!request &&
  (request.genres.length > 0 ||
    request.moods.length > 0 ||
    request.energy !== null ||
    !!request.bpm && (request.bpm.min !== null || request.bpm.max !== null));

/**
 * What the web sends for the request: `buildSessionPreferences` for a session
 * start, `buildPickPreferences` for a pick
 * (web/src/components/agent/sessionPreferences.ts). A tapped starter sends its
 * preset's own preferences and request; edited or typed filters send the
 * request plus the genres, mood and energy read from it; a typed sentence adds
 * the sentence and the artists it named; a pick with no filters of its own
 * sends the saved vibes as its genres.
 */
async function webPreferences(
  evalRequest: EvalRequest,
  profile: ListenerProfile,
  phase: SessionPhase,
): Promise<WebPreferences | undefined> {
  const discoveryField = evalRequest.discovery ? { discovery: evalRequest.discovery } : {};
  const starter = evalRequest.starter;

  // Filters the chips show, and the sentence and artists that go with them.
  let chips: RequestFilters | null = null;
  let sentence: string | undefined;
  let artists: string[] = [];
  if (evalRequest.kind === "text") {
    if (starter) {
      chips = starter.request ?? null;
    } else {
      const parsed = listeningRequestFromCrateParse(
        await new ArtistAwareRulesParser(fixtureArtistResolver(OBSERVED_CATALOG)).parse(evalRequest.text),
      );
      chips = parsed.request;
      artists = parsed.artists;
      sentence = evalRequest.text.trim() || undefined;
    }
  } else {
    chips = {
      genres: evalRequest.genres ?? [],
      moods: evalRequest.moods ?? [],
      energy: evalRequest.energy ?? null,
      bpm: evalRequest.bpm ?? null,
    };
    artists = evalRequest.artists ?? [];
  }

  let built: WebPreferences | undefined;
  if (starter) {
    // toIntentPreferences: a Moments starter sends its mood and energy and no genres; a Sounds starter its genres.
    const energy = chips?.energy ?? undefined;
    built = {
      ...(starter.mood ? { mood: starter.mood } : {}),
      genres: evalRequest.kind === "structured" ? [...(evalRequest.genres ?? [])] : [],
      sessionIntent: starter.intent,
      sessionIntentName: starter.name,
      queueStyle: starter.queueStyle,
      source: "agent_session_intent",
      ...(chips && hasChips(chips) ? { request: chips, energy } : energy ? { energy } : {}),
    };
  } else if (!hasChips(chips)) {
    // A sentence the chips did not capture ("like <Artist>") still steers.
    const sentenceFields = {
      ...(sentence ? { requestText: sentence } : {}),
      ...(artists.length > 0 ? { artists: [...artists] } : {}),
    };
    built = Object.keys(sentenceFields).length > 0 ? { ...sentenceFields, source: "agent_session_prompt" } : undefined;
  } else {
    built = {
      ...(sentence ? { requestText: sentence } : {}),
      ...(artists.length > 0 ? { artists: [...artists] } : {}),
      request: chips,
      // Never the saved vibes: a request naming only a mood or energy searches every genre.
      genres: chips.genres,
      mood: chips.moods[0],
      energy: chips.energy ?? undefined,
      source: "agent_session_prompt",
    };
  }

  if (phase === "start") {
    if (!built && !evalRequest.discovery) return undefined;
    return { ...(built ?? {}), ...discoveryField };
  }
  // buildPickPreferences: a pick always states the sentence and artists (empty when dropped).
  const sentenceReset = { requestText: "", artists: [] as string[] };
  if (built && (built.request || built.sessionIntent)) return { ...sentenceReset, ...built, ...discoveryField };
  return { genres: profile.vibes, ...sentenceReset, ...(built ?? {}), ...discoveryField };
}

/**
 * The preferences the selector receives for a listener's request: the web's
 * body ({@link webPreferences}) run through the same assembly production runs,
 * for the listener's saved vibes and learned taste.
 *
 * MIRRORS, because production builds this inline in two places rather than in a
 * shared function (a later refactor can extract one and replace this):
 *
 *  - phase "start": `AgentConfigController.startSession`
 *    (backend/src/modules/agents/agent_config.controller.ts, ~lines 371-525):
 *    `requestRankingPreferences`; session genres = body genres + request genres;
 *    runtime genres = `mergeLearnedGenres(vibes, profile, sessionGenres)` =
 *    `mergeSessionGenres({ learnedGenres: profile.favoredGenres, vibes, sessionGenres })`;
 *    `learnedGenreWeights` = `profile.genreWeights`; `sessionGenres` only when
 *    non-empty; mood, energy, allowExplicit, requestText, artists, discovery;
 *    moods / tempoBpm / request only when the request has filters.
 *  - phase "next": `SessionsService.agentNext`
 *    (backend/src/modules/sessions/sessions.service.ts, ~lines 321-446, with
 *    `ownGenres` and `withLearnedGenres` at ~665-716): the body is remembered
 *    as sent; `sessionGenres` = body genres + request genres; the genres become
 *    `withLearnedGenres(...)` (the same `mergeLearnedGenres`); `ownGenres` drops
 *    session genres equal to the saved vibes when no other filter is set; the
 *    request's mood, energy, moods, tempo and request override the body's.
 *
 * Judgement calls:
 *  - `learnedGenreWeights` is passed in both phases. Production's next pick does
 *    not put it in the preferences, but the selector reads the listener's taste
 *    profile itself (`AgentSelectorService.resolveLearnedGenreWeights`), which
 *    the harness has no database for; passing the weights is that read.
 *  - The case's `allowExplicit` stands for the listener's SAVED explicit choice,
 *    applied to both phases (the web never sends it per pick).
 */
export async function listenerPreferences(
  evalRequest: EvalRequest,
  profile: ListenerProfile,
  phase: SessionPhase,
): Promise<Preferences> {
  const allowExplicit = evalRequest.allowExplicit ?? false;
  const body = (await webPreferences(evalRequest, profile, phase)) ?? {};

  if (phase === "start") {
    const requested = requestRankingPreferences({
      mood: body.mood,
      energy: body.energy,
      request: body.request,
      requestText: body.requestText,
      artists: body.artists,
    });
    const sessionGenres = requested.request ? [...(body.genres ?? []), ...requested.sessionGenres] : body.genres;
    return {
      // Saved vibes and learned favourites first, then this session's own genres (mergeLearnedGenres).
      genres: mergeSessionGenres({ learnedGenres: profile.favoredGenres, vibes: profile.vibes, sessionGenres }),
      learnedGenreWeights: profile.genreWeights,
      ...(sessionGenres?.length ? { sessionGenres } : {}),
      mood: requested.mood,
      energy: requested.energy,
      allowExplicit,
      licenseType: "personal",
      sessionIntent: body.sessionIntent,
      sessionIntentName: body.sessionIntentName,
      queueStyle: body.queueStyle,
      source: body.source,
      ...(requested.requestText ? { requestText: requested.requestText } : {}),
      ...(requested.artists.length > 0 ? { artists: requested.artists } : {}),
      ...(body.discovery ? { discovery: body.discovery } : {}),
      ...(requested.request
        ? {
            moods: requested.moods,
            ...(requested.tempoBpm ? { tempoBpm: requested.tempoBpm } : {}),
            request: requested.request,
          }
        : {}),
    };
  }

  // sanitizeIncomingRequest: the request, sentence and artists are cleaned as received.
  const received = {
    ...body,
    request: sanitizeSessionRequest(body.request),
    requestText: sanitizeRequestText(body.requestText),
    artists: sanitizeArtistNames(body.artists),
  };
  const requested = requestRankingPreferences(received);
  const sessionGenres = requested.request ? [...(received.genres ?? []), ...requested.sessionGenres] : received.genres;
  const own = ownGenres(sessionGenres, {
    sessionIntentName: received.sessionIntentName,
    mood: requested.mood,
    moods: requested.moods,
    energy: requested.energy,
    tempoBpm: requested.tempoBpm,
    vibes: profile.vibes,
  });
  return {
    ...received,
    allowExplicit,
    licenseType: "personal",
    learnedGenreWeights: profile.genreWeights,
    genres: mergeSessionGenres({ learnedGenres: profile.favoredGenres, vibes: profile.vibes, sessionGenres: sessionGenres ?? [] }),
    ...(own.length ? { sessionGenres: own } : {}),
    ...(requested.request
      ? {
          mood: requested.mood,
          energy: requested.energy,
          moods: requested.moods,
          ...(requested.tempoBpm ? { tempoBpm: requested.tempoBpm } : {}),
          request: requested.request,
        }
      : {}),
  } as Preferences;
}

/** `SessionsService.ownGenres`: saved vibes sent back as genres are taste, not the session's own filters. */
function ownGenres(
  sessionGenres: string[] | undefined,
  input: {
    sessionIntentName?: string;
    mood?: string;
    moods: string[];
    energy?: string;
    tempoBpm?: unknown;
    vibes: string[];
  },
): string[] {
  const genres = sessionGenres ?? [];
  if (genres.length === 0 || input.sessionIntentName || input.mood || input.moods.length || input.energy || input.tempoBpm) {
    return genres;
  }
  const vibes = new Set(input.vibes.map((vibe) => vibe.trim().toLowerCase()));
  const sameAsVibes = vibes.size > 0 && genres.every((genre) => vibes.has(genre.trim().toLowerCase()));
  return sameAsVibes ? [] : genres;
}

// ---------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------

export type RequestTier = "A" | "B" | "C" | "none";

export interface PickResult {
  key: string;
  observedGenre: string | null;
  tier: RequestTier;
  verdict: Verdict;
  /** On-request is false and the system did not mark the pick "Outside your request". */
  silentLeak: boolean;
  truth: { artist: string; family: string; energy: string; bpm: number };
  reasons: string[];
}

export interface BatchResult {
  batch: 1 | 2;
  picks: number;
  onRequest: number | null;
  attainable: number;
  adherence: number;
  contradictions: number;
  silentLeaks: number;
  /** Only when nothing on-request is attainable: every pick, if any, is marked outside the request. */
  unmetHonest: boolean | null;
  passed: boolean;
  /** Up to three worst picks. */
  worst: PickResult[];
  /** Every pick in order (key, tier, verdict) for the JSON report. */
  played: Array<Pick<PickResult, "key" | "tier" | "verdict">>;
}

export interface CaseRunResult {
  id: string;
  group: EvalCase["group"];
  profile: EvalCase["profile"];
  variant: string;
  batches: [BatchResult, BatchResult];
  passed: boolean;
}

let sharedEngine: { selector: ReturnType<typeof buildGoldenSelector> } | undefined;

/**
 * One selector over the observed catalog for every run. The fixture uploader is
 * a verified human, as most catalog artists are, so exploration slots exist and
 * the Discovery control has something to change.
 */
function engine() {
  if (!sharedEngine) {
    const tools = new InMemoryGoldenTools(OBSERVED_CATALOG);
    sharedEngine = {
      selector: buildGoldenSelector(tools, new FixtureAudioFeatureService(tools.tracksById), {
        policyContext: goldenPolicyContext({ verifiedArtistIds: ["uploader"] }),
        recommendations: { getServedHistory: async () => [] },
      }),
    };
  }
  return sharedEngine.selector;
}

/** The shared eval selector, for stage C: the guard tops its batches up from this same selector. */
export function evalSelector(): ReturnType<typeof buildGoldenSelector> {
  return engine();
}

const USER_ID = "eval-listener";

function severity(pick: PickResult): number {
  return (pick.verdict === "contradiction" ? 4 : pick.verdict === "partial" ? 2 : 0) + (pick.silentLeak ? 1 : 0);
}

function gradeBatch(
  evalCase: EvalCase,
  batch: 1 | 2,
  selected: Array<{ id: string; requestTier?: "A" | "B" | "C" }>,
  excluded: ReadonlySet<string>,
): BatchResult {
  const picks: PickResult[] = selected.map((entry) => {
    const truth = truthByKey.get(entry.id);
    if (!truth) throw new Error(`Selected track ${entry.id} is not in the eval catalog`);
    const grade = gradePick(evalCase.intent, truth);
    const tier: RequestTier = entry.requestTier ?? "none";
    return {
      key: entry.id,
      observedGenre: OBSERVED_CATALOG.find((track) => track.key === entry.id)?.genre ?? null,
      tier,
      verdict: grade.verdict,
      silentLeak: grade.verdict !== "on" && tier !== "C",
      truth: { artist: truth.artist, family: truth.family, energy: truth.energy, bpm: truth.bpm },
      reasons: grade.reasons,
    };
  });
  const on = picks.filter((pick) => pick.verdict === "on").length;
  const attainable = Math.min(attainableCount(evalCase.intent, EVAL_CATALOG, excluded), BATCH_SIZE);
  const adherence = attainable > 0 ? Math.min(1, on / attainable) : 1;
  const contradictions = picks.filter((pick) => pick.verdict === "contradiction").length;
  const silentLeaks = picks.filter((pick) => pick.silentLeak).length;
  return {
    batch,
    picks: picks.length,
    onRequest: picks.length > 0 ? on / picks.length : null,
    attainable,
    adherence,
    contradictions,
    silentLeaks,
    unmetHonest: attainable === 0 ? picks.every((pick) => pick.tier === "C") : null,
    passed: contradictions === 0 && silentLeaks === 0 && adherence >= ADHERENCE_TARGET - EPSILON,
    worst: picks
      .filter((pick) => severity(pick) > 0)
      .sort((a, b) => severity(b) - severity(a))
      .slice(0, 3),
    played: picks.map(({ key, tier, verdict }) => ({ key, tier, verdict })),
  };
}

/**
 * Runs one case: batch 1 is what session start plays; batch 2 is the next pick,
 * with batch 1 as the session's tracks.
 */
export async function runCase(evalCase: EvalCase, variant?: string): Promise<CaseRunResult> {
  const selector = engine();
  const profile = profileFor(evalCase);
  const select = async (phase: SessionPhase, recentTrackIds: string[]) =>
    selector.select({
      ...deterministicSelectorInput({
        userId: USER_ID,
        recentTrackIds,
        preferences: await listenerPreferences(evalCase.request, profile, phase),
        limit: BATCH_SIZE,
      }),
      // Offline evaluation pins the variant; production reads the assignment.
      ...(variant ? { retrievalVariant: variant } : {}),
    });

  const first = await select("start", []);
  const firstIds = first.selected.map((track) => track.id);
  const second = await select("next", firstIds);
  const batches: [BatchResult, BatchResult] = [
    gradeBatch(evalCase, 1, first.selected, new Set()),
    gradeBatch(evalCase, 2, second.selected, new Set(firstIds)),
  ];
  return {
    id: evalCase.id,
    group: evalCase.group,
    profile: evalCase.profile,
    variant: variantLabel(variant),
    batches,
    passed: batches.every((batchResult) => batchResult.passed),
  };
}

/** Runs every case under every variant. */
export async function runAllCases(
  cases: readonly EvalCase[] = EVAL_CASES,
  variants: ReadonlyArray<string | undefined> = EVAL_VARIANTS,
): Promise<CaseRunResult[]> {
  const results: CaseRunResult[] = [];
  for (const variant of variants) {
    for (const evalCase of cases) results.push(await runCase(evalCase, variant));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface Aggregate {
  units: number;
  passRate: number;
  meanOnRequest: number | null;
  meanAdherence: number;
  contradictions: number;
  silentLeaks: number;
  meanContradictions: number;
  meanSilentLeaks: number;
}

export interface FilterReport {
  schemaVersion: typeof FILTER_REPORT_SCHEMA_VERSION;
  note: string;
  target: { contradictions: 0; silentLeaks: 0; adherence: number; batchSize: number };
  summary: {
    cases: number;
    runs: number;
    overall: Aggregate;
    byGroup: Record<string, Aggregate>;
    byProfile: Record<string, Aggregate>;
    byVariant: Record<string, Aggregate>;
    byBatch: Record<string, Aggregate>;
  };
  results: CaseRunResult[];
}

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** `unit.passed` is the case (both batches) or, for the batch view, that batch alone. */
function aggregate(units: Array<{ passed: boolean; batches: BatchResult[] }>): Aggregate {
  const batches = units.flatMap((unit) => unit.batches);
  const onRequest = batches.filter((batch) => batch.onRequest !== null).map((batch) => batch.onRequest as number);
  return {
    units: units.length,
    passRate: units.length ? units.filter((unit) => unit.passed).length / units.length : 0,
    meanOnRequest: onRequest.length ? mean(onRequest) : null,
    meanAdherence: mean(batches.map((batch) => batch.adherence)),
    contradictions: batches.reduce((sum, batch) => sum + batch.contradictions, 0),
    silentLeaks: batches.reduce((sum, batch) => sum + batch.silentLeaks, 0),
    meanContradictions: mean(batches.map((batch) => batch.contradictions)),
    meanSilentLeaks: mean(batches.map((batch) => batch.silentLeaks)),
  };
}

function groupAggregates(
  results: CaseRunResult[],
  keyOf: (result: CaseRunResult) => string,
): Record<string, Aggregate> {
  const keys = [...new Set(results.map(keyOf))];
  return Object.fromEntries(keys.map((key) => [key, aggregate(results.filter((result) => keyOf(result) === key))]));
}

export function buildReport(results: CaseRunResult[]): FilterReport {
  const byBatch = Object.fromEntries(
    ([1, 2] as const).map((batch) => [
      `batch ${batch}`,
      aggregate(results.map((result) => ({ passed: result.batches[batch - 1].passed, batches: [result.batches[batch - 1]] }))),
    ]),
  );
  return {
    schemaVersion: FILTER_REPORT_SCHEMA_VERSION,
    note:
      "Deterministic selector only (embedding-backed retrieval is off), over an invented two-layer catalog graded by an independent grader. " +
      "A case passes with zero contradictions, zero silent leaks and adherence at or above the target in both batches. " +
      "The baseline is what the current code does, not a goal.",
    target: { contradictions: 0, silentLeaks: 0, adherence: ADHERENCE_TARGET, batchSize: BATCH_SIZE },
    summary: {
      cases: new Set(results.map((result) => result.id)).size,
      runs: results.length,
      overall: aggregate(results),
      byGroup: groupAggregates(results, (result) => result.group),
      byProfile: groupAggregates(results, (result) => result.profile),
      byVariant: groupAggregates(results, (result) => result.variant),
      byBatch,
    },
    results,
  };
}

const pct = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
const num = (value: number) => value.toFixed(2);

function aggregateTable(title: string, rows: Record<string, Aggregate>): string[] {
  return [
    `### ${title}`,
    "",
    "| | Runs | Pass rate | On-request | Adherence | Contradictions (mean) | Silent leaks (mean) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(rows).map(
      ([name, row]) =>
        `| ${name} | ${row.units} | ${pct(row.passRate)} | ${pct(row.meanOnRequest)} | ${pct(row.meanAdherence)} | ${row.contradictions} (${num(row.meanContradictions)}) | ${row.silentLeaks} (${num(row.meanSilentLeaks)}) |`,
    ),
    "",
  ];
}

export function reportMarkdown(report: FilterReport, worstCount = 15): string {
  const offenders = report.results
    .flatMap((result) =>
      result.batches.map((batch) => ({ result, batch, score: batch.contradictions * 2 + batch.silentLeaks })),
    )
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.result.id.localeCompare(b.result.id))
    .slice(0, worstCount);
  return [
    "# AI DJ filter-adherence report",
    "",
    `Target per case and batch: 0 contradictions, 0 silent leaks, adherence >= ${pct(report.target.adherence)} (batch of ${report.target.batchSize}).`,
    "",
    `${report.summary.cases} cases, ${report.summary.runs} runs (case x variant). Pass rate ${pct(report.summary.overall.passRate)}; ` +
      `${report.summary.overall.contradictions} contradicting picks and ${report.summary.overall.silentLeaks} silent leaks over all batches.`,
    "",
    ...aggregateTable("Overall", { all: report.summary.overall }),
    ...aggregateTable("By group", report.summary.byGroup),
    ...aggregateTable("By listener profile", report.summary.byProfile),
    ...aggregateTable("By retrieval variant", report.summary.byVariant),
    ...aggregateTable("By batch", report.summary.byBatch),
    "## Worst offenders",
    "",
    "| Case | Variant | Batch | Contradictions | Silent leaks | Worst pick |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...offenders.map(({ result, batch }) => {
      const pick = batch.worst[0];
      const detail = pick
        ? `${pick.key} (${pick.observedGenre ?? "no genre"}; truth ${pick.truth.family}, ${pick.truth.energy}, ${pick.truth.bpm} BPM; tier ${pick.tier}): ${pick.reasons.join("; ") || pick.verdict}`
        : "";
      return `| ${result.id} | ${result.variant} | ${batch.batch} | ${batch.contradictions} | ${batch.silentLeaks} | ${detail} |`;
    }),
    "",
    report.note,
    "",
  ].join("\n");
}

/** Writes the JSON and markdown report under `<cwd>/eval-results` (git-ignored, like the other evals). */
export function writeFilterReport(report: FilterReport): { jsonPath: string; markdownPath: string } {
  const dir = resolve(process.cwd(), "eval-results");
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, "dj-filter-adherence.json");
  const markdownPath = resolve(dir, "dj-filter-adherence.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, reportMarkdown(report));
  return { jsonPath, markdownPath };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface BaselineEntry {
  contradictions: number;
  silentLeaks: number;
  adherence: number;
}

export interface BaselineFile {
  schemaVersion: typeof FILTER_BASELINE_SCHEMA_VERSION;
  note: string;
  /** Keyed `<case id>|<variant>|<batch>`. */
  entries: Record<string, BaselineEntry>;
}

export const baselineKey = (id: string, variant: string, batch: number) => `${id}|${variant}|${batch}`;

export function baselineFromResults(results: readonly CaseRunResult[]): BaselineFile {
  const entries: Record<string, BaselineEntry> = {};
  for (const result of results) {
    for (const batch of result.batches) {
      entries[baselineKey(result.id, result.variant, batch.batch)] = {
        contradictions: batch.contradictions,
        silentLeaks: batch.silentLeaks,
        adherence: batch.adherence,
      };
    }
  }
  return {
    schemaVersion: FILTER_BASELINE_SCHEMA_VERSION,
    note:
      "What the selector does today, failures included. A change may raise these numbers, never lower them; " +
      "an improvement regenerates this file in the same PR (UPDATE_DJ_FILTER_BASELINE=1 npm run eval:dj-filters).",
    entries,
  };
}

/** Cases worse than the baseline, and cases the baseline does not know. */
export function compareToBaseline(results: readonly CaseRunResult[], baseline: BaselineFile) {
  const regressions: string[] = [];
  const missing: string[] = [];
  let improved = 0;
  for (const result of results) {
    for (const batch of result.batches) {
      const key = baselineKey(result.id, result.variant, batch.batch);
      const pinned = baseline.entries[key];
      if (!pinned) {
        missing.push(key);
        continue;
      }
      if (batch.contradictions > pinned.contradictions) {
        regressions.push(`${key}: contradictions ${pinned.contradictions} -> ${batch.contradictions}`);
      }
      if (batch.silentLeaks > pinned.silentLeaks) {
        regressions.push(`${key}: silent leaks ${pinned.silentLeaks} -> ${batch.silentLeaks}`);
      }
      if (batch.adherence < pinned.adherence - EPSILON) {
        regressions.push(`${key}: adherence ${pinned.adherence} -> ${batch.adherence}`);
      }
      if (
        batch.contradictions < pinned.contradictions ||
        batch.silentLeaks < pinned.silentLeaks ||
        batch.adherence > pinned.adherence + EPSILON
      ) {
        improved += 1;
      }
    }
  }
  return { regressions, missing, improved };
}
