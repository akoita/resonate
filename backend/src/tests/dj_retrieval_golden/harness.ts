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
 *    (and of `catalog.artist_seed`'s own-track lookup) over the same fixture,
 *    so a Docker-free run reports the same numbers.
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
import { ArtistAwareRulesParser } from "../../modules/agents/agent_session_parser";
import {
  buildArtistNameIndex,
  findArtistMentions,
  matchArtistName,
} from "../../modules/agents/agent_session_artists";
import type { SessionArtistResolver } from "../../modules/agents/agent_session_artist_resolver";
import {
  buildDescriptorInput,
  deterministicDescriptor,
  type TrackDescriptorValue,
} from "../../modules/descriptors/track_descriptor";
import {
  expandGenreSearchTerms,
  genreFamiliesFor,
} from "../../modules/recommendations/genre_families";
import { DiscoveryRankingService } from "../../modules/recommendations/discovery-ranking.service";
import { getAgentTrackLimit } from "../../modules/agents/agent_runtime.config";
import {
  GOLDEN_CASES,
  GOLDEN_CATALOG,
  HELD_BACK_CATALOG,
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

/**
 * The descriptor the backfill (`backfill_track_descriptors.ts`, deterministic
 * strategy, the default) produces for a fixture track (#2240): the same pure
 * functions it runs over the same inputs, including the measured bands of the
 * seeded original stem. The integration runner does not use this: it runs the
 * real tagger over the seeded rows, and the twin parity test proves the two
 * agree.
 */
export function goldenDescriptor(track: GoldenTrack): TrackDescriptorValue {
  return deterministicDescriptor(
    buildDescriptorInput({
      title: track.title,
      genre: track.genre,
      releaseTitle: track.releaseTitle ?? track.title,
      audioFeatures: track.measured ? stemFeaturesPayload(track.measured) : undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// Request -> the preferences a listening session sends the DJ
// ---------------------------------------------------------------------------

type SessionPreferences = AgentRecommendationInput["preferences"];

/**
 * The catalog's credited artists, from the fixture: the stand-in for
 * `AgentSessionArtistResolver`, which reads the same names from Postgres.
 */
export function fixtureArtistResolver(catalog: readonly GoldenTrack[] = GOLDEN_CATALOG): SessionArtistResolver {
  const index = buildArtistNameIndex(catalog.filter((track) => !track.uncredited).map((track) => track.artist));
  return {
    mentionsIn: async (text) => findArtistMentions(text, index),
    resolveNames: async (names) =>
      names.flatMap((name) => {
        const match = matchArtistName(name, index);
        return match ? [match] : [];
      }),
  };
}

/**
 * The preferences `POST /agents/session` derives from a request (see
 * `AgentConfigController.startSession`): request genres become session genres,
 * moods and energy ride along, and an empty request changes nothing. A typed
 * sentence also contributes the sentence itself and the artists it names
 * (#2241), through the same deterministic session parser the parse route uses.
 */
export async function preferencesFor(
  request: GoldenRequest,
  artists: SessionArtistResolver = fixtureArtistResolver(),
): Promise<SessionPreferences> {
  const parsedText =
    request.kind === "text"
      ? listeningRequestFromCrateParse(await new ArtistAwareRulesParser(artists).parse(request.text))
      : undefined;
  const rawRequest =
    request.kind === "text"
      ? parsedText?.request
      : sanitizeSessionRequest({
          genres: request.genres ?? [],
          moods: request.moods ?? [],
          energy: request.energy ?? null,
          bpm: null,
        });
  const requested = requestRankingPreferences({ request: rawRequest });
  const sessionGenres = requested.sessionGenres;
  const learnedGenres = request.kind === "structured" ? request.learnedGenres ?? [] : [];
  return {
    // As production merges them (learned favourites first, then the session's own genres).
    genres: mergeSessionGenres({ learnedGenres, sessionGenres }),
    ...(learnedGenres.length
      ? { learnedGenreWeights: Object.fromEntries(learnedGenres.map((genre) => [genre, 5])) }
      : {}),
    ...(request.kind === "structured" && request.fillSimilar ? { fillSimilar: true } : {}),
    ...(sessionGenres.length ? { sessionGenres } : {}),
    mood: requested.mood,
    energy: requested.energy,
    allowExplicit: request.allowExplicit ?? false,
    licenseType: "personal",
    ...(request.kind === "text" ? { requestText: request.text } : {}),
    ...(parsedText?.artists.length ? { artists: parsedText.artists } : {}),
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
 * genre, a match on the stored descriptor's families (#2240), or a literal
 * title match; newest first; at most 50.
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
      case "catalog.audio_range":
        return { run: async (input: Record<string, unknown>) => this.audioRange(input) };
      case "catalog.explicit_matches":
        return { run: async (input: Record<string, unknown>) => this.explicitMatches(input) };
      case "catalog.artist_seed":
        return { run: async (input: Record<string, unknown>) => this.artistSeed(input) };
      // No popularity serving tables in the twin: the trending source (#2246) reports it is unavailable.
      case "catalog.trending":
        return { run: async () => ({ items: [], status: "unavailable" }) };
      case "embeddings.similarity":
        return { run: async () => ({ ranked: [], status: "unavailable" }) };
      default:
        throw new Error(`Tool not found: ${name}`);
    }
  }

  /** `catalog.artist_seed` without embeddings: each named artist's own tracks, newest first. */
  private artistSeed(input: Record<string, unknown>) {
    const names = ((input.artists as string[]) ?? []).map((name) => name.toLowerCase());
    const excluded = new Set((input.excludeTrackIds as string[]) ?? []);
    const explicitAllowed = Boolean(input.allowExplicit ?? false);
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
    const items = names.flatMap((name) =>
      this.catalog
        .filter((track) => explicitAllowed || !track.explicit)
        .filter((track) => track.artist.toLowerCase() === name)
        .filter((track) => !excluded.has(`${this.idPrefix}${track.key}`))
        .slice(0, 8)
        .map((track) => ({ ...this.toItem(track), artistSeed: "own", seedArtist: track.artist })),
    );
    return { items: items.slice(0, limit), status: "ok" };
  }

  /**
   * `catalog.audio_range` over the fixture: the descriptor's measured energy
   * band, and a measured BPM window (the fixture's tempo confidence is 0.8,
   * above the gate), newest first. Inferred values never retrieve.
   */
  private audioRange(input: Record<string, unknown>) {
    const energy = input.energy as string | undefined;
    const tempo = input.tempoBpm as { min?: number | null; max?: number | null } | undefined;
    const excluded = new Set((input.excludeTrackIds as string[]) ?? []);
    const explicitAllowed = Boolean(input.allowExplicit ?? false);
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
    const items = this.catalog
      .filter((track) => explicitAllowed || !track.explicit)
      .filter((track) => !excluded.has(`${this.idPrefix}${track.key}`))
      .filter((track) => !energy || goldenDescriptor(track).energyBand === energy)
      .filter((track) => {
        if (tempo?.min == null && tempo?.max == null) return true;
        const bpm = track.measured?.tempoBpm;
        return bpm !== undefined && (tempo?.min == null || bpm >= tempo.min) && (tempo?.max == null || bpm <= tempo.max);
      })
      .slice(0, limit)
      .map((track) => this.toItem(track));
    return { items, status: "ok" };
  }

  /** `catalog.explicit_matches`: how many explicit tracks match the requested terms (a count only). */
  private explicitMatches(input: Record<string, unknown>) {
    const terms = (input.terms as string[]) ?? [];
    const excluded = new Set((input.excludeTrackIds as string[]) ?? []);
    const matches = (track: GoldenTrack, query: string) => {
      const genre = track.genre?.toLowerCase() ?? "";
      const familyIds = genreFamiliesFor(query).map((family) => family.id);
      return (
        expandGenreSearchTerms(query).some((term) => genre.includes(term.toLowerCase())) ||
        goldenDescriptor(track).families.some((id) => familyIds.includes(id)) ||
        track.title.toLowerCase().includes(query.toLowerCase())
      );
    };
    const count = this.catalog.filter(
      (track) =>
        track.explicit &&
        !excluded.has(`${this.idPrefix}${track.key}`) &&
        terms.some((term) => matches(track, term)),
    ).length;
    return { count };
  }

  private toItem(track: GoldenTrack) {
    return {
      id: `${this.idPrefix}${track.key}`,
      title: track.title,
      artist: track.uncredited ? null : track.artist,
      explicit: Boolean(track.explicit),
      hasListing: false,
      descriptor: goldenDescriptor(track),
      aiDisclosure: { level: "UNDECLARED" },
      release: {
        title: track.releaseTitle ?? track.title,
        genre: track.genre,
        moods: track.moods ?? [],
        artistId: `${this.idPrefix}uploader`,
        primaryArtist: track.uncredited ? null : track.artist,
        artist: { displayName: "Fixture uploader" },
      },
    };
  }

  private search(input: Record<string, unknown>) {
    const query = String(input.query ?? "").trim();
    const take = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
    const explicitAllowed = Boolean(input.allowExplicit ?? false);
    const excluded = new Set(Array.isArray(input.excludeTrackIds) ? (input.excludeTrackIds as string[]) : []);
    const terms = query ? expandGenreSearchTerms(query).map((term) => term.toLowerCase()) : [];
    const familyIds = query ? genreFamiliesFor(query).map((family) => family.id) : [];
    const matching = this.catalog
      .filter((track) => explicitAllowed || !track.explicit)
      .filter((track) => {
        if (!query) return true;
        const genre = track.genre?.toLowerCase() ?? "";
        return (
          terms.some((term) => genre.includes(term)) ||
          goldenDescriptor(track).families.some((id) => familyIds.includes(id)) ||
          track.title.toLowerCase().includes(query.toLowerCase())
        );
      });
    const items = matching
      .filter((track) => !excluded.has(`${this.idPrefix}${track.key}`))
      .slice(0, take)
      .map((track) => this.toItem(track));
    // Like the real tool: with ids to exclude, how many of them the query matches.
    return excluded.size > 0
      ? { items, excludedMatches: matching.filter((track) => excluded.has(`${this.idPrefix}${track.key}`)).length }
      : { items };
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
  collaborators: {
    policyContext?: unknown;
    recommendations?: unknown;
  } = {},
): AgentSelectorService {
  return new AgentSelectorService(
    tools as never,
    new DiscoveryRankingService(),
    audioFeatures,
    undefined,
    undefined,
    undefined,
    collaborators.policyContext as never,
    undefined,
    collaborators.recommendations as never,
  );
}

/**
 * The policy-stage lookups of a request-first scenario, as plain data: which
 * artist profiles are verified humans (all fixture tracks share one uploader
 * profile) and which tracks the listener recently played. Shared by both runners.
 */
export function goldenPolicyContext(options: { verifiedArtistIds?: string[]; playedTrackIds?: string[] } = {}) {
  return {
    loadContext: async () => ({
      verifiedHumanArtistIds: new Set(options.verifiedArtistIds ?? []),
      playedArtistIds: new Set<string>(),
    }),
    artistKeysForTracks: async () => new Map<string, string>(),
    countDiscoveryPicks: async () => 0,
    recentPlayedTrackIds: async () => options.playedTrackIds ?? [],
  };
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
  artists?: SessionArtistResolver,
  retrievalVariant?: string,
): Promise<GoldenCaseResult> {
  const preferences = await preferencesFor(goldenCase.request, artists);
  const result = await selector.select({
    ...deterministicSelectorInput({
      userId: `${idPrefix}user`,
      recentTrackIds: [],
      preferences,
      limit: GOLDEN_SELECTION_LIMIT,
    }),
    // Offline evaluation pins the variant; production reads the assignment.
    ...(retrievalVariant ? { retrievalVariant } : {}),
  });
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
  artists?: SessionArtistResolver,
  retrievalVariant?: string,
): Promise<GoldenCaseResult[]> {
  const results: GoldenCaseResult[] = [];
  for (const goldenCase of cases) {
    results.push(await runGoldenCase(selector, goldenCase, idPrefix, artists, retrievalVariant));
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

// ---------------------------------------------------------------------------
// Variant comparison (#2242): the current path against `hybrid_rrf_v1`
// ---------------------------------------------------------------------------

/** Per-case recall of the current path next to the hybrid variant, with the means. */
export function goldenComparisonMarkdown(
  current: readonly GoldenCaseResult[],
  hybrid: readonly GoldenCaseResult[],
): string {
  const byId = new Map(hybrid.map((item) => [item.id, item]));
  const rows = current.map((item) => {
    const other = byId.get(item.id) as GoldenCaseResult;
    return `| ${item.id} | ${pct(item.recallAt10)} -> ${pct(other.recallAt10)} | ${pct(item.recallAt20)} -> ${pct(other.recallAt20)} | ${item.candidateCount} -> ${other.candidateCount} |`;
  });
  const scored = (items: readonly GoldenCaseResult[]) => items.filter((item) => item.recallAt10 !== null);
  const meanOf = (items: readonly GoldenCaseResult[], pick: (item: GoldenCaseResult) => number | null) =>
    mean(scored(items).map((item) => pick(item) as number));
  return [
    "| Case | Recall@10 (current -> hybrid) | Recall@20 (current -> hybrid) | Candidates |",
    "| --- | --- | --- | --- |",
    ...rows,
    `| **Mean** | ${pct(meanOf(current, (i) => i.recallAt10))} -> ${pct(meanOf(hybrid, (i) => i.recallAt10))} | ${pct(meanOf(current, (i) => i.recallAt20))} -> ${pct(meanOf(hybrid, (i) => i.recallAt20))} | |`,
  ].join("\n");
}

/** No case may do worse under the hybrid variant than under the current path. */
export function expectNoHybridRegression(
  current: readonly GoldenCaseResult[],
  hybrid: readonly GoldenCaseResult[],
): void {
  expect(hybrid.map((item) => item.id)).toEqual(current.map((item) => item.id));
  current.forEach((item, index) => {
    const other = hybrid[index];
    if (item.unmet) {
      expect({ case: item.id, ...other.unmet }).toMatchObject({ case: item.id, honest: true });
      return;
    }
    expect({ case: item.id, recallAt10: (other.recallAt10 as number) >= (item.recallAt10 as number) - EPSILON })
      .toEqual({ case: item.id, recallAt10: true });
    expect({ case: item.id, recallAt20: (other.recallAt20 as number) >= (item.recallAt20 as number) - EPSILON })
      .toEqual({ case: item.id, recallAt20: true });
  });
}

// ---------------------------------------------------------------------------
// Held-back scenario (#2242): what the first batch leaves out, and why
// ---------------------------------------------------------------------------

/**
 * Runs one request at the DJ's default selection target (`getAgentTrackLimit()`,
 * 12) over its own catalog and returns the first batch (track keys, best first)
 * and what the selector held back.
 */
export async function runHeldBackScenario(
  selector: AgentSelectorService,
  idPrefix: string,
  request: GoldenRequest,
  retrievalVariant?: string,
) {
  const result = await selector.select({
    ...deterministicSelectorInput({
      userId: `${idPrefix}user`,
      recentTrackIds: [],
      preferences: await preferencesFor(request, fixtureArtistResolver(HELD_BACK_CATALOG)),
      limit: getAgentTrackLimit(),
    }),
    ...(retrievalVariant ? { retrievalVariant } : {}),
  });
  const toKey = (id: string) => (id.startsWith(idPrefix) ? id.slice(idPrefix.length) : id);
  return {
    firstBatch: result.selected.map((track) => toKey(track.id)),
    heldBack: result.heldBack,
    capRelaxed: result.capRelaxed,
    shortfallReason: result.shortfallReason,
  };
}

// ---------------------------------------------------------------------------
// Request-first scenarios (#2316)
// ---------------------------------------------------------------------------

export interface RequestFirstScenarioOptions {
  /** Track keys the session already holds (kept out of the search, never repeated). */
  sessionTracks?: readonly string[];
  /** Track keys Home has shown the listener (impressions); a request-first session ignores them. */
  servedOnHome?: readonly string[];
  /** Track keys the listener recently played (a gentle step down inside the tier). */
  playedRecently?: readonly string[];
  /** Make the fixture uploader profile a verified human, so exploration slots exist. */
  verifiedUploader?: boolean;
  /** Batch size; default is the DJ's own target. */
  limit?: number;
  retrievalVariant?: string;
}

/**
 * Runs one request over a request-first catalog and returns what the first
 * batch holds, with the tier and reason of each pick and what the batch says
 * about itself (cap relaxation, a short batch).
 */
export async function runRequestFirstScenario(
  selector: AgentSelectorService,
  idPrefix: string,
  catalog: readonly GoldenTrack[],
  request: GoldenRequest,
  options: RequestFirstScenarioOptions = {},
) {
  const withPrefix = (key: string) => `${idPrefix}${key}`;
  const result = await selector.select({
    ...deterministicSelectorInput({
      userId: `${idPrefix}user`,
      recentTrackIds: (options.sessionTracks ?? []).map(withPrefix),
      preferences: await preferencesFor(request, fixtureArtistResolver(catalog)),
      limit: options.limit ?? getAgentTrackLimit(),
    }),
    ...(options.retrievalVariant ? { retrievalVariant: options.retrievalVariant } : {}),
  });
  const toKey = (id: string) => (id.startsWith(idPrefix) ? id.slice(idPrefix.length) : id);
  return {
    selected: result.selected.map((track) => toKey(track.id)),
    tiers: Object.fromEntries(result.selected.map((track) => [toKey(track.id), track.requestTier])),
    /** Picks that carry the gentle "played recently" step (not the -100 duplicate penalty). */
    playedStep: result.selected
      .filter((track) =>
        (track.agentRecommendation?.signals ?? []).some(
          (signal) => signal.label === "recently_played" && signal.weight === -10,
        ),
      )
      .map((track) => toKey(track.id)),
    discoveryPicks: result.selected
      .filter((track) => track.agentRecommendation?.reasonCode === "discovery_pick")
      .map((track) => toKey(track.id)),
    candidates: result.candidates.map(toKey),
    reason: result.reason,
    capRelaxed: result.capRelaxed,
    shortfallReason: result.shortfallReason,
    heldBack: result.heldBack,
  };
}

/** The selector for a request-first scenario, with its Home, played-history and policy lookups as data. */
export function buildScenarioSelector(
  tools: unknown,
  audioFeatures: AgentAudioFeatureService,
  idPrefix: string,
  options: RequestFirstScenarioOptions = {},
) {
  return buildGoldenSelector(tools, audioFeatures, {
    policyContext: goldenPolicyContext({
      verifiedArtistIds: options.verifiedUploader ? [`${idPrefix}uploader`] : [],
      playedTrackIds: (options.playedRecently ?? []).map((key) => `${idPrefix}${key}`),
    }),
    recommendations: {
      getServedHistory: async () => (options.servedOnHome ?? []).map((key) => `${idPrefix}${key}`),
    },
  });
}
