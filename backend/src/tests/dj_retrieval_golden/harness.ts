/**
 * AI DJ retrieval golden harness (#2235). Runs the golden cases through the
 * real session path: request parser -> ranking preferences -> the selector
 * input a listening session builds -> AgentSelectorService with the shared
 * DiscoveryRankingService. Nothing in the ranker is stubbed; only the catalog
 * source differs between the two runners:
 *
 *  - `agent_dj_retrieval_golden.integration.spec.ts` seeds Postgres and uses
 *    the real `catalog.search` tool and the real audio-feature service;
 *  - `agent_golden_eval.spec.ts` (npm run eval:golden, no Docker) uses
 *    `InMemoryGoldenTools`, a line-for-line twin of `catalog.search`'s filter
 *    over the same fixture, so a Docker-free run reports the same numbers.
 *
 * Tests only; not shipped code.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  AgentAudioFeatureService,
  AgentAudioFeatureResult,
} from "../../modules/agents/agent_audio_feature.service";
import {
  AgentSelectorService,
} from "../../modules/agents/agent_selector.service";
import { deterministicSelectorInput } from "../../modules/agents/deterministic_recommendation.adapter";
import type { AgentRecommendationInput } from "../../modules/agents/agent_recommendation.adapter";
import {
  listeningRequestFromCrateParse,
  requestRankingPreferences,
  sanitizeSessionRequest,
} from "../../modules/agents/agent_session_request";
import { mergeSessionGenres } from "../../modules/agents/agent_session_genres";
import { measuredTrackFeatures } from "../../modules/agents/measured_track_features";
import { deterministicCrateRequestParser } from "../../modules/crates/crate_request_parser";
import { expandGenreSearchTerms } from "../../modules/recommendations/genre_families";
import { DiscoveryRankingService } from "../../modules/recommendations/discovery-ranking.service";
import {
  GOLDEN_CASES,
  GOLDEN_CATALOG,
  GoldenCase,
  GoldenRequest,
  GoldenTrack,
  MeasuredStemFeatures,
} from "./fixtures";

export const GOLDEN_REPORT_SCHEMA_VERSION = "dj-retrieval-golden/v1";
/** The shortlist depth every case is run at; recall@k is read off its order. */
export const GOLDEN_SELECTION_LIMIT = 20;
const EPSILON = 1e-9;

/** `stem-audio-features/v1` payload for a fixture track with measured features. */
export function stemFeaturesPayload(measured: MeasuredStemFeatures) {
  return {
    schemaVersion: "stem-audio-features/v1",
    extractor: { name: "librosa", version: "0.10" },
    sampleRate: 22050,
    durationSeconds: 200,
    ...(measured.tempoBpm !== undefined
      ? { tempoBpm: measured.tempoBpm, tempoConfidence: 0.8 }
      : {}),
    energyRms: measured.energyRms,
    onsetDensity: measured.onsetDensity,
  };
}

// ---------------------------------------------------------------------------
// Request -> the preferences a listening session sends the DJ
// ---------------------------------------------------------------------------

type SessionPreferences = AgentRecommendationInput["preferences"];

/**
 * The preferences `POST /agents/session` derives from a request (see
 * `AgentConfigController.startSession`): request genres become session genres,
 * moods and energy ride along, and an empty request changes nothing.
 */
