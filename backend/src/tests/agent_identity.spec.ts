import {
  AGENT_REPUTATION_METADATA_KEY,
  AGENT_REPUTATION_ATTESTATION_SCHEMA_VERSION,
  buildAgentReputationAttestationPayload,
  computeAgentReputationSnapshot,
  encodeAgentReputationMetadataCall,
} from "../modules/agents/agent_identity.service";
import { decodeFunctionData, hexToString } from "viem";
import {
  ERC8004_MAINNET_IDENTITY_REGISTRY,
  ERC8004_TESTNET_IDENTITY_REGISTRY,
  ERC8004_IDENTITY_ABI,
  buildAgentRegistrationFile,
  buildAgentRegistryId,
  defaultErc8004IdentityRegistry,
  toDataUriJson,
} from "../modules/agents/erc8004_identity";

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
    expect(snapshot.genreBreakdown).toEqual({});
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
    expect(snapshot.genreBreakdown).toEqual({
      House: 0.3333,
      Soul: 0.3333,
      Jazz: 0.3333,
    });
    expect(snapshot.acceptanceRate).toBe(1);
    expect(snapshot.budgetUtilization).toBe(0.75);
    expect(snapshot.tasteDepth).toBeGreaterThan(0.7);
  });

  it("folds curator quality-rating validation into agent reputation", () => {
    const snapshot = computeAgentReputationSnapshot({
      sessions: 0,
      tracksCurated: 0,
      totalSpendUsd: 0,
      monthlyCapUsd: 10,
      genresExplored: ["Soul"],
      stemQualityRatings: 4,
      curatorReputationDelta: 6,
    });

    expect(snapshot.stemQualityRatings).toBe(4);
    expect(snapshot.curatorReputationDelta).toBe(6);
    expect(snapshot.score).toBeGreaterThan(10);
  });

  it("builds a stable ERC-8004 reputation attestation payload", () => {
    const reputation = computeAgentReputationSnapshot(
      {
        sessions: 8,
        tracksCurated: 5,
        totalSpendUsd: 4,
        monthlyCapUsd: 10,
        genresExplored: ["Soul", "Jazz"],
        genreBreakdown: { Soul: 3, Jazz: 1 },
        tasteScore: 72,
        stemQualityRatings: 2,
        curatorReputationDelta: 3,
      },
      new Date("2026-04-26T12:00:00.000Z"),
    );

    const payload = buildAgentReputationAttestationPayload({
      config: {
        id: "agent_1",
        userId: "0xowner",
        name: "Koita DJ",
        vibes: ["Soul"],
        stemTypes: ["vocals", "drums"],
        monthlyCapUsd: 10,
        identityStatus: "minted",
        identityChainId: 84532,
        identityRegistry: "0x1234567890123456789012345678901234567890",
        identityTokenId: "42",
        identityTxHash: "0xmint",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
      reputationSnapshot: reputation,
      identityCredential: { id: "urn:credential:agent_1" },
      chainId: 84532,
      registry: "0x1234567890123456789012345678901234567890",
      tokenId: "42",
    });

    expect(payload).toMatchObject({
      schemaVersion: AGENT_REPUTATION_ATTESTATION_SCHEMA_VERSION,
      metadataKey: AGENT_REPUTATION_METADATA_KEY,
      issuedAt: "2026-04-26T12:00:00.000Z",
      agent: {
        id: "agent_1",
        owner: "0xowner",
        name: "Koita DJ",
        monthlyCapUsd: 10,
      },
      erc8004: {
        status: "minted",
        chainId: 84532,
        registry: "0x1234567890123456789012345678901234567890",
        tokenId: "42",
        agentRegistry: "eip155:84532:0x1234567890123456789012345678901234567890",
      },
      curation: {
        sessions: 8,
        tracksCurated: 5,
        stemQualityRatings: 2,
        curatorReputationDelta: 3,
      },
      budget: {
        totalSpendUsd: 4,
        monthlyCapUsd: 10,
        avgBudgetUtilization: 0.4,
      },
      taste: {
        score: 72,
        genresExplored: ["Soul", "Jazz"],
        genreBreakdown: { Soul: 0.75, Jazz: 0.25 },
      },
      credential: { id: "urn:credential:agent_1" },
    });
  });

  it("keeps attestation export deterministic when ERC-8004 is not configured", () => {
    const reputation = computeAgentReputationSnapshot(
      {
        sessions: 1,
        tracksCurated: 0,
        totalSpendUsd: 0,
        monthlyCapUsd: 10,
        genresExplored: ["Focus"],
      },
      new Date("2026-04-26T13:00:00.000Z"),
    );

    const payload = buildAgentReputationAttestationPayload({
      config: {
        id: "agent_local",
        userId: "0xowner",
        name: "Local DJ",
        vibes: ["Focus"],
        stemTypes: [],
        monthlyCapUsd: 10,
        identityStatus: "local",
        identityChainId: null,
        identityRegistry: null,
        identityTokenId: null,
        identityTxHash: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
      reputationSnapshot: reputation,
      identityCredential: { id: "urn:credential:local" },
      chainId: null,
      registry: null,
      tokenId: null,
    });

    expect(payload.erc8004).toEqual({
      status: "local",
      chainId: null,
      registry: null,
      tokenId: null,
      txHash: null,
      agentRegistry: null,
    });
    expect(payload.issuedAt).toBe("2026-04-26T13:00:00.000Z");
  });

  it("encodes reputation attestations for ERC-8004 setMetadata", () => {
    const reputation = computeAgentReputationSnapshot(
      {
        sessions: 2,
        tracksCurated: 2,
        totalSpendUsd: 1,
        monthlyCapUsd: 10,
        genresExplored: ["House"],
      },
      new Date("2026-04-26T14:00:00.000Z"),
    );
    const payload = buildAgentReputationAttestationPayload({
      config: {
        id: "agent_2",
        userId: "0xowner",
        name: "Minted DJ",
        vibes: ["House"],
        stemTypes: ["drums"],
        monthlyCapUsd: 10,
        identityStatus: "minted",
        identityChainId: 84532,
        identityRegistry: "0x1234567890123456789012345678901234567890",
        identityTokenId: "7",
        identityTxHash: "0xmint",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
      reputationSnapshot: reputation,
      identityCredential: { id: "urn:credential:agent_2" },
      chainId: 84532,
      registry: "0x1234567890123456789012345678901234567890",
      tokenId: "7",
    });

    const data = encodeAgentReputationMetadataCall({ tokenId: "7", payload });
    const decoded = decodeFunctionData({ abi: ERC8004_IDENTITY_ABI, data });
    const [tokenId, metadataKey, metadataValue] = decoded.args as readonly [bigint, string, `0x${string}`];

    expect(decoded.functionName).toBe("setMetadata");
    expect(tokenId).toBe(7n);
    expect(metadataKey).toBe(AGENT_REPUTATION_METADATA_KEY);
    expect(JSON.parse(hexToString(metadataValue))).toMatchObject({
      schemaVersion: AGENT_REPUTATION_ATTESTATION_SCHEMA_VERSION,
      metadataKey: AGENT_REPUTATION_METADATA_KEY,
      agent: { id: "agent_2" },
      erc8004: { tokenId: "7" },
    });
  });

  it("builds ERC-8004 registry identifiers", () => {
    expect(buildAgentRegistryId(84532, "0x1234567890123456789012345678901234567890"))
      .toBe("eip155:84532:0x1234567890123456789012345678901234567890");
  });

  it("selects official ERC-8004 registry defaults by network class", () => {
    expect(defaultErc8004IdentityRegistry(84532)).toBe(ERC8004_TESTNET_IDENTITY_REGISTRY);
    expect(defaultErc8004IdentityRegistry(1)).toBe(ERC8004_MAINNET_IDENTITY_REGISTRY);
  });

  it("builds an ERC-8004 registration file from agent config", () => {
    const file = buildAgentRegistrationFile({
      config: {
        id: "agent_1",
        name: "Koita DJ",
        vibes: ["House", "Jazz"],
        stemTypes: ["drums"],
        isActive: true,
        identityTokenId: "42",
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
