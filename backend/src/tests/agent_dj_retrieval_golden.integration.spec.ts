/**
 * AI DJ retrieval golden set (#2235), against real Postgres (Testcontainers).
 *
 * Seeds the golden catalog under a unique prefix and runs every golden case
 * through the real session path with the real `catalog.search` SQL and the
 * real audio-feature service, then asserts the recorded recall baselines and
 * writes the per-case report. A failing case is kept as a known gap with the
 * baseline the current ranker achieves; this suite never asserts more.
 *
 * Every seeded track is tagged with the real deterministic tagger first (#2240),
 * so the numbers include the stored track descriptor, as production reads it.
 *
 * Embedding-backed semantic retrieval is off (TRACK_EMBEDDING_PROVIDER=disabled):
 * the report measures the deterministic path only.
 *
 * The Docker-free twin in agent_golden_eval.spec.ts (npm run eval:golden) runs
 * the same cases over an in-memory copy of this catalog; the last test here
 * checks the two report the same numbers, so the twin cannot drift.
 *
 * Run: npm run test:integration -- agent_dj_retrieval_golden
 */
import { AgentAudioFeatureService } from "../modules/agents/agent_audio_feature.service";
import { AgentSessionArtistResolver } from "../modules/agents/agent_session_artist_resolver";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackDescriptorTagger } from "../modules/descriptors/track_descriptor_tagger";
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import {
  CAP_IDENTITY_CATALOG,
  GOLDEN_CASES,
  GOLDEN_CATALOG,
  HELD_BACK_CATALOG,
  REQUEST_FIRST_CATALOG,
  HELD_BACK_EXPECTED_FIRST_BATCH,
  HELD_BACK_REQUEST,
} from "./dj_retrieval_golden/fixtures";
import { cleanGoldenCatalog, seedGoldenCatalog } from "./dj_retrieval_golden/seed";
import {
  buildGoldenReport,
  buildGoldenSelector,
  expectGoldenBaselines,
  FixtureAudioFeatureService,
  expectNoHybridRegression,
  goldenComparisonMarkdown,
  goldenReportMarkdown,
  GoldenCaseResult,
  InMemoryGoldenTools,
  buildScenarioSelector,
  runGoldenCases,
  runHeldBackScenario,
  runRequestFirstScenario,
  scopeToIdPrefix,
  writeGoldenReport,
} from "./dj_retrieval_golden/harness";
import { registerRequestFirstCases } from "./dj_retrieval_golden/request_first_cases";

const TEST_PREFIX = `djgold_${Date.now()}_`;

describe("AI DJ retrieval golden set (integration)", () => {
  const originalProvider = process.env.TRACK_EMBEDDING_PROVIDER;
  let results: GoldenCaseResult[] = [];
  let hybridResults: GoldenCaseResult[] = [];

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "disabled";

    await seedGoldenCatalog(TEST_PREFIX);

    // #2240: the descriptors exactly as the backfill (deterministic strategy,
    // the default) writes them: the real tagger over the seeded rows.
    const tagged = await new TrackDescriptorTagger({ env: {} }).tagTracks(
      GOLDEN_CATALOG.map((track) => `${TEST_PREFIX}${track.key}`),
      { apply: true },
    );
    expect(tagged).toMatchObject({
      strategy: "deterministic",
      tagged: GOLDEN_CATALOG.length,
      modelCalls: 0,
      failed: 0,
    });

    const tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore());
    const selector = buildGoldenSelector(
      scopeToIdPrefix(tools, TEST_PREFIX),
      new AgentAudioFeatureService(),
    );
    // The real artist lookup too: credited names come from Postgres here.
    results = await runGoldenCases(selector, TEST_PREFIX, GOLDEN_CASES, new AgentSessionArtistResolver());

    // The hybrid_rrf_v1 variant (#2242) over the same real catalog and tools.
    hybridResults = await runGoldenCases(
      selector,
      TEST_PREFIX,
      GOLDEN_CASES,
      new AgentSessionArtistResolver(),
      HYBRID_RETRIEVAL_VARIANT,
    );
    const hybridReport = buildGoldenReport(
      `real catalog.search over Postgres (integration), variant ${HYBRID_RETRIEVAL_VARIANT}`,
      hybridResults,
    );
    writeGoldenReport(hybridReport, "dj-retrieval-golden-results-postgres-hybrid");
    // eslint-disable-next-line no-console
    console.log(goldenComparisonMarkdown(results, hybridResults));

    const report = buildGoldenReport("real catalog.search over Postgres (integration)", results);
    const { jsonPath } = writeGoldenReport(report, "dj-retrieval-golden-results-postgres");
    // eslint-disable-next-line no-console
    console.log(`${goldenReportMarkdown(report)}\nReport: ${jsonPath}`);
  });

  afterAll(async () => {
    if (originalProvider === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;
    else process.env.TRACK_EMBEDDING_PROVIDER = originalProvider;
    await cleanGoldenCatalog(TEST_PREFIX);
  });

  it("runs every golden case", () => {
    expect(results.map((item) => item.id)).toEqual(GOLDEN_CASES.map((item) => item.id));
  });

  it("meets the recorded recall@10 / recall@20 baseline for every case", () => {
    expect(results.filter((item) => item.status === "regressed")).toEqual([]);
    expectGoldenBaselines(results);
  });

  it("hybrid_rrf_v1 meets every baseline and regresses no case against the current path (#2242)", () => {
    expect(hybridResults.filter((item) => item.status === "regressed")).toEqual([]);
    expectGoldenBaselines(hybridResults);
    expectNoHybridRegression(results, hybridResults);
    // Measured low energy retrieves the untagged calm track (was a known gap).
    const calm = hybridResults.find((item) => item.id === "calm-measured-low-energy-no-tag");
    expect(calm?.recallAt20).toBe(1);
  });

  it("keeps explicit tracks out when explicit is off, and an unmatched request honest", () => {
    const blocked = results.find((item) => item.id === "rap-explicit-blocked");
    expect(blocked?.forbiddenOffered).toEqual([]);
    expect(blocked?.rankedKeys).not.toContain("rap_explicit");
    const unmet = results.find((item) => item.id === "unmet-gregorian-chant");
    expect(unmet?.unmet).toEqual({ honest: true, reason: "no_matching_taste_candidates", selected: 0 });
  });

  it("reports the same numbers as the Docker-free twin run by npm run eval:golden", async () => {
    const twinTools = new InMemoryGoldenTools();
    const twinSelector = buildGoldenSelector(
      twinTools,
      new FixtureAudioFeatureService(twinTools.tracksById),
    );
    const twin = await runGoldenCases(twinSelector, "");
    const summary = (items: GoldenCaseResult[]) =>
      items.map(({ id, rankedKeys, recallAt10, recallAt20, retrievedRecall, candidateCount }) => ({
        id,
        rankedKeys,
        recallAt10,
        recallAt20,
        retrievedRecall,
        candidateCount,
      }));
    expect(summary(twin)).toEqual(summary(results));

    const hybridTwin = await runGoldenCases(twinSelector, "", undefined, undefined, HYBRID_RETRIEVAL_VARIANT);
    expect(summary(hybridTwin)).toEqual(summary(hybridResults));
  });
});

