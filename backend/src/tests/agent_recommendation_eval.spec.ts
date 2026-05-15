import { existsSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import { AgentRecommendationEvalService } from "../modules/agents/agent_recommendation_eval.service";

describe("agent recommendation evals", () => {
  const artifactPath = resolve(process.cwd(), "eval-results/agent-recommendation-results.json");
  const summaryPath = resolve(process.cwd(), "eval-results/agent-recommendation-summary.md");

  beforeEach(() => {
    for (const path of [artifactPath, summaryPath]) {
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
});
