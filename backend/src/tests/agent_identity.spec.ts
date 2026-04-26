import {
  buildAgentRegistrationFile,
  buildAgentRegistryId,
  computeAgentReputationSnapshot,
  toDataUriJson,
} from "../modules/agents/agent_identity.service";

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

  it("builds ERC-8004 registry identifiers", () => {
    expect(buildAgentRegistryId(84532, "0x1234567890123456789012345678901234567890"))
      .toBe("eip155:84532:0x1234567890123456789012345678901234567890");
  });

  it("builds an ERC-8004 registration file from agent config", () => {
    const file = buildAgentRegistrationFile({
      config: {
        id: "agent_1",
        userId: "0xowner",
        name: "Koita DJ",
        vibes: ["House", "Jazz"],
        stemTypes: ["drums"],
        sessionMode: "curate",
        monthlyCapUsd: 10,
        isActive: true,
        identityStatus: "minted",
        identityChainId: 84532,
        identityRegistry: "0x1234567890123456789012345678901234567890",
        identityTokenId: "42",
        identityTxHash: "0xtx",
        identityCredential: null,
        learnedTasteProfile: null,
        tasteScore: 0,
        tasteUpdatedAt: null,
        reputationScore: 0,
        reputationSnapshot: null,
        reputationAttestedAt: null,
        reputationTxHash: null,
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
      },
      chainId: 84532,
      registry: "0x1234567890123456789012345678901234567890",
      publicBaseUrl: "https://staging.resonate.pydes.xyz/",
    });

    expect(file.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(file.name).toBe("Koita DJ");
    expect(file.services).toEqual([
      { name: "web", endpoint: "https://staging.resonate.pydes.xyz" },
      { name: "MCP", endpoint: "https://staging.resonate.pydes.xyz/mcp", version: "2025-06-18" },
    ]);
    expect(file.registrations).toEqual([{
      agentId: "42",
      agentRegistry: "eip155:84532:0x1234567890123456789012345678901234567890",
    }]);
    expect(file.supportedTrust).toEqual(["reputation"]);
  });

  it("encodes registration files as data URI JSON", () => {
    const uri = toDataUriJson({ hello: "agent" });
    const encoded = uri.replace("data:application/json;base64,", "");

    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))).toEqual({ hello: "agent" });
  });
});