describe("AI DJ held-back scenario (integration, real SQL)", () => {
  const prefix = `djheld_${Date.now()}_`;
  const originalProvider = process.env.TRACK_EMBEDDING_PROVIDER;

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
    await seedGoldenCatalog(prefix, HELD_BACK_CATALOG);
    await new TrackDescriptorTagger({ env: {} }).tagTracks(
      HELD_BACK_CATALOG.map((track) => `${prefix}${track.key}`),
      { apply: true },
    );
  });

  afterAll(async () => {
    if (originalProvider === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;
    else process.env.TRACK_EMBEDDING_PROVIDER = originalProvider;
    await cleanGoldenCatalog(prefix);
  });

  it.each([[undefined], [HYBRID_RETRIEVAL_VARIANT]])(
    "hears every playable hip-hop match in the first batch and counts what was held back (variant %s)",
    async (variant) => {
      const tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore());
      const selector = buildGoldenSelector(scopeToIdPrefix(tools, prefix), new AgentAudioFeatureService());

      const { firstBatch, heldBack, capRelaxed, shortfallReason } = await runHeldBackScenario(selector, prefix, HELD_BACK_REQUEST, variant);

      expect([...firstBatch].sort()).toEqual([...HELD_BACK_EXPECTED_FIRST_BATCH].sort());
      expect(firstBatch).not.toContain("hb_b3_explicit");
      expect(heldBack).toEqual({ variety: 0, explicit: 1 });
      expect(capRelaxed).toEqual({ artists: 1, top: { artist: "Marlo Vance", tracks: 3 } });
      expect(shortfallReason).toBe("catalog_short");
    },
  );
});

/**
 * Request-first selection (#2316) against real Postgres: the same cases as the
 * Docker-free twin, over the real `catalog.search` SQL (including the
 * `excludeTrackIds` filter and the excluded-match count) and the real tagger.
 */
describe("AI DJ request-first selection (integration, real SQL)", () => {
  const prefixes = {
    request_first: `djrf_${Date.now()}_`,
    cap_identity: `djci_${Date.now()}_`,
  } as const;
  const catalogs = { request_first: REQUEST_FIRST_CATALOG, cap_identity: CAP_IDENTITY_CATALOG } as const;
  const originalProvider = process.env.TRACK_EMBEDDING_PROVIDER;

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
    for (const kind of ["request_first", "cap_identity"] as const) {
      await seedGoldenCatalog(prefixes[kind], catalogs[kind]);
      await new TrackDescriptorTagger({ env: {} }).tagTracks(
        catalogs[kind].map((track) => `${prefixes[kind]}${track.key}`),
        { apply: true },
      );
    }
  });

  afterAll(async () => {
    if (originalProvider === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;
    else process.env.TRACK_EMBEDDING_PROVIDER = originalProvider;
    for (const kind of ["request_first", "cap_identity"] as const) await cleanGoldenCatalog(prefixes[kind]);
  });

  registerRequestFirstCases(() => async (catalogKind, request, options = {}) => {
    const prefix = prefixes[catalogKind];
    const tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore());
    const selector = buildScenarioSelector(
      scopeToIdPrefix(tools, prefix),
      new AgentAudioFeatureService(),
      prefix,
      options,
    );
    return runRequestFirstScenario(selector, prefix, catalogs[catalogKind], request, options);
  });
});