export async function preferencesFor(request: GoldenRequest): Promise<SessionPreferences> {
  const rawRequest =
    request.kind === "text"
      ? listeningRequestFromCrateParse(await deterministicCrateRequestParser.parse(request.text)).request
      : sanitizeSessionRequest({
          genres: request.genres ?? [],
          moods: request.moods ?? [],
          energy: request.energy ?? null,
          bpm: null,
        });
  const requested = requestRankingPreferences({ request: rawRequest });
  const sessionGenres = requested.sessionGenres;
  return {
    genres: mergeSessionGenres({ sessionGenres }),
    ...(sessionGenres.length ? { sessionGenres } : {}),
    mood: requested.mood,
    energy: requested.energy,
    allowExplicit: request.allowExplicit ?? false,
    licenseType: "personal",
    ...(requested.request
      ? {
          moods: requested.moods,
          request: requested.request,
          ...(requested.tempoBpm ? { tempoBpm: requested.tempoBpm } : {}),
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Docker-free catalog twin
// ---------------------------------------------------------------------------

/** `AgentAudioFeatureService` over the fixture: same derivation, no database read. */
export class FixtureAudioFeatureService extends AgentAudioFeatureService {
  constructor(private readonly byId: ReadonlyMap<string, GoldenTrack>) {
    super();
  }

  async getOrCreate(trackId: string): Promise<AgentAudioFeatureResult> {
    const track = this.byId.get(trackId);
    if (!track) return { status: "failed", trackId, reason: "track_not_found" };
    const features = (this as unknown as {
      deriveFeatures(input: Record<string, unknown>): never;
    }).deriveFeatures({
      title: track.title,
      genre: track.genre,
      releaseTitle: track.releaseTitle ?? track.title,
      primaryArtist: track.artist,
      generationMetadata: null,
      // The seeded database tracks each carry one 200-second original stem.
      stemDurations: [200],
      stemTypes: ["original"],
      measured: measuredTrackFeatures(
        track.measured ? stemFeaturesPayload(track.measured) : undefined,
      ),
    });
    return { status: "ok", trackId, features };
  }
}

/**
 * The `ToolRegistry` surface the selector reads, over the fixture catalog.
 * `catalog.search` repeats the real tool's filter: explicit tracks only when
 * allowed; a genre-family-expanded, case-insensitive `contains` on the release
 * genre, or a literal title match; newest first; at most 50.
 * Embedding tools report "unavailable", as the real ones do with the
 * embedding provider disabled.
 */
export class InMemoryGoldenTools {
  readonly tracksById: Map<string, GoldenTrack>;

  constructor(
    private readonly catalog: readonly GoldenTrack[] = GOLDEN_CATALOG,
    private readonly idPrefix = "",
  ) {
    this.tracksById = new Map(catalog.map((track) => [`${idPrefix}${track.key}`, track]));
  }

  get(name: string) {
    switch (name) {
      case "catalog.search":
        return { run: async (input: Record<string, unknown>) => this.search(input) };
      case "catalog.semantic_search":
        return { run: async () => ({ items: [], status: "unavailable" }) };
      case "embeddings.similarity":
        return { run: async () => ({ ranked: [], status: "unavailable" }) };
      default:
        throw new Error(`Tool not found: ${name}`);
    }
  }

  private search(input: Record<string, unknown>) {
    const query = String(input.query ?? "").trim();
    const take = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
    const explicitAllowed = Boolean(input.allowExplicit ?? false);
    const terms = query ? expandGenreSearchTerms(query).map((term) => term.toLowerCase()) : [];
    const items = this.catalog
      .filter((track) => explicitAllowed || !track.explicit)
      .filter((track) => {
        if (!query) return true;
        const genre = track.genre?.toLowerCase() ?? "";
        return (
          terms.some((term) => genre.includes(term)) ||
          track.title.toLowerCase().includes(query.toLowerCase())
        );
      })
      .slice(0, take)
      .map((track) => ({
        id: `${this.idPrefix}${track.key}`,
        title: track.title,
        artist: track.artist,
        explicit: Boolean(track.explicit),
        hasListing: false,
        aiDisclosure: { level: "UNDECLARED" },
        release: {
          title: track.releaseTitle ?? track.title,
          genre: track.genre,
          moods: track.moods ?? [],
          artistId: `${this.idPrefix}uploader`,
          primaryArtist: track.artist,
          artist: { displayName: "Fixture uploader" },
        },
      }));
    return { items };
  }
}

/**
 * Keeps only fixture tracks in the real tool's answers, so tracks other suites
 * left in a shared test database cannot move the numbers.
 */
export function scopeToIdPrefix(
  registry: { get(name: string): { run(input: Record<string, unknown>): Promise<Record<string, unknown>> } },
  idPrefix: string,
) {
  return {
    get(name: string) {
      const tool = registry.get(name);
      return {
        run: async (input: Record<string, unknown>) => {
          const output = await tool.run(input);
          if (!Array.isArray(output.items)) return output;
          return {
            ...output,
            items: (output.items as Array<{ id: string }>).filter((item) =>
              item.id.startsWith(idPrefix),
            ),
          };
        },
      };
    },
  };
}

export function buildGoldenSelector(
  tools: unknown,
  audioFeatures: AgentAudioFeatureService,
): AgentSelectorService {
  return new AgentSelectorService(
    tools as never,
    new DiscoveryRankingService(),
    audioFeatures,
  );
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Share of `relevant` found in the first `k` of `ranked`. */
export function recallAtK(ranked: readonly string[], relevant: readonly string[], k: number): number {
  if (relevant.length === 0) return 1;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((key) => top.has(key)).length / relevant.length;
}

export type GoldenStatus = "baseline" | "improved" | "regressed";

export interface GoldenCaseResult {
  id: string;
  group: GoldenCase["group"];
  description: string;
  relevant: readonly string[];
  /** Ranked list order (track keys), best first, as far as the shortlist goes. */
  rankedKeys: string[];
  candidateCount: number;
  recallAt10: number | null;
  recallAt20: number | null;
  /** Recall over every candidate retrieved: a miss here is a retrieval miss, not a ranking miss. */
  retrievedRecall: number | null;
  baseline: GoldenCase["baseline"];
  status: GoldenStatus;
  knownGap?: string;
  forbiddenOffered: string[];
  /** `unmet` cases only. */
  unmet?: { honest: boolean; reason: string; selected: number };
}

function statusOf(recallAt10: number, recallAt20: number, baseline: GoldenCase["baseline"]): GoldenStatus {
  if (recallAt10 < baseline.recallAt10 - EPSILON || recallAt20 < baseline.recallAt20 - EPSILON) {
    return "regressed";
  }
  if (recallAt10 > baseline.recallAt10 + EPSILON || recallAt20 > baseline.recallAt20 + EPSILON) {
    return "improved";
  }
  return "baseline";
}

export async function runGoldenCase(
  selector: AgentSelectorService,
  goldenCase: GoldenCase,
  idPrefix: string,
): Promise<GoldenCaseResult> {
  const preferences = await preferencesFor(goldenCase.request);
  const result = await selector.select(
    deterministicSelectorInput({
      userId: `${idPrefix}user`,
      recentTrackIds: [],
      preferences,
      limit: GOLDEN_SELECTION_LIMIT,
    }),
  );
  const toKey = (id: string) => (id.startsWith(idPrefix) ? id.slice(idPrefix.length) : id);
  const rankedKeys = result.candidates.map(toKey);
  const offered = new Set([...rankedKeys, ...result.selected.map((track) => toKey(track.id))]);
  const forbiddenOffered = (goldenCase.forbidden ?? []).filter((key) => offered.has(key));

  if (goldenCase.unmet) {
    const honest =
      result.selected.length === 0 &&
      result.candidates.length === 0 &&
      result.reason === "no_matching_taste_candidates";
    return {
      id: goldenCase.id,
      group: goldenCase.group,
      description: goldenCase.description,
      relevant: goldenCase.relevant,
      rankedKeys,
      candidateCount: result.candidates.length,
      recallAt10: null,
      recallAt20: null,
      retrievedRecall: null,
      baseline: goldenCase.baseline,
      status: honest ? "baseline" : "regressed",
      forbiddenOffered,
      unmet: { honest, reason: result.reason, selected: result.selected.length },
    };
  }

  const recallAt10 = recallAtK(rankedKeys, goldenCase.relevant, 10);
  const recallAt20 = recallAtK(rankedKeys, goldenCase.relevant, 20);
  return {
    id: goldenCase.id,
    group: goldenCase.group,
    description: goldenCase.description,
    relevant: goldenCase.relevant,
    rankedKeys: rankedKeys.slice(0, GOLDEN_SELECTION_LIMIT),
    candidateCount: result.candidates.length,
    recallAt10,
    recallAt20,
    retrievedRecall: recallAtK(rankedKeys, goldenCase.relevant, Number.MAX_SAFE_INTEGER),
    baseline: goldenCase.baseline,
    status: statusOf(recallAt10, recallAt20, goldenCase.baseline),
    ...(goldenCase.knownGap ? { knownGap: goldenCase.knownGap } : {}),
    forbiddenOffered,
  };
}

export async function runGoldenCases(
  selector: AgentSelectorService,
  idPrefix: string,
  cases: readonly GoldenCase[] = GOLDEN_CASES,
): Promise<GoldenCaseResult[]> {
  const results: GoldenCaseResult[] = [];
  for (const goldenCase of cases) {
    results.push(await runGoldenCase(selector, goldenCase, idPrefix));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface GoldenReport {
  schemaVersion: typeof GOLDEN_REPORT_SCHEMA_VERSION;
  runner: string;
  note: string;
  cases: GoldenCaseResult[];
  summary: {
    total: number;
    scored: number;
    meanRecallAt10: number;
    meanRecallAt20: number;
    knownGaps: number;
    regressed: number;
    improved: number;
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function buildGoldenReport(runner: string, cases: GoldenCaseResult[]): GoldenReport {
  const scored = cases.filter((item) => item.recallAt10 !== null);
  return {
    schemaVersion: GOLDEN_REPORT_SCHEMA_VERSION,
    runner,
    note:
      "Deterministic ranker only (embedding-backed semantic retrieval is off). Recall is read off the ranked candidate list; " +
      "baseline is what the current code achieves, not a target.",
    cases,
    summary: {
      total: cases.length,
      scored: scored.length,
      meanRecallAt10: mean(scored.map((item) => item.recallAt10 as number)),
      meanRecallAt20: mean(scored.map((item) => item.recallAt20 as number)),
      knownGaps: cases.filter((item) => item.knownGap).length,
      regressed: cases.filter((item) => item.status === "regressed").length,
      improved: cases.filter((item) => item.status === "improved").length,
    },
  };
}

const pct = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);

export function goldenReportMarkdown(report: GoldenReport): string {
  const lines = [
    "# AI DJ retrieval golden report",
    "",
    `Runner: ${report.runner}`,
    "",
    "| Case | Group | Relevant | Recall@10 | Recall@20 | Retrieved | Baseline @10 / @20 | Status |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ...report.cases.map((item) => {
      const status = item.unmet
        ? item.unmet.honest
          ? "honest unmet"
          : "UNMET VIOLATED"
        : item.status;
      return `| ${item.id} | ${item.group} | ${item.relevant.length} | ${pct(item.recallAt10)} | ${pct(item.recallAt20)} | ${pct(item.retrievedRecall)} | ${pct(item.baseline.recallAt10)} / ${pct(item.baseline.recallAt20)} | ${status} |`;
    }),
    "",
    `Mean recall@10: ${pct(report.summary.meanRecallAt10)}. Mean recall@20: ${pct(report.summary.meanRecallAt20)}. ` +
      `Known gaps: ${report.summary.knownGaps}. Regressed: ${report.summary.regressed}. Improved: ${report.summary.improved}.`,
    "",
    "## Known gaps",
    "",
    ...report.cases
      .filter((item) => item.knownGap)
      .map((item) => `- ${item.id}: ${item.knownGap}`),
    "",
    report.note,
    "",
  ];
  return lines.join("\n");
}

/** Writes the JSON and markdown report under `<cwd>/eval-results` (git-ignored, like the other evals). */
export function writeGoldenReport(report: GoldenReport, name: string): { jsonPath: string; markdownPath: string } {
  const dir = resolve(process.cwd(), "eval-results");
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, `${name}.json`);
  const markdownPath = resolve(dir, `${name}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, goldenReportMarkdown(report));
  return { jsonPath, markdownPath };
}

/**
 * The assertions both runners share. A case may sit above its baseline, never
 * below it; forbidden tracks are never offered; the unmet request stays unmet.
 */
export function expectGoldenBaselines(results: readonly GoldenCaseResult[]): void {
  for (const item of results) {
    const label = `${item.id}`;
    expect({ case: label, forbiddenOffered: item.forbiddenOffered }).toEqual({
      case: label,
      forbiddenOffered: [],
    });
    if (item.unmet) {
      expect({ case: label, ...item.unmet }).toMatchObject({ case: label, honest: true });
      continue;
    }
    expect(item.recallAt10 as number).toBeGreaterThanOrEqual(item.baseline.recallAt10 - EPSILON);
    expect(item.recallAt20 as number).toBeGreaterThanOrEqual(item.baseline.recallAt20 - EPSILON);
  }
}
