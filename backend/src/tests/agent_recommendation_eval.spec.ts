import { existsSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  AGENT_RECOMMENDATION_MODEL_COMPARISON_SCHEMA_VERSION,
  AgentRecommendationEvalService,
} from "../modules/agents/agent_recommendation_eval.service";

describe("agent recommendation evals", () => {
  const artifactPath = resolve(process.cwd(), "eval-results/agent-recommendation-results.json");
  const summaryPath = resolve(process.cwd(), "eval-results/agent-recommendation-summary.md");
  const comparisonArtifactPath = resolve(process.cwd(), "eval-results/agent-recommendation-model-comparison.json");
  const comparisonSummaryPath = resolve(process.cwd(), "eval-results/agent-recommendation-model-comparison.md");

  beforeEach(() => {
    for (const path of [artifactPath, summaryPath, comparisonArtifactPath, comparisonSummaryPath]) {
      if (existsSync(path)) rmSync(path);
    }
  });

  it("writes replayable recommendation quality artifacts", () => {
    const service = new AgentRecommendationEvalService();
    const { report, artifactPath: writtenArtifact, summaryPath: writtenSummary } =
      service.runAndWriteArtifact([
        {
          id: "exact-hip-hop-match",
          description: "Exact Hip Hop taste selects a listed Hip Hop candidate with explanation evidence.",
          selectedTrackIds: ["hip-hop-track"],
          candidateTrackIds: ["hip-hop-track", "ambient-track"],
          selectedCandidates: [
            {
              trackId: "hip-hop-track",
              title: "Late Night Cipher",
              relevance: "exact",
              score: 64,
              hasListing: true,
              recent: false,
              explanation: ["Selected vibe match", "Purchasable stem available"],
              signals: [
                { label: "taste_match", weight: 40, reason: "matches selected taste Hip Hop" },
                { label: "listed", weight: 14, reason: "has active stem listing" },
              ],
            },
          ],
          rejectedCandidates: [{ trackId: "ambient-track", reason: "taste_mismatch" }],
          expected: {
            status: "selected",
            requiredTrackIds: ["hip-hop-track"],
            forbiddenTrackIds: ["ambient-track"],
            maxSelected: 1,
            minPrecision: 1,
            requireListed: true,
            forbidRecent: true,
            requireExplanation: true,
          },
          dimensions: ["tasteMatch", "listingAvailability", "novelty", "explanationCoverage"],
        },
        {
          id: "semantic-rap-match",
          description: "Hip Hop taste can select a nearby Rap candidate without dumping unrelated tracks.",
          selectedTrackIds: ["rap-track"],
          candidateTrackIds: ["rap-track", "ambient-track"],
          selectedCandidates: [
            {
              trackId: "rap-track",
              title: "Pocket Flow",
              relevance: "semantic",
              score: 52,
              hasListing: true,
              recent: false,
              explanation: ["Nearby vibe match", "Semantic similarity"],
              signals: [
                { label: "expanded_taste_match", weight: 28, reason: "matches nearby taste rap" },
                { label: "semantic_similarity", weight: 10, reason: "ranked by text embedding similarity" },
              ],
            },
          ],
          rejectedCandidates: [{ trackId: "ambient-track", reason: "taste_mismatch" }],
          expected: {
            status: "selected",
            requiredTrackIds: ["rap-track"],
            forbiddenTrackIds: ["ambient-track"],
            maxSelected: 1,
            minPrecision: 1,
            requireListed: true,
            forbidRecent: true,
            requireExplanation: true,
          },
          dimensions: ["semanticMatch", "noCatalogDump", "listingAvailability", "novelty", "explanationCoverage"],
        },
        {
          id: "recent-track-refusal",
          description: "A strong but recently played candidate is rejected instead of replayed.",
          selectedTrackIds: ["fresh-track"],
          candidateTrackIds: ["recent-track", "fresh-track"],
          selectedCandidates: [
            {
              trackId: "fresh-track",
              relevance: "exact",
              score: 46,
              hasListing: true,
              recent: false,
              explanation: ["Selected vibe match"],
              signals: [{ label: "taste_match", weight: 40, reason: "matches selected taste Techno" }],
            },
          ],
          rejectedCandidates: [{ trackId: "recent-track", reason: "recently_played" }],
          expected: {
            status: "selected",
            requiredTrackIds: ["fresh-track"],
            forbiddenTrackIds: ["recent-track"],
            maxSelected: 1,
            minPrecision: 1,
            forbidRecent: true,
            requireExplanation: true,
          },
          dimensions: ["tasteMatch", "recentAvoidance", "novelty", "explanationCoverage"],
        },
        {
          id: "reggaeton-no-match",
          description: "Explicit taste miss should return no tracks.",
          selectedTrackIds: [],
          candidateTrackIds: ["ambient-track", "pop-track"],
          candidateDetails: [
            { trackId: "ambient-track", relevance: "unrelated", score: 0, hasListing: true },
            { trackId: "pop-track", relevance: "unrelated", score: 0, hasListing: true },
          ],
          rejectedCandidates: [
            { trackId: "ambient-track", reason: "taste_mismatch" },
            { trackId: "pop-track", reason: "taste_mismatch" },
          ],
          expected: { status: "no_tracks", maxSelected: 0 },
          dimensions: ["refusalCorrectness", "noCatalogDump"],
        },
      ]);

    expect(report.schemaVersion).toBe("agent-recommendation-eval/v1");
    expect(report.metrics.passRate).toBe(1);
    expect(report.metrics.precision).toBe(1);
    expect(report.metrics.refusalCorrectness).toBe(1);
    expect(report.metrics.listingCoverage).toBe(1);
    expect(report.metrics.noveltyCoverage).toBe(1);
    expect(report.metrics.explanationCoverage).toBe(1);
    expect(writtenArtifact).toBe(artifactPath);
    expect(writtenSummary).toBe(summaryPath);
    expect(JSON.parse(readFileSync(artifactPath, "utf8")).metrics.total).toBe(4);
    expect(readFileSync(summaryPath, "utf8")).toContain("Agent Recommendation Eval Report");
    expect(readFileSync(summaryPath, "utf8")).toContain("semantic-rap-match");
    expect(readFileSync(summaryPath, "utf8")).toContain("Precision: 100%");
  });

  it("fails when a no-match case selects unrelated tracks", () => {
    const service = new AgentRecommendationEvalService();
    const report = service.run([
      {
        id: "bad-catalog-dump",
        description: "Regression fixture.",
        selectedTrackIds: ["ambient-track", "pop-track"],
        candidateTrackIds: ["ambient-track", "pop-track"],
        selectedCandidates: [
          { trackId: "ambient-track", relevance: "unrelated", score: 12 },
          { trackId: "pop-track", relevance: "unrelated", score: 8 },
        ],
        expected: { status: "no_tracks", maxSelected: 0 },
        dimensions: ["refusalCorrectness", "noCatalogDump"],
      },
    ]);

    expect(report.metrics.failed).toBe(1);
    expect(report.results[0].failures).toEqual(expect.arrayContaining([
      "expected no tracks, got ambient-track, pop-track",
      "strict no-match case selected unrelated catalog candidates",
      "selected 2, max 0",
    ]));
  });

  it("fails semantic-match cases below the configured precision threshold", () => {
    const service = new AgentRecommendationEvalService();
    const report = service.run([
      {
        id: "semantic-precision-regression",
        description: "Regression fixture.",
        selectedTrackIds: ["rap-track", "ambient-track"],
        candidateTrackIds: ["rap-track", "ambient-track"],
        selectedCandidates: [
          { trackId: "rap-track", relevance: "semantic", score: 50, explanation: ["Nearby vibe match"] },
          { trackId: "ambient-track", relevance: "unrelated", score: 49, explanation: ["Catalog candidate"] },
        ],
        expected: {
          status: "selected",
          requiredTrackIds: ["rap-track"],
          forbiddenTrackIds: ["ambient-track"],
          minPrecision: 1,
          maxSelected: 2,
          requireExplanation: true,
        },
        dimensions: ["semanticMatch", "noCatalogDump", "explanationCoverage"],
      },
    ]);

    expect(report.metrics.failed).toBe(1);
    expect(report.results[0].metrics.precision).toBe(0.5);
    expect(report.results[0].selectedCandidates[0].topSignals).toEqual([]);
    expect(report.results[0].failures).toEqual(expect.arrayContaining([
      "selected forbidden track ambient-track",
      "precision 0.5 below minimum 1",
    ]));
  });

  it("compares deterministic, warehouse baseline, and BigQuery ML candidates before promotion", () => {
    const service = new AgentRecommendationEvalService();
    const { report, artifactPath: writtenArtifact, summaryPath: writtenSummary } =
      service.runModelComparisonAndWriteArtifact([
        {
          id: "bqml-avoids-skip-and-finds-listed-neighbor",
          description: "BQML ranks an accepted semantic neighbor above a skipped catalog neighbor.",
          k: 2,
          candidates: [
            {
              trackId: "cipher",
              title: "Late Night Cipher",
              relevance: "exact",
              accepted: true,
              skipped: false,
              hasListing: true,
              recent: false,
              genre: "hip-hop",
              artistId: "artist-a",
              explanation: ["Selected vibe match"],
              signals: [{ label: "taste_match", weight: 40, reason: "matches Hip Hop taste" }],
              variantScores: { deterministic: 0.95, warehouse_baseline: 0.8, bqml: 0.95 },
            },
            {
              trackId: "pocket-flow",
              title: "Pocket Flow",
              relevance: "semantic",
              accepted: true,
              skipped: false,
              hasListing: true,
              recent: false,
              genre: "rap",
              artistId: "artist-b",
              explanation: ["Semantic neighbor"],
              signals: [{ label: "semantic_similarity", weight: 14, reason: "nearby lyrical pocket" }],
              variantScores: { deterministic: 0.72, warehouse_baseline: 0.7, bqml: 0.92 },
            },
            {
              trackId: "ambient-drift",
              title: "Ambient Drift",
              relevance: "unrelated",
              accepted: false,
              skipped: true,
              hasListing: false,
              recent: false,
              genre: "ambient",
              artistId: "artist-c",
              variantScores: { deterministic: 0.86, warehouse_baseline: 0.76, bqml: 0.11 },
            },
          ],
        },
        {
          id: "bqml-preserves-novelty",
          description: "BQML keeps the fresh pick above a recently skipped replay.",
          k: 2,
          candidates: [
            {
              trackId: "fresh-techno",
              relevance: "exact",
              accepted: true,
              skipped: false,
              hasListing: true,
              recent: false,
              genre: "techno",
              artistId: "artist-d",
              explanation: ["Fresh match"],
              variantScores: { deterministic: 0.9, warehouse_baseline: 0.82, bqml: 0.93 },
            },
            {
              trackId: "warm-electro",
              relevance: "semantic",
              accepted: true,
              skipped: false,
              hasListing: true,
              recent: false,
              genre: "electro",
              artistId: "artist-e",
              explanation: ["Nearby energy curve"],
              variantScores: { deterministic: 0.62, warehouse_baseline: 0.65, bqml: 0.9 },
            },
            {
              trackId: "recent-techno",
              relevance: "exact",
              accepted: false,
              skipped: true,
              hasListing: true,
              recent: true,
              genre: "techno",
              artistId: "artist-d",
              variantScores: { deterministic: 0.88, warehouse_baseline: 0.8, bqml: 0.2 },
            },
          ],
        },
      ]);

    expect(report.schemaVersion).toBe(AGENT_RECOMMENDATION_MODEL_COMPARISON_SCHEMA_VERSION);
    expect(report.promotion.bqmlBeatsBaseline).toBe(true);
    expect(report.promotion.recommendation).toBe("promote_bqml_staging_table");
    expect(report.metrics.variants.bqml.precision).toBe(1);
    expect(report.metrics.variants.bqml.skipAvoidance).toBe(1);
    expect(report.metrics.variants.bqml.listingCoverage).toBe(1);
    expect(report.metrics.variants.bqml.overallScore)
      .toBeGreaterThan(report.metrics.variants.warehouse_baseline.overallScore ?? 0);
    expect(writtenArtifact).toBe(comparisonArtifactPath);
    expect(writtenSummary).toBe(comparisonSummaryPath);
    expect(JSON.parse(readFileSync(comparisonArtifactPath, "utf8")).promotion.bqmlBeatsBaseline).toBe(true);
    expect(readFileSync(comparisonSummaryPath, "utf8")).toContain("BQML beats baseline: yes");
  });

  it("holds baseline when BigQuery ML comparison metrics regress", () => {
    const service = new AgentRecommendationEvalService();
    const report = service.runModelComparison([
      {
        id: "bqml-regression",
        description: "BQML over-ranks an unlisted skipped candidate.",
        k: 2,
        candidates: [
          {
            trackId: "listed-match",
            relevance: "exact",
            accepted: true,
            skipped: false,
            hasListing: true,
            recent: false,
            genre: "house",
            artistId: "artist-a",
            explanation: ["Strong match"],
            variantScores: { deterministic: 0.9, warehouse_baseline: 0.95, bqml: 0.4 },
          },
          {
            trackId: "nearby-match",
            relevance: "semantic",
            accepted: true,
            skipped: false,
            hasListing: true,
            recent: false,
            genre: "deep-house",
            artistId: "artist-b",
            explanation: ["Nearby match"],
            variantScores: { deterministic: 0.86, warehouse_baseline: 0.9, bqml: 0.3 },
          },
          {
            trackId: "skipped-unlisted",
            relevance: "unrelated",
            accepted: false,
            skipped: true,
            hasListing: false,
            recent: true,
            genre: "noise",
            artistId: "artist-c",
            variantScores: { deterministic: 0.2, warehouse_baseline: 0.1, bqml: 0.99 },
          },
        ],
      },
    ]);

    expect(report.promotion.bqmlBeatsBaseline).toBe(false);
    expect(report.promotion.recommendation).toBe("hold_baseline");
    expect(report.promotion.delta.overallScore).toBeLessThan(0);
    expect(report.metrics.variants.bqml.listingCoverage).toBe(0.5);
    expect(report.caseResults[0].variants.bqml.selectedTrackIds).toEqual(["skipped-unlisted", "listed-match"]);
  });
});
