/**
 * ADR-TE-2 rule 6 on the listener AI DJ paths (#1456): having stems for sale is
 * never a reason to rank, prefer, or gate a track. The LLM may still SEE
 * `hasListing` as data; it must not be told to prefer it.
 */
jest.mock("@google/adk", () => ({
  FunctionTool: class {
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options);
    }
  },
  LlmAgent: class {
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options);
    }
  },
}));

import { createCurationAgent } from "../modules/agents/runtime/adk_curation_agent";
import { VertexAiAdapter } from "../modules/agents/runtime/vertex_ai_adapter";
import { ModelAssistedRecommendationAdapter } from "../modules/agents/model_assisted_recommendation.adapter";
import { getToolDeclarations } from "../modules/agents/tools/tool_declarations";
import { AgentRecommendationEvalService } from "../modules/agents/agent_recommendation_eval.service";

/** Any wording that tells a model to favor listed / purchasable tracks. */
const LISTING_PREFERENCE =
  /(prefer(red)?|prioriti[sz]e|favou?r|boost|rank (higher|first))[^.\n]{0,80}(hasListing|listed|listing|purchasable)|(hasListing|listed|listing|purchasable)[^.\n]{0,80}(prefer(red)?|prioriti[sz]e|first|higher)/i;

/** Drops sentences that forbid preferring (they legitimately name the words). */
const affirmative = (text: string) =>
  text
    .split(/[.\n]/)
    .filter((sentence) => !/\b(never|not)\b/i.test(sentence))
    .join("\n");

describe("listing is not a preference input on listener AI paths", () => {
  it("the ADK agent prompt and tool descriptions do not ask for listed tracks", () => {
    const agent: any = createCurationAgent({ get: jest.fn() } as any);
    expect(agent.instruction).not.toMatch(/STRONGLY PREFER/i);
    expect(affirmative(agent.instruction)).not.toMatch(LISTING_PREFERENCE);
    expect(agent.instruction).toContain("never prefer or avoid a track because of it");
    for (const tool of agent.tools ?? []) {
      expect(affirmative(`${tool.description}`)).not.toMatch(LISTING_PREFERENCE);
    }
  });

  it("the Vertex adapter prompt does not ask for listed tracks", () => {
    const prompt: string = (new VertexAiAdapter({} as any) as any).buildSystemPrompt({});
    expect(prompt).not.toMatch(/STRONGLY PREFER/i);
    expect(affirmative(prompt)).not.toMatch(LISTING_PREFERENCE);
    expect(prompt).toContain("never prefer or avoid a track because of it");
  });

  it("the function declarations describe hasListing as data, not a preference", () => {
    const search = getToolDeclarations().find((tool) => tool.name === "catalog_search");
    expect(search?.description).toContain("hasListing");
    expect(affirmative(search?.description ?? "")).not.toMatch(LISTING_PREFERENCE);
  });

  it("the model-assisted ranking instruction does not prefer listed tracks", () => {
    const instruction: string = (
      new ModelAssistedRecommendationAdapter({} as any) as any
    ).systemInstruction();
    expect(affirmative(instruction)).not.toMatch(LISTING_PREFERENCE);
    expect(instruction).toContain("never a reason to prefer or avoid a track");
  });

  it("the recommendation eval reports listing coverage but never scores or gates on it", () => {
    const service = new AgentRecommendationEvalService();
    const candidate = (hasListing: boolean) => ({
      trackId: "t1",
      relevance: "exact" as const,
      accepted: true,
      skipped: false,
      hasListing,
      recent: false,
      genre: "house",
      artistId: "a1",
      explanation: ["Selected vibe match"],
      variantScores: { deterministic: 0.9, warehouse_baseline: 0.8, bqml: 0.95 },
    });
    const run = (hasListing: boolean) =>
      service.runModelComparison([
        { id: "c", description: "same", k: 1, candidates: [candidate(hasListing)] },
      ]);
    const listed = run(true);
    const unlisted = run(false);

    // Informational metric still reported...
    expect(listed.metrics.variants.bqml.listingCoverage).toBe(1);
    expect(unlisted.metrics.variants.bqml.listingCoverage).toBe(0);
    // ...but it moves neither the score nor the promotion decision.
    expect(unlisted.metrics.variants.bqml.overallScore).toBe(
      listed.metrics.variants.bqml.overallScore,
    );
    expect(unlisted.promotion.recommendation).toBe(listed.promotion.recommendation);
    expect(unlisted.promotion.criteria).not.toHaveProperty("minListingCoverage");

    // A single-case eval with unlisted picks passes: there is no listing gate.
    const single = service.run([
      {
        id: "unlisted-ok",
        description: "An unlisted exact match is a good pick",
        selectedTrackIds: ["t1"],
        candidateTrackIds: ["t1"],
        selectedCandidates: [
          {
            trackId: "t1",
            relevance: "exact",
            hasListing: false,
            recent: false,
            explanation: ["Selected vibe match"],
          },
        ],
        expected: { status: "selected", requiredTrackIds: ["t1"], minPrecision: 1 },
        dimensions: ["tasteMatch"],
      },
    ]);
    expect(single.metrics.passRate).toBe(1);
    expect(single.metrics.listingCoverage).toBe(0);
  });
});
