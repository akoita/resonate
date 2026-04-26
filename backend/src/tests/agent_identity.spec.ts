import { computeAgentReputationSnapshot } from "../modules/agents/agent_identity.service";

describe("agent identity reputation scoring", () => {
  it("keeps a new agent at the new tier with no activity", () => {
    const snapshot = computeAgentReputationSnapshot(
      {
        sessions: 0,
        tracksCurated: 0,
        totalSpendUsd: 0,
        monthlyCapUsd: 10,
        genresExplored: [],
      },
      new Date("2026-04-26T00:00:00.000Z"),
    );

    expect(snapshot.score).toBe(0);
    expect(snapshot.tier).toBe("New");
    expect(snapshot.acceptanceRate).toBe(0);
    expect(snapshot.budgetUtilization).toBe(0);
    expect(snapshot.updatedAt).toBe("2026-04-26T00:00:00.000Z");
  });

  it("rewards curated tracks, budget usage, and genre diversity", () => {
    const snapshot = computeAgentReputationSnapshot({
      sessions: 4,
      tracksCurated: 6,
      totalSpendUsd: 7.5,
      monthlyCapUsd: 10,
      genresExplored: ["House", "Soul", "House", "Jazz"],
    });

    expect(snapshot.score).toBeGreaterThanOrEqual(80);
    expect(snapshot.tier).toBe("Proven");
    expect(snapshot.genresExplored).toEqual(["House", "Soul", "Jazz"]);
    expect(snapshot.acceptanceRate).toBe(1);
    expect(snapshot.budgetUtilization).toBe(0.75);
    expect(snapshot.tasteDepth).toBeGreaterThan(0.7);
  });
});
