/**
 * #2242: the calibrated semantic similarity floor, measured on the golden set
 * with the offline `hash` embedder over real Postgres/pgvector (Testcontainers).
 *
 * The hash embedder is lexical, not semantic, so these cosines are NOT the
 * production model's: the sweep shows how the floor behaves (an unmet request
 * must stay unmet, a relevant track just under the old floor must be reachable),
 * and the chosen constants (agent_runtime.config.ts) are documented as a
 * starting point to re-check against production embeddings, not a tuned value.
 */
import { AgentAudioFeatureService } from "../modules/agents/agent_audio_feature.service";
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import { AgentSessionArtistResolver } from "../modules/agents/agent_session_artist_resolver";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { TrackDescriptorTagger } from "../modules/descriptors/track_descriptor_tagger";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { GOLDEN_CASES, GOLDEN_CATALOG } from "./dj_retrieval_golden/fixtures";
import {
  buildGoldenSelector,
  expectNoHybridRegression,
  GoldenCaseResult,
  runGoldenCases,
  scopeToIdPrefix,
} from "./dj_retrieval_golden/harness";
import { cleanGoldenCatalog, seedGoldenCatalog } from "./dj_retrieval_golden/seed";

const TEST_PREFIX = `djcal_${Date.now()}_`;

describe("AI DJ semantic floor calibration (integration, hash embedder)", () => {
  const original = {
    provider: process.env.TRACK_EMBEDDING_PROVIDER,
    floor: process.env.AGENT_SEMANTIC_MIN_SIMILARITY,
  };
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const tools = new ToolRegistry(
    embeddingService,
    store,
    undefined,
    new TrackEmbeddingService(embeddingService, store),
  );
  const selector = buildGoldenSelector(scopeToIdPrefix(tools, TEST_PREFIX), new AgentAudioFeatureService());
  const run = async (variant: string | undefined, floor: string | undefined) => {
    if (floor === undefined) delete process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
    else process.env.AGENT_SEMANTIC_MIN_SIMILARITY = floor;
    return runGoldenCases(selector, TEST_PREFIX, GOLDEN_CASES, new AgentSessionArtistResolver(), variant);
  };
  const summary = (items: GoldenCaseResult[]) => {
    const scored = items.filter((item) => item.recallAt10 !== null);
    const avg = (pick: (item: GoldenCaseResult) => number | null) =>
      scored.reduce((sum, item) => sum + (pick(item) as number), 0) / scored.length;
    return {
      at10: avg((item) => item.recallAt10),
      at20: avg((item) => item.recallAt20),
      retrieved: avg((item) => item.retrievedRecall),
      candidates: items.reduce((sum, item) => sum + item.candidateCount, 0),
      unmetHonest: items.filter((item) => item.unmet).every((item) => item.unmet?.honest),
    };
  };

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    await seedGoldenCatalog(TEST_PREFIX);
    await new TrackDescriptorTagger({ env: {} }).tagTracks(
      GOLDEN_CATALOG.map((track) => `${TEST_PREFIX}${track.key}`),
      { apply: true },
    );
    await new TrackEmbeddingService(embeddingService, store).embedTracks(
      GOLDEN_CATALOG.map((track) => `${TEST_PREFIX}${track.key}`),
    );
  });

  afterAll(async () => {
    for (const [key, value] of [
      ["TRACK_EMBEDDING_PROVIDER", original.provider],
      ["AGENT_SEMANTIC_MIN_SIMILARITY", original.floor],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await cleanGoldenCatalog(TEST_PREFIX);
  });

  it("keeps every case at or above the current path and an unmet request unmet, at the calibrated floor and far below it", async () => {
    const current = await run(undefined, undefined);
    const calibrated = await run(HYBRID_RETRIEVAL_VARIANT, undefined);
    // 0.3 is well under any sensible floor: the relative margin and the unmet rule must still hold.
    const permissive = await run(HYBRID_RETRIEVAL_VARIANT, "0.3");
    // eslint-disable-next-line no-console
    console.log(
      [
        `current (fixed 0.55 floor)        ${JSON.stringify(summary(current))}`,
        `hybrid, calibrated floor (default) ${JSON.stringify(summary(calibrated))}`,
        `hybrid, absolute floor 0.3         ${JSON.stringify(summary(permissive))}`,
      ].join("\n"),
    );
    for (const variant of [calibrated, permissive]) {
      expectNoHybridRegression(current, variant);
      expect(variant.filter((item) => item.forbiddenOffered.length > 0)).toEqual([]);
    }
  });
});
