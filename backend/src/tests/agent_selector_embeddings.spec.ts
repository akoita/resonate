/**
 * #1452 WS-5: the selector's use of `embeddings.similarity`. The tool reports
 * `{ ranked: [], status: "unavailable" }` when the provider is off or failing,
 * and embedding coverage can be partial; in both cases no candidate may be
 * dropped. Pure unit test: both tools are stubbed, no database.
 */
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

function item(id: string) {
  return {
    id,
    title: id,
    hasListing: false,
    release: { genre: "House", title: `${id} release`, moods: [] },
  };
}

function selectorWith(similarity: Record<string, unknown>) {
  const similarityRun = jest.fn().mockResolvedValue(similarity);
  const tools = {
    get: jest.fn((name: string) =>
      name === "embeddings.similarity"
        ? { run: similarityRun }
        : { run: jest.fn().mockResolvedValue({ items: [item("a"), item("b"), item("c")] }) },
    ),
  };
  return {
    selector: new AgentSelectorService(tools as any, new DiscoveryRankingService()),
    similarityRun,
  };
}

describe("AgentSelectorService embeddings step (#1452)", () => {
  it("keeps every candidate when the embedding provider is unavailable", async () => {
    const { selector, similarityRun } = selectorWith({ ranked: [], status: "unavailable" });
    const result = await selector.select({
      queries: ["House"],
      recentTrackIds: [],
      useEmbeddings: true,
    });
    expect(similarityRun).toHaveBeenCalledTimes(1);
    expect([...result.candidates].sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps candidates that have no vector yet after the ranked ones", async () => {
    const { selector } = selectorWith({
      ranked: [{ trackId: "b", score: 0.9 }],
      status: "ok",
    });
    const result = await selector.select({
      queries: ["House"],
      recentTrackIds: [],
      useEmbeddings: true,
    });
    expect([...result.candidates].sort()).toEqual(["a", "b", "c"]);
  });
});
