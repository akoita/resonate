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
import { prisma } from "../db/prisma";
import { AgentAudioFeatureService } from "../modules/agents/agent_audio_feature.service";
import { AgentSessionArtistResolver } from "../modules/agents/agent_session_artist_resolver";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackDescriptorTagger } from "../modules/descriptors/track_descriptor_tagger";
import { GOLDEN_CASES, GOLDEN_CATALOG } from "./dj_retrieval_golden/fixtures";
import {
  buildGoldenReport,
  buildGoldenSelector,
  expectGoldenBaselines,
  FixtureAudioFeatureService,
  goldenReportMarkdown,
  GoldenCaseResult,
  InMemoryGoldenTools,
  runGoldenCases,
  scopeToIdPrefix,
  stemFeaturesPayload,
  writeGoldenReport,
} from "./dj_retrieval_golden/harness";

const TEST_PREFIX = `djgold_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}uploader`;

describe("AI DJ retrieval golden set (integration)", () => {
  const originalProvider = process.env.TRACK_EMBEDDING_PROVIDER;
  let results: GoldenCaseResult[] = [];

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "disabled";

    await prisma.user.create({ data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: USER_ID,
        displayName: "Fixture uploader",
        payoutAddress: `0x${"d".repeat(40)}`,
      },
    });

    // Newest first, and newer than anything another suite left behind, so the
    // catalog's newest-first order is the fixture's order.
    const newest = Date.now() + 60_000;
    const createdAt = (index: number) => new Date(newest - index * 1000);

    await prisma.release.createMany({
      data: GOLDEN_CATALOG.map((track, index) => ({
        id: `${TEST_PREFIX}rel_${track.key}`,
        artistId: ARTIST_ID,
        title: track.releaseTitle ?? track.title,
        primaryArtist: track.artist,
        genre: track.genre,
        moods: track.moods ?? [],
        status: "published",
        createdAt: createdAt(index),
      })),
    });
    await prisma.track.createMany({
      data: GOLDEN_CATALOG.map((track, index) => ({
        id: `${TEST_PREFIX}${track.key}`,
        releaseId: `${TEST_PREFIX}rel_${track.key}`,
        title: track.title,
        artist: track.artist,
        explicit: Boolean(track.explicit),
        position: 1,
        createdAt: createdAt(index),
      })),
    });
    await prisma.stem.createMany({
      data: GOLDEN_CATALOG.map((track) => ({
        id: `${TEST_PREFIX}stem_${track.key}`,
        trackId: `${TEST_PREFIX}${track.key}`,
        type: "original",
        uri: `local://${TEST_PREFIX}${track.key}.wav`,
        isCurrent: true,
        durationSeconds: 200,
        ...(track.measured ? { audioFeatures: stemFeaturesPayload(track.measured) } : {}),
      })),
    });

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

    const report = buildGoldenReport("real catalog.search over Postgres (integration)", results);
    const { jsonPath } = writeGoldenReport(report, "dj-retrieval-golden-results-postgres");
    // eslint-disable-next-line no-console
    console.log(`${goldenReportMarkdown(report)}\nReport: ${jsonPath}`);
  });

  afterAll(async () => {
    if (originalProvider === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;
    else process.env.TRACK_EMBEDDING_PROVIDER = originalProvider;
    await prisma.stem.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
  });

  it("runs every golden case", () => {
    expect(results.map((item) => item.id)).toEqual(GOLDEN_CASES.map((item) => item.id));
  });

  it("meets the recorded recall@10 / recall@20 baseline for every case", () => {
    expect(results.filter((item) => item.status === "regressed")).toEqual([]);
    expectGoldenBaselines(results);
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
  });
});
